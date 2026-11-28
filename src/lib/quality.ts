import type { Question, QuestionStat } from './types';

/**
 * Automatic quality review of the question bank.
 *
 * Two kinds of checks:
 *  - From the anonymous answer statistics: a wrong option chosen more than the right one (the key may be
 *    wrong), questions almost nobody gets right first time, a distractor that pulls too many people,
 *    questions everyone gets right, options nobody picks. Rates use the Wilson interval so a question is
 *    only flagged when the data is solid, not after three unlucky answers.
 *  - From the text itself (no data needed): the correct option clearly longer than the rest, repeated
 *    options, "(Choose N)" not matching the number of correct answers, near-duplicate questions, missing
 *    explanation or translation.
 * An admin can close a flag ("fine as is" or "fixed"). Data flags come back only if enough new answers
 * arrive and the problem is still there.
 */

export type Severity = 'alta' | 'media' | 'baja';
export type FlagCode =
  | 'key' | 'hard' | 'distractor' | 'reports' | 'easy' | 'dead'
  | 'length' | 'dupopt' | 'choose' | 'dupstem' | 'noexpl' | 'notrans';
export type Flag = { code: FlagCode; severity: Severity; detail: string; fromData: boolean };

export type QualityReview = {
  question_id: string;
  exam_id: string;
  status: 'ok' | 'fixed';
  note: string;
  answered_at_review: number;
  reviewed_at: string;
};

export const FLAG_LABEL: Record<FlagCode, string> = {
  key: 'Clave dudosa',
  hard: 'Casi nadie la acierta',
  distractor: 'Distractor demasiado atractivo',
  reports: 'Reportada',
  easy: 'Demasiado fácil',
  dead: 'Opción que nadie elige',
  length: 'La correcta destaca por longitud',
  dupopt: 'Opciones repetidas',
  choose: '«Elige N» no cuadra',
  dupstem: 'Posible duplicada',
  noexpl: 'Sin explicación',
  notrans: 'Sin traducción',
};
export const SEVERITY_RANK: Record<Severity, number> = { alta: 3, media: 2, baja: 1 };

/** Minimum first-time answers before judging how hard a question is. */
export const MIN_RATE = 10;
/** Minimum answers before judging how options are picked. */
export const MIN_PICKS = 15;

/** 95% Wilson interval for k successes out of n. */
export function wilson(k: number, n: number, z = 1.96): { lo: number; hi: number } {
  if (!n) return { lo: 0, hi: 1 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

const LETTERS = 'ABCDEFGH';
const pc = (x: number) => `${Math.round(x * 100)} %`;
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Visible text of an option or stem without exhibit blocks. */
const plain = (s: string) => s.replace(/```[\s\S]*?```/g, ' ');

/** "(Elige 2)" / "(Choose 2)" in a stem, or null. */
export function chooseN(stem: string): number | null {
  const m = stem.match(/\((?:elige|elija|selecciona|choose|select)\s+(\d+)\)/i);
  return m ? Number(m[1]) : null;
}

/** Words that identify a stem, for near-duplicate detection. */
function signature(q: Question): Set<string> {
  // Exhibits count: two questions with the same lead-in and different material are not duplicates.
  return new Set(norm(q.stem).split(' ').filter((w) => w.length >= 4));
}

/**
 * Near-duplicate stems in the same exam (Jaccard similarity of their words ≥ 0.8).
 * Returns, for each question, the other question it duplicates.
 */
export function findDuplicates(questions: Question[]): Map<string, Question> {
  const sigs = questions.map((q) => ({ q, s: signature(q) })).filter((x) => x.s.size >= 6);
  const out = new Map<string, Question>();
  for (let i = 0; i < sigs.length; i++) {
    for (let j = i + 1; j < sigs.length; j++) {
      const a = sigs[i].s, b = sigs[j].s;
      const small = a.size < b.size ? a : b, big = small === a ? b : a;
      if (small.size / big.size < 0.8) continue;
      let inter = 0;
      for (const w of small) if (big.has(w)) inter++;
      if (inter / (a.size + b.size - inter) >= 0.8) {
        if (!out.has(sigs[i].q.id)) out.set(sigs[i].q.id, sigs[j].q);
        if (!out.has(sigs[j].q.id)) out.set(sigs[j].q.id, sigs[i].q);
      }
    }
  }
  return out;
}

export type QualityContext = {
  reports: number;
  duplicateOf?: Question;
  /** True when most of the exam has an English version, so a missing one is worth flagging. */
  expectTranslation: boolean;
};

export function detectFlags(q: Question, s: QuestionStat | undefined, ctx: QualityContext): Flag[] {
  const flags: Flag[] = [];
  const single = q.correct.length === 1;

  // ---- From the statistics ----
  const N = s?.answered || 0;
  const share = (i: number) => (N ? (s!.picks[i] || 0) / N : 0);
  let keyFlag = false;
  if (s && single && N >= MIN_PICKS - 5) {
    const right = share(q.correct[0]);
    const best = q.options.map((_, i) => i).filter((i) => i !== q.correct[0]).sort((a, b) => share(b) - share(a))[0];
    if (best !== undefined && share(best) >= 0.35 && share(best) > right + 0.05) {
      keyFlag = true;
      flags.push({ code: 'key', severity: 'alta', fromData: true, detail: `La opción ${LETTERS[best]} la elige el ${pc(share(best))} y la correcta (${LETTERS[q.correct[0]]}) solo el ${pc(right)}. Comprueba que la respuesta marcada es la buena y que ${LETTERS[best]} no es también defendible.` });
    }
  }
  if (s && s.first_answered >= MIN_RATE) {
    const rate = s.first_correct / s.first_answered;
    const w = wilson(s.first_correct, s.first_answered);
    if (w.hi < 0.4) {
      flags.push({ code: 'hard', severity: w.hi < 0.25 ? 'alta' : 'media', fromData: true, detail: `Solo la acierta a la primera el ${pc(rate)} (${s.first_correct} de ${s.first_answered}). Suele indicar un enunciado ambiguo, una clave dudosa o un tema que la guía no cubre así.` });
    }
    if (s.first_answered >= 20 && w.lo > 0.93) {
      flags.push({ code: 'easy', severity: 'baja', fromData: true, detail: `La acierta a la primera el ${pc(rate)} (${s.first_correct} de ${s.first_answered}). Puede que el enunciado delate la respuesta o que los distractores sean evidentes.` });
    }
  }
  if (s && N >= MIN_PICKS && !keyFlag) {
    q.options.forEach((_, i) => {
      if (q.correct.includes(i)) return;
      if (share(i) >= 0.4) flags.push({ code: 'distractor', severity: 'media', fromData: true, detail: `El ${pc(share(i))} elige la opción ${LETTERS[i]}. Revisa que sea claramente incorrecta según la restricción del enunciado.` });
    });
  }
  if (s && N >= 40) {
    const dead = q.options.map((_, i) => i).filter((i) => !q.correct.includes(i) && share(i) < 0.02);
    if (dead.length) flags.push({ code: 'dead', severity: 'baja', fromData: true, detail: `${dead.length === 1 ? 'La opción' : 'Las opciones'} ${dead.map((i) => LETTERS[i]).join(', ')} no ${dead.length === 1 ? 'la elige' : 'las elige'} casi nadie (menos del 2 % de ${N}): no aporta${dead.length === 1 ? '' : 'n'} dificultad.` });
  }
  if (ctx.reports) {
    flags.push({ code: 'reports', severity: ctx.reports >= 2 ? 'alta' : 'media', fromData: true, detail: `${ctx.reports} ${ctx.reports === 1 ? 'reporte abierto' : 'reportes abiertos'} de usuarios (ver arriba).` });
  }

  // ---- From the text ----
  if (single && q.options.length > 2) {
    const len = q.options.map((o) => plain(o).trim().length);
    const c = len[q.correct[0]];
    const others = len.filter((_, i) => i !== q.correct[0]);
    const maxOther = Math.max(...others);
    if (c >= maxOther * 1.35 && c - maxOther >= 25) {
      flags.push({ code: 'length', severity: 'media', fromData: false, detail: `La correcta tiene ${c} caracteres y la siguiente más larga ${maxOther}. En el examen se aprende a elegir «la más larga»: alarga los distractores o acorta la correcta.` });
    }
  }
  const seen = new Map<string, number>();
  q.options.forEach((o, i) => {
    // Only spacing and a final full stop: symbols matter in code options ("#[payload]" ≠ "payload").
    const k = o.replace(/\s+/g, ' ').replace(/[.。]\s*$/, '').trim();
    if (seen.has(k)) flags.push({ code: 'dupopt', severity: 'alta', fromData: false, detail: `Las opciones ${LETTERS[seen.get(k)!]} y ${LETTERS[i]} dicen lo mismo.` });
    else seen.set(k, i);
  });
  const n = chooseN(q.stem);
  if (q.correct.length > 1 && n !== q.correct.length) {
    flags.push({ code: 'choose', severity: 'alta', fromData: false, detail: n === null ? `Tiene ${q.correct.length} respuestas correctas pero el enunciado no dice «(Elige ${q.correct.length})».` : `El enunciado pide elegir ${n} pero hay ${q.correct.length} respuestas correctas.` });
  } else if (q.correct.length === 1 && n !== null && n > 1) {
    flags.push({ code: 'choose', severity: 'alta', fromData: false, detail: `El enunciado pide elegir ${n} pero solo hay una respuesta correcta.` });
  }
  if (ctx.duplicateOf) {
    const d = plain(ctx.duplicateOf.stem).trim();
    flags.push({ code: 'dupstem', severity: 'media', fromData: false, detail: `Casi igual que otra pregunta del banco: «${d.length > 120 ? d.slice(0, 120) + '…' : d}». Si preguntan lo mismo, desactiva una.` });
  }
  if ((q.explanation || '').trim().length < 12) {
    flags.push({ code: 'noexpl', severity: 'baja', fromData: false, detail: 'No tiene explicación (o se queda en una o dos palabras): quien la falla no sabe por qué.' });
  }
  if (ctx.expectTranslation) {
    const en = q.i18n?.en;
    if (!en || !Array.isArray(en.options) || en.options.length !== q.options.length) {
      flags.push({ code: 'notrans', severity: 'baja', fromData: false, detail: 'Falta la versión en inglés (o no tiene el mismo número de opciones): en inglés se mostrará en español.' });
    }
  }
  return flags;
}

/**
 * Flags still open after an admin review: text flags stay closed; data flags reopen only if answers have
 * at least doubled (and grown by 20) since the review.
 */
export function openFlags(flags: Flag[], review: QualityReview | undefined, s: QuestionStat | undefined): Flag[] {
  if (!review) return flags;
  const now = s?.answered || 0;
  const enough = now >= Math.max(review.answered_at_review * 2, review.answered_at_review + 20);
  return flags.filter((f) => f.fromData && f.code !== 'reports' ? enough : f.code === 'reports');
}

export function score(flags: Flag[]): number {
  return flags.reduce((n, f) => n + SEVERITY_RANK[f.severity] ** 2, 0);
}

export function topSeverity(flags: Flag[]): Severity | null {
  return flags.reduce<Severity | null>((m, f) => (!m || SEVERITY_RANK[f.severity] > SEVERITY_RANK[m] ? f.severity : m), null);
}
