import { describe, it, expect } from 'vitest';
import { parseReceipt, findDate } from '../src/lib/parse';
import { toCsvFiles, toQif, toIif } from '../src/lib/export';

const SAMPLE = `CORNER MARKET
123 Main St  Tel 555-1234
03/14/2025  10:42
2 x Bananas        1.50
Milk 2L            3.25
Bread              2.10
Subtotal           6.85
Tax 8%             0.55
TOTAL              7.40
VISA ****1234      7.40`;

describe('parser', () => {
  const r = parseReceipt(SAMPLE, 'a.jpg', '1');
  it('extracts header fields', () => {
    expect(r.merchant).toBe('CORNER MARKET');
    expect(r.date).toBe('2025-03-14');
    expect(r.subtotal).toBe(6.85);
    expect(r.tax).toBe(0.55);
    expect(r.total).toBe(7.4);
    expect(r.paymentMethod).toBe('Visa');
  });
  it('extracts items with quantity', () => {
    expect(r.items.map((i) => [i.description, i.quantity, i.price])).toEqual([['Bananas', 2, 1.5], ['Milk 2L', 1, 3.25], ['Bread', 1, 2.1]]);
  });
  it('handles dates', () => {
    expect(findDate('25/12/2024')).toBe('2024-12-25');
    expect(findDate('5 Jan 2025')).toBe('2025-01-05');
  });
});

describe('exporters', () => {
  const rs = [parseReceipt(SAMPLE, 'a.jpg', '1'), parseReceipt('EVIL\nTotal 1.00', '=b.jpg', '2')];
  it('csv has two files and guards formulas', () => {
    const f = toCsvFiles(rs);
    expect(Object.keys(f)).toEqual(['receipts.csv', 'line_items.csv']);
    expect(f['receipts.csv']).toContain("'=b.jpg");
    expect(f['line_items.csv']).toContain('Bananas,2,1.50');
  });
  it('qif / iif', () => {
    expect(toQif(rs)).toContain('T-7.40');
    expect(toIif(rs)).toContain('TRNS\tCHECK\t03/14/2025');
  });
});
