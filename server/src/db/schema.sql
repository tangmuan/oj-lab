-- Online Judge schema (SQLite)
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS problems (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  difficulty      TEXT NOT NULL DEFAULT 'easy' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  description     TEXT NOT NULL DEFAULT '',
  input_format    TEXT NOT NULL DEFAULT '',
  output_format   TEXT NOT NULL DEFAULT '',
  hint            TEXT NOT NULL DEFAULT '',
  time_limit_ms   INTEGER NOT NULL DEFAULT 1000,
  memory_limit_mb INTEGER NOT NULL DEFAULT 256,
  is_public       INTEGER NOT NULL DEFAULT 1,
  -- 特殊评测：checker 为空时完全走原本的输出比对路径
  checker_language TEXT,
  checker_code     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS testcases (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  problem_id      INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  input           TEXT NOT NULL DEFAULT '',
  expected_output TEXT NOT NULL DEFAULT '',
  is_sample       INTEGER NOT NULL DEFAULT 0,
  ord             INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_testcases_problem ON testcases(problem_id);

CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id  INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  language    TEXT NOT NULL,
  code        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PENDING',
  time_ms     INTEGER NOT NULL DEFAULT 0,
  memory_kb   INTEGER NOT NULL DEFAULT 0,
  pass_count  INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL DEFAULT 0,
  compile_msg TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  judged_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions(problem_id);
CREATE INDEX IF NOT EXISTS idx_submissions_created ON submissions(created_at);

CREATE TABLE IF NOT EXISTS submission_cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  case_index    INTEGER NOT NULL,
  status        TEXT NOT NULL,
  time_ms       INTEGER NOT NULL DEFAULT 0,
  memory_kb     INTEGER NOT NULL DEFAULT 0,
  is_sample     INTEGER NOT NULL DEFAULT 0,
  message       TEXT
);

CREATE INDEX IF NOT EXISTS idx_subcases_submission ON submission_cases(submission_id);

-- 草稿箱：用户自建的代码文件，实时保存、可重新打开
CREATE TABLE IF NOT EXISTS user_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  language   TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  last_input TEXT NOT NULL DEFAULT '',
  problem_id INTEGER REFERENCES problems(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_files_user ON user_files(user_id, updated_at);

-- 用户自定义语言模板：每种语言一份，新建文件时优先使用
CREATE TABLE IF NOT EXISTS user_templates (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language   TEXT NOT NULL,
  content    TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, language)
);

-- 标签：自由文本，靠 name 唯一去重（NOCASE 让大小写变体落成同一条）
CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS problem_tags (
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  tag_id     INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (problem_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_problem_tags_tag ON problem_tags(tag_id);

-- 收藏：一个用户对一道题只有一条记录，重复收藏靠主键挡住
CREATE TABLE IF NOT EXISTS favorites (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id, created_at);

-- 比赛：时间统一存 UTC 的 'YYYY-MM-DD HH:MM:SS'，与 submissions.created_at 同口径
CREATE TABLE IF NOT EXISTS contests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT NOT NULL,
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  frozen_minutes INTEGER NOT NULL DEFAULT 0,
  is_public      INTEGER NOT NULL DEFAULT 1,
  -- 手动解封时间；NULL 表示还没手动解封，封榜按 end_at 自动解除
  unfrozen_at    TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contest_problems (
  contest_id INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  ord        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (contest_id, problem_id)
);

CREATE INDEX IF NOT EXISTS idx_contest_problems_problem ON contest_problems(problem_id);

CREATE TABLE IF NOT EXISTS contest_registrations (
  contest_id    INTEGER NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (contest_id, user_id)
);
