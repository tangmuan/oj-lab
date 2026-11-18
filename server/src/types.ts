export type Role = 'user' | 'admin';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type JudgeStatus = 'PENDING' | 'JUDGING' | 'AC' | 'WA' | 'TLE' | 'MLE' | 'RE' | 'CE' | 'OLE' | 'SE';

export type LanguageId = 'python' | 'node' | 'c' | 'cpp' | 'java';

export interface AuthUser {
  id: number;
  username: string;
  role: Role;
}

export interface UserRow extends AuthUser {
  password_hash: string;
  created_at: string;
}

export interface ProblemRow {
  id: number;
  title: string;
  difficulty: Difficulty;
  description: string;
  input_format: string;
  output_format: string;
  hint: string;
  time_limit_ms: number;
  memory_limit_mb: number;
  is_public: number;
  /** 特殊评测：为空表示走普通输出比对 */
  checker_language: LanguageId | null;
  checker_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestcaseRow {
  id: number;
  problem_id: number;
  input: string;
  expected_output: string;
  is_sample: number;
  ord: number;
}

export interface SubmissionRow {
  id: number;
  user_id: number;
  problem_id: number;
  language: LanguageId;
  code: string;
  status: JudgeStatus;
  time_ms: number;
  memory_kb: number;
  pass_count: number;
  total_count: number;
  compile_msg: string | null;
  detail: string | null;
  created_at: string;
  judged_at: string | null;
}

export interface SubmissionCaseRow {
  id: number;
  submission_id: number;
  case_index: number;
  status: JudgeStatus;
  time_ms: number;
  memory_kb: number;
  is_sample: number;
  message: string | null;
}

export interface ContestRow {
  id: number;
  title: string;
  /** UTC 'YYYY-MM-DD HH:MM:SS'，与 submissions.created_at 同口径 */
  start_at: string;
  end_at: string;
  frozen_minutes: number;
  is_public: number;
  unfrozen_at: string | null;
  created_at: string;
}

export interface ContestProblemRow {
  contest_id: number;
  problem_id: number;
  label: string;
  ord: number;
}

export interface UserFileRow {
  id: number;
  user_id: number;
  title: string;
  language: LanguageId;
  content: string;
  last_input: string;
  problem_id: number | null;
  created_at: string;
  updated_at: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
