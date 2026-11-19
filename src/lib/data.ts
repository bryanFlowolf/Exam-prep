import { supabase } from './supabase';
import { answered, isRight } from './exam';
import type { Attempt, Domain, Exam, Item, Mode, Profile, Question, ReviewItem } from './types';

const PAGE = 1000;

async function all<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function getMyProfile(): Promise<Profile | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase.from('profiles').select('id, display_name, is_admin').eq('id', u.user.id).maybeSingle();
  if (error) throw error;
  return data as Profile | null;
}

export async function updateDisplayName(name: string) {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Sin sesión');
  const { error } = await supabase.from('profiles').update({ display_name: name.trim().slice(0, 80) }).eq('id', u.user.id);
  if (error) throw error;
}

export async function listExams(): Promise<(Exam & { question_count: number })[]> {
  const { data, error } = await supabase.from('exams').select('*, questions(count)').order('vendor').order('name');
  if (error) throw error;
  return (data || []).map((e: Exam & { questions?: { count: number }[] }) => ({ ...e, question_count: e.questions?.[0]?.count ?? 0 }));
}

export type ExamData = {
  exam: Exam;
  domains: Domain[];
  questions: Question[];
  seen: Set<string>;
  review: Map<string, ReviewItem>;
  attempts: Attempt[];
  authors: Record<string, string>;
};

export async function loadExam(slug: string, userId: string): Promise<ExamData> {
  const { data: exam, error } = await supabase.from('exams').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!exam) throw new Error('Examen no encontrado');
  const [domainsRes, questions, seenRows, reviewRows, attemptsRes] = await Promise.all([
    supabase.from('domains').select('*').eq('exam_id', exam.id).order('weight', { ascending: false }),
    all<Question>((a, b) => supabase.from('questions').select('*').eq('exam_id', exam.id).eq('is_active', true).order('created_at').range(a, b)),
    all<{ question_id: string }>((a, b) => supabase.from('seen_questions').select('question_id').eq('exam_id', exam.id).eq('user_id', userId).range(a, b)),
    all<ReviewItem>((a, b) => supabase.from('review_items').select('*').eq('exam_id', exam.id).eq('user_id', userId).range(a, b)),
    supabase.from('attempts').select('*').eq('exam_id', exam.id).eq('user_id', userId).order('finished_at', { ascending: false }).limit(20),
  ]);
  if (domainsRes.error) throw domainsRes.error;
  if (attemptsRes.error) throw attemptsRes.error;
  const authorIds = [...new Set(questions.filter((q) => q.source === 'team' && q.author_id).map((q) => q.author_id as string))];
  const authors: Record<string, string> = {};
  if (authorIds.length) {
    const { data } = await supabase.from('profiles').select('id, display_name').in('id', authorIds);
    for (const p of data || []) authors[p.id] = p.display_name;
  }
  return {
    exam: exam as Exam,
    domains: (domainsRes.data || []) as Domain[],
    questions,
    seen: new Set(seenRows.map((r) => r.question_id)),
    review: new Map(reviewRows.map((r) => [r.question_id, r])),
    attempts: (attemptsRes.data || []) as Attempt[],
    authors,
  };
}

export type SaveResult = { attempt: Attempt | null; review: Map<string, ReviewItem>; error?: string };

/** Saves the attempt, marks answered questions as seen and updates the personal review list. */
export async function saveAttempt(
  data: ExamData, mode: Mode, title: string, items: Item[], secondsUsed: number | null, domainsById: Record<string, Domain>,
): Promise<SaveResult> {
  const done = items.filter(answered);
  const byDomain: Record<string, { ok: number; total: number }> = {};
  for (const it of done) {
    const code = domainsById[it.q.domain_id]?.code || '?';
    byDomain[code] = byDomain[code] || { ok: 0, total: 0 };
    byDomain[code].total++;
    if (isRight(it)) byDomain[code].ok++;
  }
  const wrongIds = done.filter((it) => !isRight(it)).map((it) => it.q.id);
  const review = new Map(data.review);
  const now = new Date().toISOString();
  const reviewRows: ReviewItem[] = [];
  for (const it of items) {
    const was = answered(it);
    const right = was && isRight(it);
    const prev = review.get(it.q.id);
    if (!was && !it.flag && !prev) continue;
    if (!prev && right && !it.flag) continue;
    const row: ReviewItem = {
      question_id: it.q.id,
      exam_id: it.q.exam_id,
      wrong_count: (prev?.wrong_count || 0) + (was && !right ? 1 : 0),
      flagged: Boolean(prev?.flagged || it.flag),
      last_result: !was ? 'sin responder' : right ? 'acertada' : 'fallada',
      last_pick: it.pick.map((k) => it.order[k]),
      last_mode: title,
      last_at: now,
    };
    review.set(it.q.id, row);
    reviewRows.push(row);
  }
  let error: string | undefined;
  let attempt: Attempt | null = null;
  if (done.length) {
    const res = await supabase.from('attempts').insert({
      exam_id: data.exam.id, mode, correct: done.filter(isRight).length, total: done.length,
      seconds_used: secondsUsed, by_domain: byDomain, wrong_question_ids: wrongIds,
    }).select().single();
    if (res.error) error = res.error.message; else attempt = res.data as Attempt;
    const seenRes = await supabase.from('seen_questions').upsert(
      done.map((it) => ({ question_id: it.q.id, exam_id: it.q.exam_id })), { onConflict: 'user_id,question_id', ignoreDuplicates: true },
    );
    if (seenRes.error) error = error || seenRes.error.message;
  }
  if (reviewRows.length) {
    const r = await supabase.from('review_items').upsert(reviewRows, { onConflict: 'user_id,question_id' });
    if (r.error) error = error || r.error.message;
  }
  return { attempt, review, error };
}

export async function removeReview(questionId: string) {
  const { error } = await supabase.from('review_items').delete().eq('question_id', questionId);
  if (error) throw error;
}

export async function resetSeen(examId: string) {
  const { error } = await supabase.from('seen_questions').delete().eq('exam_id', examId);
  if (error) throw error;
}

export type TeamDraft = { domain_id: string; stem: string; options: string[]; correct: number[]; explanation: string };

export async function saveTeamQuestion(examId: string, draft: TeamDraft, id?: string) {
  const row = { ...draft, exam_id: examId, source: 'team' as const };
  const res = id
    ? await supabase.from('questions').update(row).eq('id', id).select().single()
    : await supabase.from('questions').insert(row).select().single();
  if (res.error) throw res.error;
  return res.data as Question;
}

export async function deleteQuestion(id: string) {
  const { error } = await supabase.from('questions').delete().eq('id', id);
  if (error) throw error;
}

// ---- Administración ----
export async function importExam(payload: unknown) {
  const { data, error } = await supabase.rpc('import_exam', { p: payload });
  if (error) throw error;
  return data as { exam_id: string; questions: number };
}

export async function setExamPublished(id: string, value: boolean) {
  const { error } = await supabase.from('exams').update({ is_published: value }).eq('id', id);
  if (error) throw error;
}

export async function listAllowlist(): Promise<{ pattern: string; note: string }[]> {
  const { data, error } = await supabase.from('access_allowlist').select('pattern, note').order('pattern');
  if (error) throw error;
  return data || [];
}

export async function addAllow(pattern: string, note: string) {
  const { error } = await supabase.from('access_allowlist').insert({ pattern: pattern.trim().toLowerCase(), note });
  if (error) throw error;
}

export async function removeAllow(pattern: string) {
  const { error } = await supabase.from('access_allowlist').delete().eq('pattern', pattern);
  if (error) throw error;
}

export async function listProfiles(): Promise<Profile[]> {
  const { data, error } = await supabase.from('profiles').select('id, display_name, is_admin').order('display_name');
  if (error) throw error;
  return (data || []) as Profile[];
}

export async function setAdmin(userId: string, value: boolean) {
  const { error } = await supabase.rpc('set_admin', { p_user: userId, p_value: value });
  if (error) throw error;
}
