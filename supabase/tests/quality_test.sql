\set ON_ERROR_STOP on
-- Pruebas de la migración 20261130000000_quality.sql.
-- Requiere rls_test.sql, todas las migraciones e insights_test.sql (administrador 1111…, Ana 2222…).

-- Hay estadísticas de alguna pregunta del examen de prueba.
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select public.record_answers((select id from public.exams where slug = 'demo-exam'),
  (select jsonb_agg(jsonb_build_object('q', id, 'pick', '[0]'::jsonb)) from public.questions where source = 'bank' and is_active));
do $$ begin
  begin
    insert into public.question_quality_reviews (question_id, exam_id, status)
      select id, exam_id, 'ok' from public.questions where source = 'bank' limit 1;
    raise exception 'FALLO: un usuario normal cerró un aviso de calidad';
  exception when insufficient_privilege or check_violation then raise notice 'OK: solo los administradores revisan avisos';
  end;
  begin
    perform public.reset_question_stats((select id from public.questions where source = 'bank' limit 1));
    raise exception 'FALLO: un usuario normal reinició estadísticas';
  exception when raise_exception then
    if sqlerrm like 'FALLO%' then raise; end if;
    raise notice 'OK: solo los administradores reinician estadísticas';
  end;
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into public.question_quality_reviews (question_id, exam_id, status, note, answered_at_review)
  select id, exam_id, 'fixed', 'prueba', 3 from public.questions where source = 'bank' and is_active order by id limit 1;
select public.reset_question_stats((select id from public.questions where source = 'bank' and is_active order by id limit 1));
do $$ begin
  if (select count(*) from public.question_quality_reviews) <> 1 then raise exception 'FALLO: no se guardó la revisión'; end if;
  if exists (select 1 from public.question_stats where question_id = (select id from public.questions where source = 'bank' and is_active order by id limit 1)) then
    raise exception 'FALLO: no se reiniciaron las estadísticas';
  end if;
  raise notice 'OK: el administrador revisa avisos y reinicia estadísticas';
end $$;
reset role;

set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$ begin
  if (select count(*) from public.question_quality_reviews) <> 0 then raise exception 'FALLO: un usuario normal ve las revisiones'; end if;
  raise notice 'OK: las revisiones no son visibles para usuarios normales';
end $$;
reset role;
