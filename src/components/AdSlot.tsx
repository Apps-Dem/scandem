import { useEffect, useRef } from 'react';

const CLIENT = (import.meta.env.VITE_ADSENSE_CLIENT as string | undefined) || 'ca-pub-7243135710095454';
const DEFAULT_SLOT = (import.meta.env.VITE_ADSENSE_SLOT as string | undefined) || '8295221087';
// Per-placement overrides are optional; otherwise the shared "Slot 1" unit is used.
const SLOTS: Record<string, string | undefined> = {
  top: import.meta.env.VITE_ADSENSE_SLOT_TOP || DEFAULT_SLOT,
  inline: import.meta.env.VITE_ADSENSE_SLOT_INLINE || DEFAULT_SLOT,
  bottom: import.meta.env.VITE_ADSENSE_SLOT_BOTTOM || DEFAULT_SLOT,
};

declare global { interface Window { adsbygoogle?: unknown[] } }

function loadScript() {
  if (!CLIENT || document.querySelector('script[data-adsense], script[src*="adsbygoogle.js"]')) return;
  const s = document.createElement('script');
  s.async = true; s.crossOrigin = 'anonymous'; s.dataset.adsense = '1';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(CLIENT)}`;
  document.head.appendChild(s);
}

export type AdPlacement = 'top' | 'inline' | 'bottom';

/** Reserved, clearly labelled ad area. Renders AdSense when configured, else a tasteful placeholder. */
export function AdSlot({ placement }: { placement: AdPlacement }) {
  const slot = SLOTS[placement];
  const live = !!(CLIENT && slot);
  const pushed = useRef(false);
  useEffect(() => {
    if (!live || pushed.current) return;
    pushed.current = true;
    loadScript();
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* blocked */ }
  }, [live]);

  return (
    <aside className={`ad ad-${placement}`} aria-label="Advertisement">
      <span className="ad-label">Advertisement</span>
      {live ? (
        <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client={CLIENT} data-ad-slot={slot}
          data-ad-format="auto" data-full-width-responsive="true" />
      ) : (
        <div className="ad-placeholder">Your ad here</div>
      )}
    </aside>
  );
}
