\set ON_ERROR_STOP on
-- Usuarios de prueba
insert into auth.users (id, email) values
 ('11111111-1111-1111-1111-111111111111','admin@empresa.com'),
 ('22222222-2222-2222-2222-222222222222','ana@empresa.com'),
 ('33333333-3333-3333-3333-333333333333','externo@otra.com');
update public.profiles set is_admin = true where id = '11111111-1111-1111-1111-111111111111';

-- Admin importa un examen pequeño
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select public.import_exam('{"slug":"demo-exam","vendor":"Demo","code":"D","name":"Demo","exam":{"questions":2,"minutes":5,"mini":{"questions":1,"minutes":2}},
 "domains":[{"code":"D1","name":"Uno","weight":60},{"code":"D2","name":"Dos","weight":40}],
 "questions":[{"domain":"D1","stem":"Pregunta de prueba uno","options":["a","b","c"],"correct":[1],"explanation":"x"},
              {"domain":"D2","source":"official_sample","stem":"Pregunta de prueba dos","options":["a","b"],"correct":[0],"explanation":"y"}]}'::jsonb);
reset role;

-- Ana: lee preguntas, guarda progreso propio, publica una del equipo
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select count(*) as ana_ve_preguntas from public.questions;
insert into public.seen_questions (question_id, exam_id) select id, exam_id from public.questions;
insert into public.review_items (question_id, exam_id, wrong_count, flagged) select id, exam_id, 1, true from public.questions limit 1;
insert into public.attempts (exam_id, mode, correct, total) select id, 'sim', 1, 2 from public.exams;
insert into public.questions (exam_id, domain_id, source, stem, options, correct)
  select e.id, d.id, 'team', 'Pregunta del equipo de Ana', '["si","no"]', '{0}' from public.exams e join public.domains d on d.exam_id=e.id and d.code='D1';
-- No puede insertar en el banco ni hacerse admin
do $$ begin
  begin insert into public.questions (exam_id, domain_id, source, stem, options, correct)
        select e.id, d.id, 'bank', 'Intento colar en banco', '["a","b"]', '{0}' from public.exams e join public.domains d on d.exam_id=e.id limit 1;
        raise exception 'FALLO: Ana insertó en el banco';
  exception when insufficient_privilege then raise notice 'OK: Ana no puede insertar en el banco'; end;
  begin update public.profiles set is_admin = true where id = auth.uid(); raise exception 'FALLO: Ana se hizo admin';
  exception when insufficient_privilege then raise notice 'OK: Ana no puede cambiar is_admin'; end;
  begin perform public.import_exam('{}'::jsonb); raise exception 'FALLO: Ana importó';
  exception when raise_exception then raise notice 'OK: Ana no puede importar exámenes'; end;
end $$;
-- Respuesta inválida rechazada
do $$ begin
  begin insert into public.questions (exam_id, domain_id, source, stem, options, correct)
        select e.id, d.id, 'team', 'Todas correctas no vale', '["a","b"]', '{0,1}' from public.exams e join public.domains d on d.exam_id=e.id and d.code='D1';
        raise exception 'FALLO: aceptó todas correctas';
  exception when check_violation then raise notice 'OK: rechaza preguntas sin opción incorrecta'; end;
end $$;
reset role;

-- Externo: no ve nada personal de Ana, no edita su pregunta
set role authenticated; select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select (select count(*) from public.attempts) as ext_attempts, (select count(*) from public.seen_questions) as ext_seen,
       (select count(*) from public.review_items) as ext_review, (select count(*) from public.questions) as ext_preguntas;
update public.questions set stem = 'Hackeada por externo' where source='team';
delete from public.questions where source='team';
reset role;
select count(*) as team_intacta from public.questions where stem='Pregunta del equipo de Ana';

-- Admin: tampoco ve datos personales de Ana; sí modera preguntas del equipo
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select (select count(*) from public.attempts) as admin_ve_attempts, (select count(*) from public.review_items) as admin_ve_review;
delete from public.questions where source='team';
-- Reimportar conserva preguntas del equipo
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
insert into public.questions (exam_id, domain_id, source, stem, options, correct)
  select e.id, d.id, 'team', 'Segunda del equipo', '["si","no"]', '{1}' from public.exams e join public.domains d on d.exam_id=e.id and d.code='D2';
reset role;
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select public.import_exam('{"slug":"demo-exam","vendor":"Demo","code":"D","name":"Demo v2","exam":{"questions":2,"minutes":5,"mini":{"questions":1,"minutes":2}},
 "domains":[{"code":"D1","name":"Uno","weight":60},{"code":"D2","name":"Dos","weight":40}],
 "questions":[{"domain":"D1","stem":"Pregunta nueva tras reimportar","options":["a","b","c"],"correct":[2]}]}'::jsonb);
select source, count(*) from public.questions group by source order by source;
reset role;

-- Anónimo: nada
set role anon; select set_config('request.jwt.claim.sub','',false);
do $$ begin perform count(*) from public.questions; raise notice 'anon pudo consultar (con 0 filas visibles)'; exception when insufficient_privilege then raise notice 'OK: anon sin acceso'; end $$;
reset role;

-- Lista de acceso
insert into public.access_allowlist (pattern) values ('@empresa.com'), ('invitado@otra.com');
insert into auth.users (email) values ('nuevo@empresa.com'), ('invitado@otra.com');
do $$ begin insert into auth.users (email) values ('intruso@spam.com'); raise exception 'FALLO: entró un email no permitido';
exception when raise_exception then raise notice 'OK: lista de acceso bloquea emails no permitidos: %', sqlerrm; end $$;
