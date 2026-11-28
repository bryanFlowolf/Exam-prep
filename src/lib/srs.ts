import type { Domain, Question, QuestionStat, ReviewItem } from './types';

/**
 * Adaptive spaced repetition for the personal review list.
 *
 * Each question in the list has a next review date. A miss brings it back tomorrow and makes it
 * "harder" (lower ease); each hit spaces it further out: 1 → 3 → 7 days, then interval × ease.
 * The schedule adapts to three things:
 *  - the person's accuracy in the question's domain (weak domain → shorter intervals);
 *  - how hard the question is for everyone (anonymous first-try accuracy);
 *  - the exam date: nothing is scheduled after the day before the exam, so everything comes back once more.
 */

const DAY = 86400000;
export const EASE_START = 2.3;
const EASE_MIN = 1.3;
const EASE_MAX = 3.0;
/** Hits in a row and interval (days) after which a question counts as mastered. */
export const MASTERED_STREAK = 3;
export const MASTERED_DAYS = 21;

export type SrsContext = {
  /** Shrunk accuracy (0–1) by domain id, from the readiness estimate. */
  domainAcc: Record<string, number>;
  stats: Map<string, QuestionStat>;
  /** Exam date as YYYY-MM-DD, if set. */
  targetDate: string | null;
  now?: number;
};

export type SrsFields = Pick<ReviewItem, 'due_at' | 'interval_days' | 'ease' | 'streak'>;

/** Multiplier for the next interval from domain mastery and question difficulty, between 0.5 and 1.3. */
function adapt(q: Question, ctx: SrsContext): number {
  const acc = ctx.domainAcc[q.domain_id];
  // 50% domain accuracy → ×0.7, 90% → ×1.2.
  const dom = acc === undefined ? 1 : 0.075 + 1.25 * acc;
  const s = ctx.stats.get(q.id);
  const firstAcc = s && s.first_answered >= 10 ? s.first_correct / s.first_answered : null;
  const diff = firstAcc === null ? 1 : firstAcc < 0.4 ? 0.8 : firstAcc > 0.85 ? 1.1 : 1;
  return Math.min(1.3, Math.max(0.5, dom * diff));
}

/** Next schedule after answering a question that is (or is going into) the review list. */
export function schedule(prev: ReviewItem | undefined, right: boolean, q: Question, ctx: SrsContext): SrsFields {
  const now = ctx.now ?? Date.now();
  let ease = prev?.ease ?? EASE_START;
  let streak = prev?.streak ?? 0;
  let interval: number;
  if (!right) {
    ease = Math.max(EASE_MIN, ease - 0.2);
    streak = 0;
    interval = 1;
  } else {
    ease = Math.min(EASE_MAX, ease + 0.05);
    streak += 1;
    const last = prev?.interval_days || 0;
    const base = streak === 1 ? 1 : streak === 2 ? 3 : streak === 3 ? 7 : Math.max(7, last * ease);
    interval = Math.max(1, base * (streak === 1 ? 1 : adapt(q, ctx)));
  }
  interval = Math.min(interval, 180);
  let due = now + interval * DAY;
  if (ctx.targetDate) {
    // Review everything at least once more before the exam (the day before at the latest).
    const lastDay = new Date(ctx.targetDate + 'T08:00:00').getTime() - DAY;
    if (lastDay > now + DAY / 2 && due > lastDay) {
      due = lastDay;
      interval = Math.max(0.5, (lastDay - now) / DAY);
    }
  }
  return { due_at: new Date(due).toISOString(), interval_days: Math.round(interval * 10) / 10, ease: Math.round(ease * 100) / 100, streak };
}

/** Due date for rows saved before the spaced-repetition migration: misses tomorrow, hits in three days. */
export function dueAt(r: ReviewItem): number {
  if (r.due_at) return new Date(r.due_at).getTime();
  return new Date(r.last_at).getTime() + (r.last_result === 'acertada' ? 3 : 1) * DAY;
}

/** End of today in local time: anything due before then is "for today". */
export function endOfToday(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

export function isMastered(r: ReviewItem): boolean {
  return (r.streak ?? 0) >= MASTERED_STREAK && (r.interval_days ?? 0) >= MASTERED_DAYS;
}

/**
 * Today's spaced-repetition queue: due questions, most urgent first.
 * Urgency = days overdue + 1, weighted by the domain's exam weight and by how often it was missed.
 */
export function dueQueue(questions: Question[], review: Map<string, ReviewItem>, domains: Domain[], now = Date.now()): Question[] {
  const end = endOfToday(now);
  const weight = Object.fromEntries(domains.map((d) => [d.id, Number(d.weight) || 0]));
  return questions
    .map((q) => ({ q, r: review.get(q.id) }))
    .filter((x): x is { q: Question; r: ReviewItem } => Boolean(x.r) && dueAt(x.r!) <= end)
    .map(({ q, r }) => {
      const overdue = Math.max(0, (now - dueAt(r)) / DAY);
      return { q, score: (overdue + 1) * (1 + (weight[q.domain_id] || 0) / 50) * (1 + Math.min(3, r.wrong_count) * 0.25) };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.q);
}

/** How many review questions fall due on each of the next `days` days (index 0 = today, including overdue). */
export function dueForecast(questions: Question[], review: Map<string, ReviewItem>, days = 7, now = Date.now()): number[] {
  const ids = new Set(questions.map((q) => q.id));
  const out = new Array(days).fill(0);
  const end0 = endOfToday(now);
  for (const r of review.values()) {
    if (!ids.has(r.question_id)) continue;
    const k = Math.max(0, Math.ceil((dueAt(r) - end0) / DAY));
    if (k < days) out[k]++;
  }
  return out;
}

/** Plain-language "next review" label for the review list. */
export function dueLabel(r: ReviewItem, now = Date.now()): string {
  const d = Math.ceil((dueAt(r) - endOfToday(now)) / DAY);
  if (d <= 0) return 'Toca hoy';
  if (d === 1) return 'Mañana';
  if (d < 14) return `En ${d} días`;
  if (d < 60) return `En ${Math.round(d / 7)} semanas`;
  return `En ${Math.round(d / 30)} meses`;
}
