export type Exam = {
  id: string;
  slug: string;
  vendor: string;
  code: string;
  name: string;
  description: string;
  language: string;
  sim_questions: number;
  sim_minutes: number;
  mini_questions: number;
  mini_minutes: number;
  passing_note: string;
  is_published: boolean;
};

export type DocLink = { title: string; url: string };

export type Domain = { id: string; exam_id: string; code: string; name: string; weight: number; docs?: DocLink[] };

/** Anonymous per-question aggregates (no user ids). picks[i] = times original option i was chosen. */
export type QuestionStat = {
  question_id: string;
  answered: number;
  correct: number;
  first_answered: number;
  first_correct: number;
  picks: number[];
};

export type ReportReason = 'ambigua' | 'respuesta' | 'traduccion' | 'errata' | 'otro';

export type QuestionReport = {
  id: string;
  question_id: string;
  exam_id: string;
  user_id: string | null;
  reason: ReportReason;
  comment: string;
  lang: string;
  status: 'abierto' | 'resuelto' | 'descartado';
  admin_note: string;
  created_at: string;
  resolved_at: string | null;
};

export type Team = { id: string; name: string };
export type TeamMember = { team_id: string; user_id: string; role: 'lead' | 'member'; shares_progress: boolean };
export type TeamProgressRow = {
  user_id: string;
  display_name: string;
  role: 'lead' | 'member';
  shares_progress: boolean;
  exam_id: string | null;
  attempts: number | null;
  answered: number | null;
  last_at: string | null;
  last_sim_pct: number | null;
  by_domain: Record<string, { ok: number; total: number }> | null;
  target_date: string | null;
};

export type Source = 'bank' | 'official_sample' | 'team';

export type Question = {
  id: string;
  exam_id: string;
  domain_id: string;
  source: Source;
  stem: string;
  options: string[];
  correct: number[];
  explanation: string;
  /** Translations by language code, e.g. { en: { stem, options, explanation } }. Options keep the same order. */
  i18n?: Record<string, { stem: string; options: string[]; explanation?: string }>;
  author_id: string | null;
  created_at: string;
  is_active?: boolean;
};

export type ReviewItem = {
  question_id: string;
  exam_id: string;
  wrong_count: number;
  flagged: boolean;
  last_result: 'fallada' | 'acertada' | 'sin responder';
  last_pick: number[];
  last_mode: string;
  last_at: string;
};

export type Attempt = {
  id: string;
  exam_id: string;
  mode: Mode;
  correct: number;
  total: number;
  seconds_used: number | null;
  by_domain: Record<string, { ok: number; total: number }>;
  wrong_question_ids: string[];
  finished_at: string;
};

export type Mode = 'sim' | 'mini' | 'practice' | 'review' | 'team' | 'last_wrong' | 'targeted';

export type Profile = { id: string; display_name: string; is_admin: boolean; /** Training editor (training migration). */ is_editor?: boolean };

/** One question inside a running session, with its options shuffled for display. */
export type Item = {
  q: Question;
  order: number[]; // order[displayIndex] = original option index
  correct: number[]; // display indexes of the correct options
  pick: number[]; // display indexes picked
  flag: boolean;
  checked: boolean; // practice: answer revealed
  struck?: number[]; // display indexes crossed out by the user
};

export type Session = {
  examSlug: string;
  mode: Mode;
  title: string;
  items: Item[];
  seconds: number; // 0 = untimed
  startedAt: number;
};
