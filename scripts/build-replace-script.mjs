// Genera un script SQL que sustituye el banco de un examen que ya existe SIN borrar el historial de nadie:
// las preguntas del banco que ya no están en el JSON se desactivan (is_active = false) y las nuevas se añaden.
// También actualiza los datos del examen, sus dominios y sus escenarios (si el JSON los tiene).
// Uso: node scripts/build-replace-script.mjs content/exams/<slug>.json supabase/content-updates/<archivo>.sql [migración.sql ...]
// Las migraciones indicadas se copian al principio del script para que se ejecute todo de una vez.
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out, ...migrations] = process.argv.slice(2);
const exam = JSON.parse(readFileSync(src, 'utf8'));
const json = JSON.stringify(exam);
if (json.includes('$exam$')) throw new Error('El JSON contiene el delimitador $exam$');
const counts = {};
for (const q of exam.questions) counts[q.domain] = (counts[q.domain] || 0) + 1;
const scen = {};
for (const q of exam.questions) if (q.scenario) scen[q.scenario] = (scen[q.scenario] || 0) + 1;
const pre = migrations.map((m) => `-- ===== ${m} =====\n${readFileSync(m, 'utf8').trim()}\n`).join('\n');
const sql = `-- Sustituye el banco del examen ${exam.code} (${exam.name}) por ${exam.questions.length} preguntas en español e inglés.
-- Reparto por dominio: ${exam.domains.map((d) => `${d.code} ${counts[d.code] || 0}`).join(', ')}.
${Object.keys(scen).length ? `-- Reparto por escenario: ${Object.entries(scen).map(([k, v]) => `${k} ${v}`).join(', ')}. Cada simulacro usa ${exam.exam.scenario_count || 'todos los'} escenarios al azar.\n` : ''}-- Las preguntas antiguas del banco no se borran: se desactivan, así nadie pierde su historial ni sus estadísticas.
-- Las preguntas del equipo no se tocan.
-- Ejecutar en Supabase: SQL Editor > New query > pegar > Run. Se puede ejecutar varias veces.
${pre}
-- ===== Contenido =====
do $do$
declare
  p jsonb := $exam$${json}$exam$::jsonb;
  v_exam uuid;
  v_dom jsonb;
  v_new int; v_off int;
begin
  select id into v_exam from public.exams where slug = p->>'slug';
  if v_exam is null then raise exception 'El examen % no existe: usa el script de alta del examen.', p->>'slug'; end if;

  update public.exams set
    name = p->>'name', code = coalesce(p->>'code', code), description = coalesce(p->>'description', description),
    sim_questions = (p#>>'{exam,questions}')::int, sim_minutes = (p#>>'{exam,minutes}')::int,
    mini_questions = (p#>>'{exam,mini,questions}')::int, mini_minutes = (p#>>'{exam,mini,minutes}')::int,
    passing_note = coalesce(p#>>'{exam,passing}', passing_note),
    scenarios = coalesce(p->'scenarios', '[]'::jsonb), scenario_count = (p#>>'{exam,scenario_count}')::int,
    updated_at = now()
  where id = v_exam;

  for v_dom in select * from jsonb_array_elements(p->'domains') loop
    insert into public.domains (exam_id, code, name, weight, docs)
    values (v_exam, v_dom->>'code', v_dom->>'name', (v_dom->>'weight')::numeric, coalesce(v_dom->'docs', '[]'::jsonb))
    on conflict (exam_id, code) do update set
      name = excluded.name, weight = excluded.weight,
      docs = case when v_dom ? 'docs' then excluded.docs else public.domains.docs end;
  end loop;

  -- Desactiva las preguntas del banco que ya no forman parte del examen.
  update public.questions q set is_active = false
  where q.exam_id = v_exam and q.source in ('bank', 'official_sample') and q.is_active
    and not exists (select 1 from jsonb_array_elements(p->'questions') n where n->>'stem' = q.stem);
  get diagnostics v_off = row_count;

  -- Las que siguen: se actualizan (texto, opciones, dominio, escenario) y se reactivan.
  update public.questions q set
    domain_id = d.id, options = n->'options', correct = array(select jsonb_array_elements_text(n->'correct')::int),
    explanation = coalesce(n->>'explanation', ''), i18n = coalesce(n->'i18n', '{}'::jsonb),
    scenario = nullif(n->>'scenario', ''), is_active = true
  from jsonb_array_elements(p->'questions') n
  join public.domains d on d.exam_id = v_exam and d.code = n->>'domain'
  where q.exam_id = v_exam and q.source in ('bank', 'official_sample') and q.stem = n->>'stem';

  -- Las nuevas se añaden.
  insert into public.questions (exam_id, domain_id, source, stem, options, correct, explanation, author_id, i18n, scenario)
  select v_exam, d.id,
         case when n->>'source' = 'official_sample' then 'official_sample' else 'bank' end,
         n->>'stem', n->'options', array(select jsonb_array_elements_text(n->'correct')::int),
         coalesce(n->>'explanation', ''), null, coalesce(n->'i18n', '{}'::jsonb), nullif(n->>'scenario', '')
  from jsonb_array_elements(p->'questions') n
  join public.domains d on d.exam_id = v_exam and d.code = n->>'domain'
  where not exists (select 1 from public.questions q where q.exam_id = v_exam and q.stem = n->>'stem');
  get diagnostics v_new = row_count;

  raise notice 'Examen %: % preguntas nuevas, % desactivadas.', p->>'slug', v_new, v_off;
end
$do$;

select coalesce(q.scenario, '—') as escenario, d.code as dominio, count(*) as preguntas_activas
from public.questions q
join public.domains d on d.id = q.domain_id
where q.exam_id = (select id from public.exams where slug = '${exam.slug}') and q.is_active and q.source <> 'team'
group by q.scenario, d.code
order by 1, 2;
`;
writeFileSync(out, sql);
console.log(`${out}: ${exam.questions.length} preguntas`);
