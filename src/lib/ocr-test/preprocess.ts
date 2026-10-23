/**
 * Pre-processing utilities for Tesseract.js receipt OCR accuracy
 * 
 * Applied BEFORE Tesseract recognition to improve results on paper receipt photos
 */

export interface PreprocessOptions {
  /** Upscale factor for small text (1-3 recommended) */
  scale?: number;
  /** Apply adaptive thresholding (true/false) */
  threshold?: boolean;
  /** Apply deskewing (true/false) - requires additional lib */
  deskew?: boolean;
  /** Character whitelist regex pattern */
  charWhitelist?: string;
  /** Tesseract PSM page segmentation mode */
  psm?: number;
  /** Contrast enhancement factor */
  contrast?: number;
}

/**
 * Preprocess an image canvas for better Tesseract.js OCR results
 * Particularly effective for thermal receipt photos
 */
export async function preprocessCanvas(
  canvas: HTMLCanvasElement,
  options: PreprocessOptions = {}
): Promise<HTMLCanvasElement> {
  const ctx = canvas.getContext('2d')!;
  const { scale = 2, threshold = true, deskew = false, charWhitelist, psm = 6, contrast = 1.0 } = options;

  // Step 1: Enhance contrast
  if (contrast !== 1.0) {
    ctx.filter = `contrast(${contrast})`;
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height);
    // Clear the filter after applying
    ctx.filter = 'none';
  }

  // Step 2: Convert to grayscale and apply thresholding
  if (threshold) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < imageData.data.length; i += 4) {
      // Luminosity formula: Y = 0.299R + 0.587G + 0.114B
      const r = imageData.data[i];
      const g = imageData.data[i + 1];
      const b = imageData.data[i + 2];
      const brightness = r * 0.299 + g * 0.587 + b * 0.114;
      
      // Binarize: 0 or 255
      const value = brightness > 128 ? 255 : 0;
      imageData.data[i] = value;           // R
      imageData.data[i + 1] = value;       // G
      imageData.data[i + 2] = value;       // B
      // Keep A (data[i+3]) unchanged
    }
    ctx.putImageData(imageData, 0, 0);
  }

  // Step 3: Upscale to improve small text recognition
  if (scale > 1) {
    const scaled = document.createElement('canvas');
    scaled.width = canvas.width * scale;
    scaled.height = canvas.height * scale;
    const sctx = scaled.getContext('2d')!;
    sctx.imageSmoothingEnabled = false; // Preserve sharp edges
    sctx.drawImage(canvas, 0, 0, scaled.width, scaled.height);
    // Replace original with scaled version
    canvas.width = scaled.width;
    canvas.height = scaled.height;
    ctx.drawImage(scaled, 0, 0, canvas.width, canvas.height);
  }

  // Step 4: Apply character whitelist if specified (draw outside chars to white)
  if (charWhitelist) {
    // Note: Whitelist is best applied via Tesseract config, 
    // but we can pre-filter noise here
    // For now, we'll just ensure clean output
  }

  // Step 5: Deskew if requested (basic implementation)
  // Full deskewing requires Hough transform - optional for now
  if (deskew) {
    // TODO: Implement proper deskewing
    console.log('Deskew requested but not fully implemented');
  }

  return canvas;
}

/**
 * Convert canvas to data URI optimized for Tesseract.js
 */
export function canvasToTessDataUri(canvas: HTMLCanvasElement): string {
  // Use PNG format for lossless quality (better than JPEG for OCR)
  return canvas.toDataURL('image/png');
}

/**
 * Generate Tesseract.js configuration object from options
 */
export function generateTessConfig(options: PreprocessOptions = {}): Record<string, any> {
  const { psm = 6, charWhitelist } = options;
  
  const config: Record<string, any> = {
    tessedit_pageseg_mode: psm,  // Page segmentation modes:
    // 3: Fully automatic page segmentation, 
    //    but no OSD or script detection is performed
    // 6: Assume a single uniform block of text
    // 4: Assume a single column of text of variable sizes
    // 11: Sparse text with OSD
  };
  
  if (charWhitelist) {
    config.tessedit_char_whitelist = charWhitelist;
  }
  
  return config;
}

/**
 * Common preprocess configurations for receipt types
 */
export const RECEIPT_PRESETS = {
  /** Thermal receipt - high contrast, single block of text */
  thermal: {
    scale: 2,
    threshold: true,
    contrast: 1.5,
    psm: 6, // Single uniform block
    charWhitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:$%,.-',
  },
  
  /** Receipt with some glare/gloss */
  glossy: {
    scale: 3,
    threshold: true,
    contrast: 2.0,
    psm: 6,
    charWhitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:$%,.-',
  },
  
  /** Faded/low-quality receipt */
  faded: {
    scale: 3,
    threshold: true,
    contrast: 2.5,
    psm: 6,
    charWhitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:$%,.-',
  },
  
  /** Angled/receipt at an angle */
  angled: {
    scale: 2,
    threshold: true,
    contrast: 1.8,
    psm: 3, // Fully automatic but no OSD
    charWhitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:$%,.-',
  },
};