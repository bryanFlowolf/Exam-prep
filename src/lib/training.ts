import { supabase } from './supabase';

export type Category = 'prl' | 'onboarding' | 'tecnologia' | 'compliance' | 'general';
export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'prl', label: 'Prevención de riesgos laborales' },
  { id: 'onboarding', label: 'Onboarding' },
  { id: 'tecnologia', label: 'Tecnología' },
  { id: 'compliance', label: 'Cumplimiento normativo' },
  { id: 'general', label: 'General' },
];
export const catLabel = (c: string) => CATEGORIES.find((x) => x.id === c)?.label || c;

export type Course = {
  id: string;
  title: string;
  summary: string;
  category: Category;
  pass_pct: number;
  quiz_size: number | null;
  requires_ack: boolean;
  ack_text: string;
  validity_months: number | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

export type LessonKind = 'text' | 'video' | 'pdf' | 'link';
export type Lesson = { id: string; course_id: string; position: number; title: string; kind: LessonKind; body: string; url: string };
export type CourseQuestion = { id: string; course_id: string; position: number; stem: string; options: string[]; correct: number[]; explanation: string };
export type QuizQuestion = { id: string; stem: string; options: string[]; multi: boolean };
export type Assignment = { id: string; course_id: string; user_id: string | null; team_id: string | null; due_date: string | null; created_at: string };
export type Completion = {
  id: string; user_id: string | null; course_id: string; course_title: string; person_name: string; person_email: string;
  correct: number; total: number; score_pct: number; pass_pct: number; passed: boolean;
  ack_text: string | null; ack_at: string | null; completed_at: string; expires_at: string | null; code: string;
};
export type TrainingState = 'completado' | 'caducado' | 'vencido' | 'pendiente';
export type MyTraining = { course_id: string; due_date: string | null; last_passed_at: string | null; expires_at: string | null; completion_id: string | null; state: TrainingState };
export type StatusRow = {
  user_id: string; display_name: string; email: string; teams: string | null; due_date: string | null;
  last_passed_at: string | null; expires_at: string | null; score_pct: number | null; ack_at: string | null;
  completion_id: string | null; attempts: number; state: TrainingState;
};
export type Person = { user_id: string; display_name: string; email: string };

export const STATE_LABEL: Record<TrainingState, string> = { completado: 'Completada', caducado: 'Caducada', vencido: 'Vencida', pendiente: 'Pendiente' };

const ok = <T,>(r: { data: T | null; error: unknown }): T => { if (r.error) throw r.error; return r.data as T; };

// ---- Empleados ----
export async function listCourses(): Promise<Course[]> {
  return ok(await supabase.from('courses').select('*').order('title')) || [];
}
export async function myTraining(): Promise<MyTraining[]> {
  return ok(await supabase.rpc('my_training')) || [];
}
export async function getCourse(id: string): Promise<{ course: Course; lessons: Lesson[]; done: Set<string>; completions: Completion[] }> {
  const [c, l, p, k] = await Promise.all([
    supabase.from('courses').select('*').eq('id', id).maybeSingle(),
    supabase.from('course_lessons').select('*').eq('course_id', id).order('position').order('created_at'),
    supabase.from('lesson_progress').select('lesson_id').eq('course_id', id),
    supabase.from('course_completions').select('*').eq('course_id', id).order('completed_at', { ascending: false }),
  ]);
  const course = ok(c) as Course | null;
  if (!course) throw new Error('Curso no encontrado');
  const { data: u } = await supabase.auth.getUser();
  return {
    course,
    lessons: ok(l) || [],
    done: new Set((ok(p) || []).map((r: { lesson_id: string }) => r.lesson_id)),
    completions: ((ok(k) || []) as Completion[]).filter((x) => x.user_id === u.user?.id),
  };
}
export async function completeLesson(lesson: Lesson) {
  const { error } = await supabase.from('lesson_progress').insert({ lesson_id: lesson.id, course_id: lesson.course_id });
  if (error && (error as { code?: string }).code !== '23505') throw error;
}
export async function courseQuiz(courseId: string): Promise<QuizQuestion[]> {
  return ok(await supabase.rpc('course_quiz', { p_course: courseId })) || [];
}
export type SubmitResult = { completion: Completion; detail: { id: string; ok: boolean; correct?: number[]; explanation?: string }[] };
export async function submitCourse(courseId: string, answers: { id: string; picked: number[] }[], ack: boolean): Promise<SubmitResult> {
  return ok(await supabase.rpc('submit_course', { p_course: courseId, p_answers: answers, p_ack: ack }));
}
export async function getCompletion(id: string): Promise<Completion | null> {
  return ok(await supabase.from('course_completions').select('*').eq('id', id).maybeSingle());
}
/** Signed URL for a file in the private "training" bucket; external URLs are returned unchanged. */
export async function fileUrl(url: string): Promise<string> {
  if (!url.startsWith('storage:')) return url;
  const { data, error } = await supabase.storage.from('training').createSignedUrl(url.slice(8), 60 * 60);
  if (error) throw error;
  return data.signedUrl;
}

// ---- Editores ----
export async function saveCourse(c: Partial<Course> & { id?: string }): Promise<Course> {
  const row = { ...c, updated_at: new Date().toISOString() };
  if (c.id) return ok(await supabase.from('courses').update(row).eq('id', c.id).select().single());
  const { data: u } = await supabase.auth.getUser();
  return ok(await supabase.from('courses').insert({ ...row, created_by: u.user?.id }).select().single());
}
export async function deleteCourse(id: string) { ok(await supabase.from('courses').delete().eq('id', id)); }
export async function editorCourse(id: string) {
  const [c, l, q, a] = await Promise.all([
    supabase.from('courses').select('*').eq('id', id).maybeSingle(),
    supabase.from('course_lessons').select('*').eq('course_id', id).order('position').order('created_at'),
    supabase.from('course_questions').select('*').eq('course_id', id).order('position').order('created_at'),
    supabase.from('course_assignments').select('*').eq('course_id', id).order('created_at'),
  ]);
  return { course: ok(c) as Course | null, lessons: (ok(l) || []) as Lesson[], questions: (ok(q) || []) as CourseQuestion[], assignments: (ok(a) || []) as Assignment[] };
}
export async function saveLesson(l: Partial<Lesson>): Promise<Lesson> {
  if (l.id) return ok(await supabase.from('course_lessons').update(l).eq('id', l.id).select().single());
  return ok(await supabase.from('course_lessons').insert(l).select().single());
}
export async function deleteLesson(id: string) { ok(await supabase.from('course_lessons').delete().eq('id', id)); }
export async function saveQuestion(q: Partial<CourseQuestion>): Promise<CourseQuestion> {
  if (q.id) return ok(await supabase.from('course_questions').update(q).eq('id', q.id).select().single());
  return ok(await supabase.from('course_questions').insert(q).select().single());
}
export async function deleteQuestion(id: string) { ok(await supabase.from('course_questions').delete().eq('id', id)); }
export async function addAssignments(courseId: string, targets: { user_id?: string; team_id?: string }[], due: string | null) {
  const { data: u } = await supabase.auth.getUser();
  const rows = targets.map((t) => ({ course_id: courseId, user_id: t.user_id || null, team_id: t.team_id || null, due_date: due, assigned_by: u.user?.id }));
  // Ya asignados: se actualiza la fecha límite.
  for (const r of rows) {
    const col = r.user_id ? 'user_id' : 'team_id';
    const val = (r.user_id || r.team_id) as string;
    const { data: existing } = await supabase.from('course_assignments').select('id').eq('course_id', courseId).eq(col, val).maybeSingle();
    if (existing) ok(await supabase.from('course_assignments').update({ due_date: due }).eq('id', existing.id));
    else ok(await supabase.from('course_assignments').insert(r));
  }
}
export async function removeAssignment(id: string) { ok(await supabase.from('course_assignments').delete().eq('id', id)); }
export async function trainingPeople(): Promise<Person[]> { return ok(await supabase.rpc('training_people')) || []; }
export async function trainingStatus(courseId: string): Promise<StatusRow[]> { return ok(await supabase.rpc('training_status', { p_course: courseId })) || []; }
export async function uploadFile(courseId: string, file: File): Promise<string> {
  const safe = file.name.normalize('NFKD').replace(/[^\w.-]+/g, '-').slice(-80);
  const path = `${courseId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from('training').upload(path, file, { contentType: file.type || undefined });
  if (error) throw error;
  return `storage:${path}`;
}
export async function setEditor(userId: string, value: boolean) {
  const { error } = await supabase.rpc('set_editor', { p_user: userId, p_value: value });
  if (error) throw error;
}

export function fmtDay(d: string | null | undefined): string {
  if (!d) return '—';
  try { return new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return d; }
}
export function fmtDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  try { return new Date(d).toLocaleString('es-ES', { dateStyle: 'long', timeStyle: 'short' }); } catch { return d; }
}
