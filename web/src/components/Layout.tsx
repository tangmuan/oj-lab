import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const navItems = [
  { to: '/', label: '题目', end: true },
  { to: '/files', label: '草稿箱' },
  { to: '/submissions', label: '提交记录' },
  { to: '/leaderboard', label: '排行榜' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full flex-col bg-slate-50 dark:bg-slate-800/50 dark:bg-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 dark:border-slate-700 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-900/85">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-5">
          <NavLink to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">OJ</span>
            <span className="text-[15px] font-semibold tracking-tight text-slate-900 dark:text-slate-100">OJ Lab</span>
          </NavLink>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'
                      : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            {user?.role === 'admin' && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
                      : 'text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-500/10'
                  }`
                }
              >
                管理端
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <button
              className="btn-ghost !px-2.5 !py-1.5 text-xs"
              onClick={toggle}
              title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
              aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>

            {user ? (
              <>
                <Link
                  to={`/u/${user.id}`}
                  className="hidden items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-slate-50 sm:flex dark:hover:bg-slate-800/60"
                  title="我的主页"
                >
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
                    {user.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-sm text-slate-700 dark:text-slate-300">{user.username}</span>
                  {user.role === 'admin' && (
                    <span className="chip bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">管理员</span>
                  )}
                </Link>
                <button
                  className="btn-ghost !px-2.5 !py-1.5 text-xs"
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                >
                  退出
                </button>
              </>
            ) : (
              <button className="btn-primary !px-3 !py-1.5 text-xs" onClick={() => navigate('/login')}>
                登录 / 注册
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-700 py-5 text-center text-xs text-slate-400 dark:border-slate-800 dark:text-slate-500">
        OJ Lab · Express + SQLite + React · 判题结果由本地沙箱生成
      </footer>
    </div>
  );
}
