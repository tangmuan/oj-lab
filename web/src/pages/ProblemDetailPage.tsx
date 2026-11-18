import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { marked } from 'marked';
import { api, ApiError, createStreamTicket, streamUrl } from '../api/client';
import type {
  CaseResult,
  JudgeStatus,
  LanguageId,
  LanguageMeta,
  ProblemDetail,
  RunResult,
  SubmissionDetail,
  SubmissionSummary,
  UserTemplate,
} from '../api/types';
import { StatusBadge } from '../components/StatusBadge';
import { CodeEditor } from '../components/CodeEditor';
import { ResultPanel, type LiveCase } from '../components/ResultPanel';
import { SelfTestPanel } from '../components/SelfTestPanel';
import { useAuth } from '../context/AuthContext';
import { DIFFICULTY_META, formatDateTime, formatMemory, formatTimeLimit, STATUS_META } from '../lib/format';
import { TEMPLATES } from '../lib/templates';

function codeKey(problemId: number, language: LanguageId) {
  return `oj_code_${problemId}_${language}`;
}

export function ProblemDetailPage() {
  const { id } = useParams();
  const problemId = Number(id);
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [data, setData] = useState<ProblemDetail | null>(null);
  const [languages, setLanguages] = useState<LanguageMeta[]>([]);
  const [templatesReady, setTemplatesReady] = useState(false);
  const [language, setLanguage] = useState<LanguageId>('cpp');
  const [code, setCode] = useState(TEMPLATES.cpp);
  const [error, setError] = useState('');

  const [status, setStatus] = useState<JudgeStatus | null>(null);
  const [cases, setCases] = useState<LiveCase[]>([]);
  const [timeMs, setTimeMs] = useState(0);
  const [memoryKb, setMemoryKb] = useState(0);
  const [passCount, setPassCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [compileMsg, setCompileMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [draftTip, setDraftTip] = useState('');

  const [mySubs, setMySubs] = useState<SubmissionSummary[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<number | null>(null);

  // 自测运行
  const [pane, setPane] = useState<'run' | 'result'>('run');
  const [selfInput, setSelfInput] = useState('');
  const [selfResult, setSelfResult] = useState<RunResult | null>(null);
  const [selfRunning, setSelfRunning] = useState(false);
  const [selfError, setSelfError] = useState('');
  const actionsRef = useRef<{ run: () => void; submit: () => void }>({ run: () => {}, submit: () => {} });

  const isRunning = status === 'PENDING' || status === 'JUDGING';

  /* ---------- 题目信息 ---------- */
  useEffect(() => {
    if (!Number.isInteger(problemId)) return;
    setData(null);
    setError('');
    api<ProblemDetail>(`/problems/${problemId}`)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : '题目加载失败'));
  }, [problemId]);

  useEffect(() => {
    api<{ languages: LanguageMeta[] }>('/meta/languages')
      .then((r) => setLanguages(r.languages))
      .catch(() => undefined);
  }, []);

  /** 用户自定义模板：与草稿箱同一套数据，题目页也按它初始化代码 */
  const customTemplatesRef = useRef<Partial<Record<LanguageId, string>>>({});
  const templateOf = useCallback(
    (lang: LanguageId) => customTemplatesRef.current[lang] ?? TEMPLATES[lang],
    []
  );

  useEffect(() => {
    if (!user) {
      customTemplatesRef.current = {};
      setTemplatesReady(true);
      return;
    }
    api<{ items: UserTemplate[] }>('/templates')
      .then((r) => {
        const map: Partial<Record<LanguageId, string>> = {};
        r.items.forEach((t) => {
          map[t.language] = t.content;
        });
        customTemplatesRef.current = map;
      })
      .catch(() => undefined)
      .finally(() => setTemplatesReady(true));
  }, [user]);

  /* ---------- 代码草稿 ---------- */
  useEffect(() => {
    if (!Number.isInteger(problemId) || !templatesReady) return;
    const saved = localStorage.getItem(codeKey(problemId, language));
    // 历史上「未改动过」也会被缓存成系统模板，这种缓存视为无效，改用当前模板
    const staleTemplate = saved !== null && Object.values(TEMPLATES).includes(saved);
    setCode(saved && !staleTemplate ? saved : templateOf(language));
  }, [problemId, language, templatesReady, templateOf]);

  useEffect(() => {
    if (!Number.isInteger(problemId)) return;
    const t = setTimeout(() => {
      const key = codeKey(problemId, language);
      // 内容与模板一致说明还没动过，不必缓存，否则会盖住用户后设的自定义模板
      if (code === templateOf(language)) localStorage.removeItem(key);
      else localStorage.setItem(key, code);
    }, 400);
    return () => clearTimeout(t);
  }, [code, language, problemId, templateOf]);

  /* ---------- 我的提交列表 ---------- */
  const loadMySubs = useCallback(() => {
    if (!user) {
      setMySubs([]);
      return;
    }
    api<{ items: SubmissionSummary[] }>(`/submissions?mine=1&problemId=${problemId}&pageSize=5`)
      .then((r) => setMySubs(r.items))
      .catch(() => undefined);
  }, [problemId, user]);

  useEffect(loadMySubs, [loadMySubs]);

  // 首个样例自动填进自测输入框，省一次复制粘贴
  useEffect(() => {
    if (!data) return;
    setSelfInput((prev) => (prev.trim() ? prev : data.samples[0]?.input ?? ''));
  }, [data]);

  /* ---------- 清理流 ---------- */
  const stopStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (pollRef.current) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopStream, [stopStream]);

  const appliedRef = useRef<Set<number>>(new Set());

  const applyDone = useCallback(
    (detail: SubmissionDetail) => {
      const s = detail.submission;
      setStatus(s.status);
      setCases(detail.cases as CaseResult[] as LiveCase[]);
      setTimeMs(s.time_ms);
      setMemoryKb(s.memory_kb);
      setPassCount(s.pass_count);
      setTotalCount(s.total_count);
      setCompileMsg(s.compile_msg);

      // 同一次提交可能经 SSE 与兜底轮询两次回调，用 ref 去重，避免统计被重复累加
      if (appliedRef.current.has(s.id)) return;
      appliedRef.current.add(s.id);

      setData((prev) => {
        if (!prev) return prev;
        const submitCount = prev.stats.submitCount + 1;
        const acCount = prev.stats.acCount + (s.status === 'AC' ? 1 : 0);
        return {
          ...prev,
          stats: {
            ...prev.stats,
            submitCount,
            acCount,
            acRate: submitCount > 0 ? Math.round((acCount / submitCount) * 1000) / 10 : null,
          },
          mine: {
            submitCount: prev.mine.submitCount + 1,
            lastStatus: s.status,
            solved: prev.mine.solved || s.status === 'AC',
          },
        };
      });
      loadMySubs();
    },
    [loadMySubs]
  );

  /* ---------- 兜底轮询（SSE 断线时用） ---------- */
  const startPolling = useCallback(
    (submissionId: number) => {
      const tick = async () => {
        try {
          const detail = await api<SubmissionDetail>(`/submissions/${submissionId}`);
          if (!['PENDING', 'JUDGING'].includes(detail.submission.status)) {
            applyDone(detail);
            return;
          }
          setStatus(detail.submission.status);
          setCases(detail.cases as CaseResult[] as LiveCase[]);
          pollRef.current = window.setTimeout(tick, 800);
        } catch {
          pollRef.current = window.setTimeout(tick, 1500);
        }
      };
      pollRef.current = window.setTimeout(tick, 600);
    },
    [applyDone]
  );

  /* ---------- 提交 ---------- */
  async function handleSubmit() {
    if (!user) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    if (!code.trim()) {
      setSubmitError('代码不能为空');
      return;
    }

    setSubmitting(true);
    setSubmitError('');
    setCases([]);
    setCompileMsg(null);
    setTimeMs(0);
    setMemoryKb(0);
    setPassCount(0);
    setTotalCount(0);
    setStatus('PENDING');
    stopStream();
    setPane('result');

    try {
      const created = await api<{ id: number; status: JudgeStatus }>('/submissions', {
        method: 'POST',
        body: { problemId, language, code },
      });

      // 换票失败不能把已经成功的提交报成「提交失败」，退回轮询兜底
      let ticket: string | null = null;
      try {
        ticket = await createStreamTicket(created.id);
      } catch {
        ticket = null;
      }
      if (!ticket) {
        startPolling(created.id);
        return;
      }

      const es = new EventSource(streamUrl(created.id, ticket));
      esRef.current = es;

      es.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as
          | { type: 'snapshot'; status: JudgeStatus; cases: LiveCase[] }
          | { type: 'status'; status: JudgeStatus }
          | { type: 'case'; case: LiveCase }
          | { type: 'done'; status: JudgeStatus; timeMs: number; memoryKb: number; passCount: number; totalCount: number; compileMsg: string | null };

        if (msg.type === 'snapshot') {
          setStatus(msg.status);
          setCases(msg.cases);
        } else if (msg.type === 'status') {
          setStatus(msg.status);
        } else if (msg.type === 'case') {
          setCases((prev) => {
            const merged = [...prev.filter((c) => c.case_index !== msg.case.case_index), msg.case].sort(
              (a, b) => a.case_index - b.case_index
            );
            // 判题过程中通过数跟着用例走，避免出现「通过 2/1」这类脏数据
            setPassCount(merged.filter((c) => c.status === 'AC').length);
            setTotalCount((t) => Math.max(t, merged.length));
            return merged;
          });
        } else if (msg.type === 'done') {
          setStatus(msg.status);
          setTimeMs(msg.timeMs ?? 0);
          setMemoryKb(msg.memoryKb ?? 0);
          setPassCount(msg.passCount ?? 0);
          setTotalCount(msg.totalCount ?? 0);
          setCompileMsg(msg.compileMsg ?? null);
          es.close();
          esRef.current = null;
          // 拉一次完整详情，保证样例/用例数据与数据库一致
          api<SubmissionDetail>(`/submissions/${created.id}`)
            .then(applyDone)
            .catch(() => undefined);
        }
      };

      es.onerror = () => {
        es.close();
        esRef.current = null;
        startPolling(created.id);
      };
    } catch (e) {
      setStatus(null);
      setSubmitError(e instanceof ApiError ? e.message : '提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  /** 自测运行：自定义输入跑一遍，不写提交记录 */
  async function runSelfTest() {
    if (!user) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    if (selfRunning) return;
    if (!code.trim()) {
      setSelfError('代码不能为空');
      return;
    }

    setSelfRunning(true);
    setSelfError('');
    setPane('run');
    try {
      const r = await api<RunResult>('/run', {
        method: 'POST',
        body: { problemId, language, code, input: selfInput },
      });
      setSelfResult(r);
    } catch (e) {
      setSelfResult(null);
      setSelfError(e instanceof ApiError ? e.message : '运行失败，请重试');
    } finally {
      setSelfRunning(false);
    }
  }

  /** 把当前代码整段存进草稿箱，之后可在「草稿箱」继续写 */
  async function saveToDrafts() {
    if (!user) {
      navigate('/login', { state: { from: location.pathname } });
      return;
    }
    if (!code.trim()) {
      setSubmitError('代码不能为空');
      return;
    }
    try {
      await api('/files', {
        method: 'POST',
        body: {
          title: `${data?.problem.title ?? '题目'} · ${language}`,
          language,
          content: code,
          last_input: selfInput,
          problem_id: problemId,
        },
      });
      setDraftTip('已存入草稿箱');
      setTimeout(() => setDraftTip(''), 2500);
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : '存入草稿箱失败');
    }
  }

  // Ctrl/Cmd + Enter 运行，加 Shift 提交  actionsRef.current = { run: () => void runSelfTest(), submit: () => void handleSubmit() };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) actionsRef.current.submit();
        else actionsRef.current.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const markdown = useMemo(() => {
    if (!data) return '';
    return marked.parse(data.problem.description || '_暂无题面描述_', { async: false }) as string;
  }, [data]);

  if (error) {
    return (
      <div className="card mx-auto mt-16 max-w-md p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900">{error}</h2>
        <Link to="/" className="btn-ghost mt-5 inline-flex">
          返回题目列表
        </Link>
      </div>
    );
  }

  if (!data) {
    return <div className="py-24 text-center text-sm text-slate-400">题目加载中…</div>;
  }

  const { problem, samples, stats, mine } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Link to="/" className="hover:text-slate-600">
          题目列表
        </Link>
        <span>/</span>
        <span className="text-slate-500">{problem.title}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 左：题面 */}
        <div className="card overflow-hidden">
          <div className="border-b border-slate-200 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-slate-400">#{String(problem.id).padStart(4, '0')}</span>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">{problem.title}</h1>
              <span className={`chip ${DIFFICULTY_META[problem.difficulty].className}`}>
                {DIFFICULTY_META[problem.difficulty].label}
              </span>
              {mine.solved && <span className="chip bg-emerald-50 text-emerald-700">已通过</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>
                时间限制 <b className="font-mono text-slate-700">{formatTimeLimit(problem.time_limit_ms)}</b>
              </span>
              <span>
                内存限制 <b className="font-mono text-slate-700">{problem.memory_limit_mb} MB</b>
              </span>
              <span>
                通过率{' '}
                <b className="font-mono text-slate-700">{stats.acRate === null ? '—' : `${stats.acRate}%`}</b>
                <span className="ml-1 text-slate-400">
                  ({stats.acCount}/{stats.submitCount})
                </span>
              </span>
              {user && (
                <span>
                  我的提交 <b className="text-slate-700">{mine.submitCount}</b>
                </span>
              )}
            </div>
          </div>

          <div className="max-h-[calc(100vh-13rem)] overflow-y-auto px-5 py-4">
            <div className="prose-oj" dangerouslySetInnerHTML={{ __html: markdown }} />

            {problem.input_format && (
              <section className="mt-5">
                <h3 className="text-sm font-semibold text-slate-900">输入格式</h3>
                <div className="prose-oj mt-1" dangerouslySetInnerHTML={{ __html: marked.parse(problem.input_format, { async: false }) as string }} />
              </section>
            )}
            {problem.output_format && (
              <section className="mt-4">
                <h3 className="text-sm font-semibold text-slate-900">输出格式</h3>
                <div className="prose-oj mt-1" dangerouslySetInnerHTML={{ __html: marked.parse(problem.output_format, { async: false }) as string }} />
              </section>
            )}

            {samples.length > 0 && (
              <section className="mt-5">
                <h3 className="mb-2 text-sm font-semibold text-slate-900">样例</h3>
                <div className="space-y-3">
                  {samples.map((s, idx) => (
                    <div key={s.id} className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <p className="mb-1 text-[11px] font-medium text-slate-400">输入 #{idx + 1}</p>
                        <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[12px] leading-5 text-slate-700">
                          {s.input}
                        </pre>
                      </div>
                      <div>
                        <p className="mb-1 text-[11px] font-medium text-slate-400">输出 #{idx + 1}</p>
                        <pre className="whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-2.5 font-mono text-[12px] leading-5 text-slate-700">
                          {s.expected_output}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {problem.hint && (
              <section className="mt-5 rounded-lg bg-amber-50/70 px-3.5 py-3">
                <h3 className="mb-1 text-sm font-semibold text-amber-800">提示</h3>
                <div className="prose-oj !text-[13px] !text-amber-900/80" dangerouslySetInnerHTML={{ __html: marked.parse(problem.hint, { async: false }) as string }} />
              </section>
            )}
          </div>
        </div>

        {/* 右：编辑器 + 结果 */}
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-2.5 flex flex-wrap items-center gap-2">
              <select
                className="input !w-auto !py-1.5 text-xs"
                value={language}
                onChange={(e) => setLanguage(e.target.value as LanguageId)}
              >
                {(languages.length ? languages : [{ id: 'cpp' as LanguageId, label: 'C++ (g++)' }]).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <span className="text-xs text-slate-400">
                {isRunning ? '判题进行中…' : draftTip ? <span className="text-emerald-600">{draftTip}</span> : '代码会自动保存在本机浏览器'}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button className="btn-ghost !px-2.5 !py-1.5 text-xs" onClick={() => void saveToDrafts()} title="把当前代码存进草稿箱">
                  存草稿
                </button>
                <button
                  className="btn-ghost !px-2.5 !py-1.5 text-xs"
                  onClick={() => {
                    if (confirm('确定重置为初始模板？当前代码将丢失。')) setCode(templateOf(language));
                  }}
                >
                  重置模板
                </button>
                <button
                  className="btn-ghost !px-3 !py-1.5 text-xs"
                  onClick={() => void runSelfTest()}
                  disabled={selfRunning || isRunning}
                  title="用左侧自测输入运行（Ctrl + Enter）"
                >
                  {selfRunning ? '运行中…' : '▶ 运行'}
                </button>
                <button className="btn-primary !px-4 !py-1.5 text-xs" onClick={handleSubmit} disabled={submitting || isRunning}>
                  {isRunning ? '判题中…' : submitting ? '提交中…' : user ? '提交代码' : '登录后提交'}
                </button>
              </div>
            </div>

            <CodeEditor value={code} language={language} onChange={setCode} height="430px" />

            {submitError && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{submitError}</p>}
          </div>

          {/* 自测 / 判题结果 切换 */}
          <div className="flex w-fit items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                pane === 'run' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setPane('run')}
            >
              自测运行
            </button>
            <button
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                pane === 'result' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
              onClick={() => setPane('result')}
            >
              判题结果
              {status && <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[status].dot}`} />}
            </button>
          </div>

          {pane === 'run' ? (
            <SelfTestPanel
              input={selfInput}
              onInputChange={setSelfInput}
              result={selfResult}
              running={selfRunning}
              error={selfError}
              samples={samples}
              onFillSample={setSelfInput}
            />
          ) : status ? (
            <ResultPanel
              status={status}
              cases={cases}
              timeMs={timeMs}
              memoryKb={memoryKb}
              passCount={passCount}
              totalCount={totalCount}
              compileMsg={compileMsg}
            />
          ) : (
            <div className="card p-8 text-center text-sm text-slate-400">
              还没有提交记录，写好代码后点「提交代码」，判题结果会实时显示在这里。
            </div>
          )}

          {mySubs.length > 0 && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                <h3 className="text-sm font-semibold text-slate-800">我的最近提交</h3>
                <Link to="/submissions" className="text-xs text-brand-600 hover:text-brand-700">
                  查看全部
                </Link>
              </div>
              <ul className="divide-y divide-slate-100">
                {mySubs.map((s) => (
                  <li key={s.id}>
                    <Link to={`/submissions/${s.id}`} className="flex items-center gap-3 px-4 py-2.5 text-xs hover:bg-slate-50">
                      <StatusBadge status={s.status} />
                      <span className="font-mono text-slate-500">{s.language}</span>
                      <span className="font-mono text-slate-400">{s.time_ms}ms</span>
                      <span className="font-mono text-slate-400">{formatMemory(s.memory_kb)}</span>
                      <span className="ml-auto text-slate-400">{formatDateTime(s.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-slate-400">
        判题状态码：{Object.keys(STATUS_META).slice(2, 8).map((k) => `${k} ${STATUS_META[k as JudgeStatus].label}`).join(' · ')}
      </p>
    </div>
  );
}
