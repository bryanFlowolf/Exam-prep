# WolfPack Academy

Aplicación para preparar certificaciones: simulacros con el reparto oficial por dominios, práctica con corrección al momento, lista de repaso personal y preguntas escritas por el equipo. Admite varios exámenes (Anthropic, Appian, Salesforce…) y cada persona tiene su progreso guardado en su cuenta.

- **Frontend:** Vite + React + TypeScript, desplegado en Vercel.
- **Backend:** Supabase (Postgres con Row Level Security y login por enlace mágico al email).
- **Contenido inicial:** Claude Certified Developer – Foundations (500 preguntas de práctica, `content/exams/anthropic-ccdv-f.json`).

## Qué ve cada persona

| Dato | Quién lo ve |
|---|---|
| Exámenes y preguntas del banco | Todos los usuarios con sesión |
| Preguntas del equipo | Todos; cada autor edita y borra las suyas; los administradores moderan |
| Intentos y notas, preguntas vistas, lista de repaso | **Solo su dueño.** Ni los administradores pueden leerlos (políticas RLS en `supabase/migrations`) |
| Nombre visible | Todos (aparece junto a las preguntas del equipo) |
| Fecha prevista de examen | Solo su dueño (y los responsables de su equipo si comparte su progreso) |
| Estadísticas por pregunta (veces respondida, % de acierto, opciones elegidas) | Todos. Son **anónimas**: la tabla no guarda quién respondió |
| Reportes de preguntas | Quien lo envía y los administradores (que ven su nombre) |
| Progreso compartido con un equipo | Solo los **responsables** de ese equipo, y solo de los miembros que activan "compartir mi progreso" en *Mis equipos*. Es un resumen por examen (nota estimada, probabilidad, respuestas, última actividad, último simulacro, fecha de examen), nunca preguntas ni respuestas. Ser administrador no da acceso |

| Cursos internos y sus lecciones | Todos los usuarios con sesión (los publicados); los editores de formación ven también los borradores |
| Preguntas del test de un curso (con su respuesta) | Solo administradores y editores de formación. El test se reparte y se corrige en el servidor |
| Avance en lecciones, intentos de test, certificados y firmas de conformidad | Su dueño, y los administradores y editores de formación (es la evidencia de la formación obligatoria) |
| Consultas al tutor IA | Nadie: no se guardan. Solo se cuenta cuántas hace cada persona al día para aplicar el límite |

Los emails están en el sistema de autenticación de Supabase. Como excepción, cada registro de formación completada guarda una copia del nombre y el email de la persona en el momento de completarla, para que la evidencia se conserve aunque la cuenta se borre.

## Despliegue (unos 20 minutos)

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) (región UE si los usuarios están en Europa).
2. En **SQL Editor**, ejecuta en este orden el contenido de:
   - `supabase/migrations/20261119000000_init.sql` (tablas y reglas de privacidad);
   - `supabase/migrations/20261119000100_grants.sql` (permisos de tabla; los proyectos nuevos de Supabase no los conceden solos).
   - `supabase/migrations/20261119000200_keepalive.sql` (función mínima para evitar la pausa por inactividad del plan gratuito).
   - `supabase/migrations/20261123000000_i18n.sql` (traducciones de las preguntas).
   - `supabase/migrations/20261124000000_insights.sql` (panel de preparación, reportes y estadísticas de preguntas, equipos y enlaces de documentación);
   - `supabase/migrations/20261127000000_training.sql` (formación interna y límite del tutor IA).
3. En **SQL Editor**, ejecuta `supabase/seed.sql` para cargar el examen CCDV-F.
4. En **Authentication → URL Configuration**:
   - **Site URL:** la URL de Vercel (por ejemplo `https://exam-prep.vercel.app`).
   - **Redirect URLs:** la misma URL y, para desarrollo, `http://localhost:5173`.
5. En **Authentication → Providers → Email**: deja activado *Email* y el enlace mágico. Para muchos usuarios, configura un SMTP propio en **Authentication → SMTP Settings**: el correo integrado de Supabase tiene un límite bajo de envíos por hora.
6. En **Project Settings → API** copia la *Project URL* y la clave *anon public*.

### 2. Vercel

1. Importa este repositorio en [vercel.com](https://vercel.com) (framework: Vite).
2. Añade las variables de entorno `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` con los valores del paso anterior.
3. Despliega. `vercel.json` ya redirige todas las rutas a la aplicación.

### 3. Primer administrador

1. Entra en la app con tu email (recibirás un enlace).
2. En Supabase, **SQL Editor**:
   ```sql
   update public.profiles set is_admin = true
   where id = (select id from auth.users where email = 'tu-email@empresa.com');
   ```
3. Recarga la app: verás **Administración**. Desde ahí puedes nombrar a otros administradores.

### 4. Evitar la pausa por inactividad (plan gratuito de Supabase)

Supabase pausa los proyectos gratuitos tras una semana sin actividad. El workflow `.github/workflows/keepalive.yml` llama a `keepalive()` cada 3 días para evitarlo.

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**, crea `SUPABASE_URL` y `SUPABASE_ANON_KEY` con los mismos valores que en Vercel.
2. En **Actions → Supabase keepalive → Run workflow**, lánzalo una vez a mano y comprueba que termina en verde.

GitHub desactiva los workflows programados de repositorios sin commits durante 60 días: si pasa, reactívalo en la pestaña Actions. Con el plan Pro de Supabase no hay pausa y este workflow no hace falta.

### 5. Restringir quién se registra (recomendado)

Con la lista de acceso vacía, cualquiera con un email puede registrarse. En **Administración → Lista de acceso** añade:
- `@tuempresa.com` para todo el dominio de la empresa;
- el email completo de cada compañero externo (`persona@otra.com`).

## Añadir un examen nuevo

Crea un JSON con este formato (ver `content/exams/anthropic-ccdv-f.json`) y súbelo en **Administración → Importar o actualizar un examen**:

```json
{
  "slug": "salesforce-admin",
  "vendor": "Salesforce",
  "code": "ADM-201",
  "name": "Salesforce Certified Administrator",
  "description": "Preguntas de práctica escritas a partir de la guía oficial.",
  "language": "es",
  "exam": { "questions": 60, "minutes": 105, "passing": "65% aprox.", "mini": { "questions": 20, "minutes": 35 } },
  "domains": [
    { "code": "D1", "name": "Configuration and Setup", "weight": 20 },
    { "code": "D2", "name": "Object Manager and Lightning App Builder", "weight": 20 }
  ],
  "questions": [
    {
      "domain": "D1",
      "stem": "Enunciado del escenario…",
      "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correct": [1],
      "explanation": "Por qué B es correcta y por qué fallan las demás."
    }
  ]
}
```

- `i18n` (opcional) guarda otras versiones de cada pregunta, por ejemplo `"i18n": {"en": {"stem": "…", "options": ["…"], "explanation": "…"}}`. Las opciones traducidas van en el mismo orden que las originales. El selector ES/EN de la barra superior elige el idioma; si una pregunta no tiene traducción, se muestra en su idioma original con un aviso.
- `correct` usa índices desde 0; con varios índices la pregunta es de respuesta múltiple. Entre 2 y 6 opciones, y al menos una incorrecta.
- `source: "official_sample"` marca una pregunta de ejemplo publicada en la guía oficial.
- Si el `slug` ya existe, se actualiza el examen y se sustituyen sus preguntas del banco; las del equipo se conservan.
- Para versionar el contenido en el repositorio, guarda el JSON en `content/exams/` y ejecuta `npm run seed` para regenerar `supabase/seed.sql`.

**Contenido permitido:** solo preguntas propias o con permiso de su autor. No uses preguntas de exámenes reales ni de bancos de terceros ("brain dumps"): los acuerdos de confidencialidad de Anthropic, Salesforce, Appian y la mayoría de fabricantes lo prohíben y pueden retirar la certificación.

## Preparación, calidad y equipos

- **Panel de preparación** (página de cada examen): nota estimada ponderada por el peso oficial de cada dominio, probabilidad de aprobar frente al corte del examen, evolución de los simulacros y fecha prevista del examen. Usa los últimos 20 simulacros, mini-exámenes y prácticas; los dominios con pocas respuestas cuentan como un 50 % hasta tener datos. La lógica está en `src/lib/readiness.ts` y la vista de equipos usa la misma.
- **Práctica dirigida:** 20 preguntas de los dos dominios donde más puntos puedes ganar (distancia al objetivo × peso), empezando por las que fallaste.
- **Reportar pregunta:** en el examen, los resultados y la lista de repaso. Los administradores los resuelven en *Administración → Calidad del banco*, donde también ven qué preguntas casi nadie acierta y qué distractor se elige más.
- **Equipos:** los administradores los crean en *Administración → Equipos* y nombran responsables; cada miembro decide en *Mis equipos* si comparte su progreso.
- **Para saber más:** cada dominio tiene enlaces a la documentación oficial (campo `docs` de cada dominio en `content/exams/*.json`; para un proyecto ya desplegado, `supabase/content-updates/20261124_enlaces_documentacion.sql`).
- **Móvil:** en pantallas pequeñas los botones del examen quedan fijos abajo, la navegación se pliega y se puede deslizar a izquierda o derecha para cambiar de pregunta. La app se puede instalar en la pantalla de inicio (`public/manifest.webmanifest`).

## Formación interna

Además de las certificaciones, la app centraliza la formación de la empresa (prevención de riesgos laborales, onboarding, tecnologías, cumplimiento…). Requiere la migración `supabase/migrations/20261127000000_training.sql`.

- **Roles:** los administradores pueden nombrar **editores de formación** en *Administración → Personas registradas*. Un editor crea cursos, asigna y consulta el cumplimiento, sin acceso al resto de la administración.
- **Cursos** (*Formación → Gestionar cursos*): lecciones de texto, vídeo (YouTube, Vimeo o archivo subido), PDF (enlace o archivo) o enlace externo, y un test final con nota de aprobado. Opcionalmente, una muestra aleatoria de preguntas por intento, caducidad del certificado (p. ej. 12 meses para renovar cada año) y **firma de conformidad**: al aprobar, la persona acepta una declaración y queda registrada con fecha y hora.
- **Asignaciones:** a personas o equipos, con fecha límite opcional. Asignar a un equipo incluye a quien entre más tarde. Cada persona ve sus formaciones pendientes en *Formación*, con un contador en la cabecera y un aviso en la portada.
- **Cumplimiento:** por curso, quién la tiene completada, pendiente, vencida (pasada la fecha límite) o caducada (hay que renovarla), con nota, firma y certificado. Se exporta a CSV para RR. HH. o auditorías.
- **Certificado:** página imprimible con nombre, curso, fecha, nota, caducidad, código y declaración firmada; se guarda en PDF desde el navegador.
- **Evidencia:** los intentos y firmas no se pueden modificar ni borrar desde la app, y un curso que alguien ya ha hecho no se puede borrar (solo despublicar).
- **Archivos:** se guardan en el bucket privado `training` de Supabase Storage (lo crea la migración); solo se pueden abrir con sesión iniciada. Límite de 50 MB por archivo en la app; para vídeos largos, usa un enlace a vuestra plataforma de vídeo.
- **Pendiente:** los avisos por email de fecha límite y caducidad. Por ahora los avisos se ven dentro de la app.

## Tutor IA (Claude en Amazon Bedrock)

En la corrección de cada pregunta, en los resultados y en la lista de repaso hay un botón **«Explícamelo con IA»**. Claude explica por qué la respuesta elegida es incorrecta y la correcta es correcta, con la explicación oficial y la documentación del dominio, y admite preguntas de seguimiento.

- La llamada la hace la función de Supabase `supabase/functions/tutor`. La pregunta y su respuesta se leen de la base de datos (no del navegador) y las credenciales nunca llegan a la app.
- No se guardan las conversaciones. Hay un límite diario por persona (60 consultas por defecto, variable `TUTOR_DAILY_LIMIT`).
- Hasta que se configure, el botón indica que el tutor no está activado.

**Activarlo** (necesita la migración `20261127000000_training.sql`):

1. En AWS, habilita el acceso al modelo de Claude en Bedrock y anota la región y el **ID del modelo o del perfil de inferencia** (por ejemplo `eu.anthropic.claude-sonnet-4-5-20250929-v1:0`).
2. Guarda los secretos en Supabase (*Edge Functions → Secrets*, o con la CLI):
   ```bash
   npx supabase secrets set --project-ref <ref> BEDROCK_REGION=eu-west-1 BEDROCK_MODEL_ID=<id-del-modelo>
   # Con una clave de API de Bedrock:
   npx supabase secrets set --project-ref <ref> BEDROCK_API_KEY=<clave>
   # O con credenciales IAM (permiso bedrock:InvokeModel sobre ese modelo):
   npx supabase secrets set --project-ref <ref> AWS_ACCESS_KEY_ID=<id> AWS_SECRET_ACCESS_KEY=<secreto>
   ```
3. Despliega la función: `npx supabase functions deploy tutor --project-ref <ref>` (o créala en *Edge Functions* del panel con los dos archivos de `supabase/functions/tutor`).

## Desarrollo

```bash
npm install
cp .env.example .env    # rellena las dos variables
npm run dev
```

### Pruebas

- **Aislamiento de datos (RLS):** con un Postgres 16 local,
  ```bash
  psql -d prueba -f supabase/tests/mock_supabase.sql -f supabase/migrations/20261119000000_init.sql -f supabase/migrations/20261119000100_grants.sql -f supabase/seed.sql
  psql -d prueba -f supabase/tests/rls_test.sql   # todas las líneas deben decir OK
  psql -d prueba -f supabase/migrations/20261123000000_i18n.sql -f supabase/migrations/20261124000000_insights.sql -f supabase/migrations/20261127000000_training.sql
  psql -d prueba -f supabase/tests/insights_test.sql   # reportes, estadísticas anónimas y privacidad de los equipos
  ```
- **Interfaz sin backend:** `npx vite --config test/vite.mock.config.ts` arranca la app con un Supabase simulado en memoria.
