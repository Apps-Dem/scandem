import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

const DAY_MS = 24 * 60 * 60 * 1000;

export function priceInfo(env = process.env) {
  const usd = Number(env.PRICE_USD ?? 5);
  const rate = Number(env.XCD_PER_USD ?? 2.7); // EC$ is pegged to USD
  // Round to cents first to avoid float noise (e.g. 13.500000000000002)
  const xcd = Math.ceil(Math.round(usd * rate * 100) / 100);
  return { usd, xcd, rate };
}

export function createApp({ dbPath = ':memory:', env = process.env, now = () => Date.now(), staticDir } = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fp TEXT, sid TEXT,
      free_used INTEGER NOT NULL DEFAULT 0,
      pass_expires INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS devices_fp ON devices(fp);
    CREATE INDEX IF NOT EXISTS devices_sid ON devices(sid);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, device_id INTEGER NOT NULL,
      amount_usd REAL NOT NULL, provider TEXT NOT NULL, created_at INTEGER NOT NULL
    );
  `);

  const envDefault = () => (env.PAYMENTS_REQUIRED ?? 'true') !== 'false';
  function paymentsRequired() {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('payments_required');
    return row ? row.value === 'true' : envDefault();
  }

  // A device is matched by fingerprint OR cookie so clearing either one alone doesn't reset the free use.
  function resolveDevice(req, res) {
    const fpHeader = req.get('x-device-fp') || '';
    const fp = /^[a-f0-9]{32,128}$/i.test(fpHeader) ? fpHeader.toLowerCase() : null;
    const cookies = Object.fromEntries((req.get('cookie') || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
    let sid = /^[a-f0-9]{32}$/.test(cookies.sid || '') ? cookies.sid : null;
    if (!fp) return null;
    let dev = db.prepare('SELECT * FROM devices WHERE fp = ? OR (sid IS NOT NULL AND sid = ?) ORDER BY free_used DESC, pass_expires DESC LIMIT 1').get(fp, sid);
    if (!dev) {
      sid = sid || randomBytes(16).toString('hex');
      const r = db.prepare('INSERT INTO devices (fp, sid, created_at) VALUES (?, ?, ?)').run(fp, sid, now());
      dev = db.prepare('SELECT * FROM devices WHERE id = ?').get(r.lastInsertRowid);
    } else {
      sid = dev.sid || sid || randomBytes(16).toString('hex');
      db.prepare('UPDATE devices SET fp = ?, sid = ? WHERE id = ?').run(fp, sid, dev.id);
      dev = { ...dev, fp, sid };
    }
    res.append('Set-Cookie', `sid=${sid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${env.NODE_ENV === 'production' ? '; Secure' : ''}`);
    return dev;
  }

  const status = (dev) => ({
    paymentsRequired: paymentsRequired(),
    freeUsed: !!dev.free_used,
    passActive: dev.pass_expires > now(),
    passExpires: dev.pass_expires > now() ? dev.pass_expires : null,
  });

  function mockEnabled() {
    return env.MOCK_PAYMENTS ? env.MOCK_PAYMENTS === 'true' : env.NODE_ENV !== 'production';
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  app.get('/api/config', (_req, res) => {
    const p = priceInfo(env);
    res.json({ paymentsRequired: paymentsRequired(), priceUsd: p.usd, priceXcd: p.xcd, mockPayments: mockEnabled() });
  });

  const withDevice = (handler) => (req, res) => {
    const dev = resolveDevice(req, res);
    if (!dev) return res.status(400).json({ error: 'missing_fingerprint' });
    return handler(dev, req, res);
  };

  app.get('/api/status', withDevice((dev, _req, res) => res.json(status(dev))));

  // Called once per input before it is accepted for processing.
  app.post('/api/accept', withDevice((dev, _req, res) => {
    const t = now();
    if (!paymentsRequired() || dev.pass_expires > t) return res.json({ ok: true, ...status(dev) });
    // Conditional update makes the free-use claim atomic.
    const r = db.prepare('UPDATE devices SET free_used = 1 WHERE id = ? AND free_used = 0').run(dev.id);
    if (r.changes === 1) return res.json({ ok: true, free: true, ...status({ ...dev, free_used: 1 }) });
    return res.status(402).json({ error: 'payment_required', ...status(dev) });
  }));

  // Stub for a real payment provider: grants a 24h pass immediately.
  app.post('/api/pay/mock-complete', withDevice((dev, _req, res) => {
    if (!mockEnabled()) return res.status(404).json({ error: 'not_available' });
    const t = now();
    const expires = Math.max(t, dev.pass_expires) + DAY_MS;
    db.prepare('UPDATE devices SET pass_expires = ? WHERE id = ?').run(expires, dev.id);
    db.prepare('INSERT INTO payments (device_id, amount_usd, provider, created_at) VALUES (?, ?, ?, ?)').run(dev.id, priceInfo(env).usd, 'mock', t);
    res.json(status({ ...dev, pass_expires: expires }));
  }));

  function adminAuth(req, res, next) {
    const token = env.ADMIN_TOKEN;
    if (!token) return res.status(503).json({ error: 'admin_disabled' });
    const given = Buffer.from((req.get('authorization') || '').replace(/^Bearer /, ''));
    const want = Buffer.from(token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return res.status(401).json({ error: 'unauthorized' });
    next();
  }
  app.get('/api/admin/settings', adminAuth, (_req, res) => res.json({ paymentsRequired: paymentsRequired() }));
  app.put('/api/admin/settings', adminAuth, (req, res) => {
    if (typeof req.body?.paymentsRequired !== 'boolean') return res.status(400).json({ error: 'paymentsRequired must be boolean' });
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('payments_required', String(req.body.paymentsRequired));
    res.json({ paymentsRequired: paymentsRequired() });
  });

  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.resolve(staticDir, 'index.html')));
  }
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: 'server_error' }));
  return { app, db };
}
