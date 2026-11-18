import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';

export function LoginPage() {
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || '/';

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user) navigate(from, { replace: true });
  }, [user, from, navigate]);

  if (user) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (mode === 'register' && password !== confirm) {
      setError('两次输入的密码不一致');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'login') await login(username.trim(), password);
      else await register(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '网络异常，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-800/50">
      {/* 左侧品牌区 */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-slate-900 dark:bg-slate-950 p-12 text-white lg:flex">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-emerald-500/20 blur-3xl" />
        <Link to="/" className="relative flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-sm font-bold">OJ</span>
          <span className="text-lg font-semibold tracking-tight">OJ Lab</span>
        </Link>
        <div className="relative">
          <h1 className="text-4xl font-semibold leading-tight tracking-tight">
            写代码，
            <br />
            看它跑起来。
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-6 text-slate-300">
            支持 C / C++ / Java / Python / Node.js 五种语言，提交后逐测试点实时返回耗时、内存与判定结果。
          </p>
          <div className="mt-8 flex flex-wrap gap-2">
            {['AC', 'WA', 'TLE', 'MLE', 'RE', 'CE'].map((s) => (
              <span key={s} className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1 font-mono text-xs text-slate-200">
                {s}
              </span>
            ))}
          </div>
        </div>
        <p className="relative text-xs text-slate-400 dark:text-slate-500">本地沙箱判题 · 仅供学习与内部使用</p>
      </div>

      {/* 右侧表单 */}
      <div className="flex w-full items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">OJ</span>
              <span className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">OJ Lab</span>
            </Link>
          </div>

          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            {mode === 'login' ? '登录账号' : '创建账号'}
          </h2>
          <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">
            {mode === 'login' ? '登录后即可提交代码、查看判题结果' : '首个注册的账号自动成为管理员'}
          </p>

          <form className="mt-7 space-y-4" onSubmit={onSubmit}>
            <div>
              <label className="label" htmlFor="username">
                用户名
              </label>
              <input
                id="username"
                className="input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="3-20 位字母、数字、下划线或中文"
                autoComplete="username"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="password">
                密码
              </label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 6 位"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                required
              />
            </div>
            {mode === 'register' && (
              <div>
                <label className="label" htmlFor="confirm">
                  确认密码
                </label>
                <input
                  id="confirm"
                  type="password"
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="再次输入密码"
                  autoComplete="new-password"
                  required
                />
              </div>
            )}

            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</p>}

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-slate-500 dark:text-slate-400">
            {mode === 'login' ? '还没有账号？' : '已有账号？'}
            <button
              className="ml-1 font-medium text-brand-600 hover:text-brand-700"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
              }}
            >
              {mode === 'login' ? '立即注册' : '去登录'}
            </button>
          </p>

          <div className="mt-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-4 py-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
            演示账号：<span className="font-mono text-slate-700 dark:text-slate-300">admin / admin123</span>（管理员）
          </div>
        </div>
      </div>
    </div>
  );
}
