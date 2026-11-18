import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/LoginPage';
import { ProblemListPage } from './pages/ProblemListPage';
import { ProblemDetailPage } from './pages/ProblemDetailPage';
import { SubmissionsPage } from './pages/SubmissionsPage';
import { SubmissionDetailPage } from './pages/SubmissionDetailPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { AdminProblemsPage } from './pages/AdminProblemsPage';
import { AdminProblemEditPage } from './pages/AdminProblemEditPage';
import { AdminSubmissionsPage } from './pages/AdminSubmissionsPage';
import { DraftFilesPage } from './pages/DraftFilesPage';
import { UserProfilePage } from './pages/UserProfilePage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route index element={<ProblemListPage />} />
        <Route path="/problems/:id" element={<ProblemDetailPage />} />
        <Route
          path="/submissions"
          element={
            <ProtectedRoute>
              <SubmissionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/submissions/:id"
          element={
            <ProtectedRoute>
              <SubmissionDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/files"
          element={
            <ProtectedRoute>
              <DraftFilesPage />
            </ProtectedRoute>
          }
        />
        <Route path="/leaderboard" element={<LeaderboardPage />} />
        <Route path="/u/:id" element={<UserProfilePage />} />
        <Route
          path="/admin"
          element={
            <ProtectedRoute admin>
              <AdminProblemsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/problems/new"
          element={
            <ProtectedRoute admin>
              <AdminProblemEditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/problems/:id/edit"
          element={
            <ProtectedRoute admin>
              <AdminProblemEditPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/submissions"
          element={
            <ProtectedRoute admin>
              <AdminSubmissionsPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
