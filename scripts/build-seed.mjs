// Genera supabase/seed.sql a partir de content/exams/*.json.
// Uso: node scripts/build-seed.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'content/exams';
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
let sql = '-- Generado por scripts/build-seed.mjs. Ejecutar en el editor SQL de Supabase.\n';
for (const f of files) {
  const exam = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const json = JSON.stringify(exam);
  if (json.includes('$exam$')) throw new Error(`${f} contiene el delimitador $exam$`);
  sql += `\n-- ${f}: ${exam.questions.length} preguntas\nselect public.import_exam_unchecked($exam$${json}$exam$::jsonb);\n`;
}
writeFileSync('supabase/seed.sql', sql);
console.log(`supabase/seed.sql: ${files.length} examen(es)`);
