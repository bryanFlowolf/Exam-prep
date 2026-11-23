// Genera un script SQL que añade un examen nuevo a Supabase sin tocar los existentes.
// Uso: node scripts/build-exam-script.mjs content/exams/<slug>.json supabase/content-updates/<archivo>.sql
import { readFileSync, writeFileSync } from 'node:fs';
const [src, out] = process.argv.slice(2);
const exam = JSON.parse(readFileSync(src, 'utf8'));
const json = JSON.stringify(exam);
if (json.includes('$exam$')) throw new Error('El JSON contiene el delimitador $exam$');
const counts = {};
for (const q of exam.questions) counts[q.domain] = (counts[q.domain] || 0) + 1;
const sql = `-- Añade el examen ${exam.code} (${exam.name}) con ${exam.questions.length} preguntas en español e inglés.
-- Reparto por dominio: ${exam.domains.map((d) => `${d.code} ${counts[d.code] || 0}`).join(', ')}.
-- Requisito: haber ejecutado antes 20261123_ccdvf_ingles.sql (columna questions.i18n).
-- Ejecutar en Supabase: SQL Editor > New query > pegar > Run.
-- Si el examen ya existe no hace nada, así que se puede ejecutar varias veces sin borrar
-- el progreso de nadie. Para reemplazar sus preguntas usa Administración > Importar.
do $do$
begin
  if exists (select 1 from public.exams where slug = '${exam.slug}') then
    raise notice 'El examen ${exam.slug} ya existe: no se ha modificado.';
  else
    perform public.import_exam_unchecked($exam$${json}$exam$::jsonb);
    raise notice 'Examen ${exam.slug} añadido con ${exam.questions.length} preguntas.';
  end if;
end
$do$;

select e.code, d.code as dominio, d.name, count(q.id) as preguntas
from public.exams e
join public.domains d on d.exam_id = e.id
left join public.questions q on q.domain_id = d.id
where e.slug = '${exam.slug}'
group by e.code, d.code, d.name
order by d.code;
`;
writeFileSync(out, sql);
console.log(`${out}: ${exam.questions.length} preguntas`);
