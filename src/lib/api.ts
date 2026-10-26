import { getFingerprint } from './fingerprint';

export interface Config { paymentsRequired: boolean; priceUsd: number; priceXcd: number; mockPayments: boolean; debugLog: boolean }
export interface Status { paymentsRequired: boolean; freeUsed: boolean; passActive: boolean; passExpires: number | null }

async function call<T>(path: string, method = 'GET'): Promise<{ status: number; body: T }> {
  const res = await fetch(path, { method, credentials: 'same-origin', headers: { 'x-device-fp': await getFingerprint() } });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
}

export const getConfig = async () => (await call<Config>('/api/config')).body;
export const getStatus = async () => (await call<Status>('/api/status')).body;

/** Asks the server for permission to process one input. */
export async function acceptInput(): Promise<'ok' | 'payment_required'> {
  const { status } = await call('/api/accept', 'POST');
  if (status === 200) return 'ok';
  if (status === 402) return 'payment_required';
  throw new Error('Could not verify usage. Check your connection and try again.');
}

export async function mockPay(): Promise<Status> {
  const { status, body } = await call<Status>('/api/pay/mock-complete', 'POST');
  if (status !== 200) throw new Error('Payment unavailable.');
  return body;
}
