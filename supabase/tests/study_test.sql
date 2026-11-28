\set ON_ERROR_STOP on
-- Pruebas de la migración 20261129000000_study.sql.
-- Requiere haber ejecutado antes rls_test.sql, todas las migraciones e insights_test.sql
-- (usa su equipo Plataforma: Ana 2222… comparte su progreso y el externo 3333… es responsable).

-- ---- Repaso espaciado, plan y modos nuevos (Ana) ----
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
insert into public.review_items (question_id, exam_id, wrong_count, last_result, due_at, interval_days, ease, streak)
  select id, exam_id, 1, 'fallada', now() - interval '1 hour', 1, 2.1, 0
  from public.questions where source = 'bank' and is_active
  on conflict (user_id, question_id) do update set due_at = excluded.due_at, interval_days = 1, ease = 2.1, streak = 0;
insert into public.attempts (exam_id, mode, correct, total, by_domain)
  select id, 'daily', 1, 2, '{}' from public.exams where slug = 'demo-exam';
insert into public.attempts (exam_id, mode, correct, total, by_domain)
  select id, 'spaced', 2, 2, '{}' from public.exams where slug = 'demo-exam';
insert into public.exam_plans (exam_id, target_date, daily_minutes, study_days)
  select id, date '2027-01-15', 45, '{1,3,5}' from public.exams where slug = 'demo-exam'
  on conflict (user_id, exam_id) do update set daily_minutes = 45, study_days = '{1,3,5}';
do $$ begin
  begin
    update public.review_items set ease = 9;
    raise exception 'FALLO: se aceptó una facilidad fuera de rango';
  exception when check_violation then raise notice 'OK: la programación del repaso se valida'; end;
  begin
    update public.exam_plans set study_days = '{9}';
    raise exception 'FALLO: se aceptó un día de la semana inexistente';
  exception when check_violation then raise notice 'OK: las preferencias del plan se validan'; end;
end $$;

-- ---- Resultados oficiales ----
insert into public.exam_results (exam_id, taken_on, passed, score, predicted_estimate, predicted_probability, predicted_answers, pass_mark)
  select id, date '2026-11-20', true, 0.78, 0.82, 0.85, 120, 0.72 from public.exams where slug = 'demo-exam';
do $$
declare c record;
begin
  select * into c from public.prediction_calibration((select id from public.exams where slug = 'demo-exam'));
  if c.n <> 1 or c.mean_bias is not null or c.brier is not null then raise exception 'FALLO: con un solo resultado se ven cifras %', row_to_json(c); end if;
  raise notice 'OK: con menos de 3 resultados la calibración no da cifras';
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
do $$ begin
  if (select count(*) from public.exam_results) <> 0 then raise exception 'FALLO: el externo ve resultados ajenos'; end if;
  update public.exam_results set passed = false;
  if found then raise exception 'FALLO: el externo cambió un resultado ajeno'; end if;
  raise notice 'OK: los resultados oficiales son solo de su dueño';
end $$;
insert into public.exam_results (exam_id, taken_on, passed, score, predicted_estimate, predicted_probability, predicted_answers, pass_mark)
  select id, date '2026-11-21', false, 0.66, 0.74, 0.55, 80, 0.72 from public.exams where slug = 'demo-exam';
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into public.exam_results (exam_id, taken_on, passed, score, predicted_estimate, predicted_probability, predicted_answers, pass_mark)
  select id, date '2026-11-22', true, 0.80, 0.83, 0.90, 200, 0.72 from public.exams where slug = 'demo-exam';
-- Una predicción con pocas respuestas no cuenta.
insert into public.exam_results (exam_id, taken_on, passed, score, predicted_estimate, predicted_probability, predicted_answers, pass_mark)
  select id, date '2026-11-23', false, 0.10, 0.90, 0.99, 5, 0.72 from public.exams where slug = 'demo-exam';
do $$
declare c record;
begin
  select * into c from public.prediction_calibration((select id from public.exams where slug = 'demo-exam'));
  if c.n <> 3 or c.n_scored <> 3 or abs(c.mean_bias - 0.05) > 0.001 or c.brier is null or jsonb_array_length(c.bins) < 2 then
    raise exception 'FALLO: calibración incorrecta %', row_to_json(c);
  end if;
  raise notice 'OK: calibración con 3 resultados: sesgo % , brier %', round(c.mean_bias::numeric, 3), round(c.brier::numeric, 3);
  select * into c from public.prediction_calibration(null);
  if c.n <> 3 then raise exception 'FALLO: la calibración global no cuenta igual %', row_to_json(c); end if;
  if (select count(*) from public.exam_results) <> 2 then raise exception 'FALLO: el administrador ve resultados ajenos'; end if;
  raise notice 'OK: ni el administrador ve resultados individuales ajenos';
end $$;
reset role;

-- ---- Panel del responsable ----
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  begin perform * from public.team_activity((select id from public.teams where name = 'Plataforma'));
        raise exception 'FALLO: un miembro vio la actividad del equipo';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
    raise notice 'OK: los miembros no ven la actividad de los demás';
  end;
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
do $$
declare r record;
begin
  select * into r from public.team_activity((select id from public.teams where name = 'Plataforma'))
    where user_id = '22222222-2222-2222-2222-222222222222';
  if r.active_days_14 <> 1 or r.answered_7 < 4 or r.due_reviews < 1 or r.daily_minutes <> 45 or not r.result_passed or r.result_on <> date '2026-11-20' then
    raise exception 'FALLO: actividad compartida incorrecta %', row_to_json(r);
  end if;
  raise notice 'OK: el responsable ve constancia, % repasos pendientes y el resultado oficial', r.due_reviews;
end $$;
reset role;

-- Si Ana deja de compartir, el responsable deja de ver su actividad.
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select public.set_share_progress((select id from public.teams where name = 'Plataforma'), false);
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
do $$ begin
  if exists (select 1 from public.team_activity((select id from public.teams where name = 'Plataforma'))
             where user_id = '22222222-2222-2222-2222-222222222222') then
    raise exception 'FALLO: se ve la actividad sin consentimiento';
  end if;
  raise notice 'OK: sin consentimiento no se ve la actividad';
end $$;
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select public.set_share_progress((select id from public.teams where name = 'Plataforma'), true);
reset role;
