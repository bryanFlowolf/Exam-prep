// Official exam-structure pages and how each vendor scores its real exam. Checked in November 2026.

export type OfficialGuide = { url: string; label: string; note?: string };

const ANTHROPIC_NOTE = 'La guía en PDF se descarga desde la página de la certificación en Partner Academy (requiere cuenta de partner).';

/** Official page with the exam structure (format, passing score, weighted objectives), by exam slug. */
export const OFFICIAL_GUIDES: Record<string, OfficialGuide> = {
  'anthropic-ccao-f': { url: 'https://anthropic-partners.skilljar.com/path/claude-associate', label: 'Guía oficial del examen en Partner Academy', note: ANTHROPIC_NOTE },
  'anthropic-ccar-f': { url: 'https://anthropic-partners.skilljar.com/claude-certified-architect-foundations-certification', label: 'Guía oficial del examen en Partner Academy', note: ANTHROPIC_NOTE },
  'anthropic-ccar-p': { url: 'https://anthropic-partners.skilljar.com/path/claude-certified-architect-professional', label: 'Guía oficial del examen en Partner Academy', note: ANTHROPIC_NOTE },
  'anthropic-ccdv-f': { url: 'https://anthropic-partners.skilljar.com/path/claude-certified-developer-foundations', label: 'Guía oficial del examen en Partner Academy', note: ANTHROPIC_NOTE },
  'anthropic-ccdv-p': { url: 'https://anthropic-partners.skilljar.com/path/claude-developer', label: 'Guía oficial del examen en Partner Academy', note: ANTHROPIC_NOTE },
  'appian-analyst': { url: 'https://community.appian.com/learn/certifications/p/certified-analyst', label: 'Información oficial del examen (Appian Community)' },
  'appian-associate-developer': { url: 'https://community.appian.com/learn/certifications/p/associate-developer', label: 'Información oficial del examen (Appian Community)' },
  'appian-senior-developer': { url: 'https://community.appian.com/learn/certifications/p/senior-developer', label: 'Información oficial del examen (Appian Community)' },
  'appian-lead-developer': { url: 'https://community.appian.com/learn/certifications/p/lead-developer', label: 'Información oficial del examen (Appian Community)' },
  'salesforce-platform-administrator': { url: 'https://trailheadacademy.salesforce.com/certificate/exam-platform-admin---Plat-Admn-201', label: 'Guía oficial del examen (Trailhead Academy)' },
  'salesforce-agentforce-specialist': { url: 'https://trailheadacademy.salesforce.com/certificate/exam-agentforce-specialist---AI-201', label: 'Guía oficial del examen (Trailhead Academy)' },
  'salesforce-data-360-consultant': { url: 'https://trailhead.salesforce.com/credentials/data360consultant', label: 'Credencial y guía oficial del examen (Trailhead)' },
  'salesforce-mulesoft-developer': { url: 'https://trailhead.salesforce.com/credentials/mulesoftdeveloperi', label: 'Credencial y guía oficial del examen (Trailhead)' },
  'adobe-aem-sites-developer-expert': { url: 'https://certification.adobe.com/certification/sites-developer-expert-v2/1222', label: 'Objetivos oficiales del examen (Adobe Certification)' },
  'adobe-journey-optimizer-developer-expert': { url: 'https://certification.adobe.com/certification/journey-optimizer-developer-expert/199', label: 'Objetivos oficiales del examen (Adobe Certification)' },
  'adobe-rtcdp-developer-expert': { url: 'https://certification.adobe.com/certification/developer-expert2/1348', label: 'Objetivos oficiales del examen (Adobe Certification)' },
};

export type Scoring = { summary: string; points: string[] };

/** How the real exam is scored, by vendor. Only where the vendor documents it. */
export const SCORING: Record<string, Scoring> = {
  Anthropic: {
    summary: 'Nota escalada de 100 a 1.000; se aprueba con 720.',
    points: [
      'El examen real tiene 70 preguntas, de las que 60 puntúan. Las otras 10 se están probando para futuras versiones: no se distinguen de las demás ni cuentan para la nota (en CCAR-F son 60 preguntas en total).',
      'Tus aciertos se convierten a una escala de 100 a 1.000 y el aprobado está en 720. La escala sirve para igualar versiones del examen con dificultad ligeramente distinta, así que 720 no equivale necesariamente a un 72 % de aciertos. Anthropic no publica la tabla de conversión.',
      'Es un examen con criterio fijo: te comparas con un estándar definido por expertos, no con el resto de candidatos.',
      'Solo cuenta la nota total. El informe muestra el porcentaje de aciertos por dominio, pero es orientativo: no hay mínimo por dominio.',
      'Cada pregunta indica cuántas respuestas elegir. La guía no habla de puntuación parcial; aquí una pregunta con varias respuestas solo cuenta si aciertas todas.',
      'En esta app ves el porcentaje de aciertos. Como la conversión a la escala no es pública, el objetivo del 80 % es un margen de seguridad propio, no una regla oficial.',
    ],
  },
};
