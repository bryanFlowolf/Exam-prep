-- Tutor IA: contador diario con el token del usuario (no necesita la clave de servicio).
-- Necesario si ya ejecutaste 20261127000000_training.sql antes de este cambio. Se puede ejecutar más de una vez.

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
