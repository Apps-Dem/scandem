import type { LineItem, Receipt } from './types';

const AMOUNT = /(-?)\$?\s?(\d{1,3}(?:[,\s]\d{3})*|\d+)[.,](\d{2})(?!\d)/g;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function amounts(line: string): { value: number; index: number; raw: string }[] {
  const out: { value: number; index: number; raw: string }[] = [];
  for (const m of line.matchAll(AMOUNT)) {
    const whole = m[2].replace(/[,\s]/g, '');
    const v = Number(`${whole}.${m[3]}`);
    out.push({ value: m[1] ? -v : v, index: m.index ?? 0, raw: m[0] });
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : '';
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

export function findDate(text: string): string {
  let m = text.match(/\b(20\d{2}|19\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/);
  if (m) {
    const a = +m[1], b = +m[2];
    // Assume US month/day unless that is impossible.
    return a > 12 ? iso(fullYear(+m[3]), b, a) : iso(fullYear(+m[3]), a, b);
  }
  m = text.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = text.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS.includes(m[1].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return '';
}

const PAYMENT = /\b(visa|master\s?card|mastercard|amex|american express|discover|debit|credit|cash|check|cheque|apple pay|google pay|gift card|paypal)\b/i;
const SUBTOTAL = /sub\s*-?\s*total/i;
const TAX = /\b(tax|vat|gst|hst|pst)\b/i;
const TOTAL = /\b(grand\s+total|total|amount\s+due|balance\s+due|amount)\b/i;
const NON_ITEM = /\b(total|sub\s*-?total|tax|vat|gst|change|tender|visa|master\s?card|amex|debit|credit|cash|balance|amount|payment|tip|discount|savings|card|auth|approval|ref|invoice|receipt|tel|phone)\b/i;

function splitQty(text: string, price: number): { description: string; quantity: number; price: number } {
  let t = text.trim();
  let quantity = 1;
  let m = t.match(/^(\d{1,3})\s*[xX@]\s*/) || t.match(/^(\d{1,3})\s+(?=[A-Za-z])/);
  if (m) { quantity = +m[1]; t = t.slice(m[0].length); }
  else if ((m = t.match(/\s*[xX]\s*(\d{1,3})$/))) { quantity = +m[1]; t = t.slice(0, m.index); }
  t = t.replace(/\s*@\s*$/, '').replace(/[\s.\-_*]+$/, '').replace(/\s{2,}/g, ' ').trim();
  return { description: t, quantity: quantity || 1, price };
}

export function parseReceipt(text: string, source: string, id: string): Receipt {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const r: Receipt = { id, source, merchant: '', date: findDate(text), items: [], subtotal: null, tax: null, total: null, paymentMethod: '' };

  r.merchant = lines.slice(0, 6).find((l) => /[A-Za-z]{3,}/.test(l) && !findDate(l) && !/\d{3}[-.\s]\d{4}/.test(l) && !amounts(l).length) ?? '';
  r.merchant = r.merchant.replace(/[^\p{L}\p{N}&'.,\- ]/gu, '').trim();

  const pm = text.match(PAYMENT);
  if (pm) r.paymentMethod = pm[1].toLowerCase().replace(/\s+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

  const all: number[] = [];
  for (const line of lines) {
    const amts = amounts(line);
    if (!amts.length) continue;
    const last = amts[amts.length - 1].value;
    all.push(last);
    if (SUBTOTAL.test(line)) { r.subtotal ??= last; continue; }
    if (TAX.test(line) && !TOTAL.test(line.replace(TAX, ''))) { r.tax ??= last; continue; }
    if (TOTAL.test(line) && !/change|tender/i.test(line)) { r.total = last; continue; }
    if (NON_ITEM.test(line)) continue;
    const desc = line.slice(0, amts[0].index).replace(/\s[A-Z]$/, '');
    const withUnit = amts.length > 1 ? amts[amts.length - 1].value : last;
    const item: LineItem = splitQty(desc, withUnit);
    if (/[A-Za-z]/.test(item.description)) r.items.push(item);
  }
  if (r.total === null && all.length) r.total = Math.max(...all);
  if (r.subtotal === null && r.items.length) {
    r.subtotal = Math.round(r.items.reduce((s, i) => s + i.price, 0) * 100) / 100;
  }
  return r;
}
