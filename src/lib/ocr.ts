import { getFingerprint } from './fingerprint';

const MAX_DIM = 2200;
const MAX_PDF_PAGES = 8;
const MAX_IMAGE_CHARS = 4 * 1024 * 1024;
const MAX_TOTAL_IMAGE_CHARS = 10 * 1024 * 1024;

function toCanvas(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_DIM / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function toDataUri(canvas: HTMLCanvasElement): string {
  const image = canvas.toDataURL('image/jpeg', 0.88);
  if (image.length > MAX_IMAGE_CHARS) throw new Error('An image is too large for cloud OCR. Try a smaller file.');
  return image;
}

async function recognize(images: string[], token: string): Promise<string> {
  if (images.reduce((total, image) => total + image.length, 0) > MAX_TOTAL_IMAGE_CHARS) {
    throw new Error('This file is too large for cloud OCR. Try a smaller file.');
  }
  let response: Response;
  try {
    response = await fetch('/api/ocr', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-device-fp': await getFingerprint(),
      },
      body: JSON.stringify({ images }),
    });
  } catch {
    throw new Error('Could not reach the cloud OCR service. Check your connection and try again.');
  }
  const result = await response.json().catch(() => ({})) as { text?: string; error?: string };
  if (!response.ok) {
    if (result.error === 'ocr_unavailable') throw new Error('Cloud OCR is unavailable right now. Please try again later.');
    if (result.error === 'ocr_image_too_large') throw new Error('This file is too large for cloud OCR. Try a smaller file.');
    if (result.error === 'ocr_failed') throw new Error('Cloud OCR could not read this file. Try a clearer, well-lit image.');
    throw new Error('Could not authorize cloud OCR. Please try again.');
  }
  if (typeof result.text !== 'string') throw new Error('Cloud OCR returned an invalid response. Please try again.');
  return result.text;
}

async function pdfText(file: File, token: string): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    const images: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, MAX_PDF_PAGES); p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport, canvas }).promise;
      images.push(toDataUri(toCanvas(canvas, canvas.width, canvas.height)));
    }
    return await recognize(images, token);
  } finally {
    await task.destroy();
  }
}

export const isSupported = (f: File) => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.(pdf|jpe?g|png|webp|heic|bmp)$/i.test(f.name);

export async function ocrFile(file: File, token: string): Promise<string> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return pdfText(file, token);
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try { return await recognize([toDataUri(toCanvas(bmp, bmp.width, bmp.height))], token); } finally { bmp.close(); }
}
