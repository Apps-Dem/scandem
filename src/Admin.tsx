import { useCallback, useState } from 'react';

interface Row {
  id: number; created_at: number; version: string; outcome: string; paywall: string;
  accepted: number; processed: number; successful: number; failed: number;
  browser: string | null; os: string | null; device_class: string | null;
}
interface Summary {
  totals: { logs: number; accepted: number; processed: number; successful: number; failed: number };
  byOutcome: { outcome: string; n: number }[];
  byVersion: { version: string; n: number }[];
  byPaywall: { paywall: string; n: number }[];
}

const OUTCOMES = ['ready', 'prepare_failed', 'download_failed', 'scan_failed', 'accept_failed', 'payment_failed'];

/** Admin-only diagnostics viewer at /admin. The token is held in memory only. */
export default function Admin() {
  const [token, setToken] = useState('');
  const [authed, setAuthed] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState({ outcome: '', version: '', paywall: '' });
  const [detail, setDetail] = useState<unknown>(null);
  const [error, setError] = useState('');

  const api = useCallback(async (path: string, tk = token) => {
    const res = await fetch(path, { headers: { authorization: `Bearer ${tk}` } });
    if (!res.ok) throw new Error(res.status === 401 ? 'Invalid admin token.' : res.status === 503 ? 'Admin is disabled on the server.' : `Request failed (${res.status}).`);
    return res.json();
  }, [token]);

  const load = useCallback(async (f = filters, before: number | null = null, tk = token) => {
    setError('');
    try {
      const q = new URLSearchParams({ limit: '50' });
      for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
      if (before) q.set('before', String(before));
      const [list, sum] = await Promise.all([api(`/api/admin/logs?${q}`, tk), api('/api/admin/logs/summary', tk)]);
      setRows((r) => (before ? [...r, ...list.logs] : list.logs));
      setNext(list.next); setSummary(sum); setAuthed(true);
    } catch (e) { setError((e as Error).message); setAuthed(false); }
  }, [api, filters, token]);

  const open = async (id: number) => {
    try { setDetail(await api(`/api/admin/logs/${id}`)); } catch (e) { setError((e as Error).message); }
  };

  if (!authed) {
    return (
      <div className="app"><main><section className="card">
        <h2>Admin sign-in</h2>
        <form onSubmit={(e) => { e.preventDefault(); void load(filters, null, token); }}>
          <input type="password" autoComplete="off" placeholder="Admin token" value={token} onChange={(e) => setToken(e.target.value)} />
          {' '}<button className="btn primary" type="submit">Sign in</button>
        </form>
        {error && <p className="error" role="alert">{error}</p>}
      </section></main></div>
    );
  }

  const t = summary?.totals;
  const fail = t && t.accepted ? Math.round((t.failed / t.accepted) * 100) : 0;
  return (
    <div className="app admin">
      <header><h1>Scandem <span>debug logs</span></h1></header>
      <main>
        {t && (
          <section className="card">
            <div className="tally">
              <div><b>{t.logs}</b><span>Logs</span></div>
              <div><b>{t.accepted}</b><span>Accepted</span></div>
              <div><b>{t.successful}</b><span>Successful</span></div>
              <div><b>{fail}%</b><span>Failed</span></div>
            </div>
            <p className="muted small">
              By outcome: {summary!.byOutcome.map((o) => `${o.outcome} ${o.n}`).join(' · ') || '—'}<br />
              By version: {summary!.byVersion.map((o) => `${o.version} ${o.n}`).join(' · ') || '—'}<br />
              Paywall: {summary!.byPaywall.map((o) => `${o.paywall} ${o.n}`).join(' · ') || '—'}
            </p>
          </section>
        )}
        <section className="card">
          <div className="buttons">
            <select value={filters.outcome} onChange={(e) => { const f = { ...filters, outcome: e.target.value }; setFilters(f); void load(f); }}>
              <option value="">All outcomes</option>
              {OUTCOMES.map((o) => <option key={o}>{o}</option>)}
            </select>
            <select value={filters.paywall} onChange={(e) => { const f = { ...filters, paywall: e.target.value }; setFilters(f); void load(f); }}>
              <option value="">Paywall: any</option><option>enabled</option><option>disabled</option>
            </select>
            <input placeholder="Version" value={filters.version} onChange={(e) => setFilters({ ...filters, version: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void load()} />
            <button className="btn" onClick={() => void load()}>Refresh</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>When</th><th>Version</th><th>Outcome</th><th>Paywall</th><th>Acc</th><th>Proc</th><th>OK</th><th>Fail</th><th>Device</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} onClick={() => void open(r.id)} style={{ cursor: 'pointer' }}>
                    <td>{new Date(r.created_at).toLocaleString()}</td><td>{r.version}</td><td>{r.outcome}</td><td>{r.paywall}</td>
                    <td>{r.accepted}</td><td>{r.processed}</td><td>{r.successful}</td><td>{r.failed}</td>
                    <td>{[r.browser, r.os, r.device_class].filter(Boolean).join(' / ')}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={9}>No logs.</td></tr>}
              </tbody>
            </table>
          </div>
          {next && <button className="btn" onClick={() => void load(filters, next)}>Load more</button>}
        </section>
        {detail !== null && (
          <section className="card">
            <h2>Log detail <button className="btn link" onClick={() => setDetail(null)}>Close</button></h2>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: '.75rem' }}>{JSON.stringify(detail, null, 2)}</pre>
          </section>
        )}
      </main>
    </div>
  );
}
