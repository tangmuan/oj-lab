import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { Paginated, ProblemDetail, SubmissionDetail, SubmissionSummary } from '../api/types';
import { CodeDiffView } from '../components/CodeDiffView';
import { CodeEditor } from '../components/CodeEditor';
import { ResultPanel } from '../components/ResultPanel';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, formatTimeLimit, DIFFICULTY_META } from '../lib/format';

interface PrevSubmission {
  id: number;
  created_at: string;
  code: string;
}

export function SubmissionDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [error, setError] = useState('');

  const [prevId, setPrevId] = useState<number | null>(null);
  const [prev, setPrev] = useState<PrevSubmission | null>(null);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState('');

  useEffect(() => {
    const sid = Number(id);
    if (!Number.isInteger(sid)) return;
    api<SubmissionDetail>(`/submissions/${sid}`)
      .then((d) => {
        setDetail(d);
        return api<ProblemDetail>(`/problems/${d.submission.problem_id}`);
      })
      .then(setProblem)
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'));
  }, [id]);

  // 找同一个人的上一条提交：自己的用 mine=1，管理员看别人时按 userId 限定，权限由后端复核
  useEffect(() => {
    if (!detail || !user) return;
    const s = detail.submission;
    if (s.codeHidden) return;

    const qs = new URLSearchParams({
      problemId: String(s.problem_id),
      beforeId: String(s.id),
      pageSize: '1',
    });
    if (s.user_id === user.id) qs.set('mine', '1');
    else qs.set('userId', String(s.user_id));

    let alive = true;
    api<Paginated<SubmissionSummary>>(`/submissions?${qs.toString()}`)
      .then((r) => {
        if (alive) setPrevId(r.items[0]?.id ?? null);
      })
      .catch(() => {
        if (alive) setPrevId(null);
      });
    return () => {
      alive = false;
    };
  }, [detail, user]);

  async function toggleDiff(): Promise<void> {
    if (diffOpen) {
      setDiffOpen(false);
      return;
    }
    if (!prevId) return;
    setDiffLoading(true);
    setDiffError('');
    try {
      const d = await api<SubmissionDetail>(`/submissions/${prevId}`);
      if (d.submission.codeHidden) {
        setDiffError('上一条提交的代码不可见');
        return;
      }
      setPrev({ id: d.submission.id, created_at: d.submission.created_at, code: d.submission.code });
      setDiffOpen(true);
    } catch (e) {
      setDiffError(e instanceof ApiError ? e.message : '加载上一条提交失败');
    } finally {
      setDiffLoading(false);
    }
  }

  if (error) {
    return (
      <div className="card mx-auto mt-16 max-w-md p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{error}</h2>
        <Link to="/submissions" className="btn-ghost mt-5 inline-flex">
          返回提交列表
        </Link>
      </div>
    );
  }
  if (!detail) return <div className="py-24 text-center text-sm text-slate-400 dark:text-slate-500">加载中…</div>;

  const s = detail.submission;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <Link to="/submissions" className="hover:text-slate-600 dark:hover:text-slate-300">
          我的提交
        </Link>
        <span>/</span>
        <span className="text-slate-500 dark:text-slate-400">#{s.id}</span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            <Link to={`/problems/${s.problem_id}`} className="hover:text-brand-600 dark:hover:text-brand-400">
              {s.problemTitle}
            </Link>
            {problem && (
              <span className={`chip ${DIFFICULTY_META[problem.problem.difficulty].className}`}>
                {DIFFICULTY_META[problem.problem.difficulty].label}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {s.username} · {s.language} · {formatDateTime(s.created_at)}
            {problem && ` · 限制 ${formatTimeLimit(problem.problem.time_limit_ms)} / ${problem.problem.memory_limit_mb} MB`}
          </p>
        </div>
        <Link to={`/problems/${s.problem_id}`} className="btn-ghost !py-1.5 text-xs">
          再做一次
        </Link>
      </div>

      <ResultPanel
        status={s.status}
        cases={detail.cases}
        timeMs={s.time_ms}
        memoryKb={s.memory_kb}
        passCount={s.pass_count}
        totalCount={s.total_count}
        compileMsg={s.compile_msg}
      />

      <div className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">提交代码</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400 dark:text-slate-500">{s.codeHidden ? '仅本人或管理员可见' : `${s.code.split('\n').length} 行`}</span>
            {!s.codeHidden &&
              (prevId ? (
                <button className="btn-ghost !py-1.5 text-xs" onClick={toggleDiff} disabled={diffLoading}>
                  {diffLoading ? '加载中…' : diffOpen ? '收起对比' : '与上次提交对比'}
                </button>
              ) : (
                <span className="text-xs text-slate-400 dark:text-slate-500">该题首次提交，暂无可对比记录</span>
              ))}
          </div>
        </div>

        {diffError && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{diffError}</p>}

        {s.codeHidden ? (
          <p className="rounded-lg bg-slate-50 dark:bg-slate-800/50 px-3 py-6 text-center text-sm text-slate-400 dark:bg-slate-800/60 dark:text-slate-500">代码不可见</p>
        ) : (
          <CodeEditor value={s.code} language={s.language} readOnly height="360px" />
        )}

        {diffOpen && prev && !s.codeHidden && (
          <div className="mt-4">
            <CodeDiffView
              oldCode={prev.code}
              newCode={s.code}
              oldLabel={`#${prev.id} · ${formatDateTime(prev.created_at)}`}
              newLabel={`#${s.id} · ${formatDateTime(s.created_at)}`}
            />
          </div>
        )}
      </div>
    </div>
  );
}
