// Whitelist-based sanitizer: anything not explicitly listed here is dropped.
export const SUPPORT_TO = 'support@boundless-tallawah.com';
const SOURCES = ['photo', 'upload'];
const STATUSES = ['success', 'failed', 'paywalled'];
const OUTCOMES = ['ready', 'prepare_failed', 'download_failed'];
const FIELDS = ['merchant', 'date', 'items', 'subtotal', 'tax', 'total', 'paymentMethod'];
const MAX_ATTEMPTS = 200;

const str = (v, max = 60) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').slice(0, max) : undefined);
const num = (v, min = 0, max = 1e9) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
const oneOf = (v, list) => (list.includes(v) ? v : undefined);
const names = (v) => (Array.isArray(v) ? v.filter((x) => FIELDS.includes(x)) : undefined);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// Same redaction as the client, applied again so the server never trusts it.
export function redact(s) {
  const v = str(s, 400);
  if (v === undefined) return undefined;
  return v
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[^\s/\\]*[/\\][^\s]*/g, '<path>')
    .replace(/\S+\.[a-z0-9]{2,5}\b/gi, '<file>')
    .replace(/\d{5,}/g, '<n>')
    .slice(0, 160);
}

export function sanitizeLog(b, { paywallEnabled }) {
  if (!b || typeof b !== 'object') return null;
  const attempts = (Array.isArray(b.attempts) ? b.attempts : []).slice(0, MAX_ATTEMPTS).map((a, i) => clean({
    n: i + 1,
    source: oneOf(a?.source, SOURCES),
    fileType: str(a?.fileType, 40)?.replace(/[^a-z0-9./+-]/gi, ''),
    bytes: num(a?.bytes), width: num(a?.width, 0, 1e5), height: num(a?.height, 0, 1e5), pages: num(a?.pages, 0, 1e3),
    ocrMs: num(a?.ocrMs, 0, 36e5), ocrConfidence: num(a?.ocrConfidence, 0, 100), parseScore: num(a?.parseScore, 0, 1),
    fieldsFound: names(a?.fieldsFound), fieldsMissing: names(a?.fieldsMissing),
    status: oneOf(a?.status, STATUSES),
    errorClass: str(a?.errorClass, 40)?.replace(/[^\w.$-]/g, ''), errorMessage: redact(a?.errorMessage),
  }));
  const d = b.download ?? {};
  const dev = b.device ?? {};
  const log = {
    version: str(b.version, 30)?.replace(/[^\w.+-]/g, '') ?? 'unknown',
    sessionId: str(b.sessionId, 40)?.replace(/[^a-f0-9-]/gi, ''),
    receivedAt: new Date().toISOString(),
    outcome: oneOf(b.outcome, OUTCOMES) ?? 'unknown',
    paywall: paywallEnabled ? 'enabled' : 'disabled', // authoritative, from the server
    paywallHits: num(b.paywallHits, 0, 1e4) ?? 0,
    payments: (Array.isArray(b.payments) ? b.payments : []).filter((p) => p === 'completed' || p === 'failed').slice(0, 20),
    device: clean({ browser: str(dev.browser, 20), os: str(dev.os, 20), deviceClass: str(dev.deviceClass, 20) }),
    counts: {
      accepted: attempts.filter((a) => a.status !== 'paywalled').length,
      processed: attempts.filter((a) => a.ocrConfidence !== undefined).length,
      successful: attempts.filter((a) => a.status === 'success').length,
      failed: attempts.filter((a) => a.status === 'failed').length,
    },
    attempts,
    download: clean({
      stage: oneOf(d.stage, ['prepare', 'download']), format: oneOf(d.format, ['csv', 'xlsx', 'qif', 'iif']),
      receipts: num(d.receipts, 0, 1e4), lineItems: num(d.lineItems, 0, 1e6), ms: num(d.ms, 0, 36e5), bytes: num(d.bytes),
      errorClass: str(d.errorClass, 40)?.replace(/[^\w.$-]/g, ''), errorMessage: redact(d.errorMessage),
    }),
  };
  return log;
}

export function formatEmail(log, from) {
  const c = log.counts;
  return {
    to: SUPPORT_TO,
    from,
    subject: `[Scandem ${log.version}] debug log: ${log.outcome} (${c.successful}/${c.accepted} ok, paywall ${log.paywall})`,
    text:
      `Anonymized diagnostics. No uploaded data, file names, or receipt contents are included.\n\n` +
      `Build: ${log.version}\nPaywall: ${log.paywall}\nOutcome: ${log.outcome}\n` +
      `Accepted: ${c.accepted}  Processed: ${c.processed}  Successful: ${c.successful}  Failed: ${c.failed}\n\n` +
      JSON.stringify(log, null, 2),
  };
}
