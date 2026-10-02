import { useEffect, useState } from 'react';

type ApiStatus =
  { state: 'loading' } | { state: 'ok'; protocolVersion: number } | { state: 'down' };

export function App() {
  const [status, setStatus] = useState<ApiStatus>({ state: 'loading' });

  useEffect(() => {
    fetch('/health')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { protocolVersion: number }) =>
        setStatus({ state: 'ok', protocolVersion: body.protocolVersion }),
      )
      .catch(() => setStatus({ state: 'down' }));
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1>SQL Heist City — Admin</h1>
      <p>
        API: {status.state === 'loading' && 'checking…'}
        {status.state === 'ok' && `online (protocol v${status.protocolVersion})`}
        {status.state === 'down' && 'unreachable'}
      </p>
    </main>
  );
}
