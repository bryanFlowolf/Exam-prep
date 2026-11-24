import type { Attempt, Domain, Mode, Question, ReviewItem } from './types';
import { shuffle } from './exam';

/** Modes that measure readiness. Review and "last wrong" are biased towards failed questions; team questions are not the exam's. */
export const READY_MODES: Mode[] = ['sim', 'mini', 'practice'];
/** Same window as team_progress() in SQL, so a person and their team lead see the same estimate. */
export const READY_WINDOW = 20;
/** Below this many answers the estimate is too noisy to give a pass probability. */
export const MIN_ANSWERS = 20;

export type DomainTotals = Record<string, { ok: number; total: number }>;

/** Pass mark as a fraction from the exam's note: "73%" → 0.73, "720/1000 (escalado)" → 0.72. Defaults to 0.7. */
export function passMark(note: string): number {
  const ratio = note.match(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+)/);
  if (ratio) return Number(ratio[1].replace(',', '.')) / Number(ratio[2]);
  const pct = note.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (pct) return Number(pct[1].replace(',', '.')) / 100;
  return 0.7;
}

/** Correct/total per domain code over the most recent attempts that count for readiness. */
export function recentTotals(attempts: Attempt[], window = READY_WINDOW): DomainTotals {
  const out: DomainTotals = {};
  const recent = attempts
    .filter((a) => READY_MODES.includes(a.mode))
    .sort((a, b) => b.finished_at.localeCompare(a.finished_at))
    .slice(0, window);
  for (const a of recent) for (const [code, v] of Object.entries(a.by_domain || {})) {
    out[code] = out[code] || { ok: 0, total: 0 };
    out[code].ok += v.ok;
    out[code].total += v.total;
  }
  return out;
}

export type DomainReadiness = { domain: Domain; ok: number; total: number; acc: number | null; shrunk: number };
export type Readiness = {
  pass: number;
  answered: number;
  /** Share of the exam's weight with at least 5 answers. */
  coverage: number;
  /** Expected exam score (0–1), weighting each domain by the official weight. Null with no answers. */
  estimate: number | null;
  /** Chance of scoring at or above the pass mark. Null below MIN_ANSWERS. */
  probability: number | null;
  domains: DomainReadiness[];
};

// Domains with few answers are pulled towards 50%, so one lucky answer does not count as mastery
// and a domain never practised still weighs on the estimate.
const PRIOR = 0.5;
const PRIOR_WEIGHT = 4;

export function readiness(domains: Domain[], totals: DomainTotals, passNote: string): Readiness {
  const pass = passMark(passNote);
  const weightSum = domains.reduce((s, d) => s + Number(d.weight), 0) || 1;
  let answered = 0;
  let covered = 0;
  let est = 0;
  const rows: DomainReadiness[] = domains.map((d) => {
    const t = totals[d.code] || { ok: 0, total: 0 };
    answered += t.total;
    if (t.total >= 5) covered += Number(d.weight);
    const shrunk = (t.ok + PRIOR * PRIOR_WEIGHT) / (t.total + PRIOR_WEIGHT);
    est += (Number(d.weight) / weightSum) * shrunk;
    return { domain: d, ok: t.ok, total: t.total, acc: t.total ? t.ok / t.total : null, shrunk };
  });
  let probability: number | null = null;
  if (answered >= MIN_ANSWERS) {
    // Sampling error of the answers seen, plus a floor for how different the real exam can be.
    const se = Math.sqrt((est * (1 - est)) / answered + 0.04 ** 2);
    probability = normalCdf((est - pass) / se);
  }
  return { pass, answered, coverage: covered / weightSum, estimate: answered ? est : null, probability, domains: rows };
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, error < 1.5e-7). */
export function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/**
 * Domains to work on first: the biggest gap to a safe target (pass mark + 8 points, at least 80%),
 * multiplied by how much the domain weighs in the exam.
 */
export function weakestDomains(r: Readiness, count = 2): DomainReadiness[] {
  const target = Math.max(0.8, r.pass + 0.08);
  return [...r.domains]
    .filter((d) => Number(d.domain.weight) > 0)
    .map((d) => ({ d, score: Math.max(0, target - d.shrunk) * Number(d.domain.weight) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.d);
}

/**
 * Targeted practice: up to `total` questions from the given domains, split by weight.
 * In each domain: questions you got wrong first, then ones you have not seen, then the rest.
 */
export function targetedPool(domains: Domain[], pool: Question[], review: Map<string, ReviewItem>, seen: Set<string>, total = 20): Question[] {
  const weightSum = domains.reduce((s, d) => s + Number(d.weight), 0) || 1;
  const out: Question[] = [];
  domains.forEach((d, i) => {
    const share = i === domains.length - 1 ? total - out.length : Math.round((Number(d.weight) / weightSum) * total);
    const qs = pool.filter((q) => q.domain_id === d.id);
    const wrong = shuffle(qs.filter((q) => (review.get(q.id)?.wrong_count || 0) > 0 && review.get(q.id)?.last_result !== 'acertada'));
    const unseen = shuffle(qs.filter((q) => !seen.has(q.id) && !wrong.includes(q)));
    const rest = shuffle(qs.filter((q) => seen.has(q.id) && !wrong.includes(q)));
    out.push(...[...wrong, ...unseen, ...rest].slice(0, share));
  });
  return shuffle(out);
}

export function pct(x: number | null, digits = 0): string {
  return x === null ? '—' : `${(x * 100).toFixed(digits)}%`;
}

/** Plain-language verdict for a pass probability. */
export function verdict(p: number | null): { cls: 'pass' | 'edge' | 'fail' | 'none'; text: string } {
  if (p === null) return { cls: 'none', text: 'Aún sin datos suficientes' };
  if (p >= 0.8) return { cls: 'pass', text: 'Preparado' };
  if (p >= 0.5) return { cls: 'edge', text: 'Cerca: falta margen' };
  return { cls: 'fail', text: 'Todavía no' };
}
