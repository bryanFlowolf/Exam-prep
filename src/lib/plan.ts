import type { Attempt, Domain, Exam, ExamPlan, Question, ReviewItem } from './types';
import type { Readiness } from './readiness';
import { weakestDomains } from './readiness';
import { shuffle } from './exam';
import { dueQueue } from './srs';

/**
 * Personal study plan: what to do today and the next days until the exam.
 *
 * Inputs are the person's preferences (minutes a day and study days), the exam date, the readiness
 * estimate, the review list and what is still unseen. The plan:
 *  - splits the time left into phases (base → reinforcement → simulation → eve of the exam);
 *  - puts a mini-exam every 7 days and full simulations ~10 and ~3 days before the exam, so the
 *    estimate keeps being measured under exam conditions;
 *  - builds today's session from due reviews, the domains with most points to gain and unseen questions,
 *    in proportions that change with the phase.
 */

const DAY = 86400000;
export const WEEKDAYS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
export const WEEKDAY_NAMES = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export type PhaseKey = 'nodate' | 'base' | 'reinforce' | 'simulate' | 'eve' | 'examday' | 'past';
export type DayKind = 'session' | 'mini' | 'sim' | 'light' | 'rest' | 'exam';

export type Phase = { key: PhaseKey; title: string; text: string };
export type PlanDay = { date: Date; kind: DayKind; isToday: boolean };
export type Mix = { due: number; focus: number; fresh: number };

export type StudyPlan = {
  phase: Phase;
  daysLeft: number | null;
  /** Study days from today (included) to the day before the exam. */
  studyDaysLeft: number | null;
  secondsPerQuestion: number;
  perSession: number;
  today: { kind: DayKind; isStudyDay: boolean; target: number; done: number; mix: Mix; focus: Domain[] };
  week: PlanDay[];
  streak: number;
  warnings: string[];
};

/** Local midnight of a date. */
function day0(t: number | Date): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}
const daysBetween = (a: Date, b: Date) => Math.round((day0(b).getTime() - day0(a).getTime()) / DAY);
const sameDay = (a: Date, b: Date) => daysBetween(a, b) === 0;

/** Time per practice question: the exam's own pace plus time to read the explanation, between 1 and 4 minutes. */
export function secondsPerQuestion(exam: Exam): number {
  const pace = exam.sim_questions ? (exam.sim_minutes * 60) / exam.sim_questions : 90;
  return Math.round(Math.min(240, Math.max(60, pace * 1.3)));
}

function phaseFor(daysLeft: number | null): Phase {
  if (daysLeft === null) return { key: 'nodate', title: 'Sin fecha', text: 'Pon la fecha de tu examen y el plan repartirá el temario, los repasos y los simulacros hasta ese día.' };
  if (daysLeft < 0) return { key: 'past', title: 'Examen pasado', text: 'Si ya hiciste el examen, registra tu resultado: sirve para afinar la predicción de todos.' };
  if (daysLeft === 0) return { key: 'examday', title: 'Día del examen', text: 'Hoy no toca estudiar. Descansa, revisa la logística y confía en lo que has preparado.' };
  if (daysLeft === 1) return { key: 'eve', title: 'Víspera', text: 'Repaso ligero de lo que toca hoy y a descansar. Lo que no sepas hoy no lo vas a aprender esta noche.' };
  if (daysLeft <= 7) return { key: 'simulate', title: 'Simulación', text: 'Simulacros en condiciones de examen y repaso de lo que fallas. Poco material nuevo.' };
  if (daysLeft <= 21) return { key: 'reinforce', title: 'Refuerzo', text: 'Más tiempo en los dominios donde más puntos puedes ganar, sin dejar de repasar.' };
  return { key: 'base', title: 'Base', text: 'Recorrer todo el temario: preguntas nuevas de todos los dominios, con algo más de peso en los flojos.' };
}

/** Share of a session for due reviews and for focus domains, by phase. The rest is unseen questions by weight. */
const MIX: Record<PhaseKey, { due: number; focus: number }> = {
  nodate: { due: 0.3, focus: 0.35 },
  base: { due: 0.25, focus: 0.3 },
  reinforce: { due: 0.35, focus: 0.45 },
  simulate: { due: 0.5, focus: 0.35 },
  eve: { due: 1, focus: 0 },
  examday: { due: 0, focus: 0 },
  past: { due: 0.4, focus: 0.3 },
};

/** Date of the last mini-exam or simulation, if any. */
function lastCheckpoint(attempts: Attempt[]): Date | null {
  const a = attempts.find((x) => x.mode === 'sim' || x.mode === 'mini');
  return a ? day0(new Date(a.finished_at)) : null;
}

/** Days in a row (only counting study days) with at least one finished attempt, ending today or yesterday. */
function studyStreak(attempts: Attempt[], studyDays: number[], now: number): number {
  const active = new Set(attempts.map((a) => day0(new Date(a.finished_at)).getTime()));
  let d = day0(now);
  if (!active.has(d.getTime())) d = new Date(d.getTime() - DAY); // today not done yet does not break it
  let n = 0;
  for (let i = 0; i < 120; i++, d = new Date(d.getTime() - DAY)) {
    if (!studyDays.includes(d.getDay())) continue;
    if (!active.has(d.getTime())) break;
    n++;
  }
  return n;
}

/**
 * Kind of activity planned for each date from today until the exam (or `horizon` days without a date).
 * Simulations: the last study day 2–5 days before the exam and, with two weeks or more, one 9–14 days before.
 * Mini-exams: a study day 7+ days after the last checkpoint.
 */
export function calendar(plan: ExamPlan, attempts: Attempt[], now = Date.now(), horizon = 7): PlanDay[] {
  const today = day0(now);
  const target = plan.target_date ? day0(new Date(plan.target_date + 'T12:00:00')) : null;
  const span = target ? Math.max(horizon, daysBetween(today, target) + 1) : horizon;
  const dates = Array.from({ length: Math.min(span, 200) }, (_, i) => new Date(today.getTime() + i * DAY));
  const isStudy = (d: Date) => plan.study_days.includes(d.getDay());
  const sims = new Set<number>();
  if (target) {
    const until = (d: Date) => daysBetween(d, target);
    const pickLast = (lo: number, hi: number) => {
      const c = dates.filter((d) => isStudy(d) && until(d) >= lo && until(d) <= hi);
      if (c.length) sims.add(c[c.length - 1].getTime());
    };
    pickLast(2, 5);
    if (daysBetween(today, target) >= 14) pickLast(9, 14);
  }
  let last = lastCheckpoint(attempts);
  return dates.map((d) => {
    let kind: DayKind;
    const until = target ? daysBetween(d, target) : null;
    if (until !== null && until < 0) kind = 'rest';
    else if (until === 0) kind = 'exam';
    else if (until === 1) kind = 'light';
    else if (!isStudy(d)) kind = 'rest';
    else if (sims.has(d.getTime())) kind = 'sim';
    else if (!last || daysBetween(last, d) >= 7) kind = 'mini';
    else kind = 'session';
    if (kind === 'sim' || kind === 'mini') last = d;
    return { date: d, kind, isToday: sameDay(d, today) };
  });
}

export function studyPlan(args: {
  exam: Exam; domains: Domain[]; bank: Question[]; seen: Set<string>; review: Map<string, ReviewItem>;
  attempts: Attempt[]; plan: ExamPlan; ready: Readiness; now?: number;
}): StudyPlan {
  const { exam, bank, seen, review, attempts, plan, ready } = args;
  const now = args.now ?? Date.now();
  const today = day0(now);
  const target = plan.target_date ? day0(new Date(plan.target_date + 'T12:00:00')) : null;
  const daysLeft = target ? daysBetween(today, target) : null;
  const phase = phaseFor(daysLeft);
  const sec = secondsPerQuestion(exam);
  const perSession = Math.max(5, Math.floor((plan.daily_minutes * 60) / sec));
  const days = calendar(plan, attempts, now, 7);
  const todayKind = days[0]?.kind ?? 'session';
  const isStudyDay = plan.study_days.includes(today.getDay());
  const studyDaysLeft = target && daysLeft !== null && daysLeft > 0
    ? Array.from({ length: daysLeft }, (_, i) => new Date(today.getTime() + i * DAY)).filter((d) => plan.study_days.includes(d.getDay())).length
    : null;

  const done = attempts.filter((a) => sameDay(new Date(a.finished_at), today)).reduce((s, a) => s + a.total, 0);
  const dueCount = dueQueue(bank, review, args.domains, now).length;
  const focus = weakestDomains(ready).map((d) => d.domain);
  const target_n = todayKind === 'light' ? Math.min(perSession, Math.max(dueCount, 0), 15)
    : todayKind === 'mini' ? exam.mini_questions
    : todayKind === 'sim' ? exam.sim_questions
    : todayKind === 'exam' ? 0
    : perSession;
  const m = MIX[phase.key];
  const due = Math.min(dueCount, Math.round(target_n * m.due));
  const focusN = focus.length ? Math.round((target_n - due) * (m.focus / (1 - m.due || 1))) : 0;
  const f = Math.max(0, Math.min(target_n - due, focusN));
  const mix: Mix = todayKind === 'session' || todayKind === 'rest'
    ? { due, focus: f, fresh: Math.max(0, target_n - due - f) }
    : todayKind === 'light' ? { due: target_n, focus: 0, fresh: 0 } : { due: 0, focus: 0, fresh: 0 };

  const warnings: string[] = [];
  const unseen = bank.filter((q) => !seen.has(q.id)).length;
  if (studyDaysLeft !== null && studyDaysLeft > 0 && phase.key !== 'eve') {
    // New questions that fit: the "fresh" and "focus" part of each session, minus checkpoint days.
    const share = 1 - MIX[phase.key].due;
    const capacity = Math.round(studyDaysLeft * perSession * share * 0.8);
    if (unseen > capacity && unseen > 0) {
      const needMin = Math.min(240, Math.ceil(((unseen / (studyDaysLeft * share * 0.8)) * sec) / 60 / 5) * 5);
      warnings.push(`Al ritmo actual verás unas ${capacity} de las ${unseen} preguntas que te quedan sin ver. Las sesiones priorizan los dominios con más puntos en juego${needMin > plan.daily_minutes ? `; para cubrirlas todas harían falta unos ${needMin} min al día` : ''}.`);
    }
  }
  if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 10 && ready.probability !== null && ready.probability < 0.4) {
    warnings.push('Con la probabilidad actual y los días que quedan, valora mover la fecha del examen si tu convocatoria lo permite.');
  }
  if (todayKind === 'sim' && exam.sim_minutes > plan.daily_minutes * 1.5) {
    warnings.push(`El simulacro de hoy dura ${exam.sim_minutes} min, más que tu tiempo diario: si no te cabe, muévelo a otro día de esta semana.`);
  }

  return {
    phase, daysLeft, studyDaysLeft, secondsPerQuestion: sec, perSession,
    today: { kind: todayKind, isStudyDay, target: target_n, done, mix, focus },
    week: days.slice(0, 7), streak: studyStreak(attempts, plan.study_days, now), warnings,
  };
}

/**
 * Questions for today's session: due reviews first (most urgent), then focus domains (wrong and unseen
 * first), then unseen questions spread by domain weight. Never repeats a question.
 */
export function sessionQuestions(p: StudyPlan, domains: Domain[], bank: Question[], seen: Set<string>, review: Map<string, ReviewItem>, now = Date.now()): Question[] {
  const used = new Set<string>();
  const take = (qs: Question[], n: number) => {
    const out: Question[] = [];
    for (const q of qs) { if (out.length >= n) break; if (!used.has(q.id)) { used.add(q.id); out.push(q); } }
    return out;
  };
  const due = take(dueQueue(bank, review, domains, now), p.today.mix.due);
  const focusIds = new Set(p.today.focus.map((d) => d.id));
  const rank = (qs: Question[]) => {
    const wrong = qs.filter((q) => (review.get(q.id)?.wrong_count || 0) > 0);
    const unseen = qs.filter((q) => !seen.has(q.id) && !wrong.includes(q));
    const rest = qs.filter((q) => seen.has(q.id) && !wrong.includes(q));
    return [...shuffle(wrong), ...shuffle(unseen), ...shuffle(rest)];
  };
  const focus = take(rank(bank.filter((q) => focusIds.has(q.domain_id))), p.today.mix.focus);
  // Unseen questions by domain weight; seen ones fill in if the bank runs out.
  const weightSum = domains.reduce((s, d) => s + Number(d.weight), 0) || 1;
  const freshN = p.today.mix.fresh + (p.today.mix.due - due.length) + (p.today.mix.focus - focus.length);
  const fresh: Question[] = [];
  for (const d of domains) {
    const n = Math.round((Number(d.weight) / weightSum) * freshN);
    const qs = bank.filter((q) => q.domain_id === d.id);
    fresh.push(...take([...shuffle(qs.filter((q) => !seen.has(q.id))), ...shuffle(qs.filter((q) => seen.has(q.id)))], n));
  }
  if (fresh.length < freshN) fresh.push(...take(shuffle(bank), freshN - fresh.length));
  // Reviews first so the hardest part is done fresh; the rest mixed like an exam.
  return [...due, ...shuffle([...focus, ...fresh])];
}

export const DAY_KIND: Record<DayKind, { label: string; short: string }> = {
  session: { label: 'Sesión de estudio', short: 'Sesión' },
  mini: { label: 'Mini-examen de control', short: 'Mini' },
  sim: { label: 'Simulacro completo', short: 'Simulacro' },
  light: { label: 'Repaso ligero', short: 'Ligero' },
  rest: { label: 'Día libre', short: 'Libre' },
  exam: { label: 'Examen', short: 'Examen' },
};
