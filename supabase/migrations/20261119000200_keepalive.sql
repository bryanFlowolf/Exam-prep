-- Función mínima para la tarea programada que evita que Supabase pause el proyecto gratuito
-- tras una semana sin actividad. No lee ni devuelve ningún dato de la aplicación.
create or replace function public.keepalive()
returns timestamptz
language sql
stable
as $$ select now(); $$;

revoke execute on function public.keepalive() from public;
grant execute on function public.keepalive() to anon, authenticated;
