-- Exam Prep: esquema inicial
-- Datos compartidos: exams, domains, questions (banco, ejemplos oficiales y preguntas del equipo).
-- Datos personales (solo su dueño los ve): attempts, seen_questions, review_items.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Perfiles y control de acceso
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Lista de acceso: si tiene filas, solo pueden registrarse los emails que encajen.
-- Una fila '@empresa.com' admite todo el dominio; una fila 'persona@otra.com' admite a esa persona.
create table public.access_allowlist (
  pattern text primary key check (pattern = lower(pattern) and char_length(pattern) between 3 and 200),
  note text not null default '',
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.email_allowed(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.access_allowlist)
      or exists (
        select 1 from public.access_allowlist a
        where lower(p_email) = a.pattern
           or (left(a.pattern, 1) = '@' and lower(p_email) like '%' || a.pattern)
      );
$$;

-- Al crear un usuario: comprobar la lista de acceso y crear su perfil.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.email_allowed(new.email) then
    raise exception 'Este email no tiene acceso a la aplicación';
  end if;
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(split_part(new.email, '@', 1), ''), 'usuario'))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Exámenes, dominios y preguntas (compartidos)
-- ---------------------------------------------------------------------------
create table public.exams (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  vendor text not null check (char_length(vendor) between 1 and 80),
  code text not null default '' check (char_length(code) <= 40),
  name text not null check (char_length(name) between 1 and 200),
  description text not null default '' check (char_length(description) <= 2000),
  language text not null default 'es' check (char_length(language) between 2 and 10),
  sim_questions int not null check (sim_questions between 1 and 500),
  sim_minutes int not null check (sim_minutes between 1 and 600),
  mini_questions int not null check (mini_questions between 1 and 500),
  mini_minutes int not null check (mini_minutes between 1 and 600),
  passing_note text not null default '' check (char_length(passing_note) <= 200),
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.domains (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 200),
  weight numeric(5,2) not null check (weight >= 0 and weight <= 100),
  unique (exam_id, code)
);

create or replace function public.valid_answer_set(p_options jsonb, p_correct int[])
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_options) = 'array'
     and jsonb_array_length(p_options) between 2 and 6
     and cardinality(p_correct) between 1 and jsonb_array_length(p_options) - 1
     and (select bool_and(c >= 0 and c < jsonb_array_length(p_options)) from unnest(p_correct) c)
     and (select count(distinct c) = cardinality(p_correct) from unnest(p_correct) c)
     and (select bool_and(jsonb_typeof(o) = 'string' and char_length(o #>> '{}') between 1 and 600)
          from jsonb_array_elements(p_options) o);
$$;

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  domain_id uuid not null references public.domains (id) on delete cascade,
  source text not null check (source in ('bank', 'official_sample', 'team')),
  stem text not null check (char_length(stem) between 10 and 3000),
  options jsonb not null,
  correct int[] not null,
  explanation text not null default '' check (char_length(explanation) <= 3000),
  author_id uuid references public.profiles (id) on delete set null default auth.uid(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint questions_valid_answers check (public.valid_answer_set(options, correct))
);
create index questions_exam_idx on public.questions (exam_id) where is_active;

-- El dominio de una pregunta debe pertenecer a su examen.
create or replace function public.check_question_domain()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.domains d where d.id = new.domain_id and d.exam_id = new.exam_id) then
    raise exception 'El dominio no pertenece a este examen';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger questions_domain_check
  before insert or update on public.questions
  for each row execute function public.check_question_domain();

-- ---------------------------------------------------------------------------
-- Datos personales (aislados por usuario)
-- ---------------------------------------------------------------------------
create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  mode text not null check (mode in ('sim', 'mini', 'practice', 'review', 'team', 'last_wrong')),
  correct int not null check (correct >= 0),
  total int not null check (total >= 0 and correct <= total),
  seconds_used int,
  by_domain jsonb not null default '{}'::jsonb,
  wrong_question_ids uuid[] not null default '{}',
  finished_at timestamptz not null default now()
);
create index attempts_user_exam_idx on public.attempts (user_id, exam_id, finished_at desc);

create table public.seen_questions (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index seen_user_exam_idx on public.seen_questions (user_id, exam_id);

create table public.review_items (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  exam_id uuid not null references public.exams (id) on delete cascade,
  wrong_count int not null default 0 check (wrong_count >= 0),
  flagged boolean not null default false,
  last_result text not null default 'fallada' check (last_result in ('fallada', 'acertada', 'sin responder')),
  last_pick int[] not null default '{}',
  last_mode text not null default '',
  last_at timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index review_user_exam_idx on public.review_items (user_id, exam_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.access_allowlist enable row level security;
alter table public.exams enable row level security;
alter table public.domains enable row level security;
alter table public.questions enable row level security;
alter table public.attempts enable row level security;
alter table public.seen_questions enable row level security;
alter table public.review_items enable row level security;

-- Perfiles: los usuarios autenticados ven los nombres (para firmar las preguntas del equipo);
-- cada uno solo cambia su nombre visible, nunca is_admin.
create policy profiles_read on public.profiles for select to authenticated using (true);
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;
-- is_admin solo se cambia desde el panel de administración mediante set_admin().

create policy allowlist_admin on public.access_allowlist for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy exams_read on public.exams for select to authenticated
  using (is_published or public.is_admin());
create policy exams_admin on public.exams for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy domains_read on public.domains for select to authenticated using (
  exists (select 1 from public.exams e where e.id = exam_id and (e.is_published or public.is_admin()))
);
create policy domains_admin on public.domains for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy questions_read on public.questions for select to authenticated using (
  exists (select 1 from public.exams e where e.id = exam_id and (e.is_published or public.is_admin()))
);
-- Preguntas del equipo: cualquiera publica las suyas; edita y borra solo las suyas.
create policy questions_team_insert on public.questions for insert to authenticated
  with check (source = 'team' and author_id = auth.uid());
create policy questions_team_update on public.questions for update to authenticated
  using (source = 'team' and author_id = auth.uid())
  with check (source = 'team' and author_id = auth.uid());
create policy questions_team_delete on public.questions for delete to authenticated
  using (source = 'team' and author_id = auth.uid());
-- Administradores: gestionan todo (moderación e importación).
create policy questions_admin on public.questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Datos personales: cada usuario ve y modifica solo sus filas. Ni los administradores los leen.
create policy attempts_own on public.attempts for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy seen_own on public.seen_questions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy review_own on public.review_items for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Los visitantes sin sesión no ven nada.
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------------------
-- Funciones de administración
-- ---------------------------------------------------------------------------
create or replace function public.set_admin(p_user uuid, p_value boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede hacer esto'; end if;
  if p_user = auth.uid() and not p_value then raise exception 'No puedes quitarte tus propios permisos de administrador'; end if;
  update public.profiles set is_admin = p_value where id = p_user;
end;
$$;

-- Importa o actualiza un examen completo desde JSON (formato de content/exams/*.json).
-- Sustituye las preguntas del banco y los ejemplos oficiales; conserva las del equipo.
create or replace function public.import_exam_unchecked(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exam uuid;
  v_dom record;
  v_q jsonb;
  v_domain uuid;
  v_count int := 0;
  v_codes text[];
begin
  if jsonb_typeof(p->'domains') <> 'array' or jsonb_array_length(p->'domains') = 0 then
    raise exception 'El examen debe tener al menos un dominio';
  end if;
  if jsonb_typeof(p->'questions') <> 'array' then raise exception 'Falta la lista de preguntas'; end if;

  insert into public.exams (slug, vendor, code, name, description, language,
                            sim_questions, sim_minutes, mini_questions, mini_minutes, passing_note)
  values (p->>'slug', p->>'vendor', coalesce(p->>'code', ''), p->>'name', coalesce(p->>'description', ''),
          coalesce(p->>'language', 'es'),
          (p#>>'{exam,questions}')::int, (p#>>'{exam,minutes}')::int,
          (p#>>'{exam,mini,questions}')::int, (p#>>'{exam,mini,minutes}')::int,
          coalesce(p#>>'{exam,passing}', ''))
  on conflict (slug) do update set
    vendor = excluded.vendor, code = excluded.code, name = excluded.name,
    description = excluded.description, language = excluded.language,
    sim_questions = excluded.sim_questions, sim_minutes = excluded.sim_minutes,
    mini_questions = excluded.mini_questions, mini_minutes = excluded.mini_minutes,
    passing_note = excluded.passing_note, updated_at = now()
  returning id into v_exam;

  select array_agg(d->>'code') into v_codes from jsonb_array_elements(p->'domains') d;
  for v_dom in select * from jsonb_to_recordset(p->'domains') as x(code text, name text, weight numeric) loop
    insert into public.domains (exam_id, code, name, weight)
    values (v_exam, v_dom.code, v_dom.name, v_dom.weight)
    on conflict (exam_id, code) do update set name = excluded.name, weight = excluded.weight;
  end loop;

  delete from public.questions where exam_id = v_exam and source in ('bank', 'official_sample');

  for v_q in select * from jsonb_array_elements(p->'questions') loop
    select id into v_domain from public.domains where exam_id = v_exam and code = v_q->>'domain';
    if v_domain is null then raise exception 'Dominio desconocido en una pregunta: %', v_q->>'domain'; end if;
    insert into public.questions (exam_id, domain_id, source, stem, options, correct, explanation, author_id)
    values (v_exam, v_domain,
            case when v_q->>'source' = 'official_sample' then 'official_sample' else 'bank' end,
            v_q->>'stem', v_q->'options',
            array(select jsonb_array_elements_text(v_q->'correct')::int),
            coalesce(v_q->>'explanation', ''), null);
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('exam_id', v_exam, 'questions', v_count);
end;
$$;

-- Versión para la app: solo administradores.
create or replace function public.import_exam(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede importar exámenes'; end if;
  return public.import_exam_unchecked(p);
end;
$$;

-- La versión sin comprobación solo la usa seed.sql desde el editor SQL de Supabase.
revoke execute on function public.import_exam_unchecked(jsonb) from public, anon, authenticated;
revoke execute on function public.import_exam(jsonb) from public, anon;
grant execute on function public.import_exam(jsonb) to authenticated;
revoke execute on function public.set_admin(uuid, boolean) from public, anon;
grant execute on function public.set_admin(uuid, boolean) to authenticated;
