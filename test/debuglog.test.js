import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';

const AUTH = { Authorization: 'Bearer secret' };
const mk = (env = {}) => createApp({ env: { ADMIN_TOKEN: 'secret', ...env } });
const body = {
  version: '0.1.0', sessionId: 'abc-123', outcome: 'ready', paywall: 'disabled', secret: 'x',
  device: { browser: 'Chrome', os: 'macOS', deviceClass: 'desktop' },
  attempts: [
    { source: 'photo', fileType: 'image/jpeg', bytes: 1000, ocrConfidence: 88, parseScore: 0.7, fieldsFound: ['total', 'evil'], status: 'success', filename: 'lunch.jpg' },
    { source: 'upload', fileType: 'application/pdf', bytes: 5, status: 'failed', errorClass: 'Error', errorMessage: 'bad read of /Users/me/receipt-1.jpg 1234567' },
  ],
  download: { stage: 'download', format: 'csv', receipts: 1, lineItems: 2, ms: 10 },
};

describe('debug log storage', () => {
  it('stores a sanitized log with server-side paywall status', async () => {
    const app = mk({ PAYMENTS_REQUIRED: 'true' });
    await request(app).post('/api/debug-log').send(body).expect(202);
    const list = (await request(app).get('/api/admin/logs').set(AUTH).expect(200)).body;
    expect(list.logs).toHaveLength(1);
    expect(list.logs[0]).toMatchObject({ version: '0.1.0', outcome: 'ready', paywall: 'enabled', accepted: 2, processed: 1, successful: 1, failed: 1, browser: 'Chrome' });
    const full = (await request(app).get(`/api/admin/logs/${list.logs[0].id}`).set(AUTH).expect(200)).body;
    expect(full.payload.attempts).toHaveLength(2);
    expect(JSON.stringify(full)).not.toMatch(/lunch|receipt-1|Users|secret|evil|1234567/);
  });

  it('reports paywall disabled', async () => {
    const app = mk({ PAYMENTS_REQUIRED: 'false' });
    await request(app).post('/api/debug-log').send(body).expect(202);
    expect((await request(app).get('/api/admin/logs').set(AUTH)).body.logs[0].paywall).toBe('disabled');
  });

  it('stores error-triggered logs without a download section', async () => {
    const app = mk();
    const b = { version: '0.1.0', outcome: 'scan_failed', attempts: [], error: { errorClass: 'Error', errorMessage: 'boom at /tmp/x.jpg' } };
    await request(app).post('/api/debug-log').send(b).expect(202);
    const { id } = (await request(app).get('/api/admin/logs?outcome=scan_failed').set(AUTH)).body.logs[0];
    const full = (await request(app).get(`/api/admin/logs/${id}`).set(AUTH)).body;
    expect(JSON.stringify(full)).not.toMatch(/tmp|x\.jpg/);
  });

  it('filters, paginates and summarizes', async () => {
    const app = mk();
    for (const outcome of ['ready', 'scan_failed', 'ready']) await request(app).post('/api/debug-log').send({ ...body, outcome }).expect(202);
    expect((await request(app).get('/api/admin/logs?outcome=ready').set(AUTH)).body.logs).toHaveLength(2);
    const page = (await request(app).get('/api/admin/logs?limit=2').set(AUTH)).body;
    expect(page.logs).toHaveLength(2);
    expect((await request(app).get(`/api/admin/logs?limit=2&before=${page.next}`).set(AUTH)).body.logs).toHaveLength(1);
    const s = (await request(app).get('/api/admin/logs/summary').set(AUTH)).body;
    expect(s.totals).toMatchObject({ logs: 3, accepted: 6 });
    expect(s.byOutcome.find((o) => o.outcome === 'ready').n).toBe(2);
  });

  it('requires the admin token', async () => {
    const app = mk();
    await request(app).get('/api/admin/logs').expect(401);
    await request(app).get('/api/admin/logs/summary').set({ Authorization: 'Bearer nope' }).expect(401);
    await request(app).get('/api/admin/logs/999').set(AUTH).expect(404);
  });

  it('is enabled by default and can be switched off', async () => {
    expect((await request(mk()).get('/api/config')).body.debugLog).toBe(true);
    const off = mk({ DEBUG_LOG_ENABLED: 'false' });
    expect((await request(off).get('/api/config')).body.debugLog).toBe(false);
    await request(off).post('/api/debug-log').send(body).expect(404);
    expect((await request(off).get('/api/admin/logs').set(AUTH)).body.logs).toHaveLength(0);
  });
});
