-- WolfPack Academy: tutor con IA y formación interna (PRL, onboarding, tecnologías…)
--
--   tutor_usage          Consultas diarias al tutor por persona (solo la función del servidor la usa).
--   profiles.is_editor   Rol «editor de formación»: crea cursos, asigna y ve el cumplimiento,
--                        sin acceso al resto de la administración.
--   courses              Cursos internos: lecciones + test final, aprobado, firma de conformidad y caducidad.
--   course_lessons       Lecciones (texto, vídeo, PDF o enlace).
--   course_questions     Preguntas del test. Las respuestas correctas solo las ven los editores;
--                        el test se pide y se corrige en el servidor (course_quiz / submit_course).
--   course_assignments   Asignaciones a personas o equipos, con fecha límite opcional.
--   lesson_progress      Lecciones completadas por cada persona.
--   course_completions   Registro de cada intento del test: nota, aprobado, firma (texto y fecha) y caducidad.
--                        No se puede modificar ni borrar desde la app: es la evidencia de la formación.
--                        Un curso con registros no se puede borrar (solo despublicar).
--
-- Solo ven un curso las personas que lo tienen asignado (y los administradores y editores de formación).
--
-- Se puede ejecutar más de una vez.

-- ---------------------------------------------------------------------------
-- Tutor
-- ---------------------------------------------------------------------------
create table if not exists public.tutor_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);
alter table public.tutor_usage enable row level security;
revoke all on public.tutor_usage from authenticated, anon;

-- Suma una consulta si no se ha llegado al límite diario. Solo la llama la función del servidor.
create or replace function public.tutor_take(p_user uuid, p_limit int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v int;
begin
  insert into public.tutor_usage as t (user_id, day, count) values (p_user, current_date, 1)
  on conflict (user_id, day) do update set count = t.count + 1 where t.count < p_limit
  returning count into v;
  return v is not null;
end;
$$;
revoke execute on function public.tutor_take(uuid, int) from public, anon, authenticated;

-- Versión para la persona con sesión (la usa la función del tutor con el token del usuario).
-- Solo puede sumar consultas a su propio contador; el límite real lo fija el servidor.
create or replace function public.tutor_use(p_limit int)
returns boolean
language sql
security definer
set search_path = public
as $$
  select case when auth.uid() is null then false else public.tutor_take(auth.uid(), p_limit) end;
$$;
revoke execute on function public.tutor_use(int) from public, anon;
grant execute on function public.tutor_use(int) to authenticated;

-- ---------------------------------------------------------------------------
-- Rol editor de formación
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_editor boolean not null default false;

create or replace function public.can_edit_training()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin or is_editor from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.set_editor(p_user uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede hacer esto'; end if;
  update public.profiles set is_editor = p_value where id = p_user;
end;
$$;

-- Personas con su email, para asignar formación y para el panel de cumplimiento.
create or replace function public.training_people()
returns table (user_id uuid, display_name text, email text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.can_edit_training() then raise exception 'Sin permiso'; end if;
  return query
    select p.id, p.display_name, u.email::text
    from public.profiles p join auth.users u on u.id = p.id
    order by coalesce(nullif(p.display_name, ''), u.email::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- Cursos
-- ---------------------------------------------------------------------------
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  summary text not null default '' check (char_length(summary) <= 2000),
  category text not null default 'general' check (category in ('prl', 'onboarding', 'tecnologia', 'compliance', 'general')),
  pass_pct int not null default 80 check (pass_pct between 0 and 100),
  quiz_size int check (quiz_size is null or quiz_size between 1 and 200),
  requires_ack boolean not null default true,
  ack_text text not null default 'Declaro que he recibido esta formación y que he leído y comprendido su contenido.' check (char_length(ack_text) <= 2000),
  validity_months int check (validity_months is null or validity_months between 1 and 120),
  is_published boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_lessons (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  position int not null default 0,
  title text not null check (char_length(title) between 1 and 200),
  kind text not null default 'text' check (kind in ('text', 'video', 'pdf', 'link')),
  body text not null default '' check (char_length(body) <= 100000),
  url text not null default '' check (char_length(url) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists course_lessons_course_idx on public.course_lessons (course_id, position);

create table if not exists public.course_questions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  position int not null default 0,
  stem text not null check (char_length(stem) between 1 and 4000),
  options text[] not null check (array_length(options, 1) between 2 and 6),
  correct int[] not null check (array_length(correct, 1) >= 1),
  explanation text not null default '' check (char_length(explanation) <= 4000),
  created_at timestamptz not null default now()
);
create index if not exists course_questions_course_idx on public.course_questions (course_id, position);

create table if not exists public.course_assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  due_date date,
  assigned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (num_nonnulls(user_id, team_id) = 1)
);
create unique index if not exists course_assignments_user_uq on public.course_assignments (course_id, user_id) where user_id is not null;
create unique index if not exists course_assignments_team_uq on public.course_assignments (course_id, team_id) where team_id is not null;

create table if not exists public.lesson_progress (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  lesson_id uuid not null references public.course_lessons (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  completed_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

create table if not exists public.course_completions (
  id uuid primary key default gen_random_uuid(),
  -- Si se borra la persona o se intenta borrar el curso, el registro se conserva (nombre, email y título copiados).
  user_id uuid references auth.users (id) on delete set null,
  course_id uuid not null references public.courses (id) on delete restrict,
  course_title text not null,
  person_name text not null default '',
  person_email text not null default '',
  correct int not null,
  total int not null,
  score_pct int not null,
  pass_pct int not null,
  passed boolean not null,
  ack_text text,
  ack_at timestamptz,
  completed_at timestamptz not null default now(),
  expires_at timestamptz,
  code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 10))
);
create index if not exists course_completions_user_idx on public.course_completions (user_id, course_id, completed_at desc);
create index if not exists course_completions_course_idx on public.course_completions (course_id, completed_at desc);

-- ¿Tengo asignado este curso (directamente o por equipo)? Solo así lo ve quien no es editor.
create or replace function public.is_assigned(p_course uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.course_assignments a
    where a.course_id = p_course
      and (a.user_id = auth.uid()
           or a.team_id in (select team_id from public.team_members where user_id = auth.uid()))
  );
$$;
grant execute on function public.is_assigned(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------
alter table public.courses enable row level security;
alter table public.course_lessons enable row level security;
alter table public.course_questions enable row level security;
alter table public.course_assignments enable row level security;
alter table public.lesson_progress enable row level security;
alter table public.course_completions enable row level security;

drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses for select to authenticated
  using (public.can_edit_training() or (is_published and public.is_assigned(id)));
drop policy if exists courses_edit on public.courses;
create policy courses_edit on public.courses for all to authenticated using (public.can_edit_training()) with check (public.can_edit_training());

drop policy if exists lessons_read on public.course_lessons;
create policy lessons_read on public.course_lessons for select to authenticated
  using (public.can_edit_training() or exists (
    select 1 from public.courses c where c.id = course_id and c.is_published and public.is_assigned(c.id)));
drop policy if exists lessons_edit on public.course_lessons;
create policy lessons_edit on public.course_lessons for all to authenticated using (public.can_edit_training()) with check (public.can_edit_training());

-- Las preguntas (con su respuesta) solo las leen los editores.
drop policy if exists cquestions_edit on public.course_questions;
create policy cquestions_edit on public.course_questions for all to authenticated using (public.can_edit_training()) with check (public.can_edit_training());

drop policy if exists assignments_read on public.course_assignments;
create policy assignments_read on public.course_assignments for select to authenticated
  using (user_id = auth.uid() or public.can_edit_training()
         or exists (select 1 from public.team_members m where m.team_id = course_assignments.team_id and m.user_id = auth.uid()));
drop policy if exists assignments_edit on public.course_assignments;
create policy assignments_edit on public.course_assignments for all to authenticated using (public.can_edit_training()) with check (public.can_edit_training());

drop policy if exists progress_own on public.lesson_progress;
create policy progress_own on public.lesson_progress for select to authenticated using (user_id = auth.uid() or public.can_edit_training());
drop policy if exists progress_insert on public.lesson_progress;
create policy progress_insert on public.lesson_progress for insert to authenticated
  with check (user_id = auth.uid() and public.is_assigned(course_id) and exists (
    select 1 from public.course_lessons l join public.courses c on c.id = l.course_id
    where l.id = lesson_id and l.course_id = lesson_progress.course_id and c.is_published));

drop policy if exists completions_read on public.course_completions;
create policy completions_read on public.course_completions for select to authenticated using (user_id = auth.uid() or public.can_edit_training());

grant select, insert, update, delete on public.courses, public.course_lessons, public.course_questions, public.course_assignments to authenticated;
grant select, insert on public.lesson_progress to authenticated;
grant select on public.course_completions to authenticated;
revoke insert, update, delete on public.course_completions from authenticated;

-- ---------------------------------------------------------------------------
-- Test del curso (se reparte y se corrige en el servidor)
-- ---------------------------------------------------------------------------

-- Preguntas para hacer el test, sin las respuestas. Si el curso tiene quiz_size, una muestra aleatoria.
create or replace function public.course_quiz(p_course uuid)
returns table (id uuid, stem text, options text[], multi boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_size int;
begin
  select quiz_size into v_size from public.courses
  where courses.id = p_course and ((is_published and public.is_assigned(p_course)) or public.can_edit_training());
  if not found then raise exception 'Curso no disponible'; end if;
  return query
    select q.id, q.stem, q.options, array_length(q.correct, 1) > 1
    from public.course_questions q
    where q.course_id = p_course
    order by case when v_size is null then q.position::double precision else random() end
    limit coalesce(v_size, 1000);
end;
$$;

-- Corrige el test y registra el intento. p_answers: [{"id": "<question uuid>", "picked": [0, 2]}].
-- Exige haber completado todas las lecciones y, si el curso lo pide, aceptar la declaración para aprobar.
-- Devuelve el registro y, por pregunta, si se acertó (y la respuesta correcta y la explicación si se aprueba).
create or replace function public.submit_course(p_course uuid, p_answers jsonb, p_ack boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.courses;
  v_uid uuid := auth.uid();
  v_total int; v_ok int := 0; v_pct int; v_passed boolean;
  v_detail jsonb := '[]'::jsonb;
  v_row public.course_completions;
  r record;
  v_picked int[];
  v_name text; v_email text;
begin
  if v_uid is null then raise exception 'Sin sesión'; end if;
  select * into c from public.courses where id = p_course and is_published;
  if not found then raise exception 'Curso no disponible'; end if;
  if not public.is_assigned(p_course) then raise exception 'Este curso no está asignado a tu usuario'; end if;
  if exists (
    select 1 from public.course_lessons l
    where l.course_id = p_course
      and not exists (select 1 from public.lesson_progress p where p.lesson_id = l.id and p.user_id = v_uid)
  ) then raise exception 'Completa todas las lecciones antes del test'; end if;
  if jsonb_typeof(p_answers) is distinct from 'array' then raise exception 'Respuestas no válidas'; end if;

  v_total := jsonb_array_length(p_answers);
  if v_total = 0 and exists (select 1 from public.course_questions where course_id = p_course) then
    raise exception 'Faltan las respuestas';
  end if;
  if v_total <> (select count(distinct a->>'id') from jsonb_array_elements(p_answers) a) then
    raise exception 'Respuestas repetidas';
  end if;

  for r in
    select q.id, q.correct, q.explanation, a->'picked' as picked
    from jsonb_array_elements(p_answers) a
    join public.course_questions q on q.id = (a->>'id')::uuid and q.course_id = p_course
  loop
    select coalesce(array_agg(x::int order by x::int), '{}') into v_picked from jsonb_array_elements_text(coalesce(r.picked, '[]'::jsonb)) x;
    if v_picked = (select array_agg(y order by y) from unnest(r.correct) y) then v_ok := v_ok + 1; end if;
    v_detail := v_detail || jsonb_build_object('id', r.id, 'ok', v_picked = (select array_agg(y order by y) from unnest(r.correct) y),
                                               'correct', r.correct, 'explanation', r.explanation);
  end loop;
  if jsonb_array_length(v_detail) <> v_total then raise exception 'Alguna pregunta no pertenece a este curso'; end if;
  if c.quiz_size is null and v_total < (select count(*) from public.course_questions where course_id = p_course) then
    raise exception 'Faltan respuestas';
  end if;

  v_pct := case when v_total = 0 then 100 else round(100.0 * v_ok / v_total) end;
  v_passed := v_pct >= c.pass_pct;
  if v_passed and c.requires_ack and not coalesce(p_ack, false) then
    raise exception 'Debes aceptar la declaración de conformidad';
  end if;

  select coalesce(nullif(p.display_name, ''), ''), u.email::text into v_name, v_email
  from auth.users u left join public.profiles p on p.id = u.id where u.id = v_uid;

  insert into public.course_completions (user_id, course_id, course_title, person_name, person_email, correct, total, score_pct, pass_pct, passed, ack_text, ack_at, expires_at)
  values (v_uid, p_course, c.title, coalesce(v_name, ''), coalesce(v_email, ''), v_ok, v_total, v_pct, c.pass_pct, v_passed,
          case when v_passed and c.requires_ack then c.ack_text end,
          case when v_passed and c.requires_ack then now() end,
          case when v_passed and c.validity_months is not null then now() + make_interval(months => c.validity_months) end)
  returning * into v_row;

  if not v_passed then
    select coalesce(jsonb_agg(d - 'correct' - 'explanation'), '[]'::jsonb) into v_detail from jsonb_array_elements(v_detail) d;
  end if;
  return jsonb_build_object('completion', to_jsonb(v_row), 'detail', v_detail);
end;
$$;

-- ---------------------------------------------------------------------------
-- Estado de la formación
-- ---------------------------------------------------------------------------

-- Estado de una persona en un curso: completado, caducado, vencido o pendiente.
create or replace function public.training_state(p_passed_at timestamptz, p_expires timestamptz, p_due date)
returns text
language sql
immutable
as $$
  select case
    when p_passed_at is not null and (p_expires is null or p_expires > now()) then 'completado'
    when p_passed_at is not null then 'caducado'
    when p_due is not null and p_due < current_date then 'vencido'
    else 'pendiente'
  end;
$$;

-- Mis cursos asignados (directamente o por equipo) con su estado.
create or replace function public.my_training()
returns table (course_id uuid, due_date date, last_passed_at timestamptz, expires_at timestamptz, completion_id uuid, state text)
language sql
stable
security definer
set search_path = public
as $$
  with asg as (
    select a.course_id, min(a.due_date) as due_date
    from public.course_assignments a
    join public.courses c on c.id = a.course_id and c.is_published
    where a.user_id = auth.uid()
       or a.team_id in (select team_id from public.team_members where user_id = auth.uid())
    group by a.course_id
  ), last as (
    select distinct on (cc.course_id) cc.course_id, cc.id, cc.completed_at, cc.expires_at
    from public.course_completions cc
    where cc.user_id = auth.uid() and cc.passed
    order by cc.course_id, cc.completed_at desc
  )
  select asg.course_id, asg.due_date, last.completed_at, last.expires_at, last.id,
         public.training_state(last.completed_at, last.expires_at, asg.due_date)
  from asg left join last on last.course_id = asg.course_id;
$$;

-- Panel de cumplimiento de un curso (editores): una fila por persona asignada.
create or replace function public.training_status(p_course uuid)
returns table (user_id uuid, display_name text, email text, teams text, due_date date,
               last_passed_at timestamptz, expires_at timestamptz, score_pct int, ack_at timestamptz,
               completion_id uuid, attempts int, state text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.can_edit_training() then raise exception 'Sin permiso'; end if;
  return query
  with people as (
    select a.user_id as uid, a.due_date from public.course_assignments a where a.course_id = p_course and a.user_id is not null
    union all
    select m.user_id, a.due_date from public.course_assignments a join public.team_members m on m.team_id = a.team_id
    where a.course_id = p_course and a.team_id is not null
  ), asg as (
    select uid, min(due_date) as due_date from people group by uid
  ), last as (
    select distinct on (cc.user_id) cc.user_id, cc.id, cc.completed_at, cc.expires_at, cc.score_pct, cc.ack_at
    from public.course_completions cc where cc.course_id = p_course and cc.passed
    order by cc.user_id, cc.completed_at desc
  )
  select asg.uid, coalesce(p.display_name, ''), u.email::text,
         (select string_agg(t.name, ', ' order by t.name) from public.team_members m join public.teams t on t.id = m.team_id where m.user_id = asg.uid),
         asg.due_date, last.completed_at, last.expires_at, last.score_pct, last.ack_at, last.id,
         (select count(*)::int from public.course_completions x where x.course_id = p_course and x.user_id = asg.uid),
         public.training_state(last.completed_at, last.expires_at, asg.due_date)
  from asg
  join auth.users u on u.id = asg.uid
  left join public.profiles p on p.id = asg.uid
  left join last on last.user_id = asg.uid
  order by 12 desc, 2;
end;
$$;

grant execute on function public.can_edit_training(), public.set_editor(uuid, boolean), public.training_people(),
  public.course_quiz(uuid), public.submit_course(uuid, jsonb, boolean), public.my_training(),
  public.training_status(uuid), public.training_state(timestamptz, timestamptz, date) to authenticated;
revoke execute on function public.training_people(), public.course_quiz(uuid), public.submit_course(uuid, jsonb, boolean),
  public.my_training(), public.training_status(uuid), public.set_editor(uuid, boolean) from anon;

-- ---------------------------------------------------------------------------
-- Archivos de las lecciones (PDF, vídeo): bucket privado, lectura con sesión, escritura de editores.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('training', 'training', false) on conflict (id) do nothing;
    execute 'drop policy if exists training_read on storage.objects';
    execute $p$create policy training_read on storage.objects for select to authenticated using (bucket_id = 'training')$p$;
    execute 'drop policy if exists training_write on storage.objects';
    execute $p$create policy training_write on storage.objects for insert to authenticated with check (bucket_id = 'training' and public.can_edit_training())$p$;
    execute 'drop policy if exists training_delete on storage.objects';
    execute $p$create policy training_delete on storage.objects for delete to authenticated using (bucket_id = 'training' and public.can_edit_training())$p$;
  end if;
end $$;
