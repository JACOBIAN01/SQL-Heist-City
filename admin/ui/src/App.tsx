import { Navigate, Route, Routes } from 'react-router';
import { useMe } from './auth/useMe';
import { ErrorMessage } from './components/ErrorMessage';
import { Shell } from './layout/Shell';
import { ImportExportPage } from './pages/ImportExportPage';
import { AuditPage } from './pages/AuditPage';
import { LoginPage } from './pages/LoginPage';
import { PoolsPage } from './pages/PoolsPage';
import { UsersPage } from './pages/UsersPage';
import { QuestionListPage } from './pages/QuestionListPage';
import { SettingsPage } from './pages/SettingsPage';
import { QuestionEditorPage } from './pages/QuestionEditorPage';

/** Routes; every page except login requires a session. */
export function App() {
  const me = useMe();
  if (me.isPending) return <p className="center muted">Loading…</p>;
  if (me.isError) return <ErrorMessage error={me.error} />;
  if (!me.data) return <LoginPage />;

  return (
    <Routes>
      <Route element={<Shell user={me.data} />}>
        <Route index element={<Navigate to="/questions" replace />} />
        <Route path="questions" element={<QuestionListPage />} />
        <Route path="questions/:id" element={<QuestionEditorPage />} />
        <Route path="pools" element={<PoolsPage />} />
        <Route path="import-export" element={<ImportExportPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="*" element={<Placeholder title="Not found" />} />
      </Route>
    </Routes>
  );
}

function Placeholder({ title }: { title: string }) {
  return <h1>{title}</h1>;
}
