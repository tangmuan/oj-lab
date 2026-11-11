import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { SubmissionDetail } from '../api/types';
import { CodeEditor } from '../components/CodeEditor';
import { ResultPanel } from '../components/ResultPanel';
import { formatDateTime, formatTimeLimit, DIFFICULTY_META } from '../lib/format';
import type { ProblemDetail } from '../api/types';

export function SubmissionDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<SubmissionDetail | null>(null);
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [error, setError] = useState('');

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

  if (error) {
    return (
      <div className="card mx-auto mt-16 max-w-md p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900">{error}</h2>
        <Link to="/submissions" className="btn-ghost mt-5 inline-flex">
          返回提交列表
        </Link>
      </div>
    );
  }
  if (!detail) return <div className="py-24 text-center text-sm text-slate-400">加载中…</div>;

  const s = detail.submission;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Link to="/submissions" className="hover:text-slate-600">
          我的提交
        </Link>
        <span>/</span>
        <span className="text-slate-500">#{s.id}</span>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
            <Link to={`/problems/${s.problem_id}`} className="hover:text-brand-600">
              {s.problemTitle}
            </Link>
            {problem && (
              <span className={`chip ${DIFFICULTY_META[problem.problem.difficulty].className}`}>
                {DIFFICULTY_META[problem.problem.difficulty].label}
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
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
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800">提交代码</h2>
          <span className="text-xs text-slate-400">{s.codeHidden ? '仅本人或管理员可见' : `${s.code.split('\n').length} 行`}</span>
        </div>
        {s.codeHidden ? (
          <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">代码不可见</p>
        ) : (
          <CodeEditor value={s.code} language={s.language} readOnly height="360px" />
        )}
      </div>
    </div>
  );
}
