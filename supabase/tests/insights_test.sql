\set ON_ERROR_STOP on
-- Pruebas de la migración 20261124000000_insights.sql.
-- Requiere haber ejecutado antes mock_supabase.sql, todas las migraciones y rls_test.sql
-- (usa sus usuarios: admin 1111…, Ana 2222…, externo 3333… y el examen demo-exam).

-- ---- Reportes ----
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
insert into public.question_reports (question_id, reason, comment)
  select id, 'ambigua', 'La opción B también podría valer' from public.questions where source = 'bank' limit 1;
do $$ begin
  begin
    insert into public.question_reports (question_id, reason)
      select id, 'errata' from public.questions where source = 'bank' limit 1;
    raise exception 'FALLO: dos reportes abiertos de la misma persona y pregunta';
  exception when unique_violation then raise notice 'OK: un solo reporte abierto por pregunta y persona'; end;
  begin
    update public.question_reports set status = 'resuelto';
    if found then raise exception 'FALLO: Ana resolvió su propio reporte'; end if;
    raise notice 'OK: Ana no puede resolver reportes';
  exception when insufficient_privilege then raise notice 'OK: Ana no puede resolver reportes'; end;
  if (select count(*) from public.question_reports) <> 1 then raise exception 'FALLO: Ana no ve su reporte'; end if;
  if (select exam_id from public.question_reports limit 1) is null then raise exception 'FALLO: exam_id no se rellenó'; end if;
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
do $$ begin
  if (select count(*) from public.question_reports) <> 0 then raise exception 'FALLO: el externo ve reportes ajenos'; end if;
  raise notice 'OK: los reportes ajenos no se ven';
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
update public.question_reports set status = 'resuelto', admin_note = 'Corregida';
do $$ begin
  if (select resolved_by from public.question_reports limit 1) <> '11111111-1111-1111-1111-111111111111' then
    raise exception 'FALLO: no se anotó quién resolvió';
  end if;
  raise notice 'OK: el administrador resuelve y queda anotado';
end $$;
reset role;

-- ---- Estadísticas anónimas ----
set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
-- El externo responde la pregunta del banco por primera vez, eligiendo la opción correcta.
select public.record_answers((select id from public.exams where slug = 'demo-exam'),
  (select jsonb_agg(jsonb_build_object('q', id, 'pick', to_jsonb(correct))) from public.questions where source = 'bank'));
-- Y otra vez, ya vista, eligiendo la 0 (incorrecta) y un índice fuera de rango que se ignora.
insert into public.seen_questions (question_id, exam_id) select id, exam_id from public.questions where source = 'bank';
select public.record_answers((select id from public.exams where slug = 'demo-exam'),
  (select jsonb_agg(jsonb_build_object('q', id, 'pick', jsonb_build_array(0, 99))) from public.questions where source = 'bank'));
do $$
declare s record;
begin
  select st.*, q.correct[1] + 1 as correct_idx into s from public.question_stats st join public.questions q on q.id = st.question_id where q.source = 'bank';
  if s.answered <> 2 or s.correct <> 1 or s.first_answered <> 1 or s.first_correct <> 1
     or s.picks[1] <> 1 or s.picks[s.correct_idx] <> 1 or cardinality(s.picks) <> 3 then
    raise exception 'FALLO: estadísticas inesperadas %', row_to_json(s);
  end if;
  raise notice 'OK: estadísticas % (acierto calculado en el servidor, primera vez, opciones)', s.picks;
  begin
    insert into public.question_stats (question_id, exam_id) select id, exam_id from public.questions where source = 'team';
    raise exception 'FALLO: se pudieron escribir estadísticas directamente';
  exception when insufficient_privilege then raise notice 'OK: las estadísticas solo cambian con record_answers'; end;
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  if (select count(*) from public.question_stats) <> 1 then raise exception 'FALLO: Ana no ve las estadísticas'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'question_stats' and column_name = 'user_id') then
    raise exception 'FALLO: las estadísticas guardan quién respondió';
  end if;
  raise notice 'OK: estadísticas visibles para todos y sin datos personales';
end $$;
-- Ana fija la fecha de su examen
insert into public.exam_plans (exam_id, target_date) select id, date '2027-01-15' from public.exams where slug = 'demo-exam';
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
do $$ begin
  if (select count(*) from public.exam_plans) <> 0 then raise exception 'FALLO: el externo ve planes ajenos'; end if;
  raise notice 'OK: las fechas de examen son privadas';
end $$;
reset role;

-- ---- Equipos ----
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  begin insert into public.teams (name) values ('Equipo pirata'); raise exception 'FALLO: Ana creó un equipo';
  exception when insufficient_privilege then raise notice 'OK: solo los administradores crean equipos'; end;
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into public.teams (name) values ('Plataforma');
insert into public.team_members (team_id, user_id, role)
  select t.id, u.id, case when u.id = '33333333-3333-3333-3333-333333333333' then 'lead' else 'member' end
  from public.teams t, (values ('22222222-2222-2222-2222-222222222222'::uuid), ('33333333-3333-3333-3333-333333333333'::uuid)) u(id)
  where t.name = 'Plataforma';
do $$ begin
  begin perform * from public.team_progress((select id from public.teams where name = 'Plataforma'));
        raise exception 'FALLO: un administrador que no es responsable vio el progreso';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
    raise notice 'OK: ser administrador no da acceso al progreso del equipo';
  end;
end $$;
reset role;

-- El responsable (externo) aún no ve datos de Ana: no los comparte.
set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
do $$
declare r record;
begin
  select * into r from public.team_progress((select id from public.teams where name = 'Plataforma'))
    where user_id = '22222222-2222-2222-2222-222222222222';
  if r.shares_progress or r.attempts is not null or r.target_date is not null then raise exception 'FALLO: se ven datos sin consentimiento'; end if;
  raise notice 'OK: sin consentimiento solo se ve el nombre';
  begin
    update public.team_members set shares_progress = true where user_id = '22222222-2222-2222-2222-222222222222';
    if found then raise exception 'FALLO: el responsable cambió el consentimiento de Ana'; end if;
    raise notice 'OK: nadie más cambia el consentimiento';
  exception when insufficient_privilege then raise notice 'OK: nadie más cambia el consentimiento'; end;
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select public.set_share_progress((select id from public.teams where name = 'Plataforma'), true);
insert into public.attempts (exam_id, mode, correct, total, by_domain)
  select id, 'practice', 3, 4, '{"D1": {"ok": 3, "total": 4}}' from public.exams where slug = 'demo-exam';
-- Los repasos no cuentan para la preparación (están sesgados hacia las falladas).
insert into public.attempts (exam_id, mode, correct, total, by_domain)
  select id, 'review', 0, 5, '{"D1": {"ok": 0, "total": 5}}' from public.exams where slug = 'demo-exam';
do $$ begin
  begin perform * from public.team_progress((select id from public.teams where name = 'Plataforma'));
        raise exception 'FALLO: un miembro vio el progreso del equipo';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
    raise notice 'OK: los miembros no ven el progreso de los demás';
  end;
  begin
    update public.team_members set role = 'lead' where user_id = auth.uid();
    if found then raise exception 'FALLO: Ana se hizo responsable'; end if;
    raise notice 'OK: Ana no puede cambiar su rol';
  exception when insufficient_privilege then raise notice 'OK: Ana no puede cambiar su rol'; end;
  if (select count(*) from public.team_members) <> 1 then raise exception 'FALLO: un miembro ve la lista completa'; end if;
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
do $$
declare r record;
begin
  select * into r from public.team_progress((select id from public.teams where name = 'Plataforma'))
    where user_id = '22222222-2222-2222-2222-222222222222';
  if not r.shares_progress or r.attempts <> 2 or r.last_sim_pct <> 50 or r.target_date <> date '2027-01-15'
     or (r.by_domain->'D1'->>'total')::int <> 4 then
    raise exception 'FALLO: resumen compartido incorrecto %', row_to_json(r);
  end if;
  raise notice 'OK: con consentimiento el responsable ve el resumen: % intentos, % %%, examen el %', r.attempts, r.last_sim_pct, r.target_date;
end $$;
reset role;
