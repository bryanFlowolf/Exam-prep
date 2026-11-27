-- Formación interna: cada persona solo ve los cursos que tiene asignados (directamente o por equipo).
-- Los administradores y editores de formación siguen viéndolos todos.
-- Solo hace falta si ya ejecutaste 20261127000000_training.sql antes de este cambio (esa migración ya lo incluye).
-- Se puede ejecutar más de una vez.

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

drop policy if exists courses_read on public.courses;
create policy courses_read on public.courses for select to authenticated
  using (public.can_edit_training() or (is_published and public.is_assigned(id)));

drop policy if exists lessons_read on public.course_lessons;
create policy lessons_read on public.course_lessons for select to authenticated
  using (public.can_edit_training() or exists (
    select 1 from public.courses c where c.id = course_id and c.is_published and public.is_assigned(c.id)));

drop policy if exists progress_insert on public.lesson_progress;
create policy progress_insert on public.lesson_progress for insert to authenticated
  with check (user_id = auth.uid() and public.is_assigned(course_id) and exists (
    select 1 from public.course_lessons l join public.courses c on c.id = l.course_id
    where l.id = lesson_id and l.course_id = lesson_progress.course_id and c.is_published));

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
