-- Preparación, calidad del banco y equipos.
--
-- Qué añade:
--   domains.docs            Enlaces a la documentación oficial de cada dominio ("Para saber más").
--   question_reports        Reportes de preguntas (ambigua, respuesta discutible, traducción...).
--                           Quien reporta ve los suyos; los administradores ven y resuelven todos.
--   question_stats          Estadísticas ANÓNIMAS por pregunta: veces respondida, aciertos y cuántas
--                           veces se eligió cada opción. No guarda quién respondió.
--   exam_plans              Fecha prevista de examen de cada persona (solo su dueño).
--   teams, team_members     Equipos creados por administradores. Cada miembro decide si comparte
--                           su progreso; los responsables del equipo solo ven el de quien lo comparte.
--
-- La regla de privacidad se mantiene: los intentos, la lista de repaso y las preguntas vistas
-- siguen siendo solo de su dueño. team_progress() devuelve un resumen únicamente de los miembros
-- que han activado "compartir progreso" y solo a los responsables de ese equipo.
--
-- Se puede ejecutar varias veces.

-- ---------------------------------------------------------------------------
-- Nuevo modo de intento: práctica dirigida a los dominios más flojos
-- ---------------------------------------------------------------------------
alter table public.attempts drop constraint if exists attempts_mode_check;
alter table public.attempts add constraint attempts_mode_check
  check (mode in ('sim', 'mini', 'practice', 'review', 'team', 'last_wrong', 'targeted'));

-- ---------------------------------------------------------------------------
-- Enlaces de documentación por dominio
-- ---------------------------------------------------------------------------
create or replace function public.valid_docs(p jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p) = 'array'
     and jsonb_array_length(p) <= 10
     and coalesce((
       select bool_and(
                jsonb_typeof(d) = 'object'
            and jsonb_typeof(d->'title') = 'string'
            and char_length(d->>'title') between 1 and 200
            and jsonb_typeof(d->'url') = 'string'
            and char_length(d->>'url') <= 500
            and d->>'url' ~ '^https://[^\s]+$')
       from jsonb_array_elements(p) d), true);
$$;

alter table public.domains add column if not exists docs jsonb not null default '[]'::jsonb;
alter table public.domains drop constraint if exists domains_valid_docs;
alter table public.domains add constraint domains_valid_docs check (public.valid_docs(docs));

-- ---------------------------------------------------------------------------
-- Reportes de preguntas
-- ---------------------------------------------------------------------------
create table if not exists public.question_reports (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles (id) on delete set null,
  reason text not null check (reason in ('ambigua', 'respuesta', 'traduccion', 'errata', 'otro')),
  comment text not null default '' check (char_length(comment) <= 1000),
  lang text not null default 'es' check (lang ~ '^[a-z]{2}$'),
  status text not null default 'abierto' check (status in ('abierto', 'resuelto', 'descartado')),
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null
);
create index if not exists question_reports_status_idx on public.question_reports (status, created_at desc);
-- Una persona tiene como mucho un reporte abierto por pregunta.
create unique index if not exists question_reports_one_open
  on public.question_reports (user_id, question_id) where status = 'abierto';

-- El examen del reporte siempre es el de la pregunta, y al resolver se anota quién y cuándo.
create or replace function public.question_reports_fill()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  select exam_id into new.exam_id from public.questions where id = new.question_id;
  if tg_op = 'UPDATE' and new.status <> old.status then
    if new.status = 'abierto' then
      new.resolved_at := null; new.resolved_by := null;
    else
      new.resolved_at := now(); new.resolved_by := auth.uid();
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists question_reports_fill on public.question_reports;
create trigger question_reports_fill
  before insert or update on public.question_reports
  for each row execute function public.question_reports_fill();

alter table public.question_reports enable row level security;
drop policy if exists reports_insert_own on public.question_reports;
create policy reports_insert_own on public.question_reports for insert to authenticated
  with check (user_id = auth.uid() and status = 'abierto');
drop policy if exists reports_read on public.question_reports;
create policy reports_read on public.question_reports for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists reports_admin_update on public.question_reports;
create policy reports_admin_update on public.question_reports for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists reports_delete on public.question_reports;
create policy reports_delete on public.question_reports for delete to authenticated
  using (public.is_admin() or (user_id = auth.uid() and status = 'abierto'));

revoke all on public.question_reports from authenticated;
grant select, delete on public.question_reports to authenticated;
grant insert (question_id, exam_id, reason, comment, lang) on public.question_reports to authenticated;
grant update (status, admin_note) on public.question_reports to authenticated;

-- ---------------------------------------------------------------------------
-- Estadísticas anónimas por pregunta
-- ---------------------------------------------------------------------------
create table if not exists public.question_stats (
  question_id uuid primary key references public.questions (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  answered int not null default 0,       -- todas las respuestas
  correct int not null default 0,
  first_answered int not null default 0, -- solo la primera vez que cada persona la responde
  first_correct int not null default 0,
  picks int[] not null default '{}',     -- veces elegida cada opción, por índice original
  updated_at timestamptz not null default now()
);
create index if not exists question_stats_exam_idx on public.question_stats (exam_id);

alter table public.question_stats enable row level security;
drop policy if exists stats_read on public.question_stats;
create policy stats_read on public.question_stats for select to authenticated using (
  exists (select 1 from public.exams e where e.id = exam_id and (e.is_published or public.is_admin()))
);
revoke all on public.question_stats from authenticated;
grant select on public.question_stats to authenticated;

-- Suma las respuestas de un intento a las estadísticas. Se llama al terminar un intento y ANTES
-- de marcar las preguntas como vistas, para saber si era la primera vez. El acierto se calcula
-- aquí con la respuesta correcta guardada, no con lo que diga el navegador.
-- p: [{"q": "<uuid>", "pick": [0, 2]}, ...] con índices de opción originales.
create or replace function public.record_answers(p_exam uuid, p jsonb)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_q public.questions%rowtype;
  v_pick int[];
  v_right boolean;
  v_first boolean;
  v_n int;
  v_count int := 0;
begin
  if v_uid is null then raise exception 'Sin sesión'; end if;
  if jsonb_typeof(p) <> 'array' then raise exception 'Formato no válido'; end if;
  if jsonb_array_length(p) > 500 then raise exception 'Demasiadas respuestas en una sola llamada'; end if;

  for v_item in select * from jsonb_array_elements(p) loop
    select * into v_q from public.questions
      where id = (v_item->>'q')::uuid and exam_id = p_exam and is_active;
    if not found then continue; end if;
    v_n := jsonb_array_length(v_q.options);
    select coalesce(array_agg(distinct x order by x), '{}') into v_pick
      from (select (jsonb_array_elements_text(coalesce(v_item->'pick', '[]'::jsonb)))::int as x) s
      where x >= 0 and x < v_n;
    v_right := v_pick = (select array_agg(c order by c) from unnest(v_q.correct) c);
    v_first := not exists (select 1 from public.seen_questions s where s.user_id = v_uid and s.question_id = v_q.id);

    insert into public.question_stats as st (question_id, exam_id, answered, correct, first_answered, first_correct, picks)
    values (v_q.id, v_q.exam_id, 1, v_right::int, v_first::int, (v_first and v_right)::int,
            array(select (i - 1 = any(v_pick))::int from generate_series(1, v_n) i))
    on conflict (question_id) do update set
      answered = st.answered + 1,
      correct = st.correct + v_right::int,
      first_answered = st.first_answered + v_first::int,
      first_correct = st.first_correct + (v_first and v_right)::int,
      picks = array(select coalesce(st.picks[i], 0) + (i - 1 = any(v_pick))::int from generate_series(1, v_n) i),
      updated_at = now();
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.record_answers(uuid, jsonb) from public, anon;
grant execute on function public.record_answers(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Fecha prevista de examen (solo su dueño)
-- ---------------------------------------------------------------------------
create table if not exists public.exam_plans (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  target_date date,
  updated_at timestamptz not null default now(),
  primary key (user_id, exam_id)
);
alter table public.exam_plans enable row level security;
drop policy if exists plans_own on public.exam_plans;
create policy plans_own on public.exam_plans for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.exam_plans to authenticated;

-- ---------------------------------------------------------------------------
-- Equipos
-- ---------------------------------------------------------------------------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('lead', 'member')),
  shares_progress boolean not null default false,
  added_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
create index if not exists team_members_user_idx on public.team_members (user_id);

create or replace function public.is_team_member(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where team_id = p_team and user_id = auth.uid());
$$;
create or replace function public.is_team_lead(p_team uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.team_members where team_id = p_team and user_id = auth.uid() and role = 'lead');
$$;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

drop policy if exists teams_read on public.teams;
create policy teams_read on public.teams for select to authenticated
  using (public.is_admin() or public.is_team_member(id));
drop policy if exists teams_admin on public.teams;
create policy teams_admin on public.teams for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Cada persona ve sus filas; los responsables ven a los miembros de su equipo; los administradores, todo.
drop policy if exists team_members_read on public.team_members;
create policy team_members_read on public.team_members for select to authenticated
  using (public.is_admin() or user_id = auth.uid() or public.is_team_lead(team_id));
drop policy if exists team_members_admin on public.team_members;
create policy team_members_admin on public.team_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.teams to authenticated;
revoke all on public.team_members from authenticated;
grant select, insert, delete on public.team_members to authenticated;
grant update (role) on public.team_members to authenticated;

-- Cada miembro decide si comparte su progreso con su equipo (nadie más puede cambiarlo, ni un administrador).
create or replace function public.set_share_progress(p_team uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_members set shares_progress = p_value
  where team_id = p_team and user_id = auth.uid();
  if not found then raise exception 'No perteneces a este equipo'; end if;
end;
$$;
revoke execute on function public.set_share_progress(uuid, boolean) from public, anon;
grant execute on function public.set_share_progress(uuid, boolean) to authenticated;

-- Resumen de progreso del equipo para sus responsables.
-- Devuelve una fila por miembro y examen practicado. De quien no comparte solo devuelve el nombre.
-- by_domain suma los aciertos por dominio de sus últimos 20 intentos que cuentan para la
-- preparación (simulacro, mini-examen y práctica); la app calcula con él la misma estimación
-- que ve cada persona en su panel.
create or replace function public.team_progress(p_team uuid)
returns table (
  user_id uuid,
  display_name text,
  role text,
  shares_progress boolean,
  exam_id uuid,
  attempts int,
  answered int,
  last_at timestamptz,
  last_sim_pct int,
  by_domain jsonb,
  target_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_team_lead(p_team) then
    raise exception 'Solo los responsables del equipo pueden ver su progreso';
  end if;
  return query
  with members as (
    select m.user_id, p.display_name, m.role, m.shares_progress
    from public.team_members m join public.profiles p on p.id = m.user_id
    where m.team_id = p_team
  ),
  recent as (
    select a.*, row_number() over (partition by a.user_id, a.exam_id order by a.finished_at desc) as rn
    from public.attempts a
    join members mm on mm.user_id = a.user_id and mm.shares_progress
    where a.mode in ('sim', 'mini', 'practice')
  ),
  dom as (
    select r.user_id, r.exam_id,
           jsonb_object_agg(k, jsonb_build_object('ok', ok, 'total', total)) as by_domain
    from (
      select r.user_id, r.exam_id, d.key as k,
             sum((d.value->>'ok')::int) as ok, sum((d.value->>'total')::int) as total
      from recent r, jsonb_each(r.by_domain) d
      where r.rn <= 20
      group by r.user_id, r.exam_id, d.key
    ) r
    group by r.user_id, r.exam_id
  ),
  agg as (
    select r.user_id, r.exam_id, count(*)::int as attempts, sum(r.total)::int as answered,
           max(r.finished_at) as last_at,
           (array_agg(case when r.total > 0 then round(100.0 * r.correct / r.total)::int end
                      order by r.finished_at desc) filter (where r.mode = 'sim'))[1] as last_sim_pct
    from recent r
    group by r.user_id, r.exam_id
  )
  select m.user_id, m.display_name, m.role, m.shares_progress,
         g.exam_id, g.attempts, g.answered, g.last_at, g.last_sim_pct, d.by_domain,
         (select ep.target_date from public.exam_plans ep where ep.user_id = m.user_id and ep.exam_id = g.exam_id)
  from members m
  left join agg g on g.user_id = m.user_id
  left join dom d on d.user_id = g.user_id and d.exam_id = g.exam_id
  order by m.display_name, g.last_at desc nulls last;
end;
$$;
revoke execute on function public.team_progress(uuid) from public, anon;
grant execute on function public.team_progress(uuid) to authenticated;

grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_team_lead(uuid) to authenticated;
grant execute on function public.valid_docs(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- La importación de exámenes también guarda los enlaces de cada dominio (campo opcional "docs").
-- ---------------------------------------------------------------------------
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
