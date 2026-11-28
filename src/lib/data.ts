import { supabase } from './supabase';
import { answered, isRight } from './exam';
import type { Attempt, Calibration, Domain, Exam, ExamPlan, ExamResult, Item, Mode, Profile, Question, QuestionReport, QuestionStat, ReportReason, ReviewItem, Team, TeamActivityRow, TeamMember, TeamProgressRow } from './types';
import { readiness, recentTotals } from './readiness';
import { schedule, type SrsContext } from './srs';
import type { QualityReview } from './quality';

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
  const { data, error } = await supabase.from('profiles').select('*').eq('id', u.user.id).maybeSingle();
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
  /** Anonymous answer statistics by question id (empty if the insights migration is not applied yet). */
  stats: Map<string, QuestionStat>;
  /** Question ids this user has an open report on. */
  reported: Set<string>;
  targetDate: string | null;
  /** Study preferences (defaults until the study migration is applied or the person changes them). */
  plan: ExamPlan;
  /** Official results this person recorded for this exam, newest first. */
  results: ExamResult[];
  /** Anonymous calibration for this exam and across all exams (null if unavailable). */
  calibration: { exam: Calibration | null; all: Calibration | null };
};

export const DEFAULT_PLAN: ExamPlan = { target_date: null, daily_minutes: 30, study_days: [1, 2, 3, 4, 5] };

async function calibration(examId: string | null): Promise<Calibration | null> {
  try {
    const { data, error } = await supabase.rpc('prediction_calibration', { p_exam: examId });
    if (error || !data) return null;
    const row = (Array.isArray(data) ? data[0] : data) as Calibration | undefined;
    return row && typeof row.n === 'number' ? row : null;
  } catch {
    return null;
  }
}

/** Optional data from the 20261124 migration: an error (e.g. table missing) must not break the exam page. */
async function optional<T>(p: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  try {
    const { data, error } = await p;
    return error ? [] : data || [];
  } catch {
    return [];
  }
}

export async function loadExam(slug: string, userId: string): Promise<ExamData> {
  const { data: exam, error } = await supabase.from('exams').select('*').eq('slug', slug).maybeSingle();
  if (error) throw error;
  if (!exam) throw new Error('Examen no encontrado');
  const [domainsRes, questions, seenRows, reviewRows, attemptsRes, statRows, reportRows, planRows, resultRows, calExam, calAll] = await Promise.all([
    supabase.from('domains').select('*').eq('exam_id', exam.id).order('weight', { ascending: false }),
    all<Question>((a, b) => supabase.from('questions').select('*').eq('exam_id', exam.id).eq('is_active', true).order('created_at').range(a, b)),
    all<{ question_id: string }>((a, b) => supabase.from('seen_questions').select('question_id').eq('exam_id', exam.id).eq('user_id', userId).range(a, b)),
    all<ReviewItem>((a, b) => supabase.from('review_items').select('*').eq('exam_id', exam.id).eq('user_id', userId).range(a, b)),
    supabase.from('attempts').select('*').eq('exam_id', exam.id).eq('user_id', userId).order('finished_at', { ascending: false }).limit(60),
    optional<QuestionStat>(supabase.from('question_stats').select('question_id, answered, correct, first_answered, first_correct, picks').eq('exam_id', exam.id).limit(5000)),
    optional<{ question_id: string }>(supabase.from('question_reports').select('question_id').eq('exam_id', exam.id).eq('user_id', userId).eq('status', 'abierto')),
    optional<Partial<ExamPlan>>(supabase.from('exam_plans').select('*').eq('exam_id', exam.id).eq('user_id', userId)),
    optional<ExamResult>(supabase.from('exam_results').select('*').eq('exam_id', exam.id).eq('user_id', userId).order('taken_on', { ascending: false })),
    calibration(exam.id),
    calibration(null),
  ]);
  const planRow = planRows[0] || {};
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
    stats: new Map(statRows.map((r) => [r.question_id, r])),
    reported: new Set(reportRows.map((r) => r.question_id)),
    targetDate: planRow.target_date ?? null,
    plan: {
      target_date: planRow.target_date ?? null,
      daily_minutes: planRow.daily_minutes ?? DEFAULT_PLAN.daily_minutes,
      study_days: planRow.study_days?.length ? planRow.study_days : DEFAULT_PLAN.study_days,
    },
    results: resultRows,
    calibration: { exam: calExam, all: calAll },
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
  const ready = readiness(data.domains, recentTotals(data.attempts), data.exam.passing_note);
  const srs: SrsContext = {
    domainAcc: Object.fromEntries(ready.domains.map((d) => [d.domain.id, d.shrunk])),
    stats: data.stats,
    targetDate: data.targetDate,
  };
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
      ...(was
        ? schedule(prev, right, it.q, srs)
        // Flagged without answering: review it today, keep its history.
        : { due_at: now, interval_days: prev?.interval_days ?? 0, ease: prev?.ease ?? 2.3, streak: prev?.streak ?? 0 }),
    };
    review.set(it.q.id, row);
    reviewRows.push(row);
  }
  let error: string | undefined;
  let attempt: Attempt | null = null;
  if (done.length) {
    // Anonymous statistics first: the server counts it as a first answer only if the question is not seen yet.
    // If this fails (for example, the migration is not applied), the attempt is still saved.
    try {
      await supabase.rpc('record_answers', {
        p_exam: data.exam.id,
        p: done.map((it) => ({ q: it.q.id, pick: it.pick.map((k) => it.order[k]) })),
      });
    } catch { /* statistics are best effort */ }
    const row = {
      exam_id: data.exam.id, mode, correct: done.filter(isRight).length, total: done.length,
      seconds_used: secondsUsed, by_domain: byDomain, wrong_question_ids: wrongIds,
    };
    let res = await supabase.from('attempts').insert(row).select().single();
    // Before the study migration the database does not know the 'daily' and 'spaced' modes: save them as review.
    if (res.error && (mode === 'daily' || mode === 'spaced') && /mode_check|check constraint/i.test(res.error.message)) {
      res = await supabase.from('attempts').insert({ ...row, mode: 'review' }).select().single();
    }
    if (res.error) error = res.error.message; else attempt = res.data as Attempt;
    const seenRes = await supabase.from('seen_questions').upsert(
      done.map((it) => ({ question_id: it.q.id, exam_id: it.q.exam_id })), { onConflict: 'user_id,question_id', ignoreDuplicates: true },
    );
    if (seenRes.error) error = error || seenRes.error.message;
  }
  if (reviewRows.length) {
    let r = await supabase.from('review_items').upsert(reviewRows, { onConflict: 'user_id,question_id' });
    // Before the study migration the schedule columns do not exist: keep the review list working without them.
    if (r.error && /due_at|interval_days|ease|streak|column/i.test(r.error.message)) {
      const plain = reviewRows.map(({ due_at: _d, interval_days: _i, ease: _e, streak: _s, ...rest }) => rest);
      r = await supabase.from('review_items').upsert(plain, { onConflict: 'user_id,question_id' });
    }
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
  const { data, error } = await supabase.from('profiles').select('*').order('display_name');
  if (error) throw error;
  return (data || []) as Profile[];
}

export async function setAdmin(userId: string, value: boolean) {
  const { error } = await supabase.rpc('set_admin', { p_user: userId, p_value: value });
  if (error) throw error;
}

// ---- Preparación ----
export async function saveTargetDate(examId: string, date: string | null) {
  const { error } = await supabase.from('exam_plans').upsert({ exam_id: examId, target_date: date, updated_at: new Date().toISOString() }, { onConflict: 'user_id,exam_id' });
  if (error) throw error;
}

export async function savePlanPrefs(examId: string, prefs: Pick<ExamPlan, 'daily_minutes' | 'study_days'>) {
  const { error } = await supabase.from('exam_plans').upsert({ exam_id: examId, ...prefs, updated_at: new Date().toISOString() }, { onConflict: 'user_id,exam_id' });
  if (error) throw error;
}

export type ResultDraft = Pick<ExamResult, 'taken_on' | 'passed' | 'score' | 'predicted_estimate' | 'predicted_probability' | 'predicted_answers' | 'pass_mark'>;

export async function saveExamResult(examId: string, draft: ResultDraft): Promise<ExamResult> {
  const { data, error } = await supabase.from('exam_results').upsert({ exam_id: examId, ...draft }, { onConflict: 'user_id,exam_id,taken_on' }).select().single();
  if (error) throw error;
  return data as ExamResult;
}

export async function deleteExamResult(id: string) {
  const { error } = await supabase.from('exam_results').delete().eq('id', id);
  if (error) throw error;
}

export async function loadCalibration(examId: string | null) {
  return calibration(examId);
}

// ---- Reportes de preguntas ----
export async function reportQuestion(questionId: string, reason: ReportReason, comment: string, lang: string) {
  const { error } = await supabase.from('question_reports').insert({ question_id: questionId, reason, comment: comment.trim().slice(0, 1000), lang });
  if (error) throw error;
}

export type ReportRow = QuestionReport & { reporter: string; question: Question | null; exam: Pick<Exam, 'id' | 'slug' | 'code' | 'name'> | null };

export async function listReports(status: QuestionReport['status'] | 'all' = 'abierto'): Promise<ReportRow[]> {
  let q = supabase.from('question_reports').select('*').order('created_at', { ascending: false }).limit(500);
  if (status !== 'all') q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data || []) as QuestionReport[];
  const qIds = [...new Set(rows.map((r) => r.question_id))];
  const uIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean) as string[])];
  const eIds = [...new Set(rows.map((r) => r.exam_id))];
  const [qs, us, es] = await Promise.all([
    qIds.length ? supabase.from('questions').select('*').in('id', qIds) : Promise.resolve({ data: [] }),
    uIds.length ? supabase.from('profiles').select('id, display_name').in('id', uIds) : Promise.resolve({ data: [] }),
    eIds.length ? supabase.from('exams').select('id, slug, code, name').in('id', eIds) : Promise.resolve({ data: [] }),
  ]);
  const qm = new Map(((qs.data || []) as Question[]).map((x) => [x.id, x]));
  const um = new Map(((us.data || []) as { id: string; display_name: string }[]).map((x) => [x.id, x.display_name]));
  const em = new Map(((es.data || []) as ReportRow['exam'][]).map((x) => [x!.id, x]));
  return rows.map((r) => ({ ...r, reporter: (r.user_id && um.get(r.user_id)) || 'Usuario eliminado', question: qm.get(r.question_id) || null, exam: em.get(r.exam_id) || null }));
}

export async function resolveReport(id: string, status: QuestionReport['status'], note: string) {
  const { error } = await supabase.from('question_reports').update({ status, admin_note: note.trim().slice(0, 1000) }).eq('id', id);
  if (error) throw error;
}

/** Everything an admin needs to judge question quality for one exam. */
export async function loadQuality(examId: string) {
  const [questions, domains, stats, reports] = await Promise.all([
    all<Question>((a, b) => supabase.from('questions').select('*').eq('exam_id', examId).eq('is_active', true).order('created_at').range(a, b)),
    supabase.from('domains').select('*').eq('exam_id', examId),
    all<QuestionStat>((a, b) => supabase.from('question_stats').select('question_id, answered, correct, first_answered, first_correct, picks').eq('exam_id', examId).range(a, b)),
    all<{ question_id: string }>((a, b) => supabase.from('question_reports').select('question_id').eq('exam_id', examId).eq('status', 'abierto').range(a, b)),
  ]);
  if (domains.error) throw domains.error;
  const openReports = new Map<string, number>();
  for (const r of reports) openReports.set(r.question_id, (openReports.get(r.question_id) || 0) + 1);
  // Admin reviews of automatic flags (quality migration); empty until it is applied.
  const reviews = await optional<QualityReview>(supabase.from('question_quality_reviews').select('*').eq('exam_id', examId));
  return {
    questions, domains: (domains.data || []) as Domain[], stats: new Map(stats.map((s) => [s.question_id, s])), openReports,
    reviews: new Map(reviews.map((r) => [r.question_id, r])),
  };
}

export async function saveQualityReview(r: Pick<QualityReview, 'question_id' | 'exam_id' | 'status' | 'note' | 'answered_at_review'>): Promise<QualityReview> {
  const { data, error } = await supabase.from('question_quality_reviews')
    .upsert({ ...r, reviewed_at: new Date().toISOString() }, { onConflict: 'question_id' }).select().single();
  if (error) throw error;
  return data as QualityReview;
}

export async function deleteQualityReview(questionId: string) {
  const { error } = await supabase.from('question_quality_reviews').delete().eq('question_id', questionId);
  if (error) throw error;
}

export type BankPatch = Pick<Question, 'stem' | 'options' | 'correct' | 'explanation'>;

/** Admin correction of a bank question (Spanish text; the English version is kept unless options change count). */
export async function updateBankQuestion(id: string, patch: BankPatch): Promise<Question> {
  const { data, error } = await supabase.from('questions').update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as Question;
}

export async function resetQuestionStats(id: string) {
  const { error } = await supabase.rpc('reset_question_stats', { p_question: id });
  if (error) throw error;
}

export async function setQuestionActive(id: string, value: boolean) {
  const { error } = await supabase.from('questions').update({ is_active: value }).eq('id', id);
  if (error) throw error;
}

// ---- Equipos ----
export async function listTeams(): Promise<Team[]> {
  const { data, error } = await supabase.from('teams').select('id, name').order('name');
  if (error) throw error;
  return (data || []) as Team[];
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await supabase.from('team_members').select('team_id, user_id, role, shares_progress');
  if (error) throw error;
  return (data || []) as TeamMember[];
}

export async function myTeamCount(userId: string): Promise<number> {
  const { count, error } = await supabase.from('team_members').select('team_id', { count: 'exact', head: true }).eq('user_id', userId);
  return error ? 0 : count || 0;
}

export async function createTeam(name: string) {
  const { error } = await supabase.from('teams').insert({ name: name.trim().slice(0, 80) });
  if (error) throw error;
}

export async function renameTeam(id: string, name: string) {
  const { error } = await supabase.from('teams').update({ name: name.trim().slice(0, 80) }).eq('id', id);
  if (error) throw error;
}

export async function deleteTeam(id: string) {
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) throw error;
}

export async function addTeamMember(teamId: string, userId: string, role: 'lead' | 'member') {
  const { error } = await supabase.from('team_members').insert({ team_id: teamId, user_id: userId, role });
  if (error) throw error;
}

export async function setTeamRole(teamId: string, userId: string, role: 'lead' | 'member') {
  const { error } = await supabase.from('team_members').update({ role }).eq('team_id', teamId).eq('user_id', userId);
  if (error) throw error;
}

export async function removeTeamMember(teamId: string, userId: string) {
  const { error } = await supabase.from('team_members').delete().eq('team_id', teamId).eq('user_id', userId);
  if (error) throw error;
}

export async function setShareProgress(teamId: string, value: boolean) {
  const { error } = await supabase.rpc('set_share_progress', { p_team: teamId, p_value: value });
  if (error) throw error;
}

export async function teamProgress(teamId: string): Promise<TeamProgressRow[]> {
  const { data, error } = await supabase.rpc('team_progress', { p_team: teamId });
  if (error) throw error;
  return (data || []) as TeamProgressRow[];
}

/** Consistency, due reviews and official results of members who share their progress (study migration). */
export async function teamActivity(teamId: string): Promise<TeamActivityRow[]> {
  try {
    const { data, error } = await supabase.rpc('team_activity', { p_team: teamId });
    return error ? [] : ((data || []) as TeamActivityRow[]);
  } catch {
    return [];
  }
}

export async function loadExamsWithDomains(): Promise<{ exams: Exam[]; domains: Domain[] }> {
  const [e, d] = await Promise.all([
    supabase.from('exams').select('*').order('vendor').order('name'),
    supabase.from('domains').select('*'),
  ]);
  if (e.error) throw e.error;
  if (d.error) throw d.error;
  return { exams: (e.data || []) as Exam[], domains: (d.data || []) as Domain[] };
}
