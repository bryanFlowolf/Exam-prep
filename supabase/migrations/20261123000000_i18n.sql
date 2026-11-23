-- Traducciones de las preguntas (por ahora, inglés).
-- questions.i18n guarda las versiones en otros idiomas: {"en": {"stem": ..., "options": [...], "explanation": ...}}.
-- Las opciones traducidas van en el mismo orden que las originales, así que correct sirve para todas.

create or replace function public.valid_i18n(p_i18n jsonb, p_options jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_i18n) = 'object'
     and coalesce((
       select bool_and(
                k ~ '^[a-z]{2}(-[A-Z]{2})?$'
            and jsonb_typeof(v) = 'object'
            and jsonb_typeof(v->'stem') = 'string'
            and char_length(v->>'stem') between 10 and 3000
            and jsonb_typeof(v->'options') = 'array'
            and jsonb_array_length(v->'options') = jsonb_array_length(p_options)
            and (select bool_and(jsonb_typeof(o) = 'string' and char_length(o #>> '{}') between 1 and 600)
                 from jsonb_array_elements(v->'options') o)
            and (v->'explanation' is null or (jsonb_typeof(v->'explanation') = 'string'
                                               and char_length(v->>'explanation') <= 3000)))
       from jsonb_each(p_i18n) as e(k, v)), true);
$$;

alter table public.questions
  add column if not exists i18n jsonb not null default '{}'::jsonb;

alter table public.questions drop constraint if exists questions_valid_i18n;
alter table public.questions
  add constraint questions_valid_i18n check (public.valid_i18n(i18n, options));

-- La importación de exámenes también guarda las traducciones.
create or replace function public.import_exam_unchecked(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam uuid;
  v_dom record;
  v_q jsonb;
  v_domain uuid;
  v_count int := 0;
  v_codes text[];
begin
  if jsonb_typeof(p->'domains') <> 'array' or jsonb_array_length(p->'domains') = 0 then
    raise exception 'El examen debe tener al menos un dominio';
  end if;
  if jsonb_typeof(p->'questions') <> 'array' then raise exception 'Falta la lista de preguntas'; end if;

  insert into public.exams (slug, vendor, code, name, description, language,
                            sim_questions, sim_minutes, mini_questions, mini_minutes, passing_note)
  values (p->>'slug', p->>'vendor', coalesce(p->>'code', ''), p->>'name', coalesce(p->>'description', ''),
          coalesce(p->>'language', 'es'),
          (p#>>'{exam,questions}')::int, (p#>>'{exam,minutes}')::int,
          (p#>>'{exam,mini,questions}')::int, (p#>>'{exam,mini,minutes}')::int,
          coalesce(p#>>'{exam,passing}', ''))
  on conflict (slug) do update set
    vendor = excluded.vendor, code = excluded.code, name = excluded.name,
    description = excluded.description, language = excluded.language,
    sim_questions = excluded.sim_questions, sim_minutes = excluded.sim_minutes,
    mini_questions = excluded.mini_questions, mini_minutes = excluded.mini_minutes,
    passing_note = excluded.passing_note, updated_at = now()
  returning id into v_exam;

  select array_agg(d->>'code') into v_codes from jsonb_array_elements(p->'domains') d;
  for v_dom in select * from jsonb_to_recordset(p->'domains') as x(code text, name text, weight numeric) loop
    insert into public.domains (exam_id, code, name, weight)
    values (v_exam, v_dom.code, v_dom.name, v_dom.weight)
    on conflict (exam_id, code) do update set name = excluded.name, weight = excluded.weight;
  end loop;

  delete from public.questions where exam_id = v_exam and source in ('bank', 'official_sample');

  for v_q in select * from jsonb_array_elements(p->'questions') loop
    select id into v_domain from public.domains where exam_id = v_exam and code = v_q->>'domain';
    if v_domain is null then raise exception 'Dominio desconocido en una pregunta: %', v_q->>'domain'; end if;
    insert into public.questions (exam_id, domain_id, source, stem, options, correct, explanation, author_id, i18n)
    values (v_exam, v_domain,
            case when v_q->>'source' = 'official_sample' then 'official_sample' else 'bank' end,
            v_q->>'stem', v_q->'options',
            array(select jsonb_array_elements_text(v_q->'correct')::int),
            coalesce(v_q->>'explanation', ''), null,
            coalesce(v_q->'i18n', '{}'::jsonb));
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('exam_id', v_exam, 'questions', v_count);
end;
$$;

revoke all on function public.import_exam_unchecked(jsonb) from public, anon, authenticated;
