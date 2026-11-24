// In-memory stand-in for @supabase/supabase-js, used only by `vite --config test/vite.mock.config.ts`
// to click through the UI without a real Supabase project. Row Level Security is tested separately
// against Postgres in supabase/tests/rls_test.sql.
import exam from '../content/exams/anthropic-ccdv-f.json';

type Row = Record<string, any>;
const uid = 'u-demo';
const uuid = () => (crypto as any).randomUUID();
const now = () => new Date().toISOString();

const db: Record<string, Row[]> = {
  profiles: [{ id: uid, display_name: 'demo', is_admin: true }, { id: 'u-ana', display_name: 'Ana', is_admin: false }],
  exams: [], domains: [], questions: [], attempts: [], seen_questions: [], review_items: [], access_allowlist: [],
  question_stats: [], question_reports: [], exam_plans: [], teams: [{ id: 't-demo', name: 'Equipo demo' }],
  team_members: [{ team_id: 't-demo', user_id: uid, role: 'lead', shares_progress: true }, { team_id: 't-demo', user_id: 'u-ana', role: 'member', shares_progress: false }],
};

function importExam(p: any) {
  let e = db.exams.find((x) => x.slug === p.slug);
  if (!e) { e = { id: uuid(), slug: p.slug, created_at: now(), is_published: true }; db.exams.push(e); }
  Object.assign(e, { vendor: p.vendor, code: p.code || '', name: p.name, description: p.description || '', language: p.language || 'es',
    sim_questions: p.exam.questions, sim_minutes: p.exam.minutes, mini_questions: p.exam.mini.questions, mini_minutes: p.exam.mini.minutes, passing_note: p.exam.passing || '' });
  for (const d of p.domains) {
    let r = db.domains.find((x) => x.exam_id === e!.id && x.code === d.code);
    if (!r) { r = { id: uuid(), exam_id: e!.id, code: d.code }; db.domains.push(r); }
    Object.assign(r, { name: d.name, weight: d.weight, docs: d.docs || r.docs || [] });
  }
  db.questions = db.questions.filter((q) => !(q.exam_id === e!.id && q.source !== 'team'));
  p.questions.forEach((q: any, i: number) => db.questions.push({
    id: uuid(), exam_id: e!.id, domain_id: db.domains.find((x) => x.exam_id === e!.id && x.code === q.domain)!.id,
    source: q.source === 'official_sample' ? 'official_sample' : 'bank', stem: q.stem, options: q.options, correct: q.correct,
    explanation: q.explanation || '', i18n: q.i18n || {}, author_id: null, is_active: true, created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  }));
  return { exam_id: e.id, questions: p.questions.length };
}
importExam(exam);
const ccdv = db.exams[0];
db.questions.push({ id: uuid(), exam_id: ccdv.id, domain_id: db.domains[0].id, source: 'team', stem: 'Pregunta de ejemplo escrita por Ana para practicar.', options: ['Opción buena', 'Opción mala'], correct: [0], explanation: 'Porque sí.', author_id: 'u-ana', is_active: true, created_at: now() });
importExam({ slug: 'demo-architect', vendor: 'Anthropic', code: 'CCA-F', name: 'Claude Certified Architect – Foundations (demo)', description: 'Examen de ejemplo para comprobar varios exámenes.',
  exam: { questions: 3, minutes: 5, mini: { questions: 2, minutes: 3 } }, domains: [{ code: 'D1', name: 'Arquitectura', weight: 100 }],
  questions: [1, 2, 3, 4].map((n) => ({ domain: 'D1', stem: `Pregunta de demostración número ${n}`, options: ['a', 'b', 'c'], correct: [n % 3] })) });

const OWN = new Set(['attempts', 'seen_questions', 'review_items', 'exam_plans']);

class Query implements PromiseLike<any> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private payload: any; private cols = '*'; private one: 'one' | 'maybe' | null = null;
  private sorts: [string, boolean][] = []; private lim?: number; private rng?: [number, number]; private conflict?: string; private ignoreDup = false; private returning = false;
  constructor(private table: string) {}
  select(c = '*') { if (this.op === 'select') this.cols = c; else this.returning = true; return this; }
  insert(p: any) { this.op = 'insert'; this.payload = p; return this; }
  update(p: any) { this.op = 'update'; this.payload = p; return this; }
  upsert(p: any, o?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.op = 'upsert'; this.payload = p; this.conflict = o?.onConflict; this.ignoreDup = !!o?.ignoreDuplicates; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(k: string, v: any) { this.filters.push((r) => r[k] === v); return this; }
  in(k: string, v: any[]) { this.filters.push((r) => v.includes(r[k])); return this; }
  order(k: string, o?: { ascending?: boolean }) { this.sorts.push([k, o?.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(a: number, b: number) { this.rng = [a, b]; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  then<A, B>(ok?: (v: any) => A | PromiseLike<A>, ko?: (e: any) => B | PromiseLike<B>) { return Promise.resolve(this.run()).then(ok, ko); }
  single() { this.one = 'one'; return this; }
  private visible() { return (db[this.table] || []).filter((r) => !OWN.has(this.table) || r.user_id === uid); }
  private run() {
    const t = this.table;
    const match = (r: Row) => this.filters.every((f) => f(r));
    const fill = (r: Row) => (OWN.has(t) ? { user_id: uid, ...r } : r);
    let out: Row[] = [];
    if (this.op === 'insert') {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r: Row) => fill({ id: uuid(), created_at: now(), finished_at: now(), author_id: t === 'questions' ? uid : undefined, is_active: true, ...r }));
      db[t].push(...rows); out = rows;
    } else if (this.op === 'update') {
      out = this.visible().filter(match); out.forEach((r) => Object.assign(r, this.payload));
    } else if (this.op === 'upsert') {
      const keys = (this.conflict || 'id').split(',');
      for (const r0 of Array.isArray(this.payload) ? this.payload : [this.payload]) {
        const r = fill(r0);
        const ex = db[t].find((x) => keys.every((k) => x[k] === r[k]));
        if (ex) { if (!this.ignoreDup) Object.assign(ex, r); } else db[t].push(r);
        out.push(ex || r);
      }
    } else if (this.op === 'delete') {
      const del = this.visible().filter(match); db[t] = db[t].filter((r) => !del.includes(r)); out = del;
    } else {
      out = this.visible().filter(match).map((r) => ({ ...r }));
      if (t === 'exams' && this.cols.includes('questions(count)')) out.forEach((e) => (e.questions = [{ count: db.questions.filter((q) => q.exam_id === e.id).length }]));
      for (const [k, asc] of [...this.sorts].reverse()) out.sort((a, b) => (a[k] > b[k] ? 1 : a[k] < b[k] ? -1 : 0) * (asc ? 1 : -1));
      if (this.rng) out = out.slice(this.rng[0], this.rng[1] + 1);
      if (this.lim) out = out.slice(0, this.lim);
    }
    if (this.one) return { data: out[0] ?? null, error: this.one === 'one' && !out[0] ? { message: 'not found' } : null };
    return { data: this.op === 'select' || this.returning ? out : null, error: null };
  }
}

let session: any = { user: { id: uid, email: 'demo@empresa.com' } };
const listeners: ((e: string, s: any) => void)[] = [];

export function createClient() {
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      getUser: async () => ({ data: { user: session?.user ?? null } }),
      onAuthStateChange: (fn: any) => { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithOtp: async () => ({ error: null }),
      signOut: async () => { session = null; listeners.forEach((f) => f('SIGNED_OUT', null)); return { error: null }; },
    },
    from: (t: string) => new Query(t),
    rpc: async (fn: string, args: any) => {
      if (fn === 'import_exam') return { data: importExam(args.p), error: null };
      if (fn === 'set_admin') { const p = db.profiles.find((x) => x.id === args.p_user); if (p) p.is_admin = args.p_value; return { data: null, error: null }; }
      if (fn === 'record_answers') {
        for (const a of args.p) {
          const q = db.questions.find((x) => x.id === a.q); if (!q) continue;
          let st = db.question_stats.find((x) => x.question_id === q.id);
          if (!st) { st = { question_id: q.id, exam_id: q.exam_id, answered: 0, correct: 0, first_answered: 0, first_correct: 0, picks: q.options.map(() => 0) }; db.question_stats.push(st); }
          const right = [...a.pick].sort().join() === [...q.correct].sort().join();
          const first = !db.seen_questions.some((x) => x.question_id === q.id && x.user_id === uid);
          st.answered++; st.correct += +right; st.first_answered += +first; st.first_correct += +(first && right);
          for (const i of a.pick) st.picks[i] = (st.picks[i] || 0) + 1;
        }
        return { data: args.p.length, error: null };
      }
      if (fn === 'set_share_progress') { const m = db.team_members.find((x) => x.team_id === args.p_team && x.user_id === uid); if (m) m.shares_progress = args.p_value; return { data: null, error: null }; }
      if (fn === 'team_progress') {
        return { data: db.team_members.filter((m) => m.team_id === args.p_team).map((m) => ({ user_id: m.user_id, display_name: db.profiles.find((p) => p.id === m.user_id)?.display_name, role: m.role, shares_progress: m.shares_progress,
          exam_id: null, attempts: null, answered: null, last_at: null, last_sim_pct: null, by_domain: null, target_date: null })), error: null };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    },
  };
}
(window as any).__mockdb = db;
