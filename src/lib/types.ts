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
  /** Scenario-based exams (scenarios migration): the scenarios and how many a simulation draws. */
  scenarios?: Scenario[];
  scenario_count?: number | null;
};

/** A case study shown next to its questions. `i18n.en` holds the English text. */
export type Scenario = { code: string; title: string; text: string; i18n?: Record<string, { title: string; text: string }> };

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
  /** Code of the exam scenario this question belongs to, if any. */
  scenario?: string | null;
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
  /** Spaced repetition (study migration): next review, interval in days, ease factor and hits in a row. */
  due_at?: string | null;
  interval_days?: number;
  ease?: number;
  streak?: number;
};

/** Personal study preferences for one exam (exam_plans). study_days uses 0 = Sunday … 6 = Saturday. */
export type ExamPlan = { target_date: string | null; daily_minutes: number; study_days: number[] };

/** Official exam result with the app's prediction on that day. score is a fraction (720/1000 → 0.72). */
export type ExamResult = {
  id: string;
  exam_id: string;
  taken_on: string;
  passed: boolean;
  score: number | null;
  predicted_estimate: number | null;
  predicted_probability: number | null;
  predicted_answers: number;
  pass_mark: number | null;
  created_at: string;
};

/** Anonymous prediction-vs-result aggregate (prediction_calibration). Figures are null below 3 results. */
export type Calibration = {
  n: number;
  n_scored: number;
  mean_bias: number | null;
  sd_resid: number | null;
  brier: number | null;
  pass_rate: number | null;
  mean_prob: number | null;
  bins: { lo: number; hi: number; n: number; passed: number }[] | null;
};

export type TeamActivityRow = {
  user_id: string;
  exam_id: string;
  active_days_14: number;
  answered_7: number;
  due_reviews: number;
  daily_minutes: number | null;
  result_on: string | null;
  result_passed: boolean | null;
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

export type Mode = 'sim' | 'mini' | 'practice' | 'review' | 'team' | 'last_wrong' | 'targeted' | 'daily' | 'spaced';

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
