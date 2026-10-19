export interface LineItem { description: string; quantity: number; price: number }

export interface Receipt {
  id: string;
  source: string;
  merchant: string;
  date: string; // ISO yyyy-mm-dd or ''
  items: LineItem[];
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  paymentMethod: string;
}

export type OutputFormat = 'csv' | 'xlsx' | 'qif' | 'iif';
