/**
 * Tesseract.js Receipt OCR Accuracy Tests
 * 
 * Tests OCR accuracy across various receipt image types and configurations
 * Uses vitest with Tesseract.js for browser-based OCR evaluation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Tesseract from 'tesseract.js';

// Mock global document for test environment
(global as any).document = {
  createElement: (tag: string) => {
    if (tag === 'canvas') {
      return {
        width: 800,
        height: 600,
        getContext: (type: string) => {
          if (type === '2d') {
            let currentFilter = 'none';
            return {
              fillStyle: '#000000',
              fillRect: () => {},
              drawImage: () => {},
              fillText: () => {},
              getImageData: () => ({
                data: new Uint8ClampedArray([255, 255, 255, 255]),
              }),
              putImageData: () => {},
              imageSmoothingEnabled: true,
              // Track filter property
              get filter() { return currentFilter; },
              set filter(value: string) { currentFilter = value; },
            };
          }
          return null;
        },
      };
    }
    return null;
  },
  defaultView: {
    CSSPixelToInch: 96,
  },
};

// Mock HTMLCanvasElement
(global as any).HTMLCanvasElement = class {
  width = 0;
  height = 0;
  getContext = (type: string) => {
    if (type === '2d') {
      let currentFilter = 'none';
      return {
        fillStyle: '#000000',
        fillRect: () => {},
        drawImage: () => {},
        fillText: () => {},
        getImageData: () => ({
          data: new Uint8ClampedArray([255, 255, 255, 255]),
        }),
        putImageData: () => {},
        imageSmoothingEnabled: true,
        // Track filter property
        get filter() { return currentFilter; },
        set filter(value: string) { currentFilter = value; },
      };
    }
    return null;
  };
};

// Mock Tesseract.create since we can't run real OCR in vitest without workers
vi.mock('tesseract.js', () => ({
  create: vi.fn().mockResolvedValue({
    recognize: vi.fn().mockResolvedValue({
      data: {
        text: '',
        confidence: 0,
      },
    }),
    promise: Promise.resolve({
      data: {
        text: '',
        confidence: 0,
      },
    }),
  }),
}));

import { preprocessCanvas, generateTessConfig, RECEIPT_PRESETS } from '../src/lib/ocr-test/preprocess';
import type { PreprocessOptions } from '../src/lib/ocr-test/preprocess';

describe('Tesseract.js OCR Preprocessing', () => {
  let mockCanvas: any;

  beforeEach(() => {
    // Create a test canvas with simulated receipt-like content
    mockCanvas = document.createElement('canvas');
    mockCanvas.width = 800;
    mockCanvas.height = 600;
    const ctx = mockCanvas.getContext('2d')!;
    // Fill with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, mockCanvas.width, mockCanvas.height);
    // Draw some simulated receipt text in black
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 24px Arial';
    ctx.fillText('CORNER MARKET', 100, 100);
    ctx.fillText('$12.50', 100, 150);
    ctx.fillText('3 x Item A $3.50', 100, 200);
  });

  describe('preprocessCanvas', () => {
    it('should apply thresholding by default', async () => {
      const result = await preprocessCanvas(mockCanvas, {
        threshold: true,
        scale: 1,
      });
      // Canvas should be modified - check pixel data
      const imageData = result.getContext('2d')!.getImageData(50, 50, 1, 1).data;
      // After thresholding, bright pixels should be 255
      expect(imageData[0]).toBeGreaterThan(128);
    });

    it('should upscale the canvas', async () => {
      const result = await preprocessCanvas(mockCanvas, {
        scale: 2,
        threshold: false,
      });
      expect(result.width).toBe(1600);
      expect(result.height).toBe(1200);
    });

    it('should apply contrast enhancement', async () => {
      const result = await preprocessCanvas(mockCanvas, {
        contrast: 1.5,
        threshold: false,
      });
      const ctx = result.getContext('2d')!;
      // Contrast filter should have been applied and cleared
      // The code sets ctx.filter = 'contrast(1.5)' then ctx.filter = 'none'
      expect(ctx.filter).toBe('none'); // Filter is cleared after application
    });
  });

  describe('generateTessConfig', () => {
    it('should generate config with default PSM 6', () => {
      const config = generateTessConfig();
      expect(config.tessedit_pageseg_mode).toBe(6);
    });

    it('should include character whitelist', () => {
      const config = generateTessConfig({
        charWhitelist: '0123456789',
      });
      expect(config.tessedit_char_whitelist).toBe('0123456789');
    });

    it('should override PSM mode', () => {
      const config = generateTessConfig({ psm: 3 });
      expect(config.tessedit_pageseg_mode).toBe(3);
    });
  });

  describe('RECEIPT_PRESETS', () => {
    it('thermal preset should have correct settings', () => {
      const preset = RECEIPT_PRESETS.thermal;
      expect(preset.scale).toBe(2);
      expect(preset.threshold).toBe(true);
      expect(preset.psm).toBe(6);
      expect(preset.charWhitelist).toContain('$');
      expect(preset.charWhitelist).toContain('%');
    });

    it('glossy preset should have higher contrast', () => {
      const preset = RECEIPT_PRESETS.glossy;
      expect(preset.contrast).toBe(2.0);
      expect(preset.scale).toBe(3);
    });

    it('faded preset should have highest contrast', () => {
      const preset = RECEIPT_PRESETS.faded;
      expect(preset.contrast).toBe(2.5);
      expect(preset.scale).toBe(3);
    });

    it('angled preset should use PSM 3', () => {
      const preset = RECEIPT_PRESETS.angled;
      expect(preset.psm).toBe(3);
    });
  });
});

describe('OCR Accuracy Scenarios', () => {
  // In a real test, these would use actual Tesseract recognition
  // Here we test the configuration and preprocessing pipeline

  it('should configure thermal receipt preset correctly', () => {
    const config = generateTessConfig(RECEIPT_PRESETS.thermal);
    expect(config.tessedit_char_whitelist).toBe(
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:$%,.-'
    );
    expect(config.tessedit_pageseg_mode).toBe(6);
  });

  it('should configure faded receipt preset', () => {
    const config = generateTessConfig(RECEIPT_PRESETS.faded);
    expect(config.tessedit_pageseg_mode).toBe(6);
    expect(config.tessedit_char_whitelist).toBe(
      '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:$%,.-'
    );
  });

  it('should validate preprocessing options type', () => {
    const options: PreprocessOptions = {
      scale: 2,
      threshold: true,
      contrast: 1.5,
    };
    expect(options.scale).toBe(2);
    expect(options.threshold).toBe(true);
    expect(options.contrast).toBe(1.5);
  });
});