export type Difficulty = 'easy' | 'medium' | 'hard';
export type Role = 'user' | 'admin';
export type LanguageId = 'python' | 'node' | 'c' | 'cpp' | 'java';
export type JudgeStatus =
  | 'PENDING'
  | 'JUDGING'
  | 'AC'
  | 'WA'
  | 'TLE'
  | 'MLE'
  | 'RE'
  | 'CE'
  | 'OLE'
  | 'SE';

export interface User {
  id: number;
  username: string;
  role: Role;
}

export interface ProblemSummary {
  id: number;
  title: string;
  difficulty: Difficulty;
  time_limit_ms: number;
  memory_limit_mb: number;
  is_public: number;
  submit_count: number;
  ac_count: number;
  case_count: number;
  ac_rate: number | null;
  my_status: { tried: boolean; solved: boolean };
}

export interface Problem {
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
  created_at: string;
  updated_at: string;
}

export interface Sample {
  id: number;
  input: string;
  expected_output: string;
  ord: number;
}

export interface ProblemDetail {
  problem: Problem;
  samples: Sample[];
  stats: { submitCount: number; acCount: number; solvedUsers: number; acRate: number | null };
  mine: { submitCount: number; lastStatus: string | null; solved: boolean };
}

export interface SubmissionSummary {
  id: number;
  user_id: number;
  problem_id: number;
  language: LanguageId;
  status: JudgeStatus;
  time_ms: number;
  memory_kb: number;
  pass_count: number;
  total_count: number;
  created_at: string;
  username: string;
  problem_title: string;
}

export interface CaseResult {
  case_index: number;
  status: JudgeStatus;
  time_ms: number;
  memory_kb: number;
  is_sample: number;
  message: string | null;
}

export interface SubmissionDetailData {
  id: number;
  user_id: number;
  problem_id: number;
  language: LanguageId;
  status: JudgeStatus;
  time_ms: number;
  memory_kb: number;
  pass_count: number;
  total_count: number;
  created_at: string;
  judged_at: string | null;
  compile_msg: string | null;
  detail: string | null;
  code: string;
  codeHidden: boolean;
  username: string;
  problemTitle: string;
}

export interface SubmissionDetail {
  submission: SubmissionDetailData;
  cases: CaseResult[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type RunStatus = 'OK' | 'TLE' | 'MLE' | 'RE' | 'OLE' | 'CE';

export interface RunResult {
  status: RunStatus;
  compileMsg: string | null;
  stdout: string;
  stderr: string;
  timeMs: number;
  memoryKb: number;
  exitCode: number | null;
  truncated: boolean;
}

export interface UserFileSummary {
  id: number;
  title: string;
  language: LanguageId;
  problem_id: number | null;
  created_at: string;
  updated_at: string;
  char_count: number;
  input_len: number;
}

export interface UserFile {
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

export interface UserTemplate {
  language: LanguageId;
  content: string;
  updated_at: string;
}

export interface LanguageMeta {
  id: LanguageId;
  label: string;
}

export interface LeaderboardItem {
  rank: number;
  id: number;
  username: string;
  role: Role;
  solved: number;
  submit_count: number;
  ac_count: number;
  ac_rate: number | null;
  last_submit_at: string | null;
}

export interface Overview {
  users: number;
  problems: number;
  submissions: number;
  accepted: number;
  todaySubmissions: number;
  todayAccepted: number;
}

export interface Testcase {
  id: number;
  problem_id: number;
  input: string;
  expected_output: string;
  is_sample: number;
  ord: number;
}

export interface AdminProblem extends Problem {
  case_count: number;
  submit_count: number;
}
