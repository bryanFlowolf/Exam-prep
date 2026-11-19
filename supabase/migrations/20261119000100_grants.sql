-- Permisos de tabla para los usuarios con sesión (rol "authenticated").
-- Los proyectos nuevos de Supabase no conceden estos permisos automáticamente a las tablas
-- creadas por SQL. Las políticas RLS de la migración inicial siguen decidiendo qué filas ve
-- y modifica cada persona; esto solo permite que esas políticas se apliquen.

grant usage on schema public to authenticated;

grant select on public.exams, public.domains, public.questions, public.profiles to authenticated;
grant insert, update, delete on public.exams, public.domains, public.questions to authenticated;
grant select, insert, update, delete on public.attempts, public.seen_questions, public.review_items, public.access_allowlist to authenticated;

-- En perfiles, cada persona solo puede cambiar su nombre visible (nunca is_admin).
revoke insert, update, delete on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.valid_answer_set(jsonb, int[]) to authenticated;
grant execute on function public.import_exam(jsonb) to authenticated;
grant execute on function public.set_admin(uuid, boolean) to authenticated;

-- Los visitantes sin sesión no tienen acceso a nada.
revoke all on all tables in schema public from anon;
