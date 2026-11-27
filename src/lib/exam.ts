import type { Domain, Exam, Item, Question, Scenario } from './types';

export const LETTERS = 'ABCDEF';

export function shuffle<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function toItem(q: Question): Item {
  const order = shuffle(q.options.map((_, i) => i));
  return { q, order, correct: q.correct.map((i) => order.indexOf(i)).sort((a, b) => a - b), pick: [], flag: false, checked: false };
}

export function isRight(it: Item): boolean {
  if (it.pick.length !== it.correct.length) return false;
  const p = [...it.pick].sort((a, b) => a - b);
  return p.every((v, k) => v === it.correct[k]);
}

export const answered = (it: Item) => it.pick.length > 0 || it.checked;

/** Unseen questions first, then the rest, each group shuffled. */
export function freshFirst(pool: Question[], seen: Set<string>): Question[] {
  return [...shuffle(pool.filter((q) => !seen.has(q.id))), ...shuffle(pool.filter((q) => seen.has(q.id)))];
}

/**
 * Split `total` questions across domains in proportion to their weights (largest remainder),
 * capped by what each domain has available, then pick unseen questions first.
 */
export function buildPlan(domains: Domain[], pool: Question[], total: number): Record<string, number> {
  const avail: Record<string, number> = {};
  for (const d of domains) avail[d.id] = pool.filter((q) => q.domain_id === d.id).length;
  const weightSum = domains.reduce((s, d) => s + Number(d.weight), 0) || 1;
  const target = Math.min(total, pool.length);
  const raw = domains.map((d) => ({ id: d.id, exact: (Number(d.weight) / weightSum) * target }));
  const plan: Record<string, number> = {};
  for (const r of raw) plan[r.id] = Math.min(Math.floor(r.exact), avail[r.id]);
  let left = target - Object.values(plan).reduce((s, n) => s + n, 0);
  const byRemainder = [...raw].sort((a, b) => (b.exact % 1) - (a.exact % 1));
  while (left > 0) {
    let placed = false;
    for (const r of byRemainder) {
      if (left === 0) break;
      if (plan[r.id] < avail[r.id]) { plan[r.id]++; left--; placed = true; }
    }
    if (!placed) break;
  }
  return plan;
}

export function buildExam(domains: Domain[], pool: Question[], total: number, seen: Set<string>): Item[] {
  const plan = buildPlan(domains, pool, total);
  const chosen: Question[] = [];
  for (const d of domains) chosen.push(...freshFirst(pool.filter((q) => q.domain_id === d.id), seen).slice(0, plan[d.id] || 0));
  return shuffle(chosen).map(toItem);
}

/** Scenarios of the exam that have at least one question in the pool. */
export function usableScenarios(exam: Exam, pool: Question[]): Scenario[] {
  const codes = new Set(pool.map((q) => q.scenario).filter(Boolean));
  return (exam.scenarios || []).filter((s) => codes.has(s.code));
}

/**
 * Scenario-based exam, as in the real one: draw `scenario_count` scenarios at random, split the
 * questions evenly between them (unseen questions first) and keep each scenario's questions together.
 * Falls back to the domain-weighted exam when the exam has no scenarios.
 */
export function buildExamFor(exam: Exam, domains: Domain[], pool: Question[], total: number, seen: Set<string>): Item[] {
  const usable = usableScenarios(exam, pool);
  if (!usable.length) return buildExam(domains, pool, total, seen);
  const picked = shuffle(usable).slice(0, Math.max(1, Math.min(exam.scenario_count || 4, usable.length)));
  const groups = picked.map((s) => freshFirst(pool.filter((q) => q.scenario === s.code), seen));
  const quota = groups.map(() => 0);
  // Round-robin so every scenario gets its share (or all it has).
  let left = Math.min(total, groups.reduce((n, g) => n + g.length, 0));
  while (left > 0) {
    let placed = false;
    for (let k = 0; k < groups.length && left > 0; k++) {
      if (quota[k] < groups[k].length) { quota[k]++; left--; placed = true; }
    }
    if (!placed) break;
  }
  return groups.flatMap((g, k) => g.slice(0, quota[k])).map(toItem);
}

export function clock(s: number): string {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
}

export function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; }
}
