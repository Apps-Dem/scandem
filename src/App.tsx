import { useCallback, useEffect, useRef, useState } from 'react';
import { acceptInput, getConfig, getStatus, mockPay, type Config, type Status } from './lib/api';
import { buildOutput } from './lib/export';
import { isSupported, ocrFile } from './lib/ocr';
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

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setError(''); setNotice('');
    const list = [...files];
    let skipped = 0;
    for (const file of list) {
      if (!isSupported(file)) { skipped++; continue; }
      try {
        if ((await acceptInput()) === 'payment_required') {
          setPaywall(true);
          setNotice(`${list.length - list.indexOf(file) - skipped} file(s) were not accepted. Download your output or pay to continue.`);
          break;
        }
      } catch (e) { setError((e as Error).message); break; }
      update((s) => ({ ...s, accepted: s.accepted + 1 }));
      setWorking((n) => n + 1);
      try {
        const text = await ocrFile(file);
        const receipt = parseReceipt(text, file.name, crypto.randomUUID());
        update((s) => ({ ...s, processed: s.processed + 1, receipts: [...s.receipts, receipt] }));
      } catch {
        update((s) => ({ ...s, failed: s.failed + 1 }));
        setError(`Could not read “${file.name}”. Try a clearer, well-lit photo.`);
      } finally { setWorking((n) => n - 1); }
    }
    if (skipped) setError(`${skipped} unsupported file(s) skipped. Use images or PDF.`);
    getStatus().then(setStatus).catch(() => undefined);
    if (fileRef.current) fileRef.current.value = '';
    if (camRef.current) camRef.current.value = '';
  }, [update]);

  const download = useCallback(async () => {
    if (!session.receipts.length) return;
    setError('');
    try {
      const out = await buildOutput(session.receipts, format);
      const url = URL.createObjectURL(out.blob);
      const a = document.createElement('a');
      a.href = url; a.download = out.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      clear();
      setPaywall(false);
      setNotice('Download started. Your inputs and results have been cleared.');
    } catch { setError('Could not build the output file. Your data is still here; try again.'); }
  }, [session.receipts, format, clear]);

  const pay = async () => {
    setPaying(true);
    try { setStatus(await mockPay()); setPaywall(false); setNotice('Pass active for 24 hours. Keep scanning!'); }
    catch (e) { setError((e as Error).message); }
    finally { setPaying(false); }
  };

  const formatLabel = FORMATS.find((f) => f.id === format)!.label;
  const mins = Math.ceil(msLeft / 60000);
  const hasData = session.receipts.length > 0 || session.accepted > 0;
  const pending = session.accepted - session.processed - session.failed;
  const priceLine = config?.paymentsRequired
    ? `First scan free · then $${config.priceUsd} USD (≈ EC$${config.priceXcd}) per 24 hours`
    : 'Free to use right now';

  return (
    <div className="app">
      <header>
        <h1>Scandem <span>receipt scanner</span></h1>
        <p className="muted">{priceLine}{status?.passActive && status.passExpires ? ` · Pass until ${new Date(status.passExpires).toLocaleString()}` : ''}</p>
      </header>

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
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFiles(e.target.files)} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
          <p className="muted small">Processed on your device — images are never uploaded.</p>

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
