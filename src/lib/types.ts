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

export type Domain = { id: string; exam_id: string; code: string; name: string; weight: number };

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
  author_id: string | null;
  created_at: string;
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

export type Mode = 'sim' | 'mini' | 'practice' | 'review' | 'team' | 'last_wrong';

export type Profile = { id: string; display_name: string; is_admin: boolean };

/** One question inside a running session, with its options shuffled for display. */
export type Item = {
  q: Question;
  order: number[]; // order[displayIndex] = original option index
  correct: number[]; // display indexes of the correct options
  pick: number[]; // display indexes picked
  flag: boolean;
  checked: boolean; // practice: answer revealed
};

export type Session = {
  examSlug: string;
  mode: Mode;
  title: string;
  items: Item[];
  seconds: number; // 0 = untimed
  startedAt: number;
};
