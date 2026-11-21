/**
 * TRMNL-Horizon Core Engine (UMD: Browser + Node.js)
 * 800x480 1-Bit & 2-Bit E-Paper Framebuffer, Dithering Pipeline,
 * Official TRMNL BYOS Protocol Handlers (/api/setup, /api/display, /api/log),
 * 1-Bit Packed BMP/PNG Encoder, Battery Physics Model, and Liquid Exporter.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TrmnlEngine = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DISPLAY_WIDTH = 800;
  const DISPLAY_HEIGHT = 480;

  // Compact 5x7 ASCII bitmap font (columns encoded as 5 bytes, LSB = top row)
  const FONT_5X7 = {
    ' ': [0x00, 0x00, 0x00, 0x00, 0x00],
    '!': [0x00, 0x00, 0x5f, 0x00, 0x00],
    '"': [0x00, 0x07, 0x00, 0x07, 0x00],
    '#': [0x14, 0x7f, 0x14, 0x7f, 0x14],
    '$': [0x24, 0x2a, 0x7f, 0x2a, 0x12],
    '%': [0x23, 0x13, 0x08, 0x64, 0x62],
    '&': [0x36, 0x49, 0x55, 0x22, 0x50],
    "'": [0x00, 0x05, 0x03, 0x00, 0x00],
    '(': [0x00, 0x1c, 0x22, 0x41, 0x00],
    ')': [0x00, 0x41, 0x22, 0x1c, 0x00],
    '*': [0x14, 0x08, 0x3e, 0x08, 0x14],
    '+': [0x08, 0x08, 0x3e, 0x08, 0x08],
    ',': [0x00, 0x50, 0x30, 0x00, 0x00],
    '-': [0x08, 0x08, 0x08, 0x08, 0x08],
    '.': [0x00, 0x60, 0x60, 0x00, 0x00],
    '/': [0x20, 0x10, 0x08, 0x04, 0x02],
    '0': [0x3e, 0x51, 0x49, 0x45, 0x3e],
    '1': [0x00, 0x42, 0x7f, 0x40, 0x00],
    '2': [0x42, 0x61, 0x51, 0x49, 0x46],
    '3': [0x21, 0x41, 0x45, 0x4b, 0x31],
    '4': [0x18, 0x14, 0x12, 0x7f, 0x10],
    '5': [0x27, 0x45, 0x45, 0x45, 0x39],
    '6': [0x3c, 0x4a, 0x49, 0x49, 0x30],
    '7': [0x01, 0x71, 0x09, 0x05, 0x03],
    '8': [0x36, 0x49, 0x49, 0x49, 0x36],
    '9': [0x06, 0x49, 0x49, 0x29, 0x1e],
    ':': [0x00, 0x36, 0x36, 0x00, 0x00],
    ';': [0x00, 0x56, 0x36, 0x00, 0x00],
    '<': [0x08, 0x14, 0x22, 0x41, 0x00],
    '=': [0x14, 0x14, 0x14, 0x14, 0x14],
    '>': [0x00, 0x41, 0x22, 0x14, 0x08],
    '?': [0x02, 0x01, 0x51, 0x09, 0x06],
    '@': [0x32, 0x49, 0x79, 0x41, 0x3e],
    'A': [0x7e, 0x11, 0x11, 0x11, 0x7e],
    'B': [0x7f, 0x49, 0x49, 0x49, 0x36],
    'C': [0x3e, 0x41, 0x41, 0x41, 0x22],
    'D': [0x7f, 0x41, 0x41, 0x22, 0x1c],
    'E': [0x7f, 0x49, 0x49, 0x49, 0x41],
    'F': [0x7f, 0x09, 0x09, 0x09, 0x01],
    'G': [0x3e, 0x41, 0x49, 0x49, 0x7a],
    'H': [0x7f, 0x08, 0x08, 0x08, 0x7f],
    'I': [0x00, 0x41, 0x7f, 0x41, 0x00],
    'J': [0x20, 0x40, 0x41, 0x3f, 0x01],
    'K': [0x7f, 0x08, 0x14, 0x22, 0x41],
    'L': [0x7f, 0x40, 0x40, 0x40, 0x40],
    'M': [0x7f, 0x02, 0x0c, 0x02, 0x7f],
    'N': [0x7f, 0x04, 0x08, 0x10, 0x7f],
    'O': [0x3e, 0x41, 0x41, 0x41, 0x3e],
    'P': [0x7f, 0x09, 0x09, 0x09, 0x06],
    'Q': [0x3e, 0x41, 0x51, 0x21, 0x5e],
    'R': [0x7f, 0x09, 0x19, 0x29, 0x46],
    'S': [0x46, 0x49, 0x49, 0x49, 0x31],
    'T': [0x01, 0x01, 0x7f, 0x01, 0x01],
    'U': [0x3f, 0x40, 0x40, 0x40, 0x3f],
    'V': [0x1f, 0x20, 0x40, 0x20, 0x1f],
    'W': [0x3f, 0x40, 0x38, 0x40, 0x3f],
    'X': [0x63, 0x14, 0x08, 0x14, 0x63],
    'Y': [0x07, 0x08, 0x70, 0x08, 0x07],
    'Z': [0x61, 0x51, 0x49, 0x45, 0x43],
    '[': [0x00, 0x7f, 0x41, 0x41, 0x00],
    '\\': [0x02, 0x04, 0x08, 0x10, 0x20],
    ']': [0x00, 0x41, 0x41, 0x7f, 0x00],
    '^': [0x04, 0x02, 0x01, 0x02, 0x04],
    '_': [0x40, 0x40, 0x40, 0x40, 0x40],
    '`': [0x00, 0x01, 0x02, 0x04, 0x00],
    'a': [0x20, 0x54, 0x54, 0x54, 0x78],
    'b': [0x7f, 0x48, 0x44, 0x44, 0x38],
    'c': [0x38, 0x44, 0x44, 0x44, 0x20],
    'd': [0x38, 0x44, 0x44, 0x48, 0x7f],
    'e': [0x38, 0x54, 0x54, 0x54, 0x18],
    'f': [0x08, 0x7e, 0x09, 0x01, 0x02],
    'g': [0x0c, 0x52, 0x52, 0x52, 0x3e],
    'h': [0x7f, 0x08, 0x04, 0x04, 0x78],
    'i': [0x00, 0x44, 0x7d, 0x40, 0x00],
    'j': [0x20, 0x40, 0x44, 0x3d, 0x00],
    'k': [0x7f, 0x10, 0x28, 0x44, 0x00],
    'l': [0x00, 0x41, 0x7f, 0x40, 0x00],
    'm': [0x7c, 0x04, 0x18, 0x04, 0x78],
    'n': [0x7c, 0x08, 0x04, 0x04, 0x78],
    'o': [0x38, 0x44, 0x44, 0x44, 0x38],
    'p': [0x7c, 0x14, 0x14, 0x14, 0x08],
    'q': [0x08, 0x14, 0x14, 0x18, 0x7c],
    'r': [0x7c, 0x08, 0x04, 0x04, 0x08],
    's': [0x48, 0x54, 0x54, 0x54, 0x20],
    't': [0x04, 0x3f, 0x44, 0x40, 0x20],
    'u': [0x3c, 0x40, 0x40, 0x20, 0x7c],
    'v': [0x1c, 0x20, 0x40, 0x20, 0x1c],
    'w': [0x3c, 0x40, 0x30, 0x40, 0x3c],
    'x': [0x44, 0x28, 0x10, 0x28, 0x44],
    'y': [0x0c, 0x50, 0x50, 0x50, 0x3c],
    'z': [0x44, 0x64, 0x54, 0x4c, 0x44],
    '{': [0x00, 0x08, 0x36, 0x41, 0x00],
    '|': [0x00, 0x00, 0x7f, 0x00, 0x00],
    '}': [0x00, 0x41, 0x36, 0x08, 0x00],
    '~': [0x08, 0x04, 0x08, 0x10, 0x08],
    '°': [0x00, 0x06, 0x09, 0x09, 0x06]
  };

  /**
   * 8-Bit Grayscale Framebuffer with vector/bitmap primitives for e-paper layouts.
   * 0 = pure black ink, 255 = pure white e-paper substrate.
   */
  class EInkFramebuffer {
    constructor(width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT, fillValue = 255) {
      this.width = width;
      this.height = height;
      this.pixels = new Uint8Array(width * height);
      this.clear(fillValue);
    }

    clear(value = 255) {
      const clamped = Math.max(0, Math.min(255, value | 0));
      this.pixels.fill(clamped);
      return this;
    }

    setPixel(x, y, gray) {
      const xi = x | 0;
      const yi = y | 0;
      if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return;
      this.pixels[yi * this.width + xi] = Math.max(0, Math.min(255, gray | 0));
    }

    getPixel(x, y) {
      const xi = x | 0;
      const yi = y | 0;
      if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return 255;
      return this.pixels[yi * this.width + xi];
    }

    fillRect(x, y, w, h, gray = 0) {
      const x0 = Math.max(0, x | 0);
      const y0 = Math.max(0, y | 0);
      const x1 = Math.min(this.width, (x + w) | 0);
      const y1 = Math.min(this.height, (y + h) | 0);
      const val = Math.max(0, Math.min(255, gray | 0));
      for (let py = y0; py < y1; py++) {
        const rowOffset = py * this.width;
        for (let px = x0; px < x1; px++) {
          this.pixels[rowOffset + px] = val;
        }
      }
      return this;
    }

    fillGradientRect(x, y, w, h, grayStart, grayEnd, vertical = false) {
      const x0 = Math.max(0, x | 0);
      const y0 = Math.max(0, y | 0);
      const x1 = Math.min(this.width, (x + w) | 0);
      const y1 = Math.min(this.height, (y + h) | 0);
      const span = Math.max(1, vertical ? (y1 - y0 - 1) : (x1 - x0 - 1));
      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const t = vertical ? (py - y0) / span : (px - x0) / span;
          const val = Math.round(grayStart + (grayEnd - grayStart) * t);
          this.setPixel(px, py, val);
        }
      }
      return this;
    }

    strokeRect(x, y, w, h, gray = 0, thickness = 1) {
      for (let t = 0; t < thickness; t++) {
        this.drawHLine(x + t, y + t, w - 2 * t, gray);
        this.drawHLine(x + t, y + h - 1 - t, w - 2 * t, gray);
        this.drawVLine(x + t, y + t, h - 2 * t, gray);
        this.drawVLine(x + w - 1 - t, y + t, h - 2 * t, gray);
      }
      return this;
    }

    drawHLine(x, y, length, gray = 0) {
      const yi = y | 0;
      if (yi < 0 || yi >= this.height) return this;
      const x0 = Math.max(0, x | 0);
      const x1 = Math.min(this.width, (x + length) | 0);
      const val = Math.max(0, Math.min(255, gray | 0));
      const rowOffset = yi * this.width;
      for (let px = x0; px < x1; px++) {
        this.pixels[rowOffset + px] = val;
      }
      return this;
    }

    drawDashedHLine(x, y, length, gray = 0, dash = 4, gap = 4) {
      const period = dash + gap;
      for (let i = 0; i < length; i++) {
        if ((i % period) < dash) {
          this.setPixel(x + i, y, gray);
        }
      }
      return this;
    }

    drawVLine(x, y, length, gray = 0) {
      const xi = x | 0;
      if (xi < 0 || xi >= this.width) return this;
      const y0 = Math.max(0, y | 0);
      const y1 = Math.min(this.height, (y + length) | 0);
      const val = Math.max(0, Math.min(255, gray | 0));
      for (let py = y0; py < y1; py++) {
        this.pixels[py * this.width + xi] = val;
      }
      return this;
    }

    drawLine(x0, y0, x1, y1, gray = 0, thickness = 1) {
      let ix0 = x0 | 0;
      let iy0 = y0 | 0;
      const ix1 = x1 | 0;
      const iy1 = y1 | 0;
      const dx = Math.abs(ix1 - ix0);
      const sx = ix0 < ix1 ? 1 : -1;
      const dy = -Math.abs(iy1 - iy0);
      const sy = iy0 < iy1 ? 1 : -1;
      let err = dx + dy;
      const half = Math.floor(thickness / 2);

      while (true) {
        if (thickness <= 1) {
          this.setPixel(ix0, iy0, gray);
        } else {
          this.fillRect(ix0 - half, iy0 - half, thickness, thickness, gray);
        }
        if (ix0 === ix1 && iy0 === iy1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          ix0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          iy0 += sy;
        }
      }
      return this;
    }

    drawCircle(cx, cy, radius, gray = 0) {
      let x = radius | 0;
      let y = 0;
      let err = 1 - x;
      while (x >= y) {
        this.setPixel(cx + x, cy + y, gray);
        this.setPixel(cx + y, cy + x, gray);
        this.setPixel(cx - y, cy + x, gray);
        this.setPixel(cx - x, cy + y, gray);
        this.setPixel(cx - x, cy - y, gray);
        this.setPixel(cx - y, cy - x, gray);
        this.setPixel(cx + y, cy - x, gray);
        this.setPixel(cx + x, cy - y, gray);
        y++;
        if (err < 0) {
          err += 2 * y + 1;
        } else {
          x--;
          err += 2 * (y - x + 1);
        }
      }
      return this;
    }

    fillCircle(cx, cy, radius, gray = 0) {
      const r = radius | 0;
      const r2 = r * r;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy <= r2) {
            this.setPixel(cx + dx, cy + dy, gray);
          }
        }
      }
      return this;
    }

    drawText(text, x, y, scale = 1, gray = 0, letterSpacing = 1) {
      const str = String(text ?? '');
      const s = Math.max(1, scale | 0);
      let cursorX = x | 0;
      const startY = y | 0;
      for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        const glyph = FONT_5X7[ch] || FONT_5X7[ch.toUpperCase()] || FONT_5X7['?'];
        for (let col = 0; col < 5; col++) {
          const colBits = glyph[col];
          for (let row = 0; row < 7; row++) {
            if ((colBits >> row) & 1) {
              if (s === 1) {
                this.setPixel(cursorX + col, startY + row, gray);
              } else {
                this.fillRect(cursorX + col * s, startY + row * s, s, s, gray);
              }
            }
          }
        }
        cursorX += (5 + letterSpacing) * s;
      }
      return this;
    }

    measureTextWidth(text, scale = 1, letterSpacing = 1) {
      const str = String(text ?? '');
      if (str.length === 0) return 0;
      const s = Math.max(1, scale | 0);
      return str.length * 5 * s + (str.length - 1) * letterSpacing * s;
    }

    drawBadge(text, x, y, scale = 1, inverted = true, padX = 6, padY = 4) {
      const s = Math.max(1, scale | 0);
      const textW = this.measureTextWidth(text, s, 1);
      const textH = 7 * s;
      const boxW = textW + padX * 2;
      const boxH = textH + padY * 2;
      if (inverted) {
        this.fillRect(x, y, boxW, boxH, 0);
        this.drawText(text, x + padX, y + padY, s, 255, 1);
      } else {
        this.fillRect(x, y, boxW, boxH, 235);
        this.strokeRect(x, y, boxW, boxH, 0, 1);
        this.drawText(text, x + padX, y + padY, s, 0, 1);
      }
      return boxW;
    }

    drawProgressBar(x, y, w, h, ratio, fillGray = 32) {
      const clamped = Math.max(0, Math.min(1, Number(ratio) || 0));
      this.fillRect(x, y, w, h, 240);
      this.strokeRect(x, y, w, h, 0, 1);
      const innerW = Math.max(0, Math.round((w - 4) * clamped));
      if (innerW > 0) {
        this.fillGradientRect(x + 2, y + 2, innerW, h - 4, fillGray, Math.min(180, fillGray + 65), false);
      }
      return this;
    }

    drawSparkline(x, y, w, h, values, minVal, maxVal) {
      if (!Array.isArray(values) || values.length < 2) return this;
      const lo = minVal !== undefined ? minVal : Math.min(...values);
      const hi = maxVal !== undefined ? maxVal : Math.max(...values);
      const range = Math.max(1e-6, hi - lo);

      // Subtle shaded area under curve to showcase e-ink dithering
      for (let i = 0; i < values.length - 1; i++) {
        const x0 = x + Math.round((i / (values.length - 1)) * (w - 1));
        const x1 = x + Math.round(((i + 1) / (values.length - 1)) * (w - 1));
        const y0 = y + h - 1 - Math.round(((values[i] - lo) / range) * (h - 4));
        const y1 = y + h - 1 - Math.round(((values[i + 1] - lo) / range) * (h - 4));
        for (let px = x0; px <= x1; px++) {
          const t = x1 === x0 ? 0 : (px - x0) / (x1 - x0);
          const curveY = Math.round(y0 + (y1 - y0) * t);
          for (let py = curveY; py < y + h - 1; py++) {
            const depth = (py - curveY) / Math.max(1, h);
            this.setPixel(px, py, Math.round(165 + depth * 75));
          }
        }
        this.drawLine(x0, y0, x1, y1, 0, 2);
      }
      return this;
    }
  }

  // ============================================================================
  // 2. E-PAPER DITHERING PIPELINE (Atkinson, Floyd-Steinberg, Bayer, Threshold)
  // ============================================================================

  // Undersized or non-finite input used to corrupt output silently (undefined
  // pixels read as white, NaN quantized differently per level). Fail loud.
  function assertGrayBuffer(grayPixels, width, height) {
    if (!grayPixels || typeof grayPixels.length !== 'number') {
      throw new TypeError('grayPixels must be an array-like pixel buffer');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      throw new RangeError(`width/height must be positive integers, got ${width}x${height}`);
    }
    const need = width * height;
    if (grayPixels.length < need) {
      throw new RangeError(`grayPixels has ${grayPixels.length} pixels, needs ${need}`);
    }
    for (let i = 0; i < need; i++) {
      if (!Number.isFinite(grayPixels[i])) {
        throw new RangeError(`grayPixels[${i}] is not finite (${grayPixels[i]})`);
      }
    }
  }

  function quantizePixel(value, levels = 2) {
    const clamped = Math.max(0, Math.min(255, value));
    if (levels <= 2) {
      return clamped < 128 ? 0 : 255;
    }
    const step = 255 / (levels - 1);
    return Math.round(Math.round(clamped / step) * step);
  }

  /**
   * 1-bit / N-level direct threshold quantization.
   */
  function ditherThreshold(grayPixels, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT, threshold = 128) {
    assertGrayBuffer(grayPixels, width, height);
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) {
      out[i] = grayPixels[i] < threshold ? 0 : 255;
    }
    return out;
  }

  /**
   * Floyd-Steinberg error-diffusion dithering:
   * [     *   7/16 ]
   * [ 3/16 5/16 1/16 ]
   */
  function ditherFloydSteinberg(grayPixels, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT, levels = 2) {
    assertGrayBuffer(grayPixels, width, height);
    const work = new Float32Array(grayPixels.length);
    for (let i = 0; i < grayPixels.length; i++) work[i] = grayPixels[i];
    const out = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const oldVal = work[idx];
        const newVal = quantizePixel(oldVal, levels);
        out[idx] = newVal;
        const err = oldVal - newVal;

        if (x + 1 < width) work[idx + 1] += err * (7 / 16);
        if (y + 1 < height) {
          if (x > 0) work[idx + width - 1] += err * (3 / 16);
          work[idx + width] += err * (5 / 16);
          if (x + 1 < width) work[idx + width + 1] += err * (1 / 16);
        }
      }
    }
    return out;
  }

  /**
   * Bill Atkinson's dithering algorithm (classic Apple Macintosh / HyperCard):
   * Diffuses 6/8 (75%) of quantization error across 6 neighbors (1/8 each).
   * Preserves crisp high-contrast edges on reflective e-paper displays without
   * muddy speckle buildup in near-white or near-black regions.
   */
  function ditherAtkinson(grayPixels, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT, levels = 2) {
    assertGrayBuffer(grayPixels, width, height);
    const work = new Float32Array(grayPixels.length);
    for (let i = 0; i < grayPixels.length; i++) work[i] = grayPixels[i];
    const out = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const oldVal = work[idx];
        const newVal = quantizePixel(oldVal, levels);
        out[idx] = newVal;
        const share = (oldVal - newVal) / 8.0;

        if (x + 1 < width) work[idx + 1] += share;
        if (x + 2 < width) work[idx + 2] += share;
        if (y + 1 < height) {
          if (x > 0) work[idx + width - 1] += share;
          work[idx + width] += share;
          if (x + 1 < width) work[idx + width + 1] += share;
        }
        if (y + 2 < height) {
          work[idx + 2 * width] += share;
        }
      }
    }
    return out;
  }

  const BAYER_4X4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5]
  ];

  const BAYER_8X8 = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21]
  ];

  /**
   * Bayer 4x4 or 8x8 ordered dithering (deterministic cross-hatch halftone patterns).
   */
  function ditherBayer(grayPixels, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT, matrixSize = 4, levels = 2) {
    assertGrayBuffer(grayPixels, width, height);
    const use8 = matrixSize === 8;
    const matrix = use8 ? BAYER_8X8 : BAYER_4X4;
    const n = use8 ? 8 : 4;
    const norm = n * n;
    const out = new Uint8Array(width * height);

    for (let y = 0; y < height; y++) {
      const row = matrix[y % n];
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const bayerVal = (row[x % n] + 0.5) / norm - 0.5;
        const spread = 255 / Math.max(1, levels - 1);
        const adjusted = grayPixels[idx] + bayerVal * spread * 0.85;
        out[idx] = quantizePixel(adjusted, levels);
      }
    }
    return out;
  }

  function applyDithering(grayPixels, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT, mode = 'atkinson') {
    switch (String(mode).toLowerCase()) {
      case 'floyd-steinberg':
      case 'fs':
        return ditherFloydSteinberg(grayPixels, width, height, 2);
      case 'bayer4':
      case 'bayer-4x4':
        return ditherBayer(grayPixels, width, height, 4, 2);
      case 'bayer8':
      case 'bayer-8x8':
        return ditherBayer(grayPixels, width, height, 8, 2);
      case 'gray2bit':
      case '2bit':
        return ditherAtkinson(grayPixels, width, height, 4);
      case 'threshold':
      case '1bit':
        return ditherThreshold(grayPixels, width, height, 128);
      case 'atkinson':
      default:
        return ditherAtkinson(grayPixels, width, height, 2);
    }
  }

  // ============================================================================
  // 3. 1-BIT PACKING, 48,062-BYTE TRMNL BMP ENCODER & PNG ENCODER
  // ============================================================================

  /**
   * Packs an 8-bit quantized buffer into 1-bit MSB-first bytes (8 pixels per byte).
   * Bit = 1 means white (pixel >= 128), Bit = 0 means black ink (pixel < 128).
   */
  function pack1Bit(quantizedPixels, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT) {
    const rowBytes = Math.ceil(width / 8);
    const packed = new Uint8Array(rowBytes * height);
    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      const outRowOffset = y * rowBytes;
      for (let x = 0; x < width; x++) {
        if (quantizedPixels[rowOffset + x] >= 128) {
          packed[outRowOffset + (x >> 3)] |= (0x80 >> (x & 7));
        }
      }
    }
    return packed;
  }

  function unpack1Bit(packedBytes, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT) {
    const rowBytes = Math.ceil(width / 8);
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      const outRowOffset = y * width;
      const inRowOffset = y * rowBytes;
      for (let x = 0; x < width; x++) {
        const bit = (packedBytes[inRowOffset + (x >> 3)] >> (7 - (x & 7))) & 1;
        out[outRowOffset + x] = bit ? 255 : 0;
      }
    }
    return out;
  }

  /**
   * Encodes an 800x480 (or arbitrary size) quantized pixel array into a standard
   * 1-bit monochrome Windows BMP file compatible with TRMNL ESP32-C3 firmware.
   * For 800x480: 14 (file header) + 40 (DIB header) + 8 (color table) + 48000 (pixels) = 48,062 bytes.
   */
  function encode1BitBMP(quantizedPixels, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT) {
    const rawRowBytes = Math.ceil(width / 8);
    const stride = (rawRowBytes + 3) & ~3; // 4-byte aligned row stride (100 bytes for 800px)
    const pixelDataSize = stride * height;
    const headerSize = 14 + 40 + 8; // 62 bytes
    const fileSize = headerSize + pixelDataSize;
    const bmp = new Uint8Array(fileSize);
    const view = new DataView(bmp.buffer);

    // BITMAPFILEHEADER (14 bytes)
    bmp[0] = 0x42; // 'B'
    bmp[1] = 0x4d; // 'M'
    view.setUint32(2, fileSize, true);
    view.setUint32(6, 0, true);
    view.setUint32(10, headerSize, true);

    // BITMAPINFOHEADER (40 bytes)
    view.setUint32(14, 40, true); // biSize
    view.setInt32(18, width, true); // biWidth
    view.setInt32(22, height, true); // biHeight (positive = bottom-up standard BMP)
    view.setUint16(26, 1, true); // biPlanes = 1
    view.setUint16(28, 1, true); // biBitCount = 1 (monochrome 1-bit)
    view.setUint32(30, 0, true); // biCompression = BI_RGB (0)
    view.setUint32(34, pixelDataSize, true); // biSizeImage
    view.setInt32(38, 2835, true); // biXPelsPerMeter (~72 DPI)
    view.setInt32(42, 2835, true); // biYPelsPerMeter (~72 DPI)
    view.setUint32(46, 2, true); // biClrUsed = 2
    view.setUint32(50, 2, true); // biClrImportant = 2

    // Color Palette (8 bytes): Index 0 = Black (0,0,0,0), Index 1 = White (255,255,255,0)
    bmp[54] = 0x00; bmp[55] = 0x00; bmp[56] = 0x00; bmp[57] = 0x00;
    bmp[58] = 0xff; bmp[59] = 0xff; bmp[60] = 0xff; bmp[61] = 0x00;

    // Bottom-up rows
    for (let y = 0; y < height; y++) {
      const srcY = height - 1 - y;
      const srcRowOffset = srcY * width;
      const dstRowOffset = headerSize + y * stride;
      for (let x = 0; x < width; x++) {
        if (quantizedPixels[srcRowOffset + x] >= 128) {
          bmp[dstRowOffset + (x >> 3)] |= (0x80 >> (x & 7));
        }
      }
    }

    return bmp;
  }

  // Zero-dependency Grayscale PNG encoder (uses valid zlib uncompressed blocks + CRC32 + Adler32)
  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes, start = 0, length = bytes.length - start) {
    let c = 0xffffffff;
    for (let i = start; i < start + length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function adler32(bytes) {
    let a = 1;
    let b = 0;
    const MOD = 65521;
    for (let i = 0; i < bytes.length; i++) {
      a = (a + bytes[i]) % MOD;
      b = (b + a) % MOD;
    }
    return ((b << 16) | a) >>> 0;
  }

  function makePngChunk(typeFourCC, dataBytes) {
    const chunk = new Uint8Array(12 + dataBytes.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, dataBytes.length, false);
    for (let i = 0; i < 4; i++) {
      chunk[4 + i] = typeFourCC.charCodeAt(i);
    }
    chunk.set(dataBytes, 8);
    const crc = crc32(chunk, 4, 4 + dataBytes.length);
    view.setUint32(8 + dataBytes.length, crc, false);
    return chunk;
  }

  function encodeGrayscalePNG(pixels, width = DISPLAY_WIDTH, height = DISPLAY_HEIGHT) {
    const rawScanlines = new Uint8Array((width + 1) * height);
    for (let y = 0; y < height; y++) {
      const dstOffset = y * (width + 1);
      rawScanlines[dstOffset] = 0; // Filter type 0 (None)
      rawScanlines.set(pixels.subarray(y * width, (y + 1) * width), dstOffset + 1);
    }

    // Wrap rawScanlines into valid zlib stream with stored (BTYPE=00) blocks of up to 65535 bytes
    const maxBlock = 65535;
    const numBlocks = Math.ceil(rawScanlines.length / maxBlock) || 1;
    const zlibData = new Uint8Array(2 + rawScanlines.length + numBlocks * 5 + 4);
    zlibData[0] = 0x78; // CMF
    zlibData[1] = 0x01; // FLG (no preset dict, check bits)

    let zPos = 2;
    let srcPos = 0;
    for (let b = 0; b < numBlocks; b++) {
      const remaining = rawScanlines.length - srcPos;
      const blockLen = Math.min(maxBlock, remaining);
      const isFinal = (b === numBlocks - 1) ? 1 : 0;
      zlibData[zPos++] = isFinal;
      zlibData[zPos++] = blockLen & 0xff;
      zlibData[zPos++] = (blockLen >>> 8) & 0xff;
      const nlen = (~blockLen) & 0xffff;
      zlibData[zPos++] = nlen & 0xff;
      zlibData[zPos++] = (nlen >>> 8) & 0xff;
      zlibData.set(rawScanlines.subarray(srcPos, srcPos + blockLen), zPos);
      zPos += blockLen;
      srcPos += blockLen;
    }

    const adler = adler32(rawScanlines);
    const zView = new DataView(zlibData.buffer);
    zView.setUint32(zPos, adler, false);

    // IHDR (13 bytes)
    const ihdr = new Uint8Array(13);
    const ihdrView = new DataView(ihdr.buffer);
    ihdrView.setUint32(0, width, false);
    ihdrView.setUint32(4, height, false);
    ihdr[8] = 8; // 8-bit grayscale
    ihdr[9] = 0; // Color type 0 (Grayscale)
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdrChunk = makePngChunk('IHDR', ihdr);
    const idatChunk = makePngChunk('IDAT', zlibData);
    const iendChunk = makePngChunk('IEND', new Uint8Array(0));

    const png = new Uint8Array(signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
    let offset = 0;
    png.set(signature, offset); offset += signature.length;
    png.set(ihdrChunk, offset); offset += ihdrChunk.length;
    png.set(idatChunk, offset); offset += idatChunk.length;
    png.set(iendChunk, offset);
    return png;
  }

  // ============================================================================
  // 4. FOUR BUILT-IN 800x480 E-INK SCREEN RENDERERS
  // ============================================================================

  const DEFAULT_SCREEN_DATA = {
    corridor: {
      stationName: 'PENN CORRIDOR // NORTH CONCOURSE',
      stationCode: 'NYP-N4',
      updatedAt: '08:42:15 EST',
      headwayAdherencePct: 94,
      activeAlerts: 'SIG-LOCK CLEAR // TRACK 4 HIGH-DENSITY BOARDING',
      hourlyLoad: [38, 44, 62, 85, 96, 88, 74, 68, 71, 82, 91, 64],
      departures: [
        { line: 'NE-214', dest: 'BOSTON SOUTH STA', track: '07', sched: '08:46', etaMin: 4, cars: 8, status: 'BOARDING', occupancy: 0.82 },
        { line: 'KEY-64', dest: 'HARRISBURG EXP', track: '12', sched: '08:51', etaMin: 9, cars: 6, status: 'ON TIME', occupancy: 0.58 },
        { line: 'EMP-28', dest: 'ALBANY-RENSSELAER', track: '05', sched: '08:58', etaMin: 16, cars: 7, status: 'ON TIME', occupancy: 0.46 },
        { line: 'ACE-2150', dest: 'WASHINGTON UNION', track: '09', sched: '09:05', etaMin: 23, cars: 9, status: 'HIGH SPEED', occupancy: 0.91 },
        { line: 'LIR-408', dest: 'RONKONKOMA LOCAL', track: '18', sched: '09:12', etaMin: 30, cars: 10, status: 'DELAY +3M', occupancy: 0.67 }
      ]
    },
    orbital: {
      stationCallsign: 'GS-40N // HORIZON TRACKING ARRAY',
      gridLocator: 'FN20XR (40.71N, 74.01W)',
      utcTime: '2026-11-09 01:42:00Z',
      targetSat: 'ISS (ZARYA) // NORAD 25544',
      maxElevationDeg: 74.2,
      aosAzimuthDeg: 228,
      losAzimuthDeg: 49,
      orbitNumber: 59412,
      downlinkMhz: '145.800 FM / 437.800 PKT',
      solarFluxF107: 164,
      kpIndex: 2.3,
      sunEvents: { dawn: '06:08', sunrise: '06:36', transit: '11:44', sunset: '16:52', dusk: '17:21' },
      upcomingPasses: [
        { sat: 'ISS (ZARYA)', aos: '01:48 UTC', dur: '06m 42s', maxEl: '74° NW', mode: 'APRS 1200' },
        { sat: 'NOAA-19 APT', aos: '03:14 UTC', dur: '11m 18s', maxEl: '58° E', mode: '137.100 MHz' },
        { sat: 'METEOR-M2-4', aos: '05:02 UTC', dur: '12m 05s', maxEl: '81° Z', mode: 'LRPT 72K' },
        { sat: 'SONATE-2', aos: '06:29 UTC', dur: '08m 50s', maxEl: '41° SW', mode: '9k6 FSK' }
      ]
    },
    labbench: {
      clusterName: 'TRMNL-BYOS // RACK-03 TELEMETRY',
      hostIp: '10.24.0.18:8080',
      firmwareTarget: 'ESP32-C3 FW 1.6.8',
      voltageHistory: [4.18, 4.16, 4.13, 4.11, 4.08, 4.05, 4.02, 3.99, 3.97, 3.94, 3.91, 3.89],
      nodes: [
        { name: 'byos-edge-01', cpu: 0.34, mem: 0.61, tempC: 42, status: 'HEALTHY' },
        { name: 'dither-worker', cpu: 0.78, mem: 0.52, tempC: 56, status: 'RENDER' },
        { name: 'gtfs-poller', cpu: 0.19, mem: 0.44, tempC: 39, status: 'SYNCED' },
        { name: 'ephem-solver', cpu: 0.12, mem: 0.29, tempC: 37, status: 'IDLE' }
      ],
      ciPipelines: [
        { repo: 'trmnl-horizon/main', sha: '9f4c2a1', duration: '18s', result: 'PASS 52/52' },
        { repo: 'esp32c3-epd-lut/v2', sha: '3b18e0d', duration: '41s', result: 'PASS 19/19' },
        { repo: 'gtfs-rt-Protobuf', sha: '7a09c44', duration: '24s', result: 'PASS 34/34' }
      ],
      checklist: [
        { done: true, task: 'Verify 48,062-byte 1-bit BMP stride alignment' },
        { done: true, task: 'Calibrate Atkinson midtone contrast curve' },
        { done: true, task: 'Validate /api/display Refresh-Rate header' },
        { done: false, task: 'Measure deep-sleep current across 900s wake' }
      ]
    },
    rhythm: {
      title: 'CLASSICAL RIYAZ & TAAL ALMANAC',
      ragaName: 'RAGA YAMAN (KALYAN THAAT)',
      prahar: 'EVENING PRAHAR 1 (18:00 - 21:00)',
      vadi: 'GA (GANDHAR)',
      samvadi: 'NI (NISHAD)',
      aroha: 'N. R G M# D N S\'',
      avaroha: 'S\' N D P M# G R S',
      pakad: 'N. R G R, P M# G R S',
      taalName: 'TEENTAAL // 16 MATRA (4+4+4+4)',
      bpm: 144,
      streakDays: 24,
      bols: [
        'DHA', 'DHIN', 'DHIN', 'DHA',
        'DHA', 'DHIN', 'DHIN', 'DHA',
        'DHA', 'TIN', 'TIN', 'TA',
        'TA', 'DHIN', 'DHIN', 'DHA'
      ],
      markers: ['X', '', '', '', '2', '', '', '', '0', '', '', '', '3', '', '', '']
    }
  };

  function drawHeaderBar(fb, title, subtitle, rightTag, batteryV = 4.02, rssi = -61) {
    // Top black header bar (800 x 44)
    fb.fillRect(0, 0, 800, 44, 0);
    fb.drawBadge('TRMNL', 12, 9, 2, false, 7, 5);
    fb.drawText(title, 98, 9, 2, 255, 1);
    fb.drawText(subtitle, 98, 28, 1, 210, 1);

    // Right status telemetry pill
    const vStr = `${Number(batteryV).toFixed(2)}V`;
    const rssiStr = `${rssi}DBM`;
    fb.drawText(rightTag, 535, 10, 1, 255, 1);
    fb.drawText(`${vStr} // ${rssiStr}`, 535, 24, 1, 200, 1);

    // Battery icon in top-right (732, 11)
    fb.strokeRect(732, 11, 46, 22, 255, 2);
    fb.fillRect(778, 16, 4, 12, 255);
    const soc = Math.max(0.08, Math.min(1, (batteryV - 3.2) / 0.95));
    const fillW = Math.round(38 * soc);
    fb.fillRect(736, 15, fillW, 14, 255);

    // Bottom status bar (y = 450..480)
    fb.fillRect(0, 450, 800, 30, 232);
    fb.drawHLine(0, 450, 800, 0);
    fb.drawHLine(0, 451, 800, 0);
  }

  function drawFooterBar(fb, leftText, centerText, rightText) {
    fb.drawText(leftText, 14, 461, 1, 0, 1);
    const cw = fb.measureTextWidth(centerText, 1, 1);
    fb.drawText(centerText, Math.round((800 - cw) / 2), 461, 1, 0, 1);
    const rw = fb.measureTextWidth(rightText, 1, 1);
    fb.drawText(rightText, 800 - 14 - rw, 461, 1, 0, 1);
  }

  // options.data is library-API user input: a mistyped field (departures as a
  // string, sunEvents: null) crashed the renderers instead of falling back.
  function coerceScreenData(d, defaults) {
    for (const key of Object.keys(defaults)) {
      const dv = defaults[key];
      const cv = d[key];
      if (Array.isArray(dv)) {
        if (!Array.isArray(cv)) {
          d[key] = dv;
        } else if (dv.length && dv[0] && typeof dv[0] === 'object') {
          // Repair each row against the schema so a stray field or primitive
          // element cannot crash the renderer.
          d[key] = cv.map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return dv[0];
            const row = { ...item };
            for (const k2 of Object.keys(dv[0])) {
              if (typeof row[k2] !== typeof dv[0][k2]) row[k2] = dv[0][k2];
            }
            return row;
          });
        }
      } else if (dv && typeof dv === 'object') {
        if (!cv || typeof cv !== 'object' || Array.isArray(cv)) {
          d[key] = dv;
        } else {
          for (const k2 of Object.keys(dv)) {
            if (typeof cv[k2] !== typeof dv[k2]) cv[k2] = dv[k2];
          }
        }
      }
    }
    return d;
  }

  function renderCorridorScreen(fb, customData = {}, telemetry = {}) {
    const d = coerceScreenData(Object.assign({}, DEFAULT_SCREEN_DATA.corridor, customData), DEFAULT_SCREEN_DATA.corridor);
    fb.clear(255);
    drawHeaderBar(
      fb,
      d.stationName,
      `GTFS-RT FEED // STATION ${d.stationCode} // UPDATED ${d.updatedAt}`,
      'MODE: TRANSIT DISPATCH',
      telemetry.batteryVoltage ?? 4.04,
      telemetry.rssi ?? -58
    );

    // Left main table: Live Departures (x=14..554, y=54..352)
    fb.strokeRect(14, 54, 540, 298, 0, 2);
    fb.fillRect(16, 56, 536, 26, 28);
    fb.drawText('LINE', 24, 65, 1, 255, 1);
    fb.drawText('DESTINATION', 92, 65, 1, 255, 1);
    fb.drawText('TRK', 268, 65, 1, 255, 1);
    fb.drawText('LOAD', 312, 65, 1, 255, 1);
    fb.drawText('STATUS', 392, 65, 1, 255, 1);
    fb.drawText('ETA', 494, 65, 1, 255, 1);

    const rows = (d.departures || DEFAULT_SCREEN_DATA.corridor.departures).slice(0, 5);
    rows.forEach((row, idx) => {
      const ry = 84 + idx * 52;
      if (idx % 2 === 1) {
        fb.fillRect(16, ry, 536, 50, 242);
      }
      fb.drawHLine(16, ry + 50, 536, 160);

      // Line badge
      fb.drawBadge(row.line, 22, ry + 12, 1, idx === 0, 5, 5);
      // Destination
      fb.drawText(row.dest.slice(0, 16), 92, ry + 11, 2, 0, 1);
      fb.drawText(`SCHED ${row.sched} // ${row.cars} CARS`, 92, ry + 32, 1, 70, 1);

      // Track box
      fb.strokeRect(265, ry + 10, 34, 28, 0, 2);
      fb.drawText(String(row.track), 271, ry + 17, 2, 0, 1);

      // Occupancy bar with gradient (shows off dithering nicely)
      fb.drawProgressBar(310, ry + 16, 70, 16, row.occupancy, 20);

      // Status
      const isHighlight = row.status === 'BOARDING' || row.status.includes('DELAY');
      fb.drawBadge(row.status, 390, ry + 14, 1, isHighlight, 5, 4);

      // ETA minutes
      const etaText = `${row.etaMin}M`;
      fb.drawText(etaText, 492, ry + 16, 2, 0, 1);
    });

    // Bottom Left Banner: Corridor Alert & Shading Strip (y=360..440)
    fb.strokeRect(14, 360, 540, 80, 0, 2);
    fb.fillGradientRect(16, 362, 536, 24, 30, 225, false);
    fb.drawText('ACTIVE SIGNAL ADVISORY', 24, 370, 1, 255, 1);
    fb.drawText(d.activeAlerts, 24, 398, 2, 0, 1);
    fb.drawText('AUTOMATIC BLOCK SIGNALING: NORMAL // HEADWAY TARGET: 450S', 24, 422, 1, 60, 1);

    // Right Column: Headway Adherence & Hourly Ridership Curve (x=566..786, y=54..440)
    fb.strokeRect(566, 54, 220, 178, 0, 2);
    fb.fillRect(568, 56, 216, 24, 0);
    fb.drawText('HEADWAY ADHERENCE', 578, 64, 1, 255, 1);

    fb.drawText(`${d.headwayAdherencePct}%`, 582, 94, 4, 0, 1);
    fb.drawText('ON-SCHEDULE CORRIDOR DISPATCH', 582, 132, 1, 50, 1);
    fb.drawProgressBar(582, 148, 188, 22, d.headwayAdherencePct / 100, 15);
    fb.drawText('0%        50%       100%', 582, 178, 1, 70, 1);
    fb.drawText('PEAK WINDOW: 07:30 - 09:30', 582, 198, 1, 0, 1);

    // Right Lower Box: Hourly Load Sparkline with Midtone Dithered Area (y=242..440)
    fb.strokeRect(566, 242, 220, 198, 0, 2);
    fb.fillRect(568, 244, 216, 24, 0);
    fb.drawText('PASSENGER LOAD PROFILE', 578, 252, 1, 255, 1);
    fb.drawSparkline(580, 282, 192, 110, d.hourlyLoad, 0, 100);
    fb.drawHLine(580, 392, 192, 0);
    fb.drawText('06H   09H   12H   15H   18H', 582, 402, 1, 40, 1);
    fb.drawText('DITHER GRADIENT CALIBRATION', 582, 420, 1, 0, 1);

    drawFooterBar(
      fb,
      'SCREEN 01/04 // CORRIDOR DISPATCH',
      '800X480 1-BIT E-PAPER FRAMEBUFFER',
      `REFRESH: ${telemetry.refreshRate ?? 300}S`
    );
    return fb;
  }

  function renderOrbitalScreen(fb, customData = {}, telemetry = {}) {
    const d = coerceScreenData(Object.assign({}, DEFAULT_SCREEN_DATA.orbital, customData), DEFAULT_SCREEN_DATA.orbital);
    fb.clear(255);
    drawHeaderBar(
      fb,
      d.stationCallsign,
      `GRID ${d.gridLocator} // ${d.utcTime}`,
      'MODE: ORBITAL EPHEMERIS',
      telemetry.batteryVoltage ?? 4.04,
      telemetry.rssi ?? -58
    );

    // Left Box: Polar Horizon Skyplot (x=14..314, y=54..348)
    fb.strokeRect(14, 54, 300, 294, 0, 2);
    fb.fillRect(16, 56, 296, 24, 0);
    fb.drawText('AZIMUTH / ELEVATION SKYPLOT', 26, 64, 1, 255, 1);

    const cx = 164;
    const cy = 212;
    const rOuter = 104;
    // Radial shaded background for horizon dome (showcases ordered & Atkinson dithering)
    for (let dy = -rOuter; dy <= rOuter; dy++) {
      for (let dx = -rOuter; dx <= rOuter; dx++) {
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= rOuter) {
          const shade = Math.round(185 + (1 - dist / rOuter) * 65);
          fb.setPixel(cx + dx, cy + dy, shade);
        }
      }
    }
    fb.drawCircle(cx, cy, rOuter, 0);
    fb.drawCircle(cx, cy, Math.round(rOuter * 0.66), 60);
    fb.drawCircle(cx, cy, Math.round(rOuter * 0.33), 60);
    fb.drawHLine(cx - rOuter, cy, rOuter * 2, 80);
    fb.drawVLine(cx, cy - rOuter, rOuter * 2, 80);

    fb.drawText('N', cx - 3, cy - rOuter - 11, 1, 0, 1);
    fb.drawText('S', cx - 3, cy + rOuter + 4, 1, 0, 1);
    fb.drawText('W', cx - rOuter - 10, cy - 3, 1, 0, 1);
    fb.drawText('E', cx + rOuter + 5, cy - 3, 1, 0, 1);

    // Plot ISS pass trajectory arc from SW (228 deg) through NW high elevation (74 deg) to NE (49 deg)
    const pts = [
      [cx - 68, cy + 72],
      [cx - 48, cy + 28],
      [cx - 22, cy - 18],
      [cx + 12, cy - 48],
      [cx + 68, cy - 70]
    ];
    for (let i = 0; i < pts.length - 1; i++) {
      fb.drawLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 0, 3);
    }
    // Current satellite position marker at TCA
    fb.fillCircle(pts[2][0], pts[2][1], 6, 0);
    fb.drawCircle(pts[2][0], pts[2][1], 10, 0);
    fb.drawText('ISS 74°', pts[2][0] + 12, pts[2][1] - 4, 1, 0, 1);

    // Right Upper Box: Ground Track & Solar Terminator (x=326..786, y=54..228)
    fb.strokeRect(326, 54, 460, 174, 0, 2);
    fb.fillRect(328, 56, 456, 24, 0);
    fb.drawText(`TARGET: ${d.targetSat} // ORBIT #${d.orbitNumber}`, 338, 64, 1, 255, 1);

    const mapX = 338;
    const mapY = 88;
    const mapW = 436;
    const mapH = 98;
    fb.strokeRect(mapX, mapY, mapW, mapH, 0, 1);

    // Day/night terminator cosine shading across ground track map
    for (let py = 0; py < mapH - 2; py++) {
      for (let px = 0; px < mapW - 2; px++) {
        const lon = (px / mapW) * Math.PI * 2;
        const lat = ((py / mapH) - 0.5) * Math.PI;
        const sunElev = Math.sin(lat) * 0.35 + Math.cos(lat) * Math.cos(lon - 1.2);
        const gray = sunElev > 0.15 ? 245 : (sunElev > -0.15 ? Math.round(140 + sunElev * 350) : 115);
        fb.setPixel(mapX + 1 + px, mapY + 1 + py, gray);
      }
    }
    // Equator & grid lines
    fb.drawDashedHLine(mapX + 1, mapY + Math.floor(mapH / 2), mapW - 2, 40, 4, 4);
    // Ground track sine wave
    let prevGx = mapX + 2;
    let prevGy = mapY + Math.floor(mapH / 2);
    for (let px = 4; px < mapW - 4; px += 4) {
      const phase = (px / mapW) * Math.PI * 2.4;
      const gy = mapY + Math.floor(mapH / 2 - Math.sin(phase) * (mapH * 0.36));
      fb.drawLine(prevGx, prevGy, mapX + px, gy, 0, 2);
      prevGx = mapX + px;
      prevGy = gy;
    }
    fb.drawText(`DOWNLINK: ${d.downlinkMhz} // F10.7: ${d.solarFluxF107} // KP: ${d.kpIndex}`, 338, 196, 1, 0, 1);
    fb.drawText(`AOS AZ: ${d.aosAzimuthDeg}° // MAX EL: ${d.maxElevationDeg}° // LOS AZ: ${d.losAzimuthDeg}°`, 338, 211, 1, 60, 1);

    // Right Middle Box: Upcoming Pass Schedule (x=326..786, y=236..348)
    fb.strokeRect(326, 236, 460, 112, 0, 2);
    fb.fillRect(328, 238, 456, 20, 30);
    fb.drawText('SATELLITE', 336, 245, 1, 255, 1);
    fb.drawText('AOS UTC', 470, 245, 1, 255, 1);
    fb.drawText('DURATION', 562, 245, 1, 255, 1);
    fb.drawText('MAX EL', 642, 245, 1, 255, 1);
    fb.drawText('TELEMETRY', 706, 245, 1, 255, 1);

    d.upcomingPasses.slice(0, 4).forEach((p, idx) => {
      const py = 262 + idx * 21;
      if (idx % 2 === 1) fb.fillRect(328, py - 2, 456, 20, 238);
      fb.drawText(p.sat, 336, py + 4, 1, 0, 1);
      fb.drawText(p.aos, 470, py + 4, 1, 0, 1);
      fb.drawText(p.dur, 562, py + 4, 1, 0, 1);
      fb.drawText(p.maxEl, 642, py + 4, 1, 0, 1);
      fb.drawText(p.mode, 706, py + 4, 1, 0, 1);
    });

    // Bottom Full-Width Solar Ephemeris Bar (x=14..786, y=358..440)
    fb.strokeRect(14, 358, 772, 82, 0, 2);
    fb.fillGradientRect(16, 360, 768, 22, 15, 220, false);
    fb.drawText('SOLAR EPHEMERIS & TWILIGHT HORIZON', 24, 367, 1, 255, 1);

    const events = [
      ['CIVIL DAWN', d.sunEvents.dawn],
      ['SUNRISE', d.sunEvents.sunrise],
      ['SOLAR NOON', d.sunEvents.transit],
      ['SUNSET', d.sunEvents.sunset],
      ['CIVIL DUSK', d.sunEvents.dusk]
    ];
    events.forEach((ev, idx) => {
      const ex = 28 + idx * 152;
      fb.drawText(ev[0], ex, 392, 1, 70, 1);
      fb.drawText(ev[1], ex, 408, 2, 0, 1);
    });

    drawFooterBar(
      fb,
      'SCREEN 02/04 // ORBITAL & SOLAR EPHEMERIS',
      'SGP4 / HORIZON POLAR SYNTHESIS',
      `REFRESH: ${telemetry.refreshRate ?? 300}S`
    );
    return fb;
  }

  function renderLabBenchScreen(fb, customData = {}, telemetry = {}) {
    const d = coerceScreenData(Object.assign({}, DEFAULT_SCREEN_DATA.labbench, customData), DEFAULT_SCREEN_DATA.labbench);
    fb.clear(255);
    drawHeaderBar(
      fb,
      d.clusterName,
      `BYOS ENDPOINT ${d.hostIp} // ${d.firmwareTarget}`,
      'MODE: LAB BENCH TELEMETRY',
      telemetry.batteryVoltage ?? 4.04,
      telemetry.rssi ?? -58
    );

    // Top Left: Node Resource Matrix (x=14..420, y=54..252)
    fb.strokeRect(14, 54, 406, 198, 0, 2);
    fb.fillRect(16, 56, 402, 24, 0);
    fb.drawText('SELF-HOSTED NODE UTILIZATION', 26, 64, 1, 255, 1);

    d.nodes.slice(0, 4).forEach((node, idx) => {
      const ny = 88 + idx * 40;
      fb.drawText(node.name.toUpperCase(), 24, ny, 1, 0, 1);
      fb.drawText(`${node.tempC}°C`, 140, ny, 1, 50, 1);
      fb.drawProgressBar(184, ny - 2, 130, 14, node.cpu, 25);
      fb.drawBadge(node.status, 326, ny - 4, 1, idx === 1, 5, 3);
      fb.drawText(`CPU ${Math.round(node.cpu * 100)}% // MEM ${Math.round(node.mem * 100)}%`, 24, ny + 14, 1, 90, 1);
      fb.drawHLine(20, ny + 28, 392, 190);
    });

    // Top Right: LiPo Discharge Curve & Power Telemetry (x=432..786, y=54..252)
    fb.strokeRect(432, 54, 354, 198, 0, 2);
    fb.fillRect(434, 56, 350, 24, 0);
    fb.drawText('TRMNL 1800MAH LIPO DISCHARGE CURVE', 444, 64, 1, 255, 1);

    fb.drawSparkline(448, 92, 322, 108, d.voltageHistory, 3.3, 4.25);
    fb.drawHLine(448, 200, 322, 0);
    fb.drawText('4.20V FULL', 448, 210, 1, 0, 1);
    fb.drawText('3.50V NOMINAL', 562, 210, 1, 60, 1);
    fb.drawText('3.20V CUTOFF', 686, 210, 1, 0, 1);
    fb.drawText('DEEP SLEEP: 18UA // WAKE BURST: 78MA FOR 4.7S', 448, 228, 1, 40, 1);

    // Bottom Left: CI Build Matrix (x=14..420, y=262..440)
    fb.strokeRect(14, 262, 406, 178, 0, 2);
    fb.fillRect(16, 264, 402, 24, 0);
    fb.drawText('CONTINUOUS INTEGRATION PIPELINES', 26, 272, 1, 255, 1);

    d.ciPipelines.slice(0, 3).forEach((pipe, idx) => {
      const py = 298 + idx * 44;
      fb.drawText(pipe.repo, 24, py, 2, 0, 1);
      fb.drawText(`COMMIT ${pipe.sha} // TIME ${pipe.duration}`, 24, py + 20, 1, 80, 1);
      fb.drawBadge(pipe.result, 304, py + 4, 1, true, 6, 4);
      fb.drawHLine(20, py + 34, 392, 190);
    });

    // Bottom Right: Hardware Validation Checklist (x=432..786, y=262..440)
    fb.strokeRect(432, 262, 354, 178, 0, 2);
    fb.fillRect(434, 264, 350, 24, 0);
    fb.drawText('BYOS PROTOCOL VERIFICATION CHECKLIST', 444, 272, 1, 255, 1);

    d.checklist.slice(0, 4).forEach((item, idx) => {
      const cy = 298 + idx * 34;
      fb.strokeRect(444, cy, 16, 16, 0, 2);
      if (item.done) {
        fb.fillRect(448, cy + 4, 8, 8, 0);
      }
      fb.drawText(item.task.slice(0, 44), 468, cy + 4, 1, 0, 1);
    });

    drawFooterBar(
      fb,
      'SCREEN 03/04 // HARDWARE LAB BENCH',
      'BYOS /API/SETUP + /API/DISPLAY + /API/LOG',
      `REFRESH: ${telemetry.refreshRate ?? 300}S`
    );
    return fb;
  }

  function renderRhythmScreen(fb, customData = {}, telemetry = {}) {
    const d = coerceScreenData(Object.assign({}, DEFAULT_SCREEN_DATA.rhythm, customData), DEFAULT_SCREEN_DATA.rhythm);
    fb.clear(255);
    drawHeaderBar(
      fb,
      d.title,
      `${d.prahar} // TEMPO ${d.bpm} BPM`,
      'MODE: PRACTICE ALMANAC',
      telemetry.batteryVoltage ?? 4.04,
      telemetry.rssi ?? -58
    );

    // Top Raga Reference Card (x=14..786, y=54..186)
    fb.strokeRect(14, 54, 772, 132, 0, 2);
    fb.fillGradientRect(16, 56, 768, 28, 0, 160, false);
    fb.drawText(d.ragaName, 26, 64, 2, 255, 1);
    fb.drawBadge(`STREAK: ${d.streakDays} DAYS`, 624, 61, 1, false, 6, 4);

    fb.drawText(`AROHA   : ${d.aroha}`, 26, 96, 2, 0, 1);
    fb.drawText(`AVAROHA : ${d.avaroha}`, 26, 122, 2, 0, 1);
    fb.drawText(`PAKAD   : ${d.pakad}`, 26, 152, 1, 40, 1);
    fb.drawText(`VADI: ${d.vadi} // SAMVADI: ${d.samvadi}`, 430, 152, 1, 0, 1);

    // Middle Vibhag Grid: 16-Matra Teentaal Avartan (x=14..786, y=198..356)
    fb.strokeRect(14, 198, 772, 158, 0, 2);
    fb.fillRect(16, 200, 768, 24, 0);
    fb.drawText(`${d.taalName} // AVARTAN VIBHAG MATRIX`, 26, 208, 1, 255, 1);

    const cellW = Math.floor(748 / 16);
    for (let m = 0; m < 16; m++) {
      const cx = 24 + m * cellW;
      const cy = 234;
      const isVibhagStart = (m % 4 === 0);
      fb.strokeRect(cx, cy, cellW - 2, 108, 0, isVibhagStart ? 2 : 1);
      if (isVibhagStart) {
        fb.fillRect(cx + 2, cy + 2, cellW - 6, 22, m === 8 ? 200 : 25);
        fb.drawText(d.markers[m] || '*', cx + 16, cy + 9, 1, m === 8 ? 0 : 255, 1);
      } else {
        fb.fillRect(cx + 2, cy + 2, cellW - 6, 22, 235);
      }
      fb.drawText(String(m + 1).padStart(2, '0'), cx + 12, cy + 34, 1, 70, 1);
      const bol = (d.bols[m] || 'DHA').slice(0, 4);
      fb.drawText(bol, cx + 6, cy + 58, 1, 0, 1);
      // Shaded accent bar at bottom of cell
      const accentGray = isVibhagStart ? 30 : 165;
      fb.fillRect(cx + 6, cy + 84, cellW - 14, 14, accentGray);
    }

    // Bottom 28-Day Practice Continuity Strip (x=14..786, y=366..440)
    fb.strokeRect(14, 366, 772, 74, 0, 2);
    fb.drawText('28-DAY RIYAZ CONTINUITY LOG (SAM = X, TALI = 2/3, KHALI = 0)', 26, 378, 1, 0, 1);
    for (let day = 0; day < 28; day++) {
      const dx = 26 + day * 26;
      const dy = 398;
      const completed = day < d.streakDays || day % 5 !== 0;
      fb.strokeRect(dx, dy, 20, 26, 0, 1);
      if (completed) {
        fb.fillGradientRect(dx + 2, dy + 2, 16, 22, 15, 110, true);
      }
    }

    drawFooterBar(
      fb,
      'SCREEN 04/04 // CLASSICAL RHYTHM ALMANAC',
      'VIBHAG & SWARA REFERENCE CARD',
      `REFRESH: ${telemetry.refreshRate ?? 300}S`
    );
    return fb;
  }

  function renderScreen(screenId = 'corridor', options = {}) {
    const fb = new EInkFramebuffer(DISPLAY_WIDTH, DISPLAY_HEIGHT, 255);
    const id = String(screenId || 'corridor').toLowerCase();
    const customData = options.data || {};
    const telemetry = {
      batteryVoltage: options.batteryVoltage ?? 4.04,
      rssi: options.rssi ?? -58,
      refreshRate: options.refreshRate ?? 300
    };

    if (id === 'orbital') {
      renderOrbitalScreen(fb, customData, telemetry);
    } else if (id === 'labbench') {
      renderLabBenchScreen(fb, customData, telemetry);
    } else if (id === 'rhythm') {
      renderRhythmScreen(fb, customData, telemetry);
    } else {
      renderCorridorScreen(fb, customData, telemetry);
    }

    const ditherMode = options.ditherMode || 'atkinson';
    const dithered = applyDithering(fb.pixels, fb.width, fb.height, ditherMode);
    return {
      screenId: id,
      ditherMode,
      width: fb.width,
      height: fb.height,
      grayPixels: fb.pixels,
      ditheredPixels: dithered
    };
  }

  // ============================================================================
  // 5. OFFICIAL TRMNL BYOS PROTOCOL HANDLERS (/api/setup, /api/display, /api/log)
  // ============================================================================

  function normalizeHeaders(rawHeaders = {}) {
    const out = {};
    for (const [k, v] of Object.entries(rawHeaders || {})) {
      out[String(k).toLowerCase()] = Array.isArray(v) ? v[0] : String(v);
    }
    return out;
  }

  function parseTrmnlHeaders(rawHeaders = {}) {
    const h = normalizeHeaders(rawHeaders);
    const mac = h['id'] || h['x-trmnl-id'] || 'A0:B7:65:FE:12:9C';
    const accessToken = h['access-token'] || '';
    const refreshRate = Math.max(15, Math.min(86400, parseInt(h['refresh-rate'] || '300', 10) || 300));
    const bvRaw = parseFloat(h['battery-voltage'] || '4.04');
    const batteryVoltage = Number.isFinite(bvRaw) ? Math.max(0, Math.min(30, bvRaw)) : 4.04;
    const fwVersion = h['fw-version'] || '1.6.8';
    const rssi = parseInt(h['rssi'] || '-58', 10) || -58;
    const userAgent = h['user-agent'] || 'trmnl-display/1.6.8';
    const specialFunction = h['special-function'] || 'none';

    return {
      mac: mac.toUpperCase(),
      accessToken,
      refreshRate,
      batteryVoltage,
      fwVersion,
      rssi,
      userAgent,
      specialFunction
    };
  }

  function deriveFriendlyId(mac) {
    const clean = String(mac || 'TRMNL0').replace(/[^A-F0-9]/gi, '').toUpperCase();
    const tail = clean.slice(-6).padStart(6, '0');
    return `${tail.slice(0, 3)}-${tail.slice(3, 6)}`;
  }

  function deriveApiKey(mac) {
    const clean = String(mac || 'TRMNL0').replace(/[^A-F0-9]/gi, '').toLowerCase();
    return `trmnl_byos_${clean.padEnd(12, '0')}_horizon`;
  }

  /**
   * Handles GET /api/setup per official TRMNL BYOS firmware specification.
   */
  function handleApiSetup(rawHeaders = {}, options = {}) {
    const parsed = parseTrmnlHeaders(rawHeaders);
    const baseUrl = (options.baseUrl || 'http://localhost:8080').replace(/\/+$/, '');
    const friendlyId = deriveFriendlyId(parsed.mac);
    const apiKey = options.apiKey || deriveApiKey(parsed.mac);

    return {
      status: 200,
      api_key: apiKey,
      friendly_id: friendlyId,
      image_url: `${baseUrl}/api/bitmap/setup-welcome.bmp`,
      message: `TRMNL Horizon BYOS paired with device ${friendlyId} (${parsed.mac})`
    };
  }

  /**
   * Handles GET /api/display per official TRMNL BYOS firmware specification.
   */
  function handleApiDisplay(rawHeaders = {}, options = {}) {
    const parsed = parseTrmnlHeaders(rawHeaders);
    const baseUrl = (options.baseUrl || 'http://localhost:8080').replace(/\/+$/, '');
    // Query params are reflected into filename/image_url: whitelist them so the
    // advertised name always matches what /api/bitmap would actually render.
    const screenId = ['corridor', 'orbital', 'labbench', 'rhythm'].includes(String(options.screenId || '').toLowerCase())
      ? String(options.screenId).toLowerCase()
      : 'corridor';
    const ditherMode = ['atkinson', 'floyd-steinberg', 'fs', 'bayer4', 'bayer-4x4', 'bayer8', 'bayer-8x8', 'gray2bit', '2bit', 'threshold', '1bit'].includes(String(options.ditherMode || '').toLowerCase())
      ? String(options.ditherMode).toLowerCase()
      : 'atkinson';
    const refreshRate = options.refreshRate || parsed.refreshRate || 300;
    const epochTag = options.epochTag || 'v1';
    const filename = `horizon-${screenId}-${ditherMode}-${epochTag}.bmp`;

    return {
      status: 0,
      image_url: `${baseUrl}/api/bitmap/${filename}`,
      filename,
      refresh_rate: refreshRate,
      reset_firmware: Boolean(options.resetFirmware),
      update_firmware: Boolean(options.updateFirmware),
      firmware_url: options.firmwareUrl || null,
      special_function: options.specialFunction || 'sleep',
      telemetry: parsed
    };
  }

  /**
   * Handles POST /api/log where TRMNL devices report wakeup & Wi-Fi diagnostics.
   */
  function handleApiLog(rawHeaders = {}, payload = {}, logStore = []) {
    const parsed = parseTrmnlHeaders(rawHeaders);
    const incoming = payload?.log?.logs_array || payload?.logs_array || (payload?.log ? [payload.log] : []);
    const entries = Array.isArray(incoming) ? incoming : [incoming];

    const record = {
      receivedAt: new Date().toISOString(),
      mac: parsed.mac,
      batteryVoltage: parsed.batteryVoltage,
      rssi: parsed.rssi,
      fwVersion: parsed.fwVersion,
      entriesCount: entries.length,
      entries
    };
    if (Array.isArray(logStore)) {
      logStore.unshift(record);
      if (logStore.length > 100) logStore.length = 100;
    }

    return {
      status: 200,
      message: 'Log recorded',
      entries_recorded: entries.length,
      device_mac: parsed.mac
    };
  }

  // ============================================================================
  // 6. BATTERY LIFE & ESP32-C3 E-PAPER POWER PHYSICS CALCULATOR
  // ============================================================================

  function voltageToSocPercent(voltage) {
    const v = Number(voltage) || 3.8;
    if (v >= 4.18) return 100;
    if (v <= 3.20) return 0;
    // Piecewise LiPo discharge curve approximation
    const normalized = (v - 3.20) / (4.18 - 3.20);
    const shaped = Math.pow(normalized, 1.15) * 100;
    return Math.max(0, Math.min(100, Math.round(shaped)));
  }

  function estimateBatteryLife(params = {}) {
    const capacityMah = Math.max(200, Number(params.capacityMah) || 1800);
    const refreshIntervalSec = Math.max(30, Number(params.refreshIntervalSec) || 900);
    const rssi = Number(params.rssi) || -60;
    const batteryVoltage = Number(params.batteryVoltage) || 4.04;

    // Deep sleep current (~18 uA = 0.018 mA)
    const sleepCurrentMa = 0.018;
    // Active Wi-Fi + HTTP fetch + e-paper LUT refresh current (~78 mA average)
    const activeCurrentMa = 78.0;
    // Weaker Wi-Fi signal increases association + TLS retransmission time
    const rssiPenaltySec = Math.max(0, Math.min(4.5, (-50 - rssi) * 0.06));
    const activeDurationSec = 4.2 + rssiPenaltySec;

    const wakesPerDay = 86400 / refreshIntervalSec;
    const activeSecPerDay = wakesPerDay * activeDurationSec;
    const sleepSecPerDay = Math.max(0, 86400 - activeSecPerDay);

    const activeMahPerDay = (activeCurrentMa * activeSecPerDay) / 3600;
    const sleepMahPerDay = (sleepCurrentMa * sleepSecPerDay) / 3600;
    const totalMahPerDay = activeMahPerDay + sleepMahPerDay;

    const socPercent = voltageToSocPercent(batteryVoltage);
    const usableCapacityMah = capacityMah * 0.90; // 10% safety reserve
    const remainingMah = usableCapacityMah * (socPercent / 100);
    const estimatedDaysFull = usableCapacityMah / totalMahPerDay;
    const estimatedDaysRemaining = remainingMah / totalMahPerDay;

    return {
      capacityMah,
      refreshIntervalSec,
      rssi,
      batteryVoltage,
      socPercent,
      wakesPerDay: Number(wakesPerDay.toFixed(1)),
      activeDurationSec: Number(activeDurationSec.toFixed(2)),
      mahPerDay: Number(totalMahPerDay.toFixed(3)),
      estimatedDaysFull: Math.round(estimatedDaysFull),
      estimatedDaysRemaining: Math.round(estimatedDaysRemaining)
    };
  }

  // ============================================================================
  // 7. TRMNL NATIVE .LIQUID PLUGIN MARKUP GENERATOR
  // ============================================================================

  // Custom data lands inside double-quoted Liquid `default:` literals, so
  // backslashes and double quotes in user strings must be escaped or the
  // exported template breaks.
  function escapeLiquidData(data) {
    if (Array.isArray(data)) return data.map(escapeLiquidData);
    if (data && typeof data === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(data)) out[k] = escapeLiquidData(v);
      return out;
    }
    return typeof data === 'string' ? data.replace(/\\/g, '\\\\').replace(/"/g, '\\"') : data;
  }

  function generateLiquidTemplate(screenId = 'corridor', viewSize = 'full', customData = {}) {
    const id = String(screenId || 'corridor').toLowerCase();
    const view = ['full', 'half_horizontal', 'half_vertical', 'quadrant'].includes(viewSize)
      ? viewSize
      : 'full';
    // TRMNL ships per-view markup: smaller panes get fewer list rows.
    const loopLimit = { full: 5, half_horizontal: 3, half_vertical: 3, quadrant: 2 }[view];

    if (id === 'orbital') {
      const d = escapeLiquidData(Object.assign({}, DEFAULT_SCREEN_DATA.orbital, customData));
      return `<div class="view view--${view}">
  <div class="layout layout--col gap--space-between">
    <div class="grid grid--cols-2">
      <div class="item">
        <div class="meta"><span class="index">ORBIT</span></div>
        <div class="content">
          <span class="title title--small">{{ target_sat | default: "${d.targetSat}" }}</span>
          <span class="description">MAX EL: {{ max_elevation_deg | default: "${d.maxElevationDeg}" }}° // AOS AZ: {{ aos_azimuth_deg | default: "${d.aosAzimuthDeg}" }}°</span>
          <div class="flex gap--small">
            <span class="label label--small label--inverted">DOWNLINK {{ downlink_mhz | default: "${d.downlinkMhz}" }}</span>
          </div>
        </div>
      </div>
      <div class="item">
        <div class="meta"><span class="index">SOLAR</span></div>
        <div class="content">
          <span class="value value--medium value--tnums">{{ sun_sunrise | default: "${d.sunEvents.sunrise}" }} / {{ sun_sunset | default: "${d.sunEvents.sunset}" }}</span>
          <span class="label label--small">F10.7 FLUX: {{ solar_flux | default: "${d.solarFluxF107}" }} // KP: {{ kp_index | default: "${d.kpIndex}" }}</span>
        </div>
      </div>
    </div>
    <div class="divider"></div>
    <table class="table">
      <thead>
        <tr><th>SATELLITE</th><th>AOS UTC</th><th>DURATION</th><th>MAX EL</th><th>MODE</th></tr>
      </thead>
      <tbody>
        {% for pass in upcoming_passes limit:${loopLimit} %}
        <tr>
          <td><span class="label label--small">{{ pass.sat }}</span></td>
          <td><span class="value value--xxsmall value--tnums">{{ pass.aos }}</span></td>
          <td><span class="description">{{ pass.dur }}</span></td>
          <td><span class="label label--small label--inverted">{{ pass.maxEl }}</span></td>
          <td><span class="description">{{ pass.mode }}</span></td>
        </tr>
        {% else %}
        <tr><td colspan="5"><span class="description">NO PASSES IN WINDOW</span></td></tr>
        {% endfor %}
      </tbody>
    </table>
  </div>
  <div class="title_bar">
    <span class="title">TRMNL Horizon // Orbital Ephemeris</span>
    <span class="instance">{{ station_callsign | default: "${d.stationCallsign}" }}</span>
  </div>
</div>`;
    }

    if (id === 'labbench') {
      const d = escapeLiquidData(Object.assign({}, DEFAULT_SCREEN_DATA.labbench, customData));
      return `<div class="view view--${view}">
  <div class="layout layout--col gap--space-between">
    <div class="grid grid--cols-2">
      <div class="item">
        <div class="meta"><span class="index">BYOS</span></div>
        <div class="content">
          <span class="title title--small">{{ cluster_name | default: "${d.clusterName}" }}</span>
          <span class="description">HOST {{ host_ip | default: "${d.hostIp}" }} // {{ firmware_target | default: "${d.firmwareTarget}" }}</span>
        </div>
      </div>
      <div class="item">
        <div class="meta"><span class="index">POWER</span></div>
        <div class="content">
          <span class="value value--medium value--tnums">{{ trmnl.device.percent_charged | default: "84" }}%</span>
          <span class="label label--small label--inverted">RSSI {{ trmnl.device.wifi_strength | default: "-58" }} dBm</span>
        </div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="grid grid--cols-2">
      {% for node in nodes limit:${loopLimit} %}
      <div class="item bg--gray-5">
        <div class="meta"><span class="index">{{ forloop.index }}</span></div>
        <div class="content">
          <span class="label">{{ node.name }}</span>
          <span class="description">CPU {{ node.cpu_pct }}% // TEMP {{ node.tempC }}°C // {{ node.status }}</span>
        </div>
      </div>
      {% else %}
      <div class="item"><div class="content"><span class="description">NO NODES REPORTING</span></div></div>
      {% endfor %}
    </div>
  </div>
  <div class="title_bar">
    <span class="title">TRMNL Horizon // Lab Bench Telemetry</span>
    <span class="instance">{{ trmnl.plugin_settings.instance_name | default: "Rack-03" }}</span>
  </div>
</div>`;
    }

    if (id === 'rhythm') {
      const d = escapeLiquidData(Object.assign({}, DEFAULT_SCREEN_DATA.rhythm, customData));
      return `<div class="view view--${view}">
  <div class="layout layout--col gap--space-between">
    <div class="item">
      <div class="meta"><span class="index">RAGA</span></div>
      <div class="content">
        <span class="title title--small">{{ raga_name | default: "${d.ragaName}" }}</span>
        <span class="description">AROHA: {{ aroha | default: "${d.aroha}" }} // AVAROHA: {{ avaroha | default: "${d.avaroha}" }}</span>
        <span class="label label--small label--inverted">{{ taal_name | default: "${d.taalName}" }} @ {{ bpm | default: "${d.bpm}" }} BPM</span>
      </div>
    </div>
    <div class="divider"></div>
    <div class="grid grid--cols-4">
      <div class="item bg--gray-5"><div class="content"><span class="label label--inverted">X (SAM)</span><span class="description">DHA DHIN DHIN DHA</span></div></div>
      <div class="item"><div class="content"><span class="label">2 (TALI)</span><span class="description">DHA DHIN DHIN DHA</span></div></div>
      <div class="item bg--gray-5"><div class="content"><span class="label">0 (KHALI)</span><span class="description">DHA TIN TIN TA</span></div></div>
      <div class="item"><div class="content"><span class="label">3 (TALI)</span><span class="description">TA DHIN DHIN DHA</span></div></div>
    </div>
  </div>
  <div class="title_bar">
    <span class="title">TRMNL Horizon // Classical Riyaz Almanac</span>
    <span class="instance">Streak: {{ streak_days | default: "${d.streakDays}" }} Days</span>
  </div>
</div>`;
    }

    const d = escapeLiquidData(Object.assign({}, DEFAULT_SCREEN_DATA.corridor, customData));
    return `<div class="view view--${view}">
  <div class="layout layout--col gap--space-between">
    <div class="grid grid--cols-2">
      <div class="item">
        <div class="meta"><span class="index">STATION</span></div>
        <div class="content">
          <span class="title title--small">{{ station_name | default: "${d.stationName}" }}</span>
          <span class="description">{{ active_alerts | default: "${d.activeAlerts}" }}</span>
        </div>
      </div>
      <div class="item">
        <div class="meta"><span class="index">HEADWAY</span></div>
        <div class="content">
          <span class="value value--medium value--tnums">{{ headway_adherence_pct | default: "${d.headwayAdherencePct}" }}%</span>
          <span class="label label--small label--inverted">UPDATED {{ updated_at | default: "${d.updatedAt}" }}</span>
        </div>
      </div>
    </div>
    <div class="divider"></div>
    <table class="table">
      <thead>
        <tr><th>LINE</th><th>DESTINATION</th><th>TRK</th><th>STATUS</th><th>ETA</th></tr>
      </thead>
      <tbody>
        {% for dep in departures limit:${loopLimit} %}
        <tr>
          <td><span class="label label--small label--inverted">{{ dep.line }}</span></td>
          <td><span class="title title--xxsmall">{{ dep.dest }}</span></td>
          <td><span class="value value--xxsmall value--tnums">{{ dep.track }}</span></td>
          <td><span class="label label--small">{{ dep.status }}</span></td>
          <td><span class="value value--xxsmall value--tnums">{{ dep.etaMin }}m</span></td>
        </tr>
        {% else %}
        <tr><td colspan="5"><span class="description">NO DEPARTURES ON THE BOARD</span></td></tr>
        {% endfor %}
      </tbody>
    </table>
  </div>
  <div class="title_bar">
    <span class="title">TRMNL Horizon // Corridor Dispatch</span>
    <span class="instance">{{ station_code | default: "${d.stationCode}" }}</span>
  </div>
</div>`;
  }

  return {
    DISPLAY_WIDTH,
    DISPLAY_HEIGHT,
    FONT_5X7,
    DEFAULT_SCREEN_DATA,
    EInkFramebuffer,
    quantizePixel,
    ditherThreshold,
    ditherFloydSteinberg,
    ditherAtkinson,
    ditherBayer,
    applyDithering,
    pack1Bit,
    unpack1Bit,
    encode1BitBMP,
    encodeGrayscalePNG,
    crc32,
    adler32,
    renderCorridorScreen,
    renderOrbitalScreen,
    renderLabBenchScreen,
    renderRhythmScreen,
    renderScreen,
    parseTrmnlHeaders,
    deriveFriendlyId,
    deriveApiKey,
    handleApiSetup,
    handleApiDisplay,
    handleApiLog,
    voltageToSocPercent,
    estimateBatteryLife,
    generateLiquidTemplate
  };
});
