-- Exámenes por escenarios (p. ej. Claude Certified Architect – Foundations): cada examen puede tener
-- una lista de escenarios y cada pregunta puede pertenecer a uno. En un simulacro se eligen al azar
-- `scenario_count` escenarios y las preguntas se presentan agrupadas por escenario, con su texto al lado.
-- Se puede ejecutar más de una vez.

alter table public.exams add column if not exists scenarios jsonb not null default '[]'::jsonb;
alter table public.exams add column if not exists scenario_count int;
alter table public.questions add column if not exists scenario text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'exams_scenarios_array') then
    alter table public.exams add constraint exams_scenarios_array check (jsonb_typeof(scenarios) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'exams_scenario_count_range') then
    alter table public.exams add constraint exams_scenario_count_range check (scenario_count is null or scenario_count between 1 and 50);
  end if;
end $$;

-- La importación de exámenes guarda también los escenarios (campos opcionales "scenarios",
-- "exam.scenario_count" y "scenario" en cada pregunta).
create or replace function public.import_exam_unchecked(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam uuid;
  v_dom jsonb;
  v_q jsonb;
  v_domain uuid;
  v_count int := 0;
begin
  if jsonb_typeof(p->'domains') <> 'array' or jsonb_array_length(p->'domains') = 0 then
    raise exception 'El examen debe tener al menos un dominio';
  end if;
  if jsonb_typeof(p->'questions') <> 'array' then raise exception 'Falta la lista de preguntas'; end if;
  if p ? 'scenarios' and jsonb_typeof(p->'scenarios') <> 'array' then raise exception 'Los escenarios deben ser una lista'; end if;

  insert into public.exams (slug, vendor, code, name, description, language,
                            sim_questions, sim_minutes, mini_questions, mini_minutes, passing_note,
                            scenarios, scenario_count)
  values (p->>'slug', p->>'vendor', coalesce(p->>'code', ''), p->>'name', coalesce(p->>'description', ''),
          coalesce(p->>'language', 'es'),
          (p#>>'{exam,questions}')::int, (p#>>'{exam,minutes}')::int,
          (p#>>'{exam,mini,questions}')::int, (p#>>'{exam,mini,minutes}')::int,
          coalesce(p#>>'{exam,passing}', ''),
          coalesce(p->'scenarios', '[]'::jsonb), (p#>>'{exam,scenario_count}')::int)
  on conflict (slug) do update set
    vendor = excluded.vendor, code = excluded.code, name = excluded.name,
    description = excluded.description, language = excluded.language,
    sim_questions = excluded.sim_questions, sim_minutes = excluded.sim_minutes,
    mini_questions = excluded.mini_questions, mini_minutes = excluded.mini_minutes,
    passing_note = excluded.passing_note,
    scenarios = excluded.scenarios, scenario_count = excluded.scenario_count,
    updated_at = now()
  returning id into v_exam;

  for v_dom in select * from jsonb_array_elements(p->'domains') loop
    insert into public.domains (exam_id, code, name, weight, docs)
    values (v_exam, v_dom->>'code', v_dom->>'name', (v_dom->>'weight')::numeric, coalesce(v_dom->'docs', '[]'::jsonb))
    on conflict (exam_id, code) do update set
      name = excluded.name, weight = excluded.weight,
      docs = case when v_dom ? 'docs' then excluded.docs else public.domains.docs end;
  end loop;

  delete from public.questions where exam_id = v_exam and source in ('bank', 'official_sample');

  for v_q in select * from jsonb_array_elements(p->'questions') loop
    select id into v_domain from public.domains where exam_id = v_exam and code = v_q->>'domain';
    if v_domain is null then raise exception 'Dominio desconocido en una pregunta: %', v_q->>'domain'; end if;
    insert into public.questions (exam_id, domain_id, source, stem, options, correct, explanation, author_id, i18n, scenario)
    values (v_exam, v_domain,
            case when v_q->>'source' = 'official_sample' then 'official_sample' else 'bank' end,
            v_q->>'stem', v_q->'options',
            array(select jsonb_array_elements_text(v_q->'correct')::int),
            coalesce(v_q->>'explanation', ''), null,
            coalesce(v_q->'i18n', '{}'::jsonb), nullif(v_q->>'scenario', ''));
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('exam_id', v_exam, 'questions', v_count);
end;
$$;
revoke all on function public.import_exam_unchecked(jsonb) from public, anon, authenticated;
