// How to register for each vendor's certification exams. Checked against the vendors' own pages in
// November 2026; prices and policies change, so every section links to the official source.

export type VendorGuide = {
  /** Matches exams.vendor. */
  vendor: string;
  label: string;
  where: string;
  checked: string;
  facts: { k: string; v: string }[];
  steps: string[];
  notes?: string[];
  links: { title: string; url: string }[];
};

export const GUIDES: VendorGuide[] = [
  {
    vendor: 'Anthropic',
    label: 'Claude (Anthropic)',
    where: 'Anthropic Partner Academy + Pearson VUE',
    checked: 'noviembre de 2026',
    facts: [
      { k: 'Quién puede', v: 'Solo personas de empresas del Claude Partner Network, con el correo de la empresa' },
      { k: 'Precio', v: 'Associate 99 $ · Developer y Architect Foundations 125 $ · Architect Professional 175 $ (50 % de descuento para partners Select, Preferred y Global Premier)' },
      { k: 'Formato', v: '120 minutos, libro cerrado, online (OnVUE) o en centro Pearson' },
      { k: 'Aprobado', v: '720 sobre una escala de 100 a 1.000' },
      { k: 'Validez', v: '12 meses; la renovación a tiempo es una evaluación gratuita sin vigilancia' },
    ],
    steps: [
      'Entra en Anthropic Partner Academy con tu correo de empresa. Si te dice que no es un correo de partner, escribe a partner-support@anthropic.com: vincular el dominio tarda de 7 a 10 días.',
      'Abre la página de la certificación: ahí están la guía del examen, los cursos de preparación y el botón de registro.',
      'Paga con tarjeta en Partner Academy (el descuento de partner se aplica solo).',
      'Recibirás un correo con un enlace a Pearson VUE: elige examen online (OnVUE) o en un centro de examen, fecha y hora.',
      'Si lo haces online, pasa antes la prueba del sistema de Pearson con el mismo equipo y red. En redes corporativas puede que TI tenga que permitir los dominios de Pearson.',
      'El día del examen: 120 minutos de examen (unos 135 en total), sin asistentes de IA ni traductores.',
    ],
    notes: [
      'Cambiar o cancelar es gratis hasta 24 horas antes; después, o si no te presentas, pierdes el pago.',
      'Repeticiones: espera 14 días tras el primer suspenso, 30 tras el segundo y 90 tras el tercero; como máximo 4 intentos en 12 meses, cada uno con su tasa.',
      'Al aprobar recibes un correo de Credly para aceptar la insignia digital.',
    ],
    links: [
      { title: 'Preguntas frecuentes de certificación (Partner Academy)', url: 'https://anthropic-partners.skilljar.com/page/faq-certifications' },
      { title: 'Las certificaciones de Claude por rol', url: 'https://claude.com/blog/four-role-based-claude-certifications' },
    ],
  },
  {
    vendor: 'Appian',
    label: 'Appian',
    where: 'Appian Community + Meazure Learning (ProctorU)',
    checked: 'noviembre de 2026',
    facts: [
      { k: 'Precio', v: '250 $ por examen principal (50 % de descuento para partners vinculados)' },
      { k: 'Formato', v: 'Solo online, con vigilancia remota de ProctorU; examen solo en inglés' },
      { k: 'Requisitos', v: 'Senior Developer exige Associate Developer activa; Lead Developer exige Senior Developer activa' },
      { k: 'Validez', v: 'No caduca si completas la formación trimestral Release Showcase antes de la fecha límite' },
    ],
    steps: [
      'Crea o revisa tu perfil en Appian Community con tu nombre legal (el de tu documento de identidad) y un correo actual.',
      'Si trabajas en un partner, vincula tu organización en Edit Community Profile → Primary Group Membership; así aparece el descuento al pagar.',
      'Elige el examen en la sección Learn → Certifications de Appian Community y paga al registrarte.',
      'Reserva la cita en Meazure Learning (ProctorU). Reservar con menos de 72 horas cuesta un suplemento.',
      'Prepara el equipo: descarga el navegador Guardian, prueba cámara y conexión, desactiva bloqueadores de ventanas y quita segundos monitores.',
      'Conéctate 10 minutos antes con un documento oficial con foto, original y en vigor.',
    ],
    notes: [
      'Cancelar o cambiar con menos de 24 horas cuesta 25 $; si no te presentas pierdes la tasa.',
      'Tienes 4 intentos por examen; tras el segundo hay que esperar 14 días. Cada intento se paga.',
      'Recibes el informe de puntuación al terminar; la certificación tarda hasta 48 horas en aparecer en tu perfil.',
    ],
    links: [
      { title: 'Preguntas frecuentes de certificación de Appian', url: 'https://community.appian.com/learn/certifications/p/faqs' },
      { title: 'Certificaciones de Appian', url: 'https://community.appian.com/learn/certifications' },
    ],
  },
  {
    vendor: 'Salesforce',
    label: 'Salesforce (incluido MuleSoft)',
    where: 'Trailhead Academy + Pearson VUE',
    checked: 'noviembre de 2026',
    facts: [
      { k: 'Precio', v: 'Normalmente 200 $ por examen y 100 $ por repetición, más impuestos' },
      { k: 'Formato', v: 'Online con vigilancia (OnVUE) o en un centro Pearson VUE; sin material de consulta' },
      { k: 'Desde cuándo', v: 'Desde julio de 2025 los exámenes se reservan en Trailhead Academy (antes en Webassessor); tu historial se conserva' },
      { k: 'Validez', v: 'Hay que completar en Trailhead los módulos de mantenimiento de cada certificación cuando se publican' },
    ],
    steps: [
      'Inicia sesión en Trailhead Academy con tu cuenta de Trailblazer. Usa el mismo correo que tenías en Webassessor si ya te habías certificado.',
      'Ve a Certifications → Find a Certification, elige el examen y pulsa Register Now.',
      'Elige examen online o en centro y completa tu perfil de examen con tu nombre legal, igual que en tu documento de identidad.',
      'Selecciona idioma del examen, idioma del vigilante, zona horaria, fecha y hora; añade la reserva al carrito, aplica tu voucher si tienes y paga.',
      'Si es online, pasa el test del sistema de OnVUE uno o dos días antes, en el mismo equipo, lugar y red. No se admiten tablets ni máquinas virtuales.',
      'El día del examen el registro abre 30 minutos antes: foto de la sala, documento de identidad y reconocimiento facial.',
    ],
    notes: [
      'Los exámenes de MuleSoft también se reservan en Trailhead Academy.',
      'Las condiciones de cambio, cancelación y repetición están en la página de cada examen en Trailhead Academy; revísalas antes de pagar.',
    ],
    links: [
      { title: 'Catálogo de certificaciones (Trailhead Academy)', url: 'https://trailheadacademy.salesforce.com/all-offerings#f-assetType=Certification' },
      { title: 'Certificaciones de Salesforce por rol', url: 'https://trailhead.salesforce.com/credentials/administratoroverview/' },
      { title: 'Mantener tus certificaciones', url: 'https://trailhead.salesforce.com/content/learn/trails/maintain-your-salesforce-certifications' },
    ],
  },
  {
    vendor: 'Adobe',
    label: 'Adobe Experience Cloud',
    where: 'Portal de certificación de Adobe (online)',
    checked: 'noviembre de 2026',
    facts: [
      { k: 'Precio', v: 'Professional 125 $ · Expert y Master 225 $ (33 % de descuento para partners y estudiantes)' },
      { k: 'Formato', v: 'Solo online con vigilancia por cámara (IA y personas); Chrome o Edge' },
      { k: 'Resultado', v: 'Provisional al terminar; definitivo en hasta 72 horas' },
      { k: 'Validez', v: 'Se renueva gratis con dos módulos cortos de renovación; amplía 2 años desde la caducidad' },
    ],
    steps: [
      'Entra en certification.adobe.com y completa tu perfil: el nombre legal debe coincidir con tu documento de identidad y revisa tu zona horaria.',
      'Busca el examen en el catálogo de certificaciones y pulsa Manage exam.',
      'Compra el voucher al reservar (Purchase voucher) o antes en el Voucher Center de Adobe.',
      'Pulsa Schedule exam y elige fecha y hora (hasta 60 días vista). Las adaptaciones se piden al menos 7 días antes.',
      'Prepara el equipo desde la página del examen: Chrome o Edge, Process Tracker y test del sistema. Quita monitores externos y desactiva bloqueadores de ventanas.',
      'El día del examen ten a mano un documento de identidad físico (no se aceptan copias ni digitales); el vigilante empieza a la hora exacta.',
    ],
    notes: [
      'Cambios y cancelaciones, tú mismo desde Upcoming exams → Scheduling, con más de 24 horas de antelación; si no, pierdes el voucher.',
      'Repeticiones: 24 horas tras el primer suspenso y 14 días tras los siguientes; cada intento se paga.',
      'Problemas técnicos durante el examen: chat de easyProctor.',
    ],
    links: [
      { title: 'Cómo obtener una certificación de Adobe', url: 'https://certification.adobe.com/certifications/learn-more' },
      { title: 'Preguntas frecuentes de certificación de Adobe', url: 'https://experienceleague.adobe.com/en/docs/certification/program/faq' },
    ],
  },
];

export function guideFor(vendor: string): VendorGuide | undefined {
  return GUIDES.find((g) => g.vendor === vendor);
}
