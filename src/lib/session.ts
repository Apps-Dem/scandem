import { useCallback, useEffect, useRef, useState } from 'react';
import type { Receipt } from './types';

export const IDLE_MS = 30 * 60 * 1000;
const KEY = 'scandem.session.v1';

export interface Session { receipts: Receipt[]; accepted: number; processed: number; failed: number; lastActivity: number }
const empty = (): Session => ({ receipts: [], accepted: 0, processed: 0, failed: 0, lastActivity: Date.now() });

function load(): Session {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Session | null;
    if (s && Date.now() - s.lastActivity < IDLE_MS) return s;
  } catch { /* ignore corrupt state */ }
  localStorage.removeItem(KEY);
  return empty();
}

/** Browser-persisted tally and receipts; wiped on download or after 30 minutes of inactivity. */
export function useSession() {
  const [session, setSession] = useState<Session>(load);
  const ref = useRef(session);
  ref.current = session;

  const update = useCallback((fn: (s: Session) => Session) => {
    const next = { ...fn(ref.current), lastActivity: Date.now() };
    ref.current = next;
    localStorage.setItem(KEY, JSON.stringify(next));
    setSession(next);
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(KEY);
    const e = empty();
    ref.current = e;
    setSession(e);
  }, []);

  const touch = useCallback(() => {
    if (ref.current.receipts.length || ref.current.accepted) {
      const next = { ...ref.current, lastActivity: Date.now() };
      ref.current = next;
      localStorage.setItem(KEY, JSON.stringify(next));
      setSession(next);
    }
  }, []);

  const [now, setNow] = useState(Date.now());
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const check = () => {
      setNow(Date.now());
      const s = ref.current;
      if ((s.receipts.length || s.accepted) && Date.now() - s.lastActivity >= IDLE_MS) { clear(); setExpired(true); }
    };
    const t = setInterval(check, 10_000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', check); };
  }, [clear]);

  const msLeft = Math.max(0, IDLE_MS - (now - session.lastActivity));
  return { session, update, clear, touch, msLeft, expired, dismissExpired: () => setExpired(false) };
}
