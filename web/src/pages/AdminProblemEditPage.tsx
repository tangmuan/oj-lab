import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { AdminProblemDetail, Difficulty } from '../api/types';

interface FormState {
  title: string;
  difficulty: Difficulty;
  description: string;
  input_format: string;
  output_format: string;
  hint: string;
  time_limit_ms: string;
  memory_limit_mb: string;
  is_public: 0 | 1;
}

interface EditCase {
  id?: number;
  input: string;
  expected_output: string;
  is_sample: 0 | 1;
  ord: number;
}

const EMPTY_FORM: FormState = {
  title: '',
  difficulty: 'easy',
  description: '',
  input_format: '',
  output_format: '',
  hint: '',
  time_limit_ms: '1000',
  memory_limit_mb: '256',
  is_public: 1,
};

export function AdminProblemEditPage() {
  const { id } = useParams();
  const isNew = !id;
  const problemId = Number(id);
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [cases, setCases] = useState<EditCase[]>([{ input: '', expected_output: '', is_sample: 1, ord: 1 }]);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [initialIds, setInitialIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  useEffect(() => {
    if (isNew) {
      setForm(EMPTY_FORM);
      setCases([{ input: '', expected_output: '', is_sample: 1, ord: 1 }]);
      setInitialIds([]);
      setTags([]);
      return;
    }
    setLoading(true);
    api<AdminProblemDetail>(`/admin/problems/${problemId}`)
      .then((r) => {
        const p = r.problem;
        setForm({
          title: p.title,
          difficulty: p.difficulty,
          description: p.description,
          input_format: p.input_format,
          output_format: p.output_format,
          hint: p.hint,
          time_limit_ms: String(p.time_limit_ms),
          memory_limit_mb: String(p.memory_limit_mb),
          is_public: p.is_public as 0 | 1,
        });
        setCases(
          r.testcases.map((t) => ({
            id: t.id,
            input: t.input,
            expected_output: t.expected_output,
            is_sample: t.is_sample as 0 | 1,
            ord: t.ord,
          }))
        );
        setInitialIds(r.testcases.map((t) => t.id));
        setTags(r.tags);
        setError('');
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [problemId, isNew]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateCase(index: number, patch: Partial<EditCase>) {
    setCases((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addTag() {
    const name = tagInput.trim();
    if (!name) return;
    if (tags.some((t) => t.toLowerCase() === name.toLowerCase())) {
      setTagInput('');
      return;
    }
    if (tags.length >= 10) {
      setError('标签最多 10 个');
      return;
    }
    setTags((prev) => [...prev, name]);
    setTagInput('');
  }

  async function save() {
    setError('');
    setOkMsg('');
    if (!form.title.trim()) {
      setError('标题不能为空');
      return;
    }
    if (cases.some((c) => !c.expected_output.trim() && !c.input.trim())) {
      setError('存在空的测试点，请填写或删除它');
      return;
    }

    setSaving(true);
    try {
      const payload = { ...form, time_limit_ms: Number(form.time_limit_ms), memory_limit_mb: Number(form.memory_limit_mb) };

      if (isNew) {
        const created = await api<{ id: number }>('/admin/problems', {
          method: 'POST',
          body: { ...payload, tags, testcases: cases.map((c, i) => ({ ...c, ord: i + 1 })) },
        });
        navigate(`/admin/problems/${created.id}/edit`, { replace: true });
        setOkMsg('题目已创建');
        return;
      }

      await api(`/admin/problems/${problemId}`, { method: 'PUT', body: { ...payload, tags } });

      // 测试点差量同步：改 → 新增 → 删
      for (const [i, c] of cases.entries()) {
        const body = { input: c.input, expected_output: c.expected_output, is_sample: c.is_sample, ord: i + 1 };
        if (c.id) await api(`/admin/testcases/${c.id}`, { method: 'PUT', body });
        else await api(`/admin/problems/${problemId}/testcases`, { method: 'POST', body });
      }
      const keepIds = new Set(cases.map((c) => c.id).filter(Boolean) as number[]);
      for (const oldId of initialIds) {
        if (!keepIds.has(oldId)) await api(`/admin/testcases/${oldId}`, { method: 'DELETE' });
      }

      // 重新拉取，拿到新建测试点的真实 ID
      const fresh = await api<AdminProblemDetail>(`/admin/problems/${problemId}`);
      setCases(
        fresh.testcases.map((t) => ({
          id: t.id,
          input: t.input,
          expected_output: t.expected_output,
          is_sample: t.is_sample as 0 | 1,
          ord: t.ord,
        }))
      );
      setInitialIds(fresh.testcases.map((t) => t.id));
      setOkMsg('已保存');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="py-24 text-center text-sm text-slate-400 dark:text-slate-500">加载中…</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <Link to="/admin" className="hover:text-slate-600 dark:hover:text-slate-300">
          管理端
        </Link>
        <span>/</span>
        <span className="text-slate-500 dark:text-slate-400">{isNew ? '新建题目' : `编辑 #${problemId}`}</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">{isNew ? '新建题目' : `编辑题目 #${problemId}`}</h1>
        <div className="flex gap-2">
          {!isNew && (
            <Link to={`/problems/${problemId}`} className="btn-ghost !py-1.5 text-xs" target="_blank">
              预览题目页
            </Link>
          )}
          <button className="btn-primary !py-1.5 text-xs" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-600">{error}</p>}
      {okMsg && <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{okMsg}</p>}

      <div className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">基本信息</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">标题</label>
            <input className="input" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="例如：A+B Problem" />
          </div>
          <div>
            <label className="label">难度</label>
            <select className="input" value={form.difficulty} onChange={(e) => set('difficulty', e.target.value as Difficulty)}>
              <option value="easy">简单</option>
              <option value="medium">中等</option>
              <option value="hard">困难</option>
            </select>
          </div>
          <div>
            <label className="label">可见性</label>
            <select
              className="input"
              value={form.is_public}
              onChange={(e) => set('is_public', Number(e.target.value) as 0 | 1)}
            >
              <option value={1}>公开（用户可见）</option>
              <option value={0}>隐藏（仅管理员）</option>
            </select>
          </div>
          <div>
            <label className="label">时间限制（ms）</label>
            <input
              type="number"
              className="input"
              value={form.time_limit_ms}
              min={100}
              max={20000}
              onChange={(e) => set('time_limit_ms', e.target.value)}
            />
          </div>
          <div>
            <label className="label">内存限制（MB）</label>
            <input
              type="number"
              className="input"
              value={form.memory_limit_mb}
              min={16}
              max={1024}
              onChange={(e) => set('memory_limit_mb', e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label">标签（最多 10 个，输入后按回车）</label>
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-900">
              {tags.map((t) => (
                <span key={t} className="chip bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                  {t}
                  <button
                    type="button"
                    className="ml-1.5 text-brand-400 hover:text-brand-700 dark:hover:text-brand-200"
                    onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                    aria-label={`删除标签 ${t}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                className="min-w-[140px] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none dark:text-slate-200"
                value={tagInput}
                placeholder={tags.length >= 10 ? '已达上限' : '例如：动态规划'}
                disabled={tags.length >= 10}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">题面</h2>
          <span className="text-xs text-slate-400 dark:text-slate-500">支持 Markdown</span>
        </div>
        <div>
          <label className="label">题目描述</label>
          <textarea
            className="input min-h-[160px] font-mono text-xs leading-6"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder={'输入两个整数 a 和 b，输出它们的和。\n\n> 建议说明数据范围，例如：-1e9 ≤ a,b ≤ 1e9'}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label">输入格式</label>
            <textarea className="input min-h-[90px] text-xs leading-6" value={form.input_format} onChange={(e) => set('input_format', e.target.value)} />
          </div>
          <div>
            <label className="label">输出格式</label>
            <textarea className="input min-h-[90px] text-xs leading-6" value={form.output_format} onChange={(e) => set('output_format', e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">提示（可选）</label>
          <textarea className="input min-h-[70px] text-xs leading-6" value={form.hint} onChange={(e) => set('hint', e.target.value)} />
        </div>
      </div>

      <div className="card space-y-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">测试点</h2>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">勾选「样例」的测试点会在题面公开展示输入输出</p>
          </div>
          <button
            className="btn-ghost !py-1.5 text-xs"
            onClick={() => setCases((prev) => [...prev, { input: '', expected_output: '', is_sample: 0, ord: prev.length + 1 }])}
          >
            + 添加测试点
          </button>
        </div>

        {cases.length === 0 && <p className="rounded-lg bg-amber-50 px-3 py-3 text-xs text-amber-700">没有测试点，提交会全部判为系统错误。</p>}

        {cases.map((c, i) => (
          <div key={c.id ?? `new-${i}`} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
            <div className="mb-2 flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">测试点 {i + 1}</span>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <input
                  type="checkbox"
                  checked={c.is_sample === 1}
                  onChange={(e) => updateCase(i, { is_sample: e.target.checked ? 1 : 0 })}
                  className="h-3.5 w-3.5 rounded border-slate-300 dark:border-slate-600 text-brand-600"
                />
                样例
              </label>
              {!c.id && <span className="chip bg-brand-50 text-brand-600">未保存</span>}
              <button
                className="ml-auto text-xs text-rose-500 hover:text-rose-600"
                onClick={() => setCases((prev) => prev.filter((_, idx) => idx !== i))}
              >
                删除
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-[11px] text-slate-400 dark:text-slate-500">输入</label>
                <textarea
                  className="input min-h-[80px] font-mono text-xs leading-5"
                  value={c.input}
                  onChange={(e) => updateCase(i, { input: e.target.value })}
                />
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-slate-400 dark:text-slate-500">期望输出</label>
                <textarea
                  className="input min-h-[80px] font-mono text-xs leading-5"
                  value={c.expected_output}
                  onChange={(e) => updateCase(i, { expected_output: e.target.value })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pb-6">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存题目'}
        </button>
      </div>
    </div>
  );
}
