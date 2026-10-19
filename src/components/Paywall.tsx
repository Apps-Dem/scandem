import type { Config } from '../lib/api';

interface Props {
  config: Config;
  hasOutput: boolean;
  busy: boolean;
  onPay: () => void;
  onDownload: () => void;
  onClose: () => void;
}

export function Paywall({ config, hasOutput, busy, onPay, onDownload, onClose }: Props) {
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="pw-title">
      <div className="modal">
        <h2 id="pw-title">Your free scan is used</h2>
        <p>Download your output, or pay to keep scanning for the rest of the day.</p>
        <p className="price">
          ${config.priceUsd} USD <span>≈ EC${config.priceXcd} · 24 hours unlimited</span>
        </p>
        <div className="actions">
          {config.mockPayments && (
            <button className="btn primary" disabled={busy} onClick={onPay}>
              {busy ? 'Processing…' : `Pay $${config.priceUsd} (EC$${config.priceXcd}) to continue`}
            </button>
          )}
          {!config.mockPayments && <p className="muted">Payments are not available yet.</p>}
          <button className="btn" disabled={!hasOutput} onClick={onDownload}>Download output</button>
          <button className="btn link" onClick={onClose}>Not now</button>
        </div>
        {config.mockPayments && <p className="muted small">Test mode: payment is simulated.</p>}
      </div>
    </div>
  );
}
