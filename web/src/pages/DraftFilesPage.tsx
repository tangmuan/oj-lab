import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, getToken } from '../api/client';
import type { LanguageId, LanguageMeta, RunResult, UserFile, UserFileSummary, UserTemplate } from '../api/types';
import { CodeEditor } from '../components/CodeEditor';
import { SelfTestPanel } from '../components/SelfTestPanel';
import { TemplateModal } from '../components/TemplateModal';
import { formatDateTime } from '../lib/format';
import { LANGUAGE_EXT, LANGUAGE_LABEL, TEMPLATES } from '../lib/templates';

const LAST_FILE_KEY = 'oj_last_file_id';
const SAVE_DELAY_MS = 700;

type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface DraftCache {
  content: string;
  title: string;
  language: LanguageId;
  last_input: string;
  ts: number;
}

/**
 * 本地镜像：每次输入同步写入 localStorage。
 * 作用是在「刚敲完就关页面 / 断网」时也不会丢内容——恢复时若本地比服务端新，回填并补存。
 */
const cacheKey = (id: number) => `oj_draft_cache_${id}`;

function readCache(id: number): DraftCache | null {
  try {
    const raw = localStorage.getItem(cacheKey(id));
    return raw ? (JSON.parse(raw) as DraftCache) : null;
  } catch {
    return null;
  }
}

function writeCache(file: UserFile): void {
  try {
    const cache: DraftCache = {
      content: file.content,
      title: file.title,
      language: file.language,
      last_input: file.last_input,
      ts: Date.now(),
    };
    localStorage.setItem(cacheKey(file.id), JSON.stringify(cache));
  } catch {
    /* 超出配额时忽略，服务端保存仍然有效 */
  }
}

function clearCache(id: number): void {
  try {
    localStorage.removeItem(cacheKey(id));
  } catch {
    /* ignore */
  }
}

export function DraftFilesPage() {
  const [items, setItems] = useState<UserFileSummary[]>([]);
  const [active, setActive] = useState<UserFile | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [error, setError] = useState('');
  const [keyword, setKeyword] = useState('');
  const [creating, setCreating] = useState(false);
  const [newLanguage, setNewLanguage] = useState<LanguageId>('cpp');
  const [languages, setLanguages] = useState<LanguageMeta[]>([]);
  const [customTemplates, setCustomTemplates] = useState<Partial<Record<LanguageId, string>>>({});
  const [templateOpen, setTemplateOpen] = useState(false);

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [lastSavedAt, setLastSavedAt] = useState('');

  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState('');

  const activeRef = useRef<UserFile | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    api<{ languages: LanguageMeta[] }>('/meta/languages')
      .then((r) => setLanguages(r.languages))
      .catch(() => undefined);

    api<{ items: UserTemplate[] }>('/templates')
      .then((r) => {
        const map: Partial<Record<LanguageId, string>> = {};
        r.items.forEach((t) => {
          map[t.language] = t.content;
        });
        setCustomTemplates(map);
      })
      .catch(() => undefined);
  }, []);

  /** 新建文件用哪个模板：用户自定义优先，否则系统默认 */
  const templateFor = useCallback(
    (lang: LanguageId) => customTemplates[lang] ?? TEMPLATES[lang],
    [customTemplates]
  );

  /* ---------------- 保存 ---------------- */

  const flushSave = useCallback(async () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const cur = activeRef.current;
    if (!cur || !dirtyRef.current) return;

    dirtyRef.current = false;
    setSaveState('saving');
    try {
      const r = await api<{ file: UserFile }>(`/files/${cur.id}`, {
        method: 'PUT',
        body: {
          title: cur.title,
          language: cur.language,
          content: cur.content,
          last_input: cur.last_input,
        },
      });
      const merged = { ...cur, updated_at: r.file.updated_at };
      activeRef.current = merged;
      clearCache(cur.id);
      setActive((prev) => (prev && prev.id === merged.id ? { ...prev, updated_at: merged.updated_at } : prev));
      setSaveState('saved');
      setLastSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      setItems((prev) =>
        prev.map((i) =>
          i.id === merged.id
            ? {
                ...i,
                title: merged.title,
                language: merged.language,
                char_count: merged.content.length,
                input_len: merged.last_input.length,
                updated_at: merged.updated_at,
              }
            : i
        )
      );
      setError('');
    } catch (e) {
      dirtyRef.current = true;
      setSaveState('error');
      setError(e instanceof ApiError ? e.message : '保存失败，检查网络后重试');
    }
  }, []);

  /** 编辑即排队保存：停止输入 700ms 后落库 */
  function applyEdit(patch: Partial<UserFile>) {
    const cur = activeRef.current;
    if (!cur) return;
    const next = { ...cur, ...patch };
    activeRef.current = next;
    setActive(next);
    writeCache(next);

    dirtyRef.current = true;
    setSaveState('pending');
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void flushSave(), SAVE_DELAY_MS);
  }

  /* ---------------- 列表与打开 ---------------- */

  const loadList = useCallback(async () => {
    const r = await api<{ items: UserFileSummary[] }>('/files');
    setItems(r.items);
    return r.items;
  }, []);

  const openFile = useCallback(
    async (id: number) => {
      await flushSave();
      setFileLoading(true);
      setError('');
      try {
        const r = await api<{ file: UserFile }>(`/files/${id}`);
        activeRef.current = r.file;
        dirtyRef.current = false;
        setActive(r.file);
        setSaveState('idle');
        setLastSavedAt('');
        setRunResult(null);
        setRunError('');
        localStorage.setItem(LAST_FILE_KEY, String(id));

        // 本地镜像比服务端新 → 上次没来得及落库（直接关页面），这里回填并立刻补存
        const cached = readCache(id);
        const serverTs = Date.parse(`${r.file.updated_at.replace(' ', 'T')}Z`);
        if (cached && cached.ts > serverTs + 1500) {
          const merged: UserFile = {
            ...r.file,
            content: cached.content,
            title: cached.title || r.file.title,
            language: cached.language || r.file.language,
            last_input: cached.last_input ?? r.file.last_input,
          };
          activeRef.current = merged;
          setActive(merged);
          dirtyRef.current = true;
          setSaveState('pending');
          void flushSave();
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : '文件打开失败');
      } finally {
        setFileLoading(false);
      }
    },
    [flushSave]
  );

  // 首次进入：优先恢复上次打开的文件
  useEffect(() => {
    void (async () => {
      try {
        const list = await loadList();
        const lastId = Number(localStorage.getItem(LAST_FILE_KEY) || 0);
        const target = list.find((f) => f.id === lastId) ?? list[0];
        if (target) await openFile(target.id);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : '草稿箱加载失败');
      } finally {
        setListLoading(false);
      }
    })();
  }, [loadList, openFile]);

  // 关闭页面/切换路由时，把未落库的改动补存一次
  useEffect(() => {
    const handler = () => {
      const cur = activeRef.current;
      if (!cur || !dirtyRef.current) return;
      const token = getToken();
      if (!token) return;
      fetch(`/api/files/${cur.id}`, {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: cur.title,
          language: cur.language,
          content: cur.content,
          last_input: cur.last_input,
        }),
      }).catch(() => undefined);
    };
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      void flushSave();
    };
  }, [flushSave]);

  /* ---------------- 增删 ---------------- */

  async function createFile() {
    setCreating(true);
    setError('');
    try {
      await flushSave();
      const lang = newLanguage;
      const r = await api<{ file: UserFile }>('/files', {
        method: 'POST',
        body: {
          title: `未命名.${LANGUAGE_EXT[lang]}`,
          language: lang,
          content: templateFor(lang),
        },
      });
      const f = r.file;
      setItems((prev) => [
        {
          id: f.id,
          title: f.title,
          language: f.language,
          problem_id: f.problem_id,
          created_at: f.created_at,
          updated_at: f.updated_at,
          char_count: f.content.length,
          input_len: 0,
        },
        ...prev,
      ]);
      activeRef.current = f;
      dirtyRef.current = false;
      setActive(f);
      setSaveState('saved');
      setLastSavedAt(new Date().toLocaleTimeString('zh-CN', { hour12: false }));
      setRunResult(null);
      setRunError('');
      localStorage.setItem(LAST_FILE_KEY, String(f.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '新建文件失败');
    } finally {
      setCreating(false);
    }
  }

  async function deleteFile(file: UserFile) {
    if (!confirm(`删除「${file.title}」？删除后不可恢复。`)) return;
    try {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      await api(`/files/${file.id}`, { method: 'DELETE' });
      clearCache(file.id);
      dirtyRef.current = false;
      const rest = items.filter((i) => i.id !== file.id);
      setItems(rest);
      if (activeRef.current?.id === file.id) {
        activeRef.current = null;
        setActive(null);
        localStorage.removeItem(LAST_FILE_KEY);
        if (rest[0]) await openFile(rest[0].id);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '删除失败');
    }
  }

  /* ---------------- 运行 ---------------- */

  async function runDraft() {
    const cur = activeRef.current;
    if (!cur || running) return;
    if (!cur.content.trim()) {
      setRunError('代码不能为空');
      return;
    }
    setRunning(true);
    setRunError('');
    try {
      const r = await api<RunResult>('/run', {
        method: 'POST',
        body: { language: cur.language, code: cur.content, input: cur.last_input },
      });
      setRunResult(r);
    } catch (e) {
      setRunResult(null);
      setRunError(e instanceof ApiError ? e.message : '运行失败，请重试');
    } finally {
      setRunning(false);
    }
  }

  /** 切换语言：内容为空或还是旧模板时，自动换成新语言模板 */
  function changeLanguage(next: LanguageId) {
    const cur = activeRef.current;
    if (!cur || cur.language === next) return;
    const isTemplate = !cur.content.trim() || cur.content === templateFor(cur.language);
    applyEdit({ language: next, ...(isTemplate ? { content: templateFor(next) } : {}) });
  }

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return items;
    return items.filter((i) => i.title.toLowerCase().includes(kw) || LANGUAGE_LABEL[i.language].toLowerCase().includes(kw));
  }, [items, keyword]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">草稿箱</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">在这里自建任意语言的代码文件，边写边自动保存，关掉浏览器再打开还是原样</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-ghost !py-1.5 text-xs" onClick={() => setTemplateOpen(true)} title="设置各语言的初始模板">
            模板设置
          </button>
          <select
            className="input !w-auto !py-1.5 text-xs"
            value={newLanguage}
            onChange={(e) => setNewLanguage(e.target.value as LanguageId)}
          >
            {(languages.length ? languages : [{ id: 'cpp' as LanguageId, label: 'C++ (g++)' }]).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
                {customTemplates[l.id] !== undefined ? ' · 自定义' : ''}
              </option>
            ))}
          </select>
          <button className="btn-primary !py-1.5 text-xs" onClick={createFile} disabled={creating}>
            {creating ? '创建中…' : '+ 新建文件'}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* 文件列表 */}
        <aside className="card flex max-h-[calc(100vh-12rem)] flex-col overflow-hidden">
          <div className="border-b border-slate-200 dark:border-slate-700 p-2.5">
            <input className="input !py-1.5 text-xs" placeholder="搜索文件名" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </div>
          <div className="flex-1 overflow-y-auto">
            {listLoading && <p className="p-4 text-center text-xs text-slate-400 dark:text-slate-500">加载中…</p>}
            {!listLoading && filtered.length === 0 && (
              <p className="p-6 text-center text-xs leading-5 text-slate-400 dark:text-slate-500">
                {items.length === 0 ? '还没有文件\n点右上角「新建文件」开始' : '没有匹配的文件'}
              </p>
            )}
            <ul className="divide-y divide-slate-100">
              {filtered.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => void openFile(f.id)}
                    className={`w-full px-3 py-2.5 text-left transition ${
                      active?.id === f.id ? 'bg-brand-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active?.id === f.id ? 'bg-brand-500' : 'bg-slate-300'}`} />
                      <span className={`truncate text-sm ${active?.id === f.id ? 'font-medium text-brand-700' : 'text-slate-700 dark:text-slate-300'}`}>
                        {f.title}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 pl-3 text-[11px] text-slate-400 dark:text-slate-500">
                      <span className="rounded bg-slate-100 dark:bg-slate-800 px-1 text-slate-500 dark:text-slate-400">{LANGUAGE_LABEL[f.language]}</span>
                      <span>{f.char_count} 字</span>
                      <span className="ml-auto">{formatDateTime(f.updated_at).slice(5, 16)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-t border-slate-200 dark:border-slate-700 px-3 py-2 text-[11px] text-slate-400 dark:text-slate-500">共 {items.length} 个文件 · 已存服务端</div>
        </aside>

        {/* 编辑器 */}
        <section className="space-y-4">
          {fileLoading && <div className="card p-10 text-center text-sm text-slate-400 dark:text-slate-500">打开中…</div>}

          {!fileLoading && !active && (
            <div className="card grid place-items-center p-16 text-center">
              <div>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">草稿箱是空的</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">新建一个文件，随便写点什么，它会自动保存</p>
                <button className="btn-primary mt-4 !py-1.5 text-xs" onClick={createFile}>
                  + 新建文件
                </button>
              </div>
            </div>
          )}

          {!fileLoading && active && (
            <>
              <div className="card p-4">
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <input
                    className="input !w-auto min-w-[10rem] max-w-[18rem] flex-1 !py-1.5 text-sm font-medium"
                    value={active.title}
                    onChange={(e) => applyEdit({ title: e.target.value })}
                    placeholder="文件名"
                  />
                  <select
                    className="input !w-auto !py-1.5 text-xs"
                    value={active.language}
                    onChange={(e) => changeLanguage(e.target.value as LanguageId)}
                  >
                    {(languages.length ? languages : [{ id: active.language, label: LANGUAGE_LABEL[active.language] }]).map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.label}
                      </option>
                    ))}
                  </select>

                  <span className="min-w-[5.5rem] text-xs">
                    {saveState === 'pending' && <span className="text-slate-400 dark:text-slate-500">未保存…</span>}
                    {saveState === 'saving' && <span className="text-slate-400 dark:text-slate-500">保存中…</span>}
                    {saveState === 'saved' && <span className="text-emerald-600">已保存 {lastSavedAt}</span>}
                    {saveState === 'error' && (
                      <button className="text-rose-600 underline" onClick={() => void flushSave()}>
                        保存失败，重试
                      </button>
                    )}
                  </span>

                  <div className="ml-auto flex items-center gap-2">
                    <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => void runDraft()} disabled={running}>
                      {running ? '运行中…' : '▶ 运行'}
                    </button>
                    <button className="btn-danger !px-2.5 !py-1.5 text-xs" onClick={() => void deleteFile(active)}>
                      删除
                    </button>
                  </div>
                </div>

                <CodeEditor
                  value={active.content}
                  language={active.language}
                  onChange={(v) => applyEdit({ content: v })}
                  height="400px"
                />

                {active.problem_id && (
                  <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                    关联题目：
                    <Link to={`/problems/${active.problem_id}`} className="text-brand-600 hover:text-brand-700">
                      #{active.problem_id}
                    </Link>
                  </p>
                )}
              </div>

              <SelfTestPanel
                input={active.last_input}
                onInputChange={(v) => applyEdit({ last_input: v })}
                result={runResult}
                running={running}
                error={runError}
                samples={[]}
                onFillSample={() => undefined}
                showSampleShortcuts={false}
              />
            </>
          )}
        </section>
      </div>

      <TemplateModal
        open={templateOpen}
        languages={languages.length ? languages : [{ id: 'cpp' as LanguageId, label: 'C++ (g++)' }]}
        custom={customTemplates}
        initialLanguage={active?.language ?? newLanguage}
        activeFile={active}
        onClose={() => setTemplateOpen(false)}
        onChanged={(language, content) => {
          setCustomTemplates((prev) => {
            const next = { ...prev };
            if (content === null) delete next[language];
            else next[language] = content;
            return next;
          });
        }}
      />
    </div>
  );
}
