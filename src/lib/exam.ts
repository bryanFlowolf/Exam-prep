import type { Domain, Item, Question } from './types';

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

export function clock(s: number): string {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
}

export function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }); } catch { return iso; }
}
