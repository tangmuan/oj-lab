import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const navItems = [
  { to: '/', label: '题目', end: true },
  { to: '/files', label: '草稿箱' },
  { to: '/submissions', label: '提交记录' },
  { to: '/leaderboard', label: '排行榜' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-5">
          <NavLink to="/" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              OJ
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-slate-900">OJ Lab</span>
          </NavLink>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
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
                    isActive ? 'bg-amber-50 text-amber-700' : 'text-amber-600 hover:bg-amber-50'
                  }`
                }
              >
                管理端
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <>
                <div className="hidden items-center gap-2 sm:flex">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                    {user.username.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="text-sm text-slate-700">{user.username}</span>
                  {user.role === 'admin' && <span className="chip bg-amber-50 text-amber-700">管理员</span>}
                </div>
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

      <footer className="border-t border-slate-200 py-5 text-center text-xs text-slate-400">
        OJ Lab · Express + SQLite + React · 判题结果由本地沙箱生成
      </footer>
    </div>
  );
}
