import type { Question } from './types';

/** Language the questions are shown in. The original text is in the exam's language (Spanish for CCDV-F). */
export type Lang = 'es' | 'en';

export const LANGS: { code: Lang; label: string; name: string }[] = [
  { code: 'es', label: 'ES', name: 'Español' },
  { code: 'en', label: 'EN', name: 'English' },
];

const KEY = 'exam-prep-lang';

export function loadLang(): Lang {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'en' || v === 'es' ? v : 'es';
  } catch {
    return 'es';
  }
}

export function saveLang(l: Lang) {
  try { localStorage.setItem(KEY, l); } catch { /* private window: keep it for this visit only */ }
}

export type QText = { stem: string; options: string[]; explanation: string; missing: boolean };

/**
 * Question text in the chosen language. Falls back to the original when there is no translation
 * (for example, a team question written only in Spanish); `missing` tells the UI to say so.
 */
export function qText(q: Question, lang: Lang, base = 'es'): QText {
  const t = lang !== base ? q.i18n?.[lang] : undefined;
  if (t && Array.isArray(t.options) && t.options.length === q.options.length) {
    return { stem: t.stem, options: t.options, explanation: t.explanation ?? q.explanation, missing: false };
  }
  return { stem: q.stem, options: q.options, explanation: q.explanation, missing: lang !== base };
}

/** The few labels that sit inside a question card, so a question read in English stays in English. */
export const QL = {
  es: { correct: 'Correcto.', incorrect: 'Incorrecto.', answer: 'Respuesta', choose: (n: number) => `Elige ${n}`, yourAnswer: 'Tu respuesta', missing: 'Sin traducción: se muestra en español', strike: 'Descartar', unstrike: 'Recuperar', strikeHint: 'Puedes descartar una opción con el botón de su derecha o con clic derecho: queda tachada en gris.',
    learnMore: 'Para saber más', report: 'Reportar pregunta', reported: 'Reportada: gracias, la revisará un administrador',
    reportTitle: '¿Qué le pasa a esta pregunta?', reportSend: 'Enviar reporte', reportCancel: 'Cancelar', reportComment: 'Detalles (opcional)',
    reportFail: 'No se ha podido enviar el reporte.', reportNote: 'Los administradores verán tu nombre junto al reporte.',
    reasons: { ambigua: 'Es ambigua o tiene más de una respuesta válida', respuesta: 'Creo que la respuesta correcta está mal', traduccion: 'La traducción no es correcta', errata: 'Tiene una errata', otro: 'Otro motivo' },
    stat: (p: number, n: number) => `Acierta a la primera el ${p}% (${n} respuestas)`, statPick: 'Elegida' },
  en: { correct: 'Correct.', incorrect: 'Incorrect.', answer: 'Answer', choose: (n: number) => `Choose ${n}`, yourAnswer: 'Your answer', missing: 'No English version yet: shown in Spanish', strike: 'Strike out', unstrike: 'Restore', strikeHint: 'Strike out an option with the button on its right or a right-click: it is crossed out and greyed.',
    learnMore: 'Learn more', report: 'Report question', reported: 'Reported: thanks, an admin will review it',
    reportTitle: 'What is wrong with this question?', reportSend: 'Send report', reportCancel: 'Cancel', reportComment: 'Details (optional)',
    reportFail: 'The report could not be sent.', reportNote: 'Admins will see your name next to the report.',
    reasons: { ambigua: 'Ambiguous or more than one valid answer', respuesta: 'I think the correct answer is wrong', traduccion: 'The translation is wrong', errata: 'It has a typo', otro: 'Something else' },
    stat: (p: number, n: number) => `${p}% get it right first time (${n} answers)`, statPick: 'Chosen' },
} as const;
