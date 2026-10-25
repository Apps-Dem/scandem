import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptInput, getConfig, getStatus, mockPay, type Config, type Status } from './lib/api';
import { buildOutput } from './lib/export';
import { isSupported, ocrFile } from './lib/ocr';
import { buildLog, describeError, fileKind, recordAttempt, recordPaywallHit, recordPayment, resetLog, scoreReceipt, sendLog, type Outcome, type Source } from './lib/debuglog';
import { parseReceipt } from './lib/parse';
import { useSession } from './lib/session';
import type { OutputFormat } from './lib/types';
import { AdSlot } from './components/AdSlot';
import { Paywall } from './components/Paywall';

const FORMATS: { id: OutputFormat; label: string; hint: string }[] = [
  { id: 'csv', label: 'CSV', hint: 'Two CSV files (receipts + line items) in a ZIP' },
  { id: 'xlsx', label: 'Excel', hint: '.xlsx workbook' },
  { id: 'qif', label: 'Quicken', hint: '.qif import file' },
  { id: 'iif', label: 'QuickBooks', hint: '.iif import file' },
];

const fmtMoney = (n: number | null) => (n === null ? '—' : n.toFixed(2));

export default function App() {
  const { session, update, clear, touch, msLeft, expired, dismissExpired } = useSession();
  const [config, setConfig] = useState<Config | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [format, setFormatState] = useState<OutputFormat>(() => {
    const f = localStorage.getItem('scandem.format') as OutputFormat | null;
    return FORMATS.some((x) => x.id === f) ? f! : 'csv';
  });
  const setFormat = (f: OutputFormat) => { localStorage.setItem('scandem.format', f); setFormatState(f); };
  const [working, setWorking] = useState(0);
  const [paywall, setPaywall] = useState(false);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getConfig().then(setConfig).catch(() => setError('Cannot reach the server.'));
    getStatus().then(setStatus).catch(() => undefined);
  }, []);

  useEffect(() => {
    const on = () => touch();
    window.addEventListener('pointerdown', on);
    window.addEventListener('keydown', on);
    return () => { window.removeEventListener('pointerdown', on); window.removeEventListener('keydown', on); };
  }, [touch]);

  const handleFiles = useCallback(async (files: FileList | null, source: Source) => {
    if (!files?.length) return;
    setError(''); setNotice('');
    const list = [...files];
    let skipped = 0;
    const logOn = config?.debugLog === true;
    for (const file of list) {
      if (!isSupported(file)) { skipped++; continue; }
      const base = { source, fileType: fileKind(file), bytes: file.size };
      try {
        if ((await acceptInput()) === 'payment_required') {
          if (logOn) { recordPaywallHit(); recordAttempt({ ...base, status: 'paywalled' }); }
          setPaywall(true);
          setNotice(`${list.length - list.indexOf(file) - skipped} file(s) were not accepted. Download your output or pay to continue.`);
          break;
        }
      } catch (e) { setError((e as Error).message); break; }
      update((s) => ({ ...s, accepted: s.accepted + 1 }));
      setWorking((n) => n + 1);
      const t0 = performance.now();
      try {
        const ocr = await ocrFile(file);
        const receipt = parseReceipt(ocr.text, file.name, crypto.randomUUID());
        if (logOn) {
          const s = scoreReceipt(receipt);
          recordAttempt({
            ...base, width: ocr.width, height: ocr.height, pages: ocr.pages, ocrMs: Math.round(performance.now() - t0),
            ocrConfidence: +ocr.confidence.toFixed(1), ...s, status: receipt.total !== null ? 'success' : 'failed',
            ...(receipt.total === null ? { errorClass: 'ParseIncomplete', errorMessage: 'No total found' } : {}),
          });
        }
        update((s) => ({ ...s, processed: s.processed + 1, receipts: [...s.receipts, receipt] }));
      } catch (e) {
        if (logOn) recordAttempt({ ...base, ocrMs: Math.round(performance.now() - t0), status: 'failed', ...describeError(e) });
        update((s) => ({ ...s, failed: s.failed + 1 }));
        setError(`Could not read “${file.name}”. Try a clearer, well-lit photo.`);
      } finally { setWorking((n) => n - 1); }
    }
    if (skipped) setError(`${skipped} unsupported file(s) skipped. Use images or PDF.`);
    getStatus().then(setStatus).catch(() => undefined);
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
  }, [update, config]);

  const download = useCallback(async () => {
    if (!session.receipts.length) return;
    setError('');
    const logOn = config?.debugLog === true;
    const info = {
      format, receipts: session.receipts.length, lineItems: session.receipts.reduce((n, r) => n + r.items.length, 0),
    };
    const report = (outcome: Outcome, stage: 'prepare' | 'download', t0: number, extra: object) => {
      if (!logOn) return;
      sendLog(buildLog({ paywallEnabled: config?.paymentsRequired ?? null, outcome, download: { stage, ...info, ms: Math.round(performance.now() - t0), ...extra } }));
    };
    const t0 = performance.now();
    let out;
    try { out = await buildOutput(session.receipts, format); }
    catch (e) {
      report('prepare_failed', 'prepare', t0, describeError(e));
      setError('Could not build the output file. Your data is still here; try again.');
      return;
    }
    try {
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement('a');
      a.href = url; a.download = out.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      report('download_failed', 'download', t0, { bytes: out.blob.size, ...describeError(e) });
      setError('The download could not be started. Your data is still here; try again.');
      return;
    }
    report('ready', 'download', t0, { bytes: out.blob.size });
    resetLog();
    clear();
    setPaywall(false);
    setNotice('Download started. Your inputs and results have been cleared.');
  }, [session.receipts, format, clear, config]);

  const pay = async () => {
    setPaying(true);
    try { setStatus(await mockPay()); recordPayment(true); setPaywall(false); setNotice('Pass active for 24 hours. Keep scanning!'); }
    catch (e) { recordPayment(false); setError((e as Error).message); }
    finally { setPaying(false); }
  };

  const formatLabel = FORMATS.find((f) => f.id === format)!.label;
  const mins = Math.ceil(msLeft / 60000);
  const hasData = session.receipts.length > 0 || session.accepted > 0;
  const pending = session.accepted - session.processed - session.failed;
  return (
    <div className="app">
      <header>
        <h1>Scandem <span>receipt scanner</span></h1>
        <small className="version">v{__APP_VERSION__}</small>
      </header>

      {config?.paymentsRequired && (
        <section className="price-box" aria-label="Pricing">
          <div className="price-main">
            <span className="price-amt">${config.priceUsd} <small>USD</small></span>
            <span className="price-xcd">≈ EC${config.priceXcd}</span>
            <span className="price-per">per 24 hours · unlimited scans</span>
          </div>
          <p className="price-note">
            {status?.passActive && status.passExpires
              ? `✓ Pass active until ${new Date(status.passExpires).toLocaleString()}`
              : 'Your first receipt scan is free.'}
          </p>
        </section>
      )}

      <AdSlot placement="top" />

      <main>
        <section className="card scan">
          <h2>1. Choose output format</h2>
          <fieldset className="formats">
            <legend className="sr">Output format</legend>
            {FORMATS.map((f) => (
              <label key={f.id} className={format === f.id ? 'fmt sel' : 'fmt'}>
                <input type="radio" name="fmt" checked={format === f.id} onChange={() => setFormat(f.id)} />
                <span><b>{f.label}</b><small>{f.hint}</small></span>
              </label>
            ))}
          </fieldset>
          <h2>2. Scan receipts</h2>
          <div className="buttons">
            <button className="btn primary big" onClick={() => camRef.current?.click()}>📷 Take photo</button>
            <button className="btn big" onClick={() => fileRef.current?.click()}>🖼️ Upload photos / PDF</button>
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFiles(e.target.files, 'photo')} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => handleFiles(e.target.files, 'upload')} />
          <p className="muted small">Processed on your device — images are never uploaded.</p>
          {config?.debugLog && <p className="muted small">Anonymized diagnostics (counts, timings, error types; never your images or receipt data) are sent to support when you download.</p>}
          <p className="muted small"><b>Tip:</b> Use a phone camera stand or turntable for consistent shots.</p>

          <div className="tally" aria-live="polite">
            <div><b>{session.accepted}</b><span>Accepted</span></div>
            <div><b>{session.processed}</b><span>Processed</span></div>
            {session.failed > 0 && <div><b>{session.failed}</b><span>Failed</span></div>}
          </div>
          {(working > 0 || pending > 0) && <p className="progress">Reading receipt{working > 1 ? 's' : ''}… first run downloads the OCR engine.</p>}
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="info" role="status">{notice}</p>}
        </section>

        <AdSlot placement="inline" />

        {session.receipts.length > 0 && (
          <section className="card">
            <h2>Results ({session.receipts.length})</h2>
            <ul className="receipts">
              {session.receipts.map((r) => (
                <li key={r.id}>
                  <div><b>{r.merchant || 'Unknown merchant'}</b><span>{r.date || 'no date'} · {r.items.length} items{r.paymentMethod ? ` · ${r.paymentMethod}` : ''}</span></div>
                  <div className="amt">{fmtMoney(r.total)}</div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card download">
          <h2>Download</h2>
          <p className="muted small">Selected format: <b>{formatLabel}</b> (change it in “Output format” above)</p>
          <button className="btn primary big" disabled={!session.receipts.length || working > 0} onClick={download}>
            ⬇ Download {formatLabel}
          </button>
          <p className="warn">
            ⚠ Download your output immediately. All inputs are cleared after a successful download or after 30 minutes of inactivity.
            {hasData && <> ({mins} min left before auto-clear)</>}
          </p>
          {expired && <p className="error" role="alert">Session expired after 30 minutes of inactivity and was cleared. <button className="btn link" onClick={dismissExpired}>Dismiss</button></p>}
        </section>
      </main>

      <AdSlot placement="bottom" />
      <footer className="muted small">OCR is approximate — review amounts before importing into accounting software.</footer>

      {paywall && config && (
        <Paywall config={config} formatLabel={formatLabel} hasOutput={session.receipts.length > 0} busy={paying}
          onPay={pay} onDownload={download} onClose={() => setPaywall(false)} />
      )}
    </div>
  );
}
