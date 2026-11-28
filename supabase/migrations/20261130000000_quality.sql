-- Revisión automática de la calidad del banco.
--
-- La app detecta sola las preguntas sospechosas (a partir de las estadísticas anónimas y de comprobaciones
-- del propio texto). Esta migración añade lo que necesita para que el administrador pueda cerrar cada aviso:
--   question_quality_reviews  «Revisada, está bien» o «Corregida», con nota. Solo administradores.
--                             Si después llegan bastantes respuestas nuevas y el problema sigue, el aviso vuelve.
--   reset_question_stats      Pone a cero las estadísticas de una pregunta tras corregir sus opciones o su
--                             respuesta, para que los datos anteriores al cambio no la sigan marcando.
--
-- Se puede ejecutar varias veces.

create table if not exists public.question_quality_reviews (
  question_id uuid primary key references public.questions (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  status text not null check (status in ('ok', 'fixed')),
  note text not null default '' check (length(note) <= 1000),
  answered_at_review int not null default 0 check (answered_at_review >= 0),  -- respuestas que tenía al revisarla
  reviewed_by uuid default auth.uid() references public.profiles (id) on delete set null,
  reviewed_at timestamptz not null default now()
);
create index if not exists quality_reviews_exam_idx on public.question_quality_reviews (exam_id);
alter table public.question_quality_reviews enable row level security;
drop policy if exists quality_reviews_admin on public.question_quality_reviews;
create policy quality_reviews_admin on public.question_quality_reviews for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.question_quality_reviews from authenticated;
grant select, insert, update, delete on public.question_quality_reviews to authenticated;

create or replace function public.reset_question_stats(p_question uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo los administradores pueden reiniciar las estadísticas';
  end if;
  delete from public.question_stats where question_id = p_question;
end;
$$;
revoke execute on function public.reset_question_stats(uuid) from public, anon;
grant execute on function public.reset_question_stats(uuid) to authenticated;

-- Primera corrección encontrada por la revisión automática: esta pregunta pide «(Elige 2)» y su propia
-- explicación nombra dos respuestas (enrutamiento y colas de escalado), pero solo tenía marcada una.
update public.questions q
   set correct = '{2,3}'
  from public.exams e
 where e.id = q.exam_id and e.slug = 'salesforce-agentforce-specialist'
   and q.stem = '¿Qué dos componentes de Omni-Channel deben revisarse al desplegar un agente de servicio? (Elige 2)'
   and q.options ->> 3 = 'Colas para escalado'
   and q.correct = '{2}';
