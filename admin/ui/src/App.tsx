import { Navigate, Route, Routes } from 'react-router';
import { useMe } from './auth/useMe';
import { ErrorMessage } from './components/ErrorMessage';
import { Shell } from './layout/Shell';
import { LoginPage } from './pages/LoginPage';
import { QuestionListPage } from './pages/QuestionListPage';

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
        <Route path="pools" element={<Placeholder title="Pools" />} />
        <Route path="import-export" element={<Placeholder title="Import / Export" />} />
        <Route path="settings" element={<Placeholder title="Settings" />} />
        <Route path="audit" element={<Placeholder title="Audit log" />} />
        <Route path="users" element={<Placeholder title="Users" />} />
        <Route path="*" element={<Placeholder title="Not found" />} />
      </Route>
    </Routes>
  );
}

function Placeholder({ title }: { title: string }) {
  return <h1>{title}</h1>;
}
