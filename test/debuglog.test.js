import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';

const sent = [];
const EMAIL = { send: async (m) => { sent.push(m); } };
const mk = (env = {}) => createApp({ env: { EMAIL, ...env } });
const body = {
  version: '0.1.0', sessionId: 'abc-123', outcome: 'ready', paywall: 'disabled', secret: 'x',
  device: { browser: 'Chrome', os: 'macOS', deviceClass: 'desktop' },
  attempts: [
    { source: 'photo', fileType: 'image/jpeg', bytes: 1000, ocrConfidence: 88, parseScore: 0.7, fieldsFound: ['total', 'evil'], status: 'success', filename: 'lunch.jpg' },
    { source: 'upload', fileType: 'application/pdf', bytes: 5, status: 'failed', errorClass: 'Error', errorMessage: 'bad read of /Users/me/receipt-1.jpg 1234567' },
  ],
  download: { stage: 'download', format: 'csv', receipts: 1, lineItems: 2, ms: 10 },
};

describe('debug log', () => {
  it('emails a sanitized log with server-side paywall status', async () => {
    sent.length = 0;
    await request(mk({ PAYMENTS_REQUIRED: 'true' })).post('/api/debug-log').send(body).expect(202);
    expect(sent).toHaveLength(1);
    const m = sent[0];
    expect(m.to).toBe('support@boundless-tallawah.com');
    expect(m.text).toContain('Paywall: enabled');
    expect(m.text).toContain('Accepted: 2  Processed: 1  Successful: 1  Failed: 1');
    expect(m.text).not.toMatch(/lunch|receipt-1|Users|secret|evil|1234567/);
  });

  it('reports paywall disabled', async () => {
    sent.length = 0;
    await request(mk({ PAYMENTS_REQUIRED: 'false' })).post('/api/debug-log').send(body).expect(202);
    expect(sent[0].text).toContain('Paywall: disabled');
  });

  it('is enabled by default and can be switched off', async () => {
    expect((await request(mk()).get('/api/config')).body.debugLog).toBe(true);
    const off = mk({ DEBUG_LOG_ENABLED: 'false' });
    expect((await request(off).get('/api/config')).body.debugLog).toBe(false);
    sent.length = 0;
    await request(off).post('/api/debug-log').send(body).expect(404);
    expect(sent).toHaveLength(0);
  });

  it('accepts error-triggered logs without a download section', async () => {
    sent.length = 0;
    const b = { version: '0.1.0', outcome: 'scan_failed', attempts: [], error: { errorClass: 'Error', errorMessage: 'boom at /tmp/x.jpg' } };
    await request(mk()).post('/api/debug-log').send(b).expect(202);
    expect(sent[0].subject).toContain('scan_failed');
    expect(sent[0].text).not.toMatch(/tmp|x\.jpg/);
  });
});
