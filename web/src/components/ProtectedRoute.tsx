import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export function ProtectedRoute({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="py-20 text-center text-sm text-slate-400 dark:text-slate-500">加载中…</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (admin && user.role !== 'admin') {
    return (
      <div className="card mx-auto mt-16 max-w-md p-8 text-center">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">没有访问权限</h2>
        <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">管理端仅限管理员账号访问。</p>
      </div>
    );
  }
  return <>{children}</>;
}
