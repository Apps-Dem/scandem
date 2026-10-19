import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp, priceInfo } from '../server/app.js';

const FP = 'a'.repeat(64);
const mk = (env = {}) => createApp({ env: { ADMIN_TOKEN: 'secret', ...env } }).app;

describe('pricing', () => {
  it('rounds XCD up: $5 -> 14', () => expect(priceInfo({}).xcd).toBe(14));
});

describe('accept / paywall', () => {
  it('first accept is free, second needs payment, pass unlocks', async () => {
    const a = request.agent(mk());
    expect((await a.post('/api/accept').set('x-device-fp', FP)).body.free).toBe(true);
    expect((await a.post('/api/accept').set('x-device-fp', FP)).status).toBe(402);
    await a.post('/api/pay/mock-complete').set('x-device-fp', FP).expect(200);
    expect((await a.post('/api/accept').set('x-device-fp', FP)).status).toBe(200);
  });

  it('same fingerprint without cookie is still the same device', async () => {
    const app = mk();
    await request(app).post('/api/accept').set('x-device-fp', FP).expect(200);
    await request(app).post('/api/accept').set('x-device-fp', FP).expect(402);
  });

  it('same cookie with new fingerprint is still the same device', async () => {
    const a = request.agent(mk());
    await a.post('/api/accept').set('x-device-fp', FP).expect(200);
    await a.post('/api/accept').set('x-device-fp', 'b'.repeat(64)).expect(402);
  });

  it('pass expires after 24h', async () => {
    let t = 1_000_000;
    const { app } = createApp({ env: {}, now: () => t });
    const a = request.agent(app);
    await a.post('/api/accept').set('x-device-fp', FP);
    await a.post('/api/pay/mock-complete').set('x-device-fp', FP);
    t += 23 * 3600e3;
    await a.post('/api/accept').set('x-device-fp', FP).expect(200);
    t += 2 * 3600e3;
    await a.post('/api/accept').set('x-device-fp', FP).expect(402);
  });

  it('requires a fingerprint', async () => {
    await request(mk()).post('/api/accept').expect(400);
  });
});

describe('admin toggle', () => {
  it('requires token and disables payment requirement', async () => {
    const app = mk();
    await request(app).put('/api/admin/settings').send({ paymentsRequired: false }).expect(401);
    await request(app).put('/api/admin/settings').set('Authorization', 'Bearer secret').send({ paymentsRequired: false }).expect(200);
    expect((await request(app).get('/api/config')).body.paymentsRequired).toBe(false);
    for (let i = 0; i < 3; i++) await request(app).post('/api/accept').set('x-device-fp', FP).expect(200);
  });
  it('is disabled without ADMIN_TOKEN', async () => {
    await request(createApp({ env: {} }).app).get('/api/admin/settings').expect(503);
  });
  it('mock payments disabled in production by default', async () => {
    const app = createApp({ env: { NODE_ENV: 'production' } }).app;
    await request(app).post('/api/pay/mock-complete').set('x-device-fp', FP).expect(404);
  });
});
