import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { LanguageId, LanguageMeta, UserFile } from '../api/types';
import { CodeEditor } from './CodeEditor';
import { LANGUAGE_LABEL, TEMPLATES } from '../lib/templates';

interface Props {
  open: boolean;
  languages: LanguageMeta[];
  /** 当前用户已保存的自定义模板 */
  custom: Partial<Record<LanguageId, string>>;
  initialLanguage: LanguageId;
  activeFile: UserFile | null;
  onClose: () => void;
  /** 保存/恢复默认后回调，null 表示删除自定义、回退系统默认 */
  onChanged: (language: LanguageId, content: string | null) => void;
}

export function TemplateModal({ open, languages, custom, initialLanguage, activeFile, onClose, onChanged }: Props) {
  const [language, setLanguage] = useState<LanguageId>(initialLanguage);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tip, setTip] = useState('');

  const isCustom = custom[language] !== undefined;

  useEffect(() => {
    if (!open) return;
    setLanguage(initialLanguage);
    setError('');
    setTip('');
  }, [open, initialLanguage]);

  useEffect(() => {
    if (!open) return;
    setContent(custom[language] ?? TEMPLATES[language]);
  }, [open, language, custom]);

  if (!open) return null;

  async function save() {
    setSaving(true);
    setError('');
    setTip('');
    try {
      await api(`/templates/${language}`, { method: 'PUT', body: { content } });
      onChanged(language, content);
      setTip('已保存，之后新建该语言文件会自动使用它');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function resetDefault() {
    if (!isCustom) {
      setContent(TEMPLATES[language]);
      return;
    }
    if (!confirm(`恢复 ${LANGUAGE_LABEL[language]} 的系统默认模板？你的自定义内容会被删除。`)) return;
    setSaving(true);
    setError('');
    try {
      await api(`/templates/${language}`, { method: 'DELETE' });
      onChanged(language, null);
      setContent(TEMPLATES[language]);
      setTip('已恢复系统默认模板');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '恢复失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div
        className="card w-full max-w-2xl overflow-hidden p-0"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-center gap-3 border-b border-slate-200 dark:border-slate-700 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">自定义语言模板</h2>
          <span className="text-xs text-slate-400 dark:text-slate-500">新建文件时自动套用</span>
          <button className="ml-auto text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="input !w-auto !py-1.5 text-xs"
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageId)}
            >
              {languages.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                  {custom[l.id] !== undefined ? ' · 已自定义' : ''}
                </option>
              ))}
            </select>
            <span className={`chip ${isCustom ? 'bg-brand-50 text-brand-700' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
              {isCustom ? '使用自定义模板' : '使用系统默认模板'}
            </span>
            {activeFile && (
              <button
                className="btn-ghost !px-2.5 !py-1 text-[11px]"
                onClick={() => setContent(activeFile.content)}
                title="把当前打开的文件内容填进来作为模板"
              >
                填入当前文件
              </button>
            )}
          </div>

          <CodeEditor value={content} language={language} onChange={setContent} height="300px" />

          <p className="text-[11px] leading-5 text-slate-400 dark:text-slate-500">
            模板只影响「新建文件」的初始内容，不会改动已有文件；每个账号每种语言各自保存一份。
          </p>

          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">{error}</p>}
          {tip && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{tip}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40 px-5 py-3">
          <button className="btn-ghost !py-1.5 text-xs" onClick={resetDefault} disabled={saving}>
            {isCustom ? '恢复系统默认' : '重置为默认内容'}
          </button>
          <button className="btn-primary !py-1.5 text-xs" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存模板'}
          </button>
        </div>
      </div>
    </div>
  );
}
