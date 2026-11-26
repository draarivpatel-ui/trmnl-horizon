'use strict';

/**
 * TRMNL-Horizon E-Paper Dither & Battery Frontier Lab (UMD: Browser + Node.js)
 *
 * Pure deterministic measurement layer over trmnl_engine.js. No DOM access, no
 * timers, no randomness: every function below returns identical output for
 * identical input in Node.js and in the browser, which is what lets the in-page
 * self-tests and the node --test suite verify the exact same invariants.
 *
 * Contents:
 *   1. Pure-JS FIPS 180-4 SHA-256 + canonical JSON (key-sorted, cycle-safe,
 *      depth-bounded)
 *   2. 16-combo Screen x Dither comparator matrix (ink coverage, RLE
 *      compressibility, byte entropy, midtone PSNR, SSIM-like block fidelity,
 *      exact 48,062-byte BMP verification, determinism check)
 *   3. ESP32-C3 + UC8179 battery autonomy sweeps (interval x capacity x RSSI)
 *   4. Ink-density vs fidelity scatter data
 *   5. Audited hardware proof brief (single cached canonical SHA-256 stamped
 *      identically across the UI badge, JSON, CSV and Markdown exports)
 *   6. Fail-closed #thlab= bookmark codec
 *   7. In-page deterministic self-test suite (18+ checks)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.TrmnlEpaperLab = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /* ---------- Lab catalogs ---------- */

  const BRIEF_FORMAT = 'TRMNL_EPAPER_PROOF_BRIEF_V1';
  const BRIEF_DISCLOSURE = 'Deterministic local audit of the TRMNL-Horizon 1-bit dithering pipeline and the ESP32-C3 + UC8179 battery physics model shipped in trmnl_engine.js. All figures are computed from the engine, not from device telemetry.';
  const BOOKMARK_PREFIX = 'thlab=';
  const BOOKMARK_VERSION = 1;

  const SCREENS = Object.freeze(['corridor', 'orbital', 'labbench', 'rhythm']);
  const DITHERS = Object.freeze([
    { id: 'atkinson', label: 'Atkinson', short: 'ATK' },
    { id: 'floyd-steinberg', label: 'Floyd-Steinberg', short: 'FS' },
    { id: 'bayer4', label: 'Bayer 4x4', short: 'B4' },
    { id: 'bayer8', label: 'Bayer 8x8', short: 'B8' }
  ]);
  const DITHER_IDS = Object.freeze(DITHERS.map((d) => d.id));

  const CAPACITY_OPTIONS = Object.freeze([1200, 1800, 2500]);
  const RSSI_OPTIONS = Object.freeze([-45, -58, -70, -80, -88]);
  const DEFAULT_INTERVALS = Object.freeze([
    60, 120, 180, 300, 420, 600, 900, 1200, 1500, 1800, 2400, 3000, 3600
  ]);
  const REFRESH_MIN_SEC = 60;
  const REFRESH_MAX_SEC = 3600;
  const RSSI_MIN = -88;
  const RSSI_MAX = -42;
  const VOLTAGE_MIN_X100 = 325; // 3.25 V
  const VOLTAGE_MAX_X100 = 420; // 4.20 V

  const B64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const B64URL_RE = /^[A-Za-z0-9_-]+$/;
  const B64URL_CUT_RE = /[^A-Za-z0-9_-]/;
  const BLOCKED_STATE_KEYS = ['__proto__', 'prototype', 'constructor'];
  const MAX_CANON_DEPTH = 64;

  const SHA256_KATS = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['TRMNL-Horizon e-paper lab', '49e9e21b71a3de828a7e99d7bf38198e3122ce96f60ade00fd8b78a53ee5b8d7'],
    ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a'],
    ['zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', '72996563049cc84daa2c3f31fd5c3d10770e69d6ebbb8da5b6d76db303dbae43'],
    ['line1\nline2', '683376e290829b482c2655745caffa7a1dccfa10afaa62dac2b42dd6c68d0f83'],
    ['tab\tsep', '018f0f844e2222bca764785fd7a4d7cae39d12c2f895560771dcecf9a7d99944']
  ];

  /* ---------- Pure JS FIPS 180-4 SHA-256 ---------- */

  const SHA256_K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  function utf8Bytes(str) {
    const s = String(str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length &&
        s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) < 0xe000) {
        const c2 = s.charCodeAt(++i);
        const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
      } else if (c >= 0xd800 && c < 0xe000) {
        out.push(0xef, 0xbf, 0xbd);
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function toByteList(input) {
    if (typeof input === 'string') return utf8Bytes(input);
    if (input && typeof input.length === 'number') {
      const out = new Array(input.length);
      for (let i = 0; i < input.length; i++) out[i] = input[i] & 0xff;
      return out;
    }
    return utf8Bytes(String(input));
  }

  function sha256Hex(input) {
    const bytes = toByteList(input);
    const bitLen = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) {
      bytes.push(0x00);
    }
    const hi = Math.floor(bitLen / 0x100000000);
    const lo = bitLen >>> 0;
    bytes.push(
      (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
      (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff
    );

    const H = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ]);
    const W = new Uint32Array(64);

    for (let offset = 0; offset < bytes.length; offset += 64) {
      for (let i = 0; i < 16; i++) {
        const j = offset + i * 4;
        W[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = (rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3)) >>> 0;
        const s1 = (rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10)) >>> 0;
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
      }

      let a = H[0], b = H[1], c = H[2], d = H[3];
      let e = H[4], f = H[5], g = H[6], h = H[7];

      for (let i = 0; i < 64; i++) {
        const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
        const ch = ((e & f) ^ ((~e) & g)) >>> 0;
        const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
        const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const temp2 = (S0 + maj) >>> 0;

        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }

      H[0] = (H[0] + a) >>> 0;
      H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0;
      H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0;
      H[7] = (H[7] + h) >>> 0;
    }

    let hex = '';
    for (let i = 0; i < 8; i++) {
      hex += H[i].toString(16).padStart(8, '0');
    }
    return hex;
  }

  /* ---------- Canonical JSON (key-sorted, cycle-safe, depth-bounded) ---------- */

  function canonicalize(value, seen, depth) {
    const d = depth === undefined ? 0 : depth;
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      if (d > MAX_CANON_DEPTH) return null;
      const visited = seen || new Set();
      if (visited.has(value)) return null;
      visited.add(value);
      let out;
      if (Array.isArray(value)) {
        out = value.map((v) => canonicalize(v, visited, d + 1));
      } else {
        out = {};
        const keys = Object.keys(value).sort();
        for (const k of keys) {
          if (!Object.prototype.hasOwnProperty.call(value, k)) continue;
          if (BLOCKED_STATE_KEYS.indexOf(k) >= 0) continue;
          const v = value[k];
          if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
          out[k] = canonicalize(v, visited, d + 1);
        }
      }
      visited.delete(value);
      return out;
    }
    return null;
  }

  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }

  function deepFreeze(value) {
    if (value && typeof value === 'object') {
      for (const k of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(value, k)) deepFreeze(value[k]);
      }
      return Object.freeze(value);
    }
    return value;
  }

  /* ---------- Dither quality metrics ---------- */

  function inkCoverage(ditheredPixels) {
    let black = 0;
    for (let i = 0; i < ditheredPixels.length; i++) {
      if (ditheredPixels[i] < 128) black++;
    }
    const total = ditheredPixels.length;
    // An empty buffer has no ink and no valid percentage; report zero instead
    // of the NaN that 0/0 would put into the brief and every export.
    return {
      blackPx: black,
      whitePx: total - black,
      inkPct: total === 0 ? 0 : Number(((black / total) * 100).toFixed(2))
    };
  }

  /**
   * Horizontal run-length stats over the quantized buffer: the metric real
   * e-paper controllers and BMP/GZIP shippers care about. Fewer, longer runs
   * mean a payload that compresses better and flashes fewer line transitions.
   */
  function runLengthStats(ditheredPixels, width, height) {
    let runs = 0;
    let transitions = 0;
    for (let y = 0; y < height; y++) {
      const off = y * width;
      let prev = ditheredPixels[off] < 128 ? 0 : 1;
      for (let x = 1; x < width; x++) {
        const cur = ditheredPixels[off + x] < 128 ? 0 : 1;
        if (cur !== prev) {
          runs++;
          transitions++;
          prev = cur;
        }
      }
    }
    runs += height; // every row ends a run
    const rawBytes = Math.ceil(width / 8) * height;
    const rleBytes = runs * 2; // 16-bit run lengths
    return {
      runs,
      transitions,
      rawBytes,
      rleBytes,
      rleRatio: Number((rleBytes / rawBytes).toFixed(4))
    };
  }

  /** Shannon entropy (bits per byte) of the packed 1-bit payload. */
  function byteEntropy(engine, ditheredPixels, width, height) {
    const packed = engine.pack1Bit(ditheredPixels, width, height);
    const hist = new Uint32Array(256);
    for (let i = 0; i < packed.length; i++) hist[packed[i]]++;
    let entropy = 0;
    const n = packed.length;
    for (let b = 0; b < 256; b++) {
      if (hist[b] === 0) continue;
      const p = hist[b] / n;
      entropy -= p * Math.log2(p);
    }
    return {
      packedBytes: n,
      distinctBytes: hist.reduce((acc, c) => acc + (c > 0 ? 1 : 0), 0),
      bitsPerByte: Number(entropy.toFixed(4))
    };
  }

  /**
   * Midtone PSNR (dB) between the continuous grayscale framebuffer and the
   * quantized output, computed over pixels whose source gray sits inside the
   * 32..223 midtone band. Falls back to the full frame when a screen has no
   * midtone content. Higher is better; capped at 99 for a lossless pass.
   */
  function midtonePsnr(grayPixels, ditheredPixels) {
    let se = 0;
    let count = 0;
    for (let i = 0; i < grayPixels.length; i++) {
      const g = grayPixels[i];
      if (g >= 32 && g <= 223) {
        const diff = ditheredPixels[i] - g;
        se += diff * diff;
        count++;
      }
    }
    if (count === 0) {
      for (let i = 0; i < grayPixels.length; i++) {
        const diff = ditheredPixels[i] - grayPixels[i];
        se += diff * diff;
      }
      count = grayPixels.length;
    }
    if (se === 0) return 99;
    const mse = se / count;
    const psnr = 20 * Math.log10(255 / Math.sqrt(mse));
    return Number(Math.min(99, psnr).toFixed(3));
  }

  /**
   * SSIM-like local block fidelity: standard SSIM luminance x contrast x
   * structure terms averaged over 8x8 blocks comparing the grayscale source
   * with the quantized output. Range -1..1, higher is better.
   */
  function ssimLikeBlockFidelity(grayPixels, ditheredPixels, width, height, block = 8) {
    const C1 = 6.5025;  // (0.01 * 255)^2
    const C2 = 58.5225; // (0.03 * 255)^2
    let sum = 0;
    let blocks = 0;
    for (let by = 0; by + block <= height; by += block) {
      for (let bx = 0; bx + block <= width; bx += block) {
        let n = 0, sumG = 0, sumD = 0, sumG2 = 0, sumD2 = 0, sumGD = 0;
        for (let y = 0; y < block; y++) {
          const off = (by + y) * width + bx;
          for (let x = 0; x < block; x++) {
            const g = grayPixels[off + x];
            const dd = ditheredPixels[off + x];
            sumG += g; sumD += dd;
            sumG2 += g * g; sumD2 += dd * dd;
            sumGD += g * dd;
            n++;
          }
        }
        const muG = sumG / n;
        const muD = sumD / n;
        const varG = Math.max(0, sumG2 / n - muG * muG);
        const varD = Math.max(0, sumD2 / n - muD * muD);
        const cov = sumGD / n - muG * muD;
        const num = (2 * muG * muD + C1) * (2 * cov + C2);
        const den = (muG * muG + muD * muD + C1) * (varG + varD + C2);
        if (den > 0) {
          sum += num / den;
          blocks++;
        }
      }
    }
    return blocks === 0 ? 0 : Number((sum / blocks).toFixed(4));
  }

  function verifyBmp48k(engine, ditheredPixels, width, height) {
    const bmp = engine.encode1BitBMP(ditheredPixels, width, height);
    const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
    const expectedImageBytes = ((Math.ceil(width / 8) + 3) & ~3) * height;
    const headerOk =
      bmp[0] === 0x42 && bmp[1] === 0x4d &&
      view.getUint32(2, true) === bmp.byteLength &&
      view.getUint32(10, true) === 62 &&
      view.getUint32(14, true) === 40 &&
      view.getInt32(18, true) === width &&
      view.getInt32(22, true) === height &&
      view.getUint16(26, true) === 1 &&
      view.getUint16(28, true) === 1 &&
      view.getUint32(34, true) === expectedImageBytes;
    return {
      bmpBytes: bmp.byteLength,
      bmpHeaderOk: headerOk,
      bmpIs48062: bmp.byteLength === 48062
    };
  }

  /* ---------- 16-combo comparator matrix ---------- */

  function screenDataFor(engine, screenId, overridesByScreen) {
    const ov = overridesByScreen && overridesByScreen[screenId];
    return (ov && typeof ov === 'object' && !Array.isArray(ov)) ? ov : {};
  }

  function measureCombo(engine, screenId, ditherId, options) {
    const opts = options || {};
    const data = screenDataFor(engine, screenId, opts.overridesByScreen);
    const renderOpts = {
      ditherMode: ditherId,
      data,
      batteryVoltage: opts.batteryVoltage,
      rssi: opts.rssi,
      refreshRate: opts.refreshRate
    };
    const r1 = engine.renderScreen(screenId, renderOpts);
    const r2 = engine.renderScreen(screenId, renderOpts);
    const crc = engine.crc32(r1.ditheredPixels);
    const deterministic = engine.crc32(r2.ditheredPixels) === crc;

    const cov = inkCoverage(r1.ditheredPixels);
    const rle = runLengthStats(r1.ditheredPixels, r1.width, r1.height);
    const ent = byteEntropy(engine, r1.ditheredPixels, r1.width, r1.height);
    const psnr = midtonePsnr(r1.grayPixels, r1.ditheredPixels);
    const ssim = ssimLikeBlockFidelity(r1.grayPixels, r1.ditheredPixels, r1.width, r1.height);
    const bmp = verifyBmp48k(engine, r1.ditheredPixels, r1.width, r1.height);

    return {
      screenId,
      ditherId,
      index: SCREENS.indexOf(screenId) * DITHER_IDS.length + DITHER_IDS.indexOf(ditherId),
      inkPct: cov.inkPct,
      blackPx: cov.blackPx,
      whitePx: cov.whitePx,
      runs: rle.runs,
      rleBytes: rle.rleBytes,
      rawBytes: rle.rawBytes,
      rleRatio: rle.rleRatio,
      byteEntropy: ent.bitsPerByte,
      distinctBytes: ent.distinctBytes,
      psnrDb: psnr,
      ssim,
      bmpBytes: bmp.bmpBytes,
      bmpHeaderOk: bmp.bmpHeaderOk,
      bmpIs48062: bmp.bmpIs48062,
      crc32: crc,
      deterministic
    };
  }

  function runComparatorMatrix(engine, options) {
    const rows = [];
    for (const screenId of SCREENS) {
      for (const d of DITHERS) {
        rows.push(measureCombo(engine, screenId, d.id, options));
      }
    }
    return {
      screens: SCREENS.slice(),
      dithers: DITHER_IDS.slice(),
      rows
    };
  }

  /* ---------- Battery autonomy sweeps ---------- */

  function clampInterval(v) {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return null;
    return Math.max(REFRESH_MIN_SEC, Math.min(REFRESH_MAX_SEC, n));
  }

  function batteryCurve(engine, params) {
    const p = params || {};
    const capacityMah = Number.isFinite(Number(p.capacityMah)) ? Number(p.capacityMah) : 1800;
    const rssi = Number.isFinite(Number(p.rssi)) ? Number(p.rssi) : -58;
    const batteryVoltage = Number.isFinite(Number(p.batteryVoltage)) ? Number(p.batteryVoltage) : 4.04;
    const intervals = Array.isArray(p.intervals) && p.intervals.length >= 2
      ? p.intervals.map(clampInterval).filter((v) => v !== null)
      : DEFAULT_INTERVALS.slice();
    const points = intervals.map((sec) => {
      const est = engine.estimateBatteryLife({
        capacityMah, refreshIntervalSec: sec, rssi, batteryVoltage
      });
      return {
        intervalSec: sec,
        daysRemaining: est.estimatedDaysRemaining,
        daysFull: est.estimatedDaysFull,
        mahPerDay: est.mahPerDay,
        wakesPerDay: est.wakesPerDay,
        activeDurationSec: est.activeDurationSec,
        socPercent: est.socPercent
      };
    });
    return { capacityMah, rssi, batteryVoltage, points };
  }

  function batteryFrontier(engine, params) {
    const p = params || {};
    const capacities = Array.isArray(p.capacities) ? p.capacities : CAPACITY_OPTIONS.slice();
    const rssis = Array.isArray(p.rssis) ? p.rssis : RSSI_OPTIONS.slice();
    const intervals = Array.isArray(p.intervals) ? p.intervals : DEFAULT_INTERVALS.slice();
    const batteryVoltage = Number.isFinite(Number(p.batteryVoltage)) ? Number(p.batteryVoltage) : 4.04;
    const days = capacities.map((cap) =>
      rssis.map((r) =>
        intervals.map((sec) => engine.estimateBatteryLife({
          capacityMah: cap, refreshIntervalSec: sec, rssi: r, batteryVoltage
        }).estimatedDaysRemaining)
      )
    );
    return { capacities, rssis, intervals, batteryVoltage, days };
  }

  /* ---------- Ink density vs fidelity scatter ---------- */

  function fidelityScatter(engine, screenId, options) {
    const id = SCREENS.indexOf(screenId) >= 0 ? screenId : 'corridor';
    const points = DITHERS.map((d) => {
      const row = measureCombo(engine, id, d.id, options);
      return {
        screenId: id,
        ditherId: d.id,
        label: d.label,
        inkPct: row.inkPct,
        psnrDb: row.psnrDb,
        ssim: row.ssim,
        runs: row.runs,
        byteEntropy: row.byteEntropy
      };
    });
    return { screenId: id, points };
  }

  /* ---------- Audited hardware proof brief ---------- */

  function hasBlockedKey(value, depth) {
    if (!value || typeof value !== 'object' || depth > 64) return false;
    for (const k of Object.keys(value)) {
      if (BLOCKED_STATE_KEYS.indexOf(k) >= 0) return true;
      if (hasBlockedKey(value[k], depth + 1)) return true;
    }
    return false;
  }

  function stripDigest(brief) {
    const out = Object.create(null);
    for (const k of Object.keys(brief)) {
      if (k !== 'auditDigest' && Object.prototype.hasOwnProperty.call(brief, k)) {
        out[k] = brief[k];
      }
    }
    return out;
  }

  function digestOfPayload(payloadSansDigest) {
    return sha256Hex(BRIEF_FORMAT + '|' + canonicalJson(payloadSansDigest));
  }

  function buildAuditPayload(engine, snapshot, matrixRows) {
    const snap = (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) ? snapshot : {};
    const screenId = SCREENS.indexOf(snap.screenId) >= 0 ? snap.screenId : 'corridor';
    const ditherId = DITHER_IDS.indexOf(snap.ditherId) >= 0 ? snap.ditherId : 'atkinson';
    const opts = {
      overridesByScreen: snap.overridesByScreen,
      batteryVoltage: snap.batteryVoltage,
      rssi: snap.rssi,
      refreshRate: snap.refreshIntervalSec
    };
    const rows = Array.isArray(matrixRows)
      ? matrixRows
      : runComparatorMatrix(engine, opts).rows;
    const active = rows.find((r) => r.screenId === screenId && r.ditherId === ditherId) || rows[0];
    const est = engine.estimateBatteryLife({
      capacityMah: snap.capacityMah,
      refreshIntervalSec: snap.refreshIntervalSec,
      rssi: snap.rssi,
      batteryVoltage: snap.batteryVoltage
    });

    return {
      format: BRIEF_FORMAT,
      active: {
        screenId,
        ditherId,
        inkPct: active.inkPct,
        blackPx: active.blackPx,
        runs: active.runs,
        rleBytes: active.rleBytes,
        byteEntropy: active.byteEntropy,
        psnrDb: active.psnrDb,
        ssim: active.ssim,
        bmpBytes: active.bmpBytes,
        bmpHeaderOk: active.bmpHeaderOk,
        crc32: active.crc32
      },
      workbench: {
        refreshIntervalSec: clampInterval(snap.refreshIntervalSec) || 300,
        batteryVoltage: Number.isFinite(Number(snap.batteryVoltage)) ? Number(snap.batteryVoltage) : 4.04,
        rssi: Number.isFinite(Number(snap.rssi)) ? Number(snap.rssi) : -58,
        capacityMah: Number.isFinite(Number(snap.capacityMah)) ? Number(snap.capacityMah) : 1800
      },
      battery: {
        socPercent: est.socPercent,
        wakesPerDay: est.wakesPerDay,
        activeDurationSec: est.activeDurationSec,
        mahPerDay: est.mahPerDay,
        estimatedDaysRemaining: est.estimatedDaysRemaining,
        estimatedDaysFull: est.estimatedDaysFull
      },
      matrix: rows.map((r) => ({
        s: r.screenId,
        d: r.ditherId,
        inkPct: r.inkPct,
        runs: r.runs,
        rleBytes: r.rleBytes,
        byteEntropy: r.byteEntropy,
        psnrDb: r.psnrDb,
        ssim: r.ssim,
        bmpBytes: r.bmpBytes,
        bmpOk: r.bmpHeaderOk === true && r.bmpIs48062 === true && r.deterministic === true
      })),
      disclosure: BRIEF_DISCLOSURE
    };
  }

  function verifyAuditBrief(brief) {
    if (!brief || typeof brief !== 'object' || Array.isArray(brief)) {
      return { ok: false, reason: 'MALFORMED_BRIEF', expectedDigest: null, actualDigest: null };
    }
    if (hasBlockedKey(brief, 0)) {
      return { ok: false, reason: 'HOSTILE_KEYS', expectedDigest: null, actualDigest: null };
    }
    if (typeof brief.auditDigest !== 'string' || !/^[0-9a-f]{64}$/.test(brief.auditDigest)) {
      return {
        ok: false,
        reason: 'MISSING_DIGEST',
        expectedDigest: null,
        actualDigest: typeof brief.auditDigest === 'string' ? brief.auditDigest : null
      };
    }
    const expected = digestOfPayload(stripDigest(brief));
    return {
      ok: expected === brief.auditDigest,
      reason: expected === brief.auditDigest ? 'OK' : 'DIGEST_MISMATCH',
      expectedDigest: expected,
      actualDigest: brief.auditDigest
    };
  }

  /** Single-unit mutation demo: flips exactly one measured figure by one unit. */
  function tamperAuditBrief(brief) {
    if (!brief || typeof brief !== 'object' || Array.isArray(brief)) return brief;
    let clone;
    try {
      clone = JSON.parse(JSON.stringify(brief));
    } catch (e) {
      return brief;
    }
    if (!clone || typeof clone !== 'object' || Array.isArray(clone)) return brief;
    if (clone.active && typeof clone.active === 'object' &&
      Number.isSafeInteger(clone.active.blackPx)) {
      clone.active.blackPx += 1;
    } else if (Array.isArray(clone.matrix) && clone.matrix.length > 0 &&
      clone.matrix[0] && typeof clone.matrix[0] === 'object' &&
      Number.isFinite(clone.matrix[0].inkPct)) {
      clone.matrix[0].inkPct += 1;
    } else {
      clone.disclosure = String(clone.disclosure || '') + ' ';
    }
    return clone;
  }

  /* ---------- Formula-safe CSV + export formats ---------- */

  function csvEscapeCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    const lead = (/^[\s\p{Cf}\p{Cc}]*/u.exec(s) || [''])[0];
    const first = s.charAt(lead.length);
    const plainNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s.slice(lead.length));
    const formulaStart = lead.length > 0 || (first !== '' && '=+-@'.indexOf(first) !== -1 && !(first === '-' && plainNumber));
    const needsQuote = /[",\n\r]/.test(s);
    if (formulaStart) s = "'" + s;
    if (needsQuote) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportJsonBrief(stamped) {
    if (!stamped || typeof stamped !== 'object') return 'null';
    return JSON.stringify(stamped, null, 2);
  }

  function exportCsvBrief(stamped) {
    if (!stamped || typeof stamped !== 'object') return '';
    const lines = [];
    lines.push('# trmnl-horizon audited hardware proof brief');
    lines.push('# format ' + stamped.format);
    lines.push('# sha256 ' + stamped.auditDigest);
    lines.push('# active ' + stamped.active.screenId + ' x ' + stamped.active.ditherId +
      ' refresh ' + stamped.workbench.refreshIntervalSec + 's ' +
      stamped.workbench.capacityMah + 'mAh rssi ' + stamped.workbench.rssi + 'dBm');
    lines.push('# ' + stamped.disclosure);
    lines.push('screen,dither,ink_pct,h_runs,rle_bytes,byte_entropy,psnr_db,ssim_like,bmp_bytes,bmp_ok');
    for (const r of (stamped.matrix || [])) {
      lines.push([
        r.s, r.d, r.inkPct, r.runs, r.rleBytes, r.byteEntropy, r.psnrDb, r.ssim, r.bmpBytes, r.bmpOk
      ].map(csvEscapeCell).join(','));
    }
    return lines.join('\n') + '\n';
  }

  function exportMarkdownBrief(stamped) {
    if (!stamped || typeof stamped !== 'object' || Array.isArray(stamped)) return '';
    const a = stamped.active || {};
    const w = stamped.workbench || {};
    const b = stamped.battery || {};
    const lines = [];
    lines.push('# TRMNL-Horizon Audited Hardware Proof Brief');
    lines.push('');
    lines.push('Active combo: ' + String(a.screenId || 'n/a') + ' x ' + String(a.ditherId || 'n/a') +
      ' (' + String(a.inkPct) + '% ink, ' + String(a.bmpBytes) + '-byte BMP).');
    lines.push('Workbench: refresh ' + String(w.refreshIntervalSec) + 's, ' +
      String(w.batteryVoltage) + 'V, RSSI ' + String(w.rssi) + ' dBm, ' + String(w.capacityMah) + ' mAh.');
    lines.push('Battery estimate: ' + String(b.estimatedDaysRemaining) + ' days remaining (' +
      String(b.socPercent) + '% SoC), ' + String(b.mahPerDay) + ' mAh/day, ' +
      String(b.wakesPerDay) + ' wakes/day.');
    lines.push('');
    lines.push('| Screen | Dither | Ink % | H-Runs | RLE Bytes | Entropy | PSNR dB | SSIM-like | BMP |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of (Array.isArray(stamped.matrix) ? stamped.matrix : [])) {
      lines.push('| ' + r.s + ' | ' + r.d + ' | ' + r.inkPct + ' | ' + r.runs + ' | ' +
        r.rleBytes + ' | ' + r.byteEntropy + ' | ' + r.psnrDb + ' | ' + r.ssim +
        ' | ' + (r.bmpOk ? '48062 OK' : 'FAIL') + ' |');
    }
    lines.push('');
    lines.push(String(stamped.disclosure || ''));
    lines.push('');
    lines.push('sha256: ' + stamped.auditDigest);
    lines.push('');
    return lines.join('\n');
  }

  /* ---------- Strict #thlab= bookmark codec ---------- */

  function utf8EncodeBytes(str) {
    const s = String(str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length &&
        s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) < 0xe000) {
        const c2 = s.charCodeAt(++i);
        const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else if (c >= 0xd800 && c < 0xe000) {
        out.push(0xef, 0xbf, 0xbd);
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  function utf8DecodeStrict(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b < 0x80) {
        s += String.fromCharCode(b);
        continue;
      }
      let cp;
      let need;
      if ((b & 0xe0) === 0xc0) { cp = b & 0x1f; need = 1; }
      else if ((b & 0xf0) === 0xe0) { cp = b & 0x0f; need = 2; }
      else if ((b & 0xf8) === 0xf0) { cp = b & 0x07; need = 3; }
      else return null;
      if (i + need >= bytes.length) return null;
      for (let j = 1; j <= need; j++) {
        const cb = bytes[i + j];
        if ((cb & 0xc0) !== 0x80) return null;
        cp = (cp << 6) | (cb & 0x3f);
      }
      i += need;
      if ((need === 1 && cp < 0x80) || (need === 2 && cp < 0x800) || (need === 3 && cp < 0x10000)) return null;
      if (cp >= 0xd800 && cp <= 0xdfff) return null;
      if (cp > 0x10ffff) return null;
      if (cp > 0xffff) {
        const v = cp - 0x10000;
        s += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
      } else {
        s += String.fromCharCode(cp);
      }
    }
    return s;
  }

  function b64urlEncodeText(str) {
    const bytes = utf8EncodeBytes(str);
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const a = bytes[i];
      const b = i + 1 < bytes.length ? bytes[i + 1] : null;
      const c = i + 2 < bytes.length ? bytes[i + 2] : null;
      out += B64URL_ALPHABET[a >> 2];
      out += B64URL_ALPHABET[((a & 3) << 4) | (b === null ? 0 : b >> 4)];
      out += b === null ? '' : B64URL_ALPHABET[((b & 15) << 2) | (c === null ? 0 : c >> 6)];
      out += c === null ? '' : B64URL_ALPHABET[c & 63];
    }
    return out;
  }

  function b64urlDecodeText(token) {
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096 || !B64URL_RE.test(token)) {
      return null;
    }
    const vals = [];
    for (let i = 0; i < token.length; i++) {
      vals.push(B64URL_ALPHABET.indexOf(token[i]));
    }
    if (vals.length % 4 === 1) return null;
    const bytes = [];
    for (let i = 0; i < vals.length; i += 4) {
      const a = vals[i];
      const b = vals[i + 1];
      if (b === undefined) return null;
      bytes.push((a << 2) | (b >> 4));
      const c = vals[i + 2];
      if (c !== undefined) {
        bytes.push(((b & 15) << 4) | (c >> 2));
        const d = vals[i + 3];
        if (d !== undefined) {
          bytes.push(((c & 3) << 6) | d);
        }
      }
    }
    return utf8DecodeStrict(bytes);
  }

  function normalizeLabState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    for (const k of Object.keys(raw)) {
      if (!Object.prototype.hasOwnProperty.call(raw, k)) return null;
      if (BLOCKED_STATE_KEYS.indexOf(k) >= 0) return null;
    }
    if (!Object.prototype.hasOwnProperty.call(raw, 'v') || raw.v !== BOOKMARK_VERSION) return null;
    if (!Object.prototype.hasOwnProperty.call(raw, 's') || typeof raw.s !== 'string' ||
      SCREENS.indexOf(raw.s) < 0) return null;
    const out = {
      v: BOOKMARK_VERSION,
      s: raw.s,
      d: 'atkinson',
      r: 300,
      b: 404,
      q: -58,
      c: 1800,
      m: -1
    };
    if (Object.prototype.hasOwnProperty.call(raw, 'd')) {
      if (typeof raw.d !== 'string' || DITHER_IDS.indexOf(raw.d) < 0) return null;
      out.d = raw.d;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'r')) {
      if (!Number.isSafeInteger(raw.r) || raw.r < REFRESH_MIN_SEC || raw.r > REFRESH_MAX_SEC) return null;
      out.r = raw.r;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'b')) {
      if (!Number.isSafeInteger(raw.b) || raw.b < VOLTAGE_MIN_X100 || raw.b > VOLTAGE_MAX_X100) return null;
      out.b = raw.b;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'q')) {
      if (!Number.isSafeInteger(raw.q) || raw.q < RSSI_MIN || raw.q > RSSI_MAX) return null;
      out.q = raw.q;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'c')) {
      if (!Number.isSafeInteger(raw.c) || CAPACITY_OPTIONS.indexOf(raw.c) < 0) return null;
      out.c = raw.c;
    }
    if (Object.prototype.hasOwnProperty.call(raw, 'm')) {
      if (!Number.isSafeInteger(raw.m) || raw.m < -1 || raw.m > 15) return null;
      out.m = raw.m;
    }
    return out;
  }

  function encodeLabHash(rawState) {
    const norm = normalizeLabState(rawState);
    if (!norm) return null;
    return '#' + BOOKMARK_PREFIX + b64urlEncodeText(JSON.stringify(norm));
  }

  function decodeLabHash(input) {
    if (typeof input !== 'string') {
      return { ok: false, reason: 'NON_STRING_HASH', state: null };
    }
    let idx = input.indexOf('#' + BOOKMARK_PREFIX);
    if (idx < 0) idx = input.indexOf(BOOKMARK_PREFIX);
    if (idx < 0) {
      return { ok: false, reason: 'MISSING_PREFIX', state: null };
    }
    let token = input.slice(idx + (input[idx] === '#' ? 1 : 0) + BOOKMARK_PREFIX.length);
    const cut = token.search(B64URL_CUT_RE);
    if (cut >= 0) token = token.slice(0, cut);
    if (!token || token.length > 4096 || !B64URL_RE.test(token)) {
      return { ok: false, reason: 'INVALID_TOKEN', state: null };
    }
    const text = b64urlDecodeText(token);
    if (text === null) {
      return { ok: false, reason: 'INVALID_BASE64URL', state: null };
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return { ok: false, reason: 'INVALID_JSON', state: null };
    }
    const norm = normalizeLabState(parsed);
    if (!norm) {
      return { ok: false, reason: 'INVALID_STATE', state: null };
    }
    return { ok: true, reason: 'OK', state: norm };
  }

  /* ---------- In-page deterministic self-tests (18+) ---------- */

  function runLabSelfTests(engine) {
    if (!engine) {
      throw new Error('runLabSelfTests requires TrmnlEngine');
    }
    const lab = createLab(engine);
    const results = [];
    const rec = (id, name, fn) => {
      try {
        const r = fn();
        const ok = r === true || (r && r.ok === true);
        results.push({ id, name, ok, detail: (r && r.detail) || (ok ? 'ok' : String(r)) });
      } catch (err) {
        results.push({ id, name, ok: false, detail: 'threw ' + String((err && err.message) || err) });
      }
    };

    rec('sha256-kat', 'SHA-256 FIPS 180-4 known-answer vectors', () => {
      for (const pair of SHA256_KATS) {
        if (sha256Hex(pair[0]) !== pair[1]) {
          return { ok: false, detail: 'mismatch on vector ' + JSON.stringify(pair[0].slice(0, 16)) };
        }
      }
      return { ok: true, detail: SHA256_KATS.length + ' vectors verified' };
    });

    rec('canonical-json', 'Canonical JSON is key-sorted and byte-stable', () => {
      const a = canonicalJson({ b: 1, a: { d: [3, 2], c: 0 } });
      if (a !== '{"a":{"c":0,"d":[3,2]},"b":1}') return { ok: false, detail: 'order drift: ' + a };
      return { ok: true, detail: 'byte-stable key ordering' };
    });

    rec('canonical-cycle-depth', 'Canonicalizer survives cycles and deep nesting', () => {
      const cyc = { a: 1 };
      cyc.self = cyc;
      const out = canonicalJson(cyc);
      if (typeof out !== 'string') return { ok: false, detail: 'cycle threw' };
      let deep = {};
      let cur = deep;
      for (let i = 0; i < 200; i++) { cur.n = {}; cur = cur.n; }
      const d = canonicalJson(deep);
      if (typeof d !== 'string') return { ok: false, detail: 'deep nesting threw' };
      return { ok: true, detail: 'cycle and 200-deep input bounded safely' };
    });

    rec('bmp-48062', 'Exact 48,062-byte 1-bit BMP header and payload invariant', () => {
      const r = engine.renderScreen('corridor', { ditherMode: 'atkinson' });
      const bmp = engine.encode1BitBMP(r.ditheredPixels, 800, 480);
      const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
      const ok = bmp.byteLength === 48062 && bmp[0] === 0x42 && bmp[1] === 0x4d &&
        view.getUint32(2, true) === 48062 && view.getUint32(10, true) === 62 &&
        view.getUint16(28, true) === 1 && view.getUint32(34, true) === 48000;
      return ok ? { ok: true, detail: '48062-byte header verified' }
        : { ok: false, detail: 'BMP invariant broken' };
    });

    rec('bmp-round-trip', '1-bit pack/unpack round-trips the dithered frame', () => {
      const r = engine.renderScreen('orbital', { ditherMode: 'bayer8' });
      const packed = engine.pack1Bit(r.ditheredPixels, 800, 480);
      const back = engine.unpack1Bit(packed, 800, 480);
      for (let i = 0; i < back.length; i += 997) {
        if (back[i] !== r.ditheredPixels[i]) return { ok: false, detail: 'pixel mismatch at ' + i };
      }
      return { ok: true, detail: 'lossless round-trip' };
    });

    rec('png-signature', 'PNG signature, IHDR geometry and CRC32 chunks verify', () => {
      const r = engine.renderScreen('labbench', { ditherMode: 'bayer4' });
      const png = engine.encodeGrayscalePNG(r.ditheredPixels, 800, 480);
      const sig = [137, 80, 78, 71, 13, 10, 26, 10];
      for (let i = 0; i < 8; i++) if (png[i] !== sig[i]) return { ok: false, detail: 'bad signature' };
      const ihdrCrc = engine.crc32(png.subarray(12, 29));
      const stored = ((png[29] << 24) | (png[30] << 16) | (png[31] << 8) | png[32]) >>> 0;
      if (ihdrCrc !== stored) return { ok: false, detail: 'IHDR CRC mismatch' };
      const iend = String.fromCharCode(png[png.length - 8], png[png.length - 7], png[png.length - 6], png[png.length - 5]);
      if (iend !== 'IEND') return { ok: false, detail: 'missing IEND' };
      return { ok: true, detail: 'signature + CRC32 + IEND verified' };
    });

    rec('dither-determinism', 'All 16 screen x dither combos render bit-identically twice', () => {
      const matrix = lab.comparatorMatrix();
      for (const r of matrix.rows) {
        if (!r.deterministic) return { ok: false, detail: 'nondeterministic ' + r.screenId + ' ' + r.ditherId };
      }
      return { ok: true, detail: '16/16 combos deterministic' };
    });

    rec('dither-binary', '1-bit kernels emit only {0, 255} ink levels', () => {
      for (const s of SCREENS) {
        const r = engine.renderScreen(s, { ditherMode: 'atkinson' });
        for (let i = 0; i < r.ditheredPixels.length; i += 761) {
          const v = r.ditheredPixels[i];
          if (v !== 0 && v !== 255) return { ok: false, detail: 'non-binary level ' + v + ' on ' + s };
        }
      }
      return { ok: true, detail: 'strict binary output' };
    });

    rec('dither-monotone', 'Ink coverage grows monotonically with source darkness', () => {
      for (const d of DITHER_IDS) {
        const light = engine.applyDithering(new Uint8Array(800 * 480).fill(200), 800, 480, d);
        const dark = engine.applyDithering(new Uint8Array(800 * 480).fill(60), 800, 480, d);
        const cl = inkCoverage(light).inkPct;
        const cd = inkCoverage(dark).inkPct;
        if (!(cd > cl)) return { ok: false, detail: d + ' coverage ' + cd + ' !> ' + cl };
      }
      return { ok: true, detail: 'coverage monotone across kernels' };
    });

    rec('matrix-16', 'Comparator matrix holds 16 verified combos', () => {
      const matrix = lab.comparatorMatrix();
      if (matrix.rows.length !== 16) return { ok: false, detail: 'rows ' + matrix.rows.length };
      const crcs = new Set();
      for (const r of matrix.rows) {
        if (!r.bmpIs48062 || !r.bmpHeaderOk) return { ok: false, detail: 'BMP fail ' + r.screenId + ' ' + r.ditherId };
        if (!(r.inkPct > 3 && r.inkPct < 70)) return { ok: false, detail: 'ink out of range ' + r.inkPct };
        crcs.add(r.crc32);
      }
      if (crcs.size < 12) return { ok: false, detail: 'only ' + crcs.size + ' distinct frames' };
      return { ok: true, detail: '16 combos, ' + crcs.size + ' distinct frames' };
    });

    rec('metrics-sane', 'RLE, entropy, PSNR and SSIM metrics stay inside physical bounds', () => {
      const matrix = lab.comparatorMatrix();
      for (const r of matrix.rows) {
        if (!(r.runs > 0 && r.rleRatio > 0 && r.byteEntropy >= 0 && r.byteEntropy <= 8)) {
          return { ok: false, detail: 'metric out of bounds on ' + r.screenId + ' ' + r.ditherId };
        }
        if (!(r.psnrDb >= 0 && r.psnrDb <= 99) || !(r.ssim >= -1 && r.ssim <= 1)) {
          return { ok: false, detail: 'fidelity out of bounds on ' + r.screenId + ' ' + r.ditherId };
        }
      }
      return { ok: true, detail: 'all metrics inside bounds' };
    });

    rec('battery-interval-monotone', 'Autonomy increases with refresh interval', () => {
      const curve = batteryCurve(engine, { capacityMah: 1800, rssi: -58, batteryVoltage: 4.04 });
      for (let i = 1; i < curve.points.length; i++) {
        if (curve.points[i].daysRemaining < curve.points[i - 1].daysRemaining) {
          return { ok: false, detail: 'drop at ' + curve.points[i].intervalSec + 's' };
        }
      }
      return { ok: true, detail: curve.points.length + ' interval points monotone' };
    });

    rec('battery-capacity-monotone', 'Autonomy increases with pack capacity', () => {
      let prev = -1;
      for (const cap of CAPACITY_OPTIONS) {
        const est = engine.estimateBatteryLife({
          capacityMah: cap, refreshIntervalSec: 300, rssi: -58, batteryVoltage: 4.04
        });
        if (est.estimatedDaysRemaining < prev) return { ok: false, detail: 'drop at ' + cap + 'mAh' };
        prev = est.estimatedDaysRemaining;
      }
      return { ok: true, detail: 'monotone across ' + CAPACITY_OPTIONS.length + ' packs' };
    });

    rec('battery-rssi-penalty', 'Weak Wi-Fi increases wake burst and daily draw', () => {
      const strong = engine.estimateBatteryLife({ capacityMah: 1800, refreshIntervalSec: 300, rssi: -45, batteryVoltage: 4.04 });
      const weak = engine.estimateBatteryLife({ capacityMah: 1800, refreshIntervalSec: 300, rssi: -88, batteryVoltage: 4.04 });
      if (!(weak.activeDurationSec > strong.activeDurationSec)) return { ok: false, detail: 'no rssi duration penalty' };
      if (!(weak.mahPerDay > strong.mahPerDay)) return { ok: false, detail: 'no rssi draw penalty' };
      return { ok: true, detail: 'rssi penalty modelled' };
    });

    rec('digest-parity', 'One canonical SHA-256 stamps badge, JSON, CSV and Markdown', () => {
      const snapshot = { screenId: 'corridor', ditherId: 'atkinson', refreshIntervalSec: 300, batteryVoltage: 4.04, rssi: -58, capacityMah: 1800 };
      const brief = lab.buildAuditBrief(snapshot);
      const json = exportJsonBrief(brief);
      const csv = exportCsvBrief(brief);
      const md = exportMarkdownBrief(brief);
      const d = brief.auditDigest;
      if (!/^[0-9a-f]{64}$/.test(d)) return { ok: false, detail: 'digest malformed' };
      if (json.indexOf(d) < 0) return { ok: false, detail: 'digest missing from JSON' };
      if (csv.indexOf(d) < 0) return { ok: false, detail: 'digest missing from CSV' };
      if (md.indexOf(d) < 0) return { ok: false, detail: 'digest missing from Markdown' };
      const again = lab.buildAuditBrief(snapshot);
      if (again.auditDigest !== d) return { ok: false, detail: 'cached digest drifted' };
      if (again !== brief) return { ok: false, detail: 'cache returned different object' };
      return { ok: true, detail: 'single canonical digest across 4 surfaces' };
    });

    rec('tamper-detection', 'One-unit mutation in the brief is caught by verification', () => {
      const brief = lab.buildAuditBrief({ screenId: 'orbital', ditherId: 'bayer8' });
      const good = verifyAuditBrief(brief);
      if (!good.ok) return { ok: false, detail: 'clean brief failed verify' };
      const bad = verifyAuditBrief(tamperAuditBrief(brief));
      if (bad.ok) return { ok: false, detail: 'tampered brief passed verify' };
      return { ok: true, detail: '1-unit mutation detected' };
    });

    rec('csv-formula-escape', 'CSV cells neutralize spreadsheet formula injection', () => {
      const hostile = ['=CMD()', '+SUM(A1)', '-10+1', '@echo', '\t=1+1', '\r=2'];
      for (const h of hostile) {
        const esc = csvEscapeCell(h);
        const core = esc.charAt(0) === '"' ? esc.slice(1, -1) : esc;
        if (core.charAt(0) !== "'") return { ok: false, detail: 'unescaped ' + JSON.stringify(h) };
      }
      if (csvEscapeCell('plain').indexOf("'") >= 0) return { ok: false, detail: 'over-escaped plain cell' };
      if (csvEscapeCell('say "hi"') !== '"say ""hi"""') return { ok: false, detail: 'quote escape broken' };
      return { ok: true, detail: 'formula leads apostrophe-prefixed' };
    });

    rec('thlab-round-trip', '#thlab= codec round-trips the full lab state', () => {
      const source = { v: 1, s: 'orbital', d: 'bayer8', r: 900, b: 392, q: -71, c: 2500, m: 14 };
      const hash = encodeLabHash(source);
      if (typeof hash !== 'string' || hash.indexOf('#thlab=') !== 0) return { ok: false, detail: 'encode failed' };
      const decoded = decodeLabHash(hash);
      if (!decoded.ok) return { ok: false, detail: 'decode failed: ' + decoded.reason };
      const st = decoded.state;
      if (st.s !== source.s || st.d !== source.d || st.r !== source.r ||
        st.b !== source.b || st.q !== source.q || st.c !== source.c || st.m !== source.m) {
        return { ok: false, detail: 'state drift after round-trip' };
      }
      return { ok: true, detail: 'all 7 state fields restored exactly' };
    });

    rec('thlab-hostile', '#thlab= codec fails closed on hostile and malformed input', () => {
      const bads = [
        '{"v":1,"s":"corridor","__proto__":{"x":1}}',
        '{"v":1,"s":"corridor","constructor":{"x":1}}',
        '{"v":2,"s":"corridor"}',
        '{"v":1,"s":"NOPE"}',
        '{"v":1,"s":"corridor","d":"HACK"}',
        '{"v":1,"s":"corridor","r":-5}',
        '{"v":1,"s":"corridor","r":99999}',
        '{"v":1,"s":"corridor","r":1.5}',
        '{"v":1,"s":"corridor","q":-200}',
        '{"v":1,"s":"corridor","c":9999}',
        '{"v":1,"s":"corridor","m":99}',
        'not json at all',
        '[1,2,3]',
        '"just a string"'
      ];
      for (const raw of bads) {
        const token = b64urlEncodeText(raw);
        const res = decodeLabHash('#thlab=' + token);
        if (res.ok) return { ok: false, detail: 'accepted hostile payload ' + raw.slice(0, 40) };
      }
      const garbage = ['#thlab=', '#thlab=!!!', '#thlab=A', '', null, 42, {}];
      for (const g of garbage) {
        const res = decodeLabHash(g);
        if (res.ok) return { ok: false, detail: 'accepted garbage ' + JSON.stringify(g) };
      }
      return { ok: true, detail: 'hostile and malformed hashes rejected' };
    });

    rec('thlab-normalize', 'State normalization rejects non-plain shapes and bad fields', () => {
      const cases = [
        null, undefined, 5, 'x', [], [{ v: 1, s: 'corridor' }],
        { v: 1, s: 'corridor', r: 30 }, { v: 1, s: 'corridor', r: 7200 },
        { v: 1, s: 'corridor', b: Number.MAX_SAFE_INTEGER + 1 },
        { v: 1, s: 'corridor', d: 'threshold' }
      ];
      const verdicts = cases.map((c) => normalizeLabState(c));
      for (let i = 0; i < verdicts.length - 1; i++) {
        if (verdicts[i] !== null) return { ok: false, detail: 'accepted case ' + i };
      }
      if (verdicts[verdicts.length - 1] !== null) {
        // 'threshold' is a real engine mode but not one of the 4 lab kernels: reject.
        return { ok: false, detail: 'non-lab dither accepted' };
      }
      return { ok: true, detail: 'normalization strict on shapes and fields' };
    });

    rec('fidelity-scatter', 'Fidelity scatter exposes the 4 kernels for the active screen', () => {
      const sc = fidelityScatter(engine, 'rhythm');
      if (sc.points.length !== 4) return { ok: false, detail: 'points ' + sc.points.length };
      const ids = sc.points.map((p) => p.ditherId).sort();
      if (ids.join(',') !== DITHER_IDS.slice().sort().join(',')) {
        return { ok: false, detail: 'kernel set mismatch' };
      }
      for (const p of sc.points) {
        if (!(p.inkPct > 0) || !(p.ssim >= -1 && p.ssim <= 1)) {
          return { ok: false, detail: 'point out of bounds ' + p.ditherId };
        }
      }
      return { ok: true, detail: '4 kernel points verified' };
    });

    rec('frontier-shape', 'Battery frontier spans 3 packs x 5 RSSI x 13 intervals', () => {
      const f = batteryFrontier(engine, {});
      if (f.days.length !== 3 || f.days[0].length !== 5 || f.days[0][0].length !== 13) {
        return { ok: false, detail: 'frontier shape wrong' };
      }
      for (const cap of f.days) {
        for (const rr of cap) {
          for (let i = 1; i < rr.length; i++) {
            if (rr[i] < rr[i - 1]) return { ok: false, detail: 'non-monotone frontier cell' };
          }
        }
      }
      return { ok: true, detail: '195 frontier cells monotone' };
    });

    rec('brief-structure', 'Brief payload carries format tag, matrix and disclosure', () => {
      const brief = lab.buildAuditBrief({ screenId: 'rhythm', ditherId: 'bayer4' });
      if (brief.format !== BRIEF_FORMAT) return { ok: false, detail: 'format mismatch' };
      if (!Array.isArray(brief.matrix) || brief.matrix.length !== 16) return { ok: false, detail: 'matrix missing' };
      if (typeof brief.disclosure !== 'string' || brief.disclosure.length < 20) {
        return { ok: false, detail: 'disclosure missing' };
      }
      if (!Object.isFrozen(brief)) return { ok: false, detail: 'stamped brief not frozen' };
      return { ok: true, detail: 'brief structure complete and frozen' };
    });

    const passed = results.filter((r) => r.ok).length;
    return {
      total: results.length,
      passed,
      ok: passed === results.length,
      results
    };
  }

  /* ---------- Lab context factory (cached matrix + cached digests) ---------- */

  function createLab(engine) {
    if (!engine) {
      throw new Error('createLab requires TrmnlEngine');
    }
    const matrixCache = new Map();
    const briefCache = new Map();

    function comparatorMatrix(options) {
      const key = canonicalJson(options || {});
      if (!matrixCache.has(key)) {
        matrixCache.set(key, runComparatorMatrix(engine, options || {}));
      }
      return matrixCache.get(key);
    }

    function buildAuditBrief(snapshot) {
      const snap = (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) ? snapshot : {};
      const matrixOpts = {
        overridesByScreen: snap.overridesByScreen,
        batteryVoltage: snap.batteryVoltage,
        rssi: snap.rssi,
        refreshRate: snap.refreshIntervalSec
      };
      const matrix = comparatorMatrix(matrixOpts);
      const payload = buildAuditPayload(engine, snap, matrix.rows);
      const key = canonicalJson(payload);
      if (briefCache.has(key)) {
        return briefCache.get(key);
      }
      const stamped = deepFreeze(Object.assign({}, payload, {
        auditDigest: sha256Hex(BRIEF_FORMAT + '|' + key)
      }));
      briefCache.set(key, stamped);
      return stamped;
    }

    return {
      SCREENS,
      DITHERS,
      DITHER_IDS,
      CAPACITY_OPTIONS,
      RSSI_OPTIONS,
      DEFAULT_INTERVALS,
      comparatorMatrix,
      measureCombo: (screenId, ditherId, options) => measureCombo(engine, screenId, ditherId, options),
      batteryCurve: (params) => batteryCurve(engine, params),
      batteryFrontier: (params) => batteryFrontier(engine, params),
      fidelityScatter: (screenId, options) => fidelityScatter(engine, screenId, options),
      buildAuditBrief,
      verifyAuditBrief,
      tamperAuditBrief,
      exportJsonBrief,
      exportCsvBrief,
      exportMarkdownBrief,
      csvEscapeCell,
      canonicalJson,
      encodeLabHash,
      decodeLabHash,
      normalizeLabState,
      runLabSelfTests: () => runLabSelfTests(engine),
      _matrixCacheSize: () => matrixCache.size,
      _briefCacheSize: () => briefCache.size
    };
  }

  return {
    BRIEF_FORMAT,
    BRIEF_DISCLOSURE,
    BOOKMARK_PREFIX,
    BOOKMARK_VERSION,
    SCREENS,
    DITHERS,
    DITHER_IDS,
    CAPACITY_OPTIONS,
    RSSI_OPTIONS,
    DEFAULT_INTERVALS,
    SHA256_KATS,
    sha256Hex,
    utf8Bytes,
    canonicalize,
    canonicalJson,
    inkCoverage,
    runLengthStats,
    byteEntropy,
    midtonePsnr,
    ssimLikeBlockFidelity,
    verifyBmp48k,
    measureCombo,
    runComparatorMatrix,
    batteryCurve,
    batteryFrontier,
    fidelityScatter,
    buildAuditPayload,
    digestOfPayload,
    verifyAuditBrief,
    tamperAuditBrief,
    csvEscapeCell,
    exportJsonBrief,
    exportCsvBrief,
    exportMarkdownBrief,
    b64urlEncodeText,
    b64urlDecodeText,
    normalizeLabState,
    encodeLabHash,
    decodeLabHash,
    runLabSelfTests,
    createLab
  };
});
