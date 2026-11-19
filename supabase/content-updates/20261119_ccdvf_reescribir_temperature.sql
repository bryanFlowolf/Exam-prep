-- Reescribe 3 preguntas del examen CCDV-F que daban por buena temperature 0.
-- Desde Claude Opus 4.7, temperature/top_p/top_k con un valor distinto del predeterminado
-- devuelven 400 (y con la versión de API 2026-10-21, cualquier valor explícito).
-- Ejecutar en Supabase: SQL Editor > New query > pegar > Run.
-- Actualiza las preguntas en su sitio (mismo id): se conservan el historial, las preguntas
-- vistas y la lista de repaso de cada usuario. Se puede ejecutar varias veces.

with exam as (
  select id from public.exams where slug = 'anthropic-ccdv-f'
),
incoming as (
  select r.*
  from jsonb_to_recordset($q$[{"old_stem": "Con temperature 0, un equipo observa que dos ejecuciones del mismo prompt a veces dan respuestas distintas. ¿Qué conclusión es correcta?", "stem": "Un equipo migra su pipeline de evals a Claude Opus 4.7. Antes fijaba temperature 0 para tener resultados reproducibles y ahora todas las peticiones fallan con 400 invalid_request_error. ¿Qué debe hacer?", "options": ["Sustituir temperature 0 por top_k 1, que el modelo nuevo acepta y que da una salida determinista", "Quitar los parámetros de sampling y repetir cada caso varias veces, porque la salida no es determinista", "Mantener temperature 0 y reintentar con backoff, porque el 400 es transitorio tras cambiar de modelo", "Pasar temperature al valor por defecto en cada petición para que la eval sea reproducible de nuevo"], "correct": [1], "explanation": "Desde Claude Opus 4.7, temperature, top_p o top_k con un valor distinto del predeterminado devuelven 400, y con la versión de API 2026-10-21 cualquier parámetro de sampling enviado explícitamente se rechaza. Además, ni siquiera temperature 0 garantizaba determinismo: la forma fiable de medir es repetir cada caso y comparar sobre varias ejecuciones. Un 400 no se reintenta."}, {"old_stem": "Un desarrollador pone temperature 0 y top_p 0,1 a la vez para \"máxima precisión\" y la calidad empeora en tareas creativas que también usa ese servicio. ¿Qué recomendación aplica?", "stem": "Un servicio usa el mismo cliente para extraer datos de facturas y para redactar textos de marketing. Con modelos anteriores ajustaba temperature por tarea; al pasar a Claude Opus 4.7 esas peticiones fallan con 400. ¿Cómo se adapta?", "options": ["Quitar los parámetros de sampling y guiar cada tarea con su prompt y ejemplos, y la extracción con structured outputs", "Enviar solo top_p en lugar de temperature, porque los modelos nuevos rechazan temperature pero siguen aceptando top_p", "Mantener temperature y reintentar con backoff exponencial, porque el 400 es un error transitorio del modelo nuevo", "Mover el ajuste al system prompt con una instrucción explícita como \"responde como si temperature fuera 0\""], "correct": [0], "explanation": "En Claude Opus 4.7 y posteriores no se ajustan temperature, top_p ni top_k: valores distintos del predeterminado dan 400 (y con la versión de API 2026-10-21, cualquier valor explícito). El comportamiento por tarea se controla con instrucciones, ejemplos y, cuando el formato importa, structured outputs o una tool strict. Un 400 no es transitorio, y pedir una temperature en el prompt no cambia el sampling."}, {"old_stem": "Un modelo con temperature 0 sigue dando respuestas variadas a preguntas abiertas en un chatbot. Producto quiere respuestas consistentes. ¿Qué medidas ayudan más? (Elige 2)", "stem": "Un chatbot sobre Claude Opus 4.7 da respuestas distintas a la misma pregunta frecuente y Producto quiere respuestas consistentes. Alguien propone bajar la temperature. ¿Qué medidas ayudan de verdad? (Elige 2)", "options": ["Dar instrucciones y ejemplos más concretos del formato y el contenido esperados", "Cachear y reutilizar respuestas aprobadas para preguntas frecuentes idénticas", "Subir max_tokens para que el modelo no recorte las respuestas de forma distinta", "Activar streaming, que hace que las respuestas se generen siempre en el mismo orden", "Enviar temperature 0 en cada petición para que las respuestas salgan idénticas"], "correct": [0, 1], "explanation": "Un prompt más específico y la reutilización de respuestas validadas dan consistencia. Bajar la temperature no es una opción: en Claude Opus 4.7 un valor distinto del predeterminado devuelve 400, y aun en modelos anteriores temperature 0 no garantizaba respuestas idénticas. max_tokens y streaming no influyen en el contenido."}]$q$::jsonb)
    as r(old_stem text, stem text, options jsonb, correct int[], explanation text)
),
updated as (
  update public.questions q
  set stem = i.stem, options = i.options, correct = i.correct,
      explanation = i.explanation, updated_at = now()
  from incoming i, exam e
  where q.exam_id = e.id and q.source <> 'team'
    and lower(btrim(q.stem)) in (lower(btrim(i.old_stem)), lower(btrim(i.stem)))
  returning q.id, left(q.stem, 80) as enunciado
)
select count(*) over () as actualizadas, enunciado from updated;
