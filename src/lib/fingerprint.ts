// Stable, non-reversible device signature. Combined server-side with a cookie so that
// clearing either one alone does not reset the free use.
function canvasSig(): string {
  try {
    const c = document.createElement('canvas');
    c.width = 200; c.height = 40;
    const g = c.getContext('2d')!;
    g.textBaseline = 'top'; g.font = '16px Arial'; g.fillStyle = '#f60';
    g.fillRect(10, 5, 80, 25); g.fillStyle = '#069';
    g.fillText('Scandem \u{1F9FE} fp', 4, 8);
    return c.toDataURL();
  } catch { return ''; }
}

function gpuSig(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)}|${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : '';
  } catch { return ''; }
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

let cached: Promise<string> | null = null;
export function getFingerprint(): Promise<string> {
  cached ??= (async () => {
    const n = navigator as Navigator & { deviceMemory?: number };
    const signals = [
      n.userAgent, n.language, n.platform, n.hardwareConcurrency, n.deviceMemory, n.maxTouchPoints,
      screen.width, screen.height, screen.colorDepth, window.devicePixelRatio,
      Intl.DateTimeFormat().resolvedOptions().timeZone, canvasSig(), gpuSig(),
    ].join('||');
    return sha256Hex(signals);
  })();
  return cached;
}
