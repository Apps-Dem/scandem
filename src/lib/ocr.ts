import type { Worker } from 'tesseract.js';

const MAX_DIM = 2200;
const MAX_PDF_PAGES = 8;

let workerPromise: Promise<Worker> | null = null;
async function getWorker(): Promise<Worker> {
  workerPromise ??= import('tesseract.js').then(({ createWorker }) => createWorker('eng'));
  return workerPromise;
}

/** Starts loading the OCR engine in the background; a failed preload is retried on first scan. */
export function preloadOcr(): void {
  getWorker().catch(() => { workerPromise = null; });
}

function toCanvas(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.filter = 'grayscale(1) contrast(1.25)';
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export interface OcrResult { text: string; confidence: number; width: number; height: number; pages: number }

async function recognize(c: HTMLCanvasElement): Promise<{ text: string; confidence: number }> {
  const w = await getWorker();
  const { data } = await w.recognize(c);
  return { text: data.text, confidence: data.confidence };
}

async function pdfText(file: File): Promise<OcrResult> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const parts: string[] = [];
  const confs: number[] = [];
  let width = 0, height = 0;
  for (let p = 1; p <= Math.min(doc.numPages, MAX_PDF_PAGES); p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width; canvas.height = viewport.height;
    width = Math.max(width, canvas.width); height = Math.max(height, canvas.height);
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;
    const r = await recognize(toCanvas(canvas, canvas.width, canvas.height));
    parts.push(r.text); confs.push(r.confidence);
  }
  await task.destroy();
  const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
  return { text: parts.join('\n'), confidence, width, height, pages: parts.length };
}

export const isSupported = (f: File) => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.(pdf|jpe?g|png|webp|heic|bmp)$/i.test(f.name);

export async function ocrFile(file: File): Promise<OcrResult> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return pdfText(file);
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const r = await recognize(toCanvas(bmp, bmp.width, bmp.height));
    return { ...r, width: bmp.width, height: bmp.height, pages: 1 };
  } finally { bmp.close(); }
}
