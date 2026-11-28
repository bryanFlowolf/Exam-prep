-- Plan de estudio, repaso espaciado, resultados oficiales y panel del responsable.
--
-- Qué añade:
--   attempts.mode           Dos modos nuevos: 'daily' (sesión del plan de hoy) y 'spaced' (repaso espaciado).
--                           Ninguno de los dos cuenta para la nota estimada: se centran en lo que fallaste.
--   review_items            Programación del repaso espaciado: próxima fecha (due_at), intervalo en días,
--                           facilidad y aciertos seguidos. Siguen siendo solo de su dueño.
--   exam_plans              Minutos al día y días de la semana que cada persona dedica a estudiar.
--   exam_results            Resultado oficial del examen (aprobado, nota opcional) con la predicción que
--                           tenía la app ese día. Solo su dueño lo ve.
--   prediction_calibration  Agregado ANÓNIMO de predicción frente a resultado real, para corregir la nota
--                           estimada. Con menos de 3 resultados no devuelve cifras.
--   team_activity           Constancia, repasos pendientes y resultado oficial de los miembros que comparten
--                           su progreso, solo para los responsables del equipo.
--
-- Se puede ejecutar varias veces.

-- ---------------------------------------------------------------------------
-- Modos de intento
-- ---------------------------------------------------------------------------
alter table public.attempts drop constraint if exists attempts_mode_check;
alter table public.attempts add constraint attempts_mode_check
  check (mode in ('sim', 'mini', 'practice', 'review', 'team', 'last_wrong', 'targeted', 'daily', 'spaced'));

-- ---------------------------------------------------------------------------
-- Repaso espaciado
-- ---------------------------------------------------------------------------
alter table public.review_items add column if not exists due_at timestamptz;
alter table public.review_items add column if not exists interval_days real not null default 0;
alter table public.review_items add column if not exists ease real not null default 2.3;
alter table public.review_items add column if not exists streak int not null default 0;
alter table public.review_items drop constraint if exists review_items_srs_check;
alter table public.review_items add constraint review_items_srs_check
  check (interval_days >= 0 and interval_days <= 400 and ease between 1.3 and 3.0 and streak >= 0);
create index if not exists review_due_idx on public.review_items (user_id, exam_id, due_at);

-- ---------------------------------------------------------------------------
-- Preferencias del plan de estudio
-- ---------------------------------------------------------------------------
alter table public.exam_plans add column if not exists daily_minutes int not null default 30;
alter table public.exam_plans add column if not exists study_days smallint[] not null default '{1,2,3,4,5}';
alter table public.exam_plans drop constraint if exists exam_plans_prefs_check;
alter table public.exam_plans add constraint exam_plans_prefs_check
  check (daily_minutes between 5 and 240
     and cardinality(study_days) between 1 and 7
     and study_days <@ '{0,1,2,3,4,5,6}'::smallint[]);

-- ---------------------------------------------------------------------------
-- Resultados oficiales
-- ---------------------------------------------------------------------------
create table if not exists public.exam_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  taken_on date not null,
  passed boolean not null,
  score real check (score is null or score between 0 and 1),        -- nota como fracción (720/1000 → 0.72)
  predicted_estimate real check (predicted_estimate is null or predicted_estimate between 0 and 1),
  predicted_probability real check (predicted_probability is null or predicted_probability between 0 and 1),
  predicted_answers int not null default 0 check (predicted_answers >= 0),
  pass_mark real check (pass_mark is null or pass_mark between 0 and 1),
  created_at timestamptz not null default now(),
  unique (user_id, exam_id, taken_on)
);
create index if not exists exam_results_exam_idx on public.exam_results (exam_id);
alter table public.exam_results enable row level security;
drop policy if exists results_own on public.exam_results;
create policy results_own on public.exam_results for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.exam_results from authenticated;
grant select, insert, update, delete on public.exam_results to authenticated;

-- Predicción frente a resultado real, sin datos personales. p_exam nulo = todos los exámenes.
-- Solo cuenta resultados con una predicción basada en al menos 20 respuestas.
--   mean_bias  media de (nota estimada − nota real) en los resultados con nota; positivo = la app sobrestima.
--   sd_resid   desviación típica de esa diferencia.
--   brier      error cuadrático medio de la probabilidad de aprobar frente a aprobado/suspendido.
--   bins       por tramo de probabilidad prevista: cuántos resultados y cuántos aprobados.
create or replace function public.prediction_calibration(p_exam uuid default null)
returns table (n int, n_scored int, mean_bias real, sd_resid real, brier real, pass_rate real, mean_prob real, bins jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_n int;
  v_ns int;
begin
  if auth.uid() is null then raise exception 'Sin sesión'; end if;
  select count(*), count(*) filter (where r.score is not null and r.predicted_estimate is not null)
    into v_n, v_ns
    from public.exam_results r
    where (p_exam is null or r.exam_id = p_exam) and r.predicted_probability is not null and r.predicted_answers >= 20;
  -- Con muy pocos resultados las cifras permitirían deducir el de una persona concreta.
  if v_n < 3 then
    return query select v_n, v_ns, null::real, null::real, null::real, null::real, null::real, null::jsonb;
    return;
  end if;
  return query
  with r as (
    select * from public.exam_results x
    where (p_exam is null or x.exam_id = p_exam) and x.predicted_probability is not null and x.predicted_answers >= 20
  ),
  b as (
    select least(4, floor(r.predicted_probability * 5))::int as k, count(*)::int as cnt, count(*) filter (where r.passed)::int as ok
    from r group by 1
  )
  select v_n,
         v_ns,
         case when v_ns >= 3 then (select avg(r.predicted_estimate - r.score) from r where r.score is not null and r.predicted_estimate is not null)::real end,
         case when v_ns >= 3 then (select stddev_samp(r.predicted_estimate - r.score) from r where r.score is not null and r.predicted_estimate is not null)::real end,
         (select avg((r.predicted_probability - r.passed::int) ^ 2) from r)::real,
         (select avg(r.passed::int) from r)::real,
         (select avg(r.predicted_probability) from r)::real,
         (select jsonb_agg(jsonb_build_object('lo', b.k * 0.2, 'hi', b.k * 0.2 + 0.2, 'n', b.cnt, 'passed', b.ok) order by b.k) from b);
end;
$$;
revoke execute on function public.prediction_calibration(uuid) from public, anon;
grant execute on function public.prediction_calibration(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Panel del responsable: constancia, repasos pendientes y resultado oficial
-- ---------------------------------------------------------------------------
-- Solo para responsables del equipo y solo de los miembros que comparten su progreso.
-- Nunca devuelve preguntas ni respuestas: solo recuentos por persona y examen.
create or replace function public.team_activity(p_team uuid)
returns table (
  user_id uuid,
  exam_id uuid,
  active_days_14 int,
  answered_7 int,
  due_reviews int,
  daily_minutes int,
  result_on date,
  result_passed boolean
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
    select m.user_id from public.team_members m where m.team_id = p_team and m.shares_progress
  ),
  pairs as (
    select distinct a.user_id, a.exam_id from public.attempts a join members mm on mm.user_id = a.user_id
    union
    select distinct r.user_id, r.exam_id from public.exam_results r join members mm on mm.user_id = r.user_id
  )
  select p.user_id, p.exam_id,
         (select count(distinct (a.finished_at at time zone 'UTC')::date)::int from public.attempts a
            where a.user_id = p.user_id and a.exam_id = p.exam_id and a.finished_at > now() - interval '14 days'),
         (select coalesce(sum(a.total), 0)::int from public.attempts a
            where a.user_id = p.user_id and a.exam_id = p.exam_id and a.finished_at > now() - interval '7 days'),
         (select count(*)::int from public.review_items ri join public.questions q on q.id = ri.question_id and q.is_active
            where ri.user_id = p.user_id and ri.exam_id = p.exam_id
              and coalesce(ri.due_at, ri.last_at + case when ri.last_result = 'acertada' then interval '3 days' else interval '1 day' end) <= now()),
         (select ep.daily_minutes from public.exam_plans ep where ep.user_id = p.user_id and ep.exam_id = p.exam_id),
         lr.taken_on, lr.passed
  from pairs p
  left join lateral (
    select r.taken_on, r.passed from public.exam_results r
    where r.user_id = p.user_id and r.exam_id = p.exam_id order by r.taken_on desc limit 1
  ) lr on true;
end;
$$;
revoke execute on function public.team_activity(uuid) from public, anon;
grant execute on function public.team_activity(uuid) to authenticated;
