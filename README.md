# Exam Prep

Aplicación para preparar certificaciones: simulacros con el reparto oficial por dominios, práctica con corrección al momento, lista de repaso personal y preguntas escritas por el equipo. Admite varios exámenes (Anthropic, Appian, Salesforce…) y cada persona tiene su progreso guardado en su cuenta.

- **Frontend:** Vite + React + TypeScript, desplegado en Vercel.
- **Backend:** Supabase (Postgres con Row Level Security y login por enlace mágico al email).
- **Contenido inicial:** Claude Certified Developer – Foundations (319 preguntas de práctica, `content/exams/anthropic-ccdv-f.json`).

## Qué ve cada persona

| Dato | Quién lo ve |
|---|---|
| Exámenes y preguntas del banco | Todos los usuarios con sesión |
| Preguntas del equipo | Todos; cada autor edita y borra las suyas; los administradores moderan |
| Intentos y notas, preguntas vistas, lista de repaso | **Solo su dueño.** Ni los administradores pueden leerlos (políticas RLS en `supabase/migrations`) |
| Nombre visible | Todos (aparece junto a las preguntas del equipo) |

Los emails solo están en el sistema de autenticación de Supabase, no en las tablas de la aplicación.

## Despliegue (unos 20 minutos)

### 1. Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com) (región UE si los usuarios están en Europa).
2. En **SQL Editor**, ejecuta en este orden el contenido de:
   - `supabase/migrations/20261119000000_init.sql` (tablas y reglas de privacidad);
   - `supabase/migrations/20261119000100_grants.sql` (permisos de tabla; los proyectos nuevos de Supabase no los conceden solos).
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

### 4. Restringir quién se registra (recomendado)

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

- `correct` usa índices desde 0; con varios índices la pregunta es de respuesta múltiple. Entre 2 y 6 opciones, y al menos una incorrecta.
- `source: "official_sample"` marca una pregunta de ejemplo publicada en la guía oficial.
- Si el `slug` ya existe, se actualiza el examen y se sustituyen sus preguntas del banco; las del equipo se conservan.
- Para versionar el contenido en el repositorio, guarda el JSON en `content/exams/` y ejecuta `npm run seed` para regenerar `supabase/seed.sql`.

**Contenido permitido:** solo preguntas propias o con permiso de su autor. No uses preguntas de exámenes reales ni de bancos de terceros ("brain dumps"): los acuerdos de confidencialidad de Anthropic, Salesforce, Appian y la mayoría de fabricantes lo prohíben y pueden retirar la certificación.

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
  ```
- **Interfaz sin backend:** `npx vite --config test/vite.mock.config.ts` arranca la app con un Supabase simulado en memoria.
