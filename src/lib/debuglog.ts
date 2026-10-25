import type { Receipt } from './types';

/**
 * Anonymized diagnostics. Never contains uploaded images, OCR text, receipt contents,
 * file names, or any identifier that survives the session. Held in memory only.
 */
export type Source = 'photo' | 'upload';
export type AttemptStatus = 'success' | 'failed' | 'paywalled';
export type Outcome = 'ready' | 'prepare_failed' | 'download_failed';

export interface Attempt {
  n: number;
  source: Source;
  fileType: string;
  bytes: number;
  width?: number;
  height?: number;
  pages?: number;
  ocrMs?: number;
  ocrConfidence?: number;
  parseScore?: number;
  fieldsFound?: string[];
  fieldsMissing?: string[];
  status: AttemptStatus;
  errorClass?: string;
  errorMessage?: string;
}

export interface DownloadInfo {
  stage: 'prepare' | 'download';
  format: string;
  receipts: number;
  lineItems: number;
  ms: number;
  bytes?: number;
  errorClass?: string;
  errorMessage?: string;
}

const MAX_ATTEMPTS = 200;
const sessionId = crypto.randomUUID();
let attempts: Attempt[] = [];
let paywallHits = 0;
const payments: ('completed' | 'failed')[] = [];

export const resetLog = () => { attempts = []; paywallHits = 0; payments.length = 0; };
export const recordPaywallHit = () => { paywallHits++; };
export const recordPayment = (ok: boolean) => { payments.push(ok ? 'completed' : 'failed'); };
export const recordAttempt = (a: Omit<Attempt, 'n'>) => {
  if (attempts.length < MAX_ATTEMPTS) attempts.push({ n: attempts.length + 1, ...a });
};

export const fileKind = (f: File) => f.type || (f.name.match(/\.([a-z0-9]{1,5})$/i)?.[1]?.toLowerCase() ?? 'unknown');

/** Removes anything that could carry user data: file names, paths, URLs, long digit runs. */
export function sanitizeMessage(s: string): string {
  return s
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[^\s/\\]*[/\\][^\s]*/g, '<path>')
    .replace(/\S+\.[a-z0-9]{2,5}\b/gi, '<file>')
    .replace(/\d{5,}/g, '<n>')
    .slice(0, 160);
}

export function describeError(e: unknown): { errorClass: string; errorMessage: string } {
  const err = e instanceof Error ? e : new Error(String(e));
  return { errorClass: (err.name || 'Error').slice(0, 40), errorMessage: sanitizeMessage(err.message || '') };
}

/** Names only: which receipt fields the parser found. */
export function scoreReceipt(r: Receipt) {
  const checks: Record<string, boolean> = {
    merchant: !!r.merchant, date: !!r.date, items: r.items.length > 0,
    subtotal: r.subtotal !== null, tax: r.tax !== null, total: r.total !== null, paymentMethod: !!r.paymentMethod,
  };
  const names = Object.keys(checks);
  const fieldsFound = names.filter((k) => checks[k]);
  return { fieldsFound, fieldsMissing: names.filter((k) => !checks[k]), parseScore: +(fieldsFound.length / names.length).toFixed(2) };
}

function device() {
  const ua = navigator.userAgent;
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\//i.test(ua) ? 'Opera' : /firefox/i.test(ua) ? 'Firefox' : /chrome|crios/i.test(ua) ? 'Chrome' : /safari/i.test(ua) ? 'Safari' : 'Other';
  const os = /android/i.test(ua) ? 'Android' : /iphone|ipad|ipod/i.test(ua) ? 'iOS' : /mac/i.test(ua) ? 'macOS' : /windows/i.test(ua) ? 'Windows' : /linux/i.test(ua) ? 'Linux' : 'Other';
  const deviceClass = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop';
  return { browser, os, deviceClass };
}

export interface LogContext { paywallEnabled: boolean | null; outcome: Outcome; download: DownloadInfo }

export function buildLog(ctx: LogContext) {
  const processed = attempts.filter((a) => a.status !== 'paywalled' && a.ocrConfidence !== undefined);
  return {
    version: __APP_VERSION__,
    sessionId,
    sentAt: new Date().toISOString(),
    outcome: ctx.outcome,
    paywall: ctx.paywallEnabled === null ? 'unknown' : ctx.paywallEnabled ? 'enabled' : 'disabled',
    paywallHits,
    payments: [...payments],
    device: device(),
    counts: {
      accepted: attempts.filter((a) => a.status !== 'paywalled').length,
      processed: processed.length,
      successful: attempts.filter((a) => a.status === 'success').length,
      failed: attempts.filter((a) => a.status === 'failed').length,
    },
    attempts,
    download: ctx.download,
  };
}

/** Fire-and-forget; diagnostics must never affect the user. */
export function sendLog(log: ReturnType<typeof buildLog>): void {
  try {
    void fetch('/api/debug-log', {
      method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify(log),
    }).catch(() => undefined);
  } catch { /* ignore */ }
}
