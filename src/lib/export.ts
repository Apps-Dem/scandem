import { zipSync, strToU8 } from 'fflate';
import type { OutputFormat, Receipt } from './types';

export interface OutputFile { blob: Blob; filename: string }

const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const money = (n: number | null) => (n === null ? '' : n.toFixed(2));

// Neutralise spreadsheet formula injection in OCR-derived text.
function safe(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
function csvCell(v: string | number): string {
  const s = typeof v === 'number' ? String(v) : safe(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export const RECEIPT_HEADER = ['Receipt ID', 'Source', 'Merchant', 'Date', 'Subtotal', 'Tax', 'Total', 'Payment Method'];
export const ITEM_HEADER = ['Receipt ID', 'Merchant', 'Date', 'Description', 'Quantity', 'Price'];

export function receiptRows(rs: Receipt[]): string[][] {
  return rs.map((r, i) => [String(i + 1), r.source, r.merchant, r.date, money(r.subtotal), money(r.tax), money(r.total), r.paymentMethod]);
}
export function itemRows(rs: Receipt[]): string[][] {
  return rs.flatMap((r, i) => r.items.map((it) => [String(i + 1), r.merchant, r.date, it.description, String(it.quantity), money(it.price)]));
}

export function toCsvFiles(rs: Receipt[]): Record<string, string> {
  return {
    'receipts.csv': csv([RECEIPT_HEADER, ...receiptRows(rs)]),
    'line_items.csv': csv([ITEM_HEADER, ...itemRows(rs)]),
  };
}

const qDate = (d: string) => (d ? `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}` : '');
const clean = (s: string) => s.replace(/[\t\r\n]+/g, ' ').trim();

export function toQif(rs: Receipt[]): string {
  const out = ['!Type:Bank'];
  for (const r of rs) {
    if (r.total === null) continue;
    out.push(`D${qDate(r.date)}`, `T${(-r.total).toFixed(2)}`, `P${clean(r.merchant)}`);
    if (r.paymentMethod) out.push(`M${clean(r.paymentMethod)}`);
    out.push('^');
  }
  return out.join('\r\n') + '\r\n';
}

export function toIif(rs: Receipt[]): string {
  const out = [
    '!TRNS\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO',
    '!SPL\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tMEMO',
    '!ENDTRNS',
  ];
  for (const r of rs) {
    if (r.total === null) continue;
    const d = qDate(r.date), name = clean(r.merchant), memo = clean(r.paymentMethod);
    out.push(`TRNS\tCHECK\t${d}\tChecking\t${name}\t${(-r.total).toFixed(2)}\t${memo}`);
    out.push(`SPL\tCHECK\t${d}\tUncategorized Expenses\t${name}\t${r.total.toFixed(2)}\t${memo}`);
    out.push('ENDTRNS');
  }
  return out.join('\r\n') + '\r\n';
}

async function toXlsx(rs: Receipt[]): Promise<Blob> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const head = (h: string[]) => h.map((value) => ({ value, fontWeight: 'bold' as const }));
  const num = (n: number | null) => ({ value: n ?? undefined, type: Number, format: '0.00' });
  const receipts = [
    head(RECEIPT_HEADER),
    ...rs.map((r, i) => [
      { value: i + 1, type: Number }, { value: safe(r.source) }, { value: safe(r.merchant) }, { value: r.date },
      num(r.subtotal), num(r.tax), num(r.total), { value: safe(r.paymentMethod) },
    ]),
  ];
  const items = [
    head(ITEM_HEADER),
    ...rs.flatMap((r, i) => r.items.map((it) => [
      { value: i + 1, type: Number }, { value: safe(r.merchant) }, { value: r.date },
      { value: safe(it.description) }, { value: it.quantity, type: Number }, num(it.price),
    ])),
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return writeXlsxFile([{ data: receipts as any, sheet: 'Receipts' }, { data: items as any, sheet: 'Line Items' }]).toBlob();
}

export async function buildOutput(rs: Receipt[], format: OutputFormat): Promise<OutputFile> {
  const d = stamp();
  switch (format) {
    case 'csv': {
      const files = Object.fromEntries(Object.entries(toCsvFiles(rs)).map(([k, v]) => [k, strToU8(v)]));
      return { blob: new Blob([zipSync(files)], { type: 'application/zip' }), filename: `receipts-${d}-csv.zip` };
    }
    case 'xlsx':
      return { blob: await toXlsx(rs), filename: `receipts-${d}.xlsx` };
    case 'qif':
      return { blob: new Blob([toQif(rs)], { type: 'application/qif' }), filename: `receipts-${d}.qif` };
    case 'iif':
      return { blob: new Blob([toIif(rs)], { type: 'text/plain' }), filename: `receipts-${d}.iif` };
  }
}
