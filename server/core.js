// Runtime-agnostic API (Web Request/Response). Used by the Cloudflare Worker (D1) and the local Node server (SQLite).
const DAY_MS = 24 * 60 * 60 * 1000;
const OCR_MODEL = '@cf/moondream/moondream3.1-9B-A2B';
const OCR_CREDIT_TTL = 30 * 60 * 1000;
const MAX_OCR_BODY_BYTES = 12 * 1024 * 1024;
const MAX_OCR_IMAGE_CHARS = 4 * 1024 * 1024;
const MAX_OCR_TOTAL_IMAGE_CHARS = 10 * 1024 * 1024;
const MAX_OCR_IMAGES = 8;

export function priceInfo(env = {}) {
  const usd = Number(env.PRICE_USD ?? 5);
  const rate = Number(env.XCD_PER_USD ?? 2.7); // EC$ is pegged to USD
  // Round to cents first to avoid float noise (e.g. 13.500000000000002)
  const xcd = Math.ceil(Math.round(usd * rate * 100) / 100);
  return { usd, xcd, rate };
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ (eb[i % eb.length] ?? 0);
  return diff === 0;
}

async function readLimitedBody(request, limit) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * db: { first(sql, ...params) -> row|null, run(sql, ...params) -> { changes, lastId } }
 */
export function createHandler({ db, env = {}, now = () => Date.now() }) {
  const paymentsRequired = async () => {
    const row = await db.first('SELECT value FROM settings WHERE key = ?', 'payments_required');
    return row ? row.value === 'true' : (env.PAYMENTS_REQUIRED ?? 'true') !== 'false';
  };
  const mockEnabled = () => (env.MOCK_PAYMENTS ? env.MOCK_PAYMENTS === 'true' : env.NODE_ENV !== 'production');

  async function status(dev) {
    const active = dev.pass_expires > now();
    return { paymentsRequired: await paymentsRequired(), freeUsed: !!dev.free_used, passActive: active, passExpires: active ? dev.pass_expires : null };
  }

  async function createOcrCredit(deviceId) {
    const token = randomHex(32);
    const createdAt = now();
    await db.run(
      'INSERT INTO ocr_credits (token_hash, device_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      await sha256Hex(token), deviceId, createdAt + OCR_CREDIT_TTL, createdAt,
    );
    return token;
  }

  // A device is matched by fingerprint OR cookie so clearing either one alone doesn't reset the free use.
  async function resolveDevice(request, secure) {
    const h = request.headers.get('x-device-fp') || '';
    const fp = /^[a-f0-9]{32,128}$/i.test(h) ? h.toLowerCase() : null;
    if (!fp) return null;
    const cookies = Object.fromEntries((request.headers.get('cookie') || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
    let sid = /^[a-f0-9]{32}$/.test(cookies.sid || '') ? cookies.sid : null;
    let dev = await db.first(
      'SELECT * FROM devices WHERE fp = ? OR (sid IS NOT NULL AND sid = ?) ORDER BY free_used DESC, pass_expires DESC LIMIT 1', fp, sid);
    if (!dev) {
      sid = sid || randomHex(16);
      const r = await db.run('INSERT INTO devices (fp, sid, created_at) VALUES (?, ?, ?)', fp, sid, now());
      dev = await db.first('SELECT * FROM devices WHERE id = ?', r.lastId);
    } else {
      sid = dev.sid || sid || randomHex(16);
      await db.run('UPDATE devices SET fp = ?, sid = ? WHERE id = ?', fp, sid, dev.id);
      dev = { ...dev, fp, sid };
    }
    return { dev, cookie: `sid=${sid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}` };
  }

  async function adminAuth(request) {
    if (!env.ADMIN_TOKEN) return json({ error: 'admin_disabled' }, 503);
    const given = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
    return safeEqual(given, env.ADMIN_TOKEN) ? null : json({ error: 'unauthorized' }, 401);
  }

  return async function handle(request) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    const secure = url.protocol === 'https:';
    try {
      if (pathname === '/api/config' && method === 'GET') {
        const p = priceInfo(env);
        return json({ paymentsRequired: await paymentsRequired(), priceUsd: p.usd, priceXcd: p.xcd, mockPayments: mockEnabled() });
      }

      if (pathname.startsWith('/api/admin/')) {
        const denied = await adminAuth(request);
        if (denied) return denied;
        if (pathname === '/api/admin/settings' && method === 'GET') return json({ paymentsRequired: await paymentsRequired() });
        if (pathname === '/api/admin/settings' && method === 'PUT') {
          const body = await request.json().catch(() => null);
          if (typeof body?.paymentsRequired !== 'boolean') return json({ error: 'paymentsRequired must be boolean' }, 400);
          await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'payments_required', String(body.paymentsRequired));
          return json({ paymentsRequired: await paymentsRequired() });
        }
        return json({ error: 'not_found' }, 404);
      }

      const isOcr = pathname === '/api/ocr' && method === 'POST';
      const deviceRoutes = { 'GET /api/status': 'status', 'POST /api/accept': 'accept', 'POST /api/pay/mock-complete': 'mock' };
      const route = deviceRoutes[`${method} ${pathname}`];
      if (!route && !isOcr) return json({ error: 'not_found' }, 404);

      const resolved = await resolveDevice(request, secure);
      if (!resolved) return json({ error: 'missing_fingerprint' }, 400);
      const { dev, cookie } = resolved;
      const respond = (body, status = 200) => json(body, status, { 'set-cookie': cookie });

      if (isOcr) {
        if (typeof env.AI?.run !== 'function') return respond({ error: 'ocr_unavailable' }, 503);
        const authorization = request.headers.get('authorization') || '';
        const token = authorization.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
        if (!token) return respond({ error: 'ocr_not_authorized' }, 403);

        const bytes = await readLimitedBody(request, MAX_OCR_BODY_BYTES);
        if (!bytes) return respond({ error: 'ocr_image_too_large' }, 413);
        let body;
        try { body = JSON.parse(new TextDecoder().decode(bytes)); }
        catch { return respond({ error: 'invalid_ocr_request' }, 400); }

        const images = body?.images;
        if (!Array.isArray(images) || images.length < 1 || images.length > MAX_OCR_IMAGES) {
          return respond({ error: 'invalid_ocr_request' }, 400);
        }
        let totalImageChars = 0;
        if (images.some((image) => {
          if (typeof image !== 'string' || !/^data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/i.test(image)) return true;
          totalImageChars += image.length;
          return image.length > MAX_OCR_IMAGE_CHARS || totalImageChars > MAX_OCR_TOTAL_IMAGE_CHARS;
        })) return respond({ error: 'invalid_ocr_request' }, 400);

        await db.run('DELETE FROM ocr_credits WHERE expires_at <= ?', now());
        const credit = await db.run(
          'DELETE FROM ocr_credits WHERE token_hash = ? AND device_id = ? AND expires_at > ?',
          await sha256Hex(token), dev.id, now(),
        );
        if (credit.changes !== 1) return respond({ error: 'ocr_not_authorized' }, 403);

        const text = [];
        try {
          for (const image of images) {
            const result = await env.AI.run(OCR_MODEL, {
              task: 'query',
              image,
              question: 'Transcribe all visible text from this receipt exactly. Preserve line breaks and item descriptions. Do not summarize, infer missing text, or omit prices, dates, taxes, totals, or payment details.',
              reasoning: false,
              temperature: 0,
              max_tokens: 4096,
            });
            if (typeof result?.answer !== 'string' || !result.answer.trim()) throw new Error('OCR returned no text');
            text.push(result.answer.trim());
          }
        } catch (error) {
          console.error(JSON.stringify({ message: 'Workers AI OCR failed', error: error instanceof Error ? error.message : String(error) }));
          return respond({ error: 'ocr_failed' }, 502);
        }
        return respond({ text: text.join('\n') });
      }

      if (route === 'status') return respond(await status(dev));

      if (route === 'accept') {
        if (!(await paymentsRequired()) || dev.pass_expires > now()) {
          return respond({ ok: true, ocrToken: await createOcrCredit(dev.id), ...(await status(dev)) });
        }
        // Conditional update makes the free-use claim atomic.
        const r = await db.run('UPDATE devices SET free_used = 1 WHERE id = ? AND free_used = 0', dev.id);
        if (r.changes === 1) {
          return respond({ ok: true, free: true, ocrToken: await createOcrCredit(dev.id), ...(await status({ ...dev, free_used: 1 })) });
        }
        return respond({ error: 'payment_required', ...(await status(dev)) }, 402);
      }

      // Stub for a real payment provider: grants a 24h pass immediately.
      if (!mockEnabled()) return respond({ error: 'not_available' }, 404);
      const t = now();
      const expires = Math.max(t, dev.pass_expires) + DAY_MS;
      await db.run('UPDATE devices SET pass_expires = ? WHERE id = ?', expires, dev.id);
      await db.run('INSERT INTO payments (device_id, amount_usd, provider, created_at) VALUES (?, ?, ?, ?)', dev.id, priceInfo(env).usd, 'mock', t);
      return respond(await status({ ...dev, pass_expires: expires }));
    } catch (e) {
      console.error(e);
      return json({ error: 'server_error' }, 500);
    }
  };
}

export function d1Adapter(d1) {
  return {
    first: (sql, ...p) => d1.prepare(sql).bind(...p).first(),
    run: async (sql, ...p) => {
      const r = await d1.prepare(sql).bind(...p).run();
      return { changes: r.meta.changes, lastId: r.meta.last_row_id };
    },
  };
}
