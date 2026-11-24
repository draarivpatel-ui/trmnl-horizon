'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const TrmnlEngine = require('./trmnl_engine.js');
const { createByosServer } = require('./server.js');

// ============================================================================
// 1. FRAMEBUFFER & VECTOR/BITMAP DRAWING PRIMITIVES
// ============================================================================

test('EInkFramebuffer initializes to 800x480 pure white (255)', () => {
  const fb = new TrmnlEngine.EInkFramebuffer();
  assert.equal(fb.width, 800);
  assert.equal(fb.height, 480);
  assert.equal(fb.pixels.length, 384000);
  assert.equal(fb.getPixel(0, 0), 255);
  assert.equal(fb.getPixel(799, 479), 255);
});

test('EInkFramebuffer setPixel and getPixel clamp coordinates and luminance', () => {
  const fb = new TrmnlEngine.EInkFramebuffer(100, 60, 255);
  fb.setPixel(10, 20, 0);
  fb.setPixel(11, 20, -40);
  fb.setPixel(12, 20, 400);
  fb.setPixel(-5, -5, 0); // out of bounds ignored
  assert.equal(fb.getPixel(10, 20), 0);
  assert.equal(fb.getPixel(11, 20), 0);
  assert.equal(fb.getPixel(12, 20), 255);
  assert.equal(fb.getPixel(-5, -5), 255);
});

test('EInkFramebuffer fillRect and strokeRect draw exact pixel boundaries', () => {
  const fb = new TrmnlEngine.EInkFramebuffer(64, 64, 255);
  fb.fillRect(10, 10, 20, 15, 32);
  assert.equal(fb.getPixel(10, 10), 32);
  assert.equal(fb.getPixel(29, 24), 32);
  assert.equal(fb.getPixel(30, 25), 255);

  fb.strokeRect(4, 4, 12, 12, 0, 2);
  assert.equal(fb.getPixel(4, 4), 0);
  assert.equal(fb.getPixel(5, 5), 0);
  assert.equal(fb.getPixel(8, 8), 255);
});

test('EInkFramebuffer drawLine, drawCircle, and fillCircle render ink pixels', () => {
  const fb = new TrmnlEngine.EInkFramebuffer(80, 80, 255);
  fb.drawLine(5, 5, 25, 25, 0, 1);
  assert.equal(fb.getPixel(5, 5), 0);
  assert.equal(fb.getPixel(15, 15), 0);
  assert.equal(fb.getPixel(25, 25), 0);

  fb.fillCircle(50, 50, 6, 0);
  assert.equal(fb.getPixel(50, 50), 0);
  assert.equal(fb.getPixel(50, 44), 0);
  assert.equal(fb.getPixel(50, 60), 255);

  fb.drawCircle(50, 50, 10, 40);
  assert.equal(fb.getPixel(60, 50), 40);
});

test('EInkFramebuffer drawText and measureTextWidth render 5x7 glyphs', () => {
  const fb = new TrmnlEngine.EInkFramebuffer(200, 40, 255);
  const w1 = fb.measureTextWidth('TRMNL', 1, 1);
  const w2 = fb.measureTextWidth('TRMNL', 2, 1);
  assert.equal(w1, 5 * 5 + 4 * 1);
  assert.equal(w2, w1 * 2);

  fb.drawText('TRMNL', 10, 10, 2, 0, 1);
  let inkPixels = 0;
  for (let i = 0; i < fb.pixels.length; i++) {
    if (fb.pixels[i] === 0) inkPixels++;
  }
  assert.ok(inkPixels > 80);
});

test('EInkFramebuffer drawBadge, drawProgressBar, and drawSparkline', () => {
  const fb = new TrmnlEngine.EInkFramebuffer(200, 100, 255);
  const bw = fb.drawBadge('ON TIME', 10, 10, 1, true, 6, 4);
  assert.ok(bw > 30);
  assert.equal(fb.getPixel(11, 11), 0); // inverted background

  fb.drawProgressBar(10, 40, 100, 14, 0.5, 20);
  assert.equal(fb.getPixel(10, 40), 0); // border

  fb.drawSparkline(10, 60, 120, 30, [10, 40, 25, 80, 60], 0, 100);
  let nonWhite = 0;
  for (let y = 60; y < 90; y++) {
    for (let x = 10; x < 130; x++) {
      if (fb.getPixel(x, y) < 255) nonWhite++;
    }
  }
  assert.ok(nonWhite > 100);
});

// ============================================================================
// 2. E-PAPER DITHERING ALGORITHMS & INVARIANTS
// ============================================================================

test('ditherThreshold produces strict binary {0, 255} values', () => {
  const src = new Uint8Array([0, 64, 127, 128, 200, 255]);
  const out = TrmnlEngine.ditherThreshold(src, 6, 1, 128);
  assert.deepEqual(Array.from(out), [0, 0, 0, 255, 255, 255]);
});

test('ditherAtkinson preserves pure black and pure white and diffuses 6/8 error on midtones', () => {
  const w = 32;
  const h = 32;
  const black = new Uint8Array(w * h).fill(0);
  const white = new Uint8Array(w * h).fill(255);
  const mid = new Uint8Array(w * h).fill(128);

  const outB = TrmnlEngine.ditherAtkinson(black, w, h, 2);
  const outW = TrmnlEngine.ditherAtkinson(white, w, h, 2);
  const outM = TrmnlEngine.ditherAtkinson(mid, w, h, 2);

  assert.ok(outB.every((v) => v === 0));
  assert.ok(outW.every((v) => v === 255));

  let whiteCount = 0;
  for (const v of outM) {
    assert.ok(v === 0 || v === 255);
    if (v === 255) whiteCount++;
  }
  const ratio = whiteCount / (w * h);
  assert.ok(ratio > 0.35 && ratio < 0.65);
});

test('ditherFloydSteinberg differs from ditherAtkinson on continuous gradient', () => {
  const w = 64;
  const h = 16;
  const grad = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      grad[y * w + x] = Math.round((x / (w - 1)) * 255);
    }
  }
  const fs = TrmnlEngine.ditherFloydSteinberg(grad, w, h, 2);
  const atk = TrmnlEngine.ditherAtkinson(grad, w, h, 2);

  let diffs = 0;
  for (let i = 0; i < fs.length; i++) {
    if (fs[i] !== atk[i]) diffs++;
  }
  assert.ok(diffs > 20);
});

test('ditherBayer 4x4 and 8x8 produce deterministic ordered halftones', () => {
  const w = 32;
  const h = 32;
  const mid = new Uint8Array(w * h).fill(140);
  const b4 = TrmnlEngine.ditherBayer(mid, w, h, 4, 2);
  const b8 = TrmnlEngine.ditherBayer(mid, w, h, 8, 2);

  // Periodic repeat every 4 pixels for Bayer 4x4 on uniform input
  assert.equal(b4[0], b4[4]);
  assert.equal(b4[1], b4[5]);
  // Periodic repeat every 8 pixels for Bayer 8x8 on uniform input
  assert.equal(b8[0], b8[8]);
  assert.equal(b8[3], b8[11]);
});

test('applyDithering supports 2-bit 4-level grayscale quantization (0, 85, 170, 255)', () => {
  const w = 64;
  const h = 8;
  const grad = new Uint8Array(w * h);
  for (let i = 0; i < grad.length; i++) grad[i] = i % 256;
  const out = TrmnlEngine.applyDithering(grad, w, h, 'gray2bit');
  const allowed = new Set([0, 85, 170, 255]);
  for (const v of out) {
    assert.ok(allowed.has(v), `Unexpected 2-bit level: ${v}`);
  }
});

// ============================================================================
// 3. 1-BIT PACKING, 48,062-BYTE BMP ENCODER & GRAYSCALE PNG ENCODER
// ============================================================================

test('pack1Bit and unpack1Bit perform lossless round-trip for 800x480 frame', () => {
  const rendered = TrmnlEngine.renderScreen('corridor', { ditherMode: 'atkinson' });
  const packed = TrmnlEngine.pack1Bit(rendered.ditheredPixels, 800, 480);
  assert.equal(packed.byteLength, (800 / 8) * 480); // 48,000 bytes

  const unpacked = TrmnlEngine.unpack1Bit(packed, 800, 480);
  assert.equal(unpacked.length, 384000);
  assert.deepEqual(unpacked, rendered.ditheredPixels);
});

test('encode1BitBMP generates valid 48,062-byte 1-bit monochrome BMP for 800x480', () => {
  const rendered = TrmnlEngine.renderScreen('corridor', { ditherMode: 'atkinson' });
  const bmp = TrmnlEngine.encode1BitBMP(rendered.ditheredPixels, 800, 480);
  assert.equal(bmp.byteLength, 48062);

  // Check 'BM' magic bytes
  assert.equal(bmp[0], 0x42);
  assert.equal(bmp[1], 0x4d);

  const view = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
  assert.equal(view.getUint32(2, true), 48062); // bfSize
  assert.equal(view.getUint32(10, true), 62); // bfOffBits (14+40+8)
  assert.equal(view.getUint32(14, true), 40); // biSize
  assert.equal(view.getInt32(18, true), 800); // biWidth
  assert.equal(view.getInt32(22, true), 480); // biHeight
  assert.equal(view.getUint16(26, true), 1); // biPlanes
  assert.equal(view.getUint16(28, true), 1); // biBitCount = 1-bit
  assert.equal(view.getUint32(34, true), 48000); // biSizeImage
});

test('encodeGrayscalePNG generates valid PNG with signature, IHDR, IDAT, and IEND', () => {
  const rendered = TrmnlEngine.renderScreen('orbital', { ditherMode: 'bayer4' });
  const png = TrmnlEngine.encodeGrayscalePNG(rendered.ditheredPixels, 800, 480);

  // PNG 8-byte signature
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);

  // First chunk is IHDR with width=800, height=480
  const chunkType = String.fromCharCode(png[12], png[13], png[14], png[15]);
  assert.equal(chunkType, 'IHDR');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(view.getUint32(16, false), 800);
  assert.equal(view.getUint32(20, false), 480);

  // Ends with IEND chunk
  const tailType = String.fromCharCode(
    png[png.length - 8],
    png[png.length - 7],
    png[png.length - 6],
    png[png.length - 5]
  );
  assert.equal(tailType, 'IEND');
});

// ============================================================================
// 4. BUILT-IN 800x480 SCREEN LAYOUTS
// ============================================================================

test('All 4 built-in screens render distinct non-empty 800x480 framebuffers', () => {
  const screens = ['corridor', 'orbital', 'labbench', 'rhythm'];
  const digests = new Set();

  for (const s of screens) {
    const res = TrmnlEngine.renderScreen(s, { ditherMode: 'atkinson' });
    assert.equal(res.width, 800);
    assert.equal(res.height, 480);
    assert.equal(res.ditheredPixels.length, 384000);

    let blackPx = 0;
    for (let i = 0; i < res.ditheredPixels.length; i++) {
      if (res.ditheredPixels[i] === 0) blackPx++;
    }
    // Every screen has meaningful ink density between 8% and 60%
    assert.ok(blackPx > 30000 && blackPx < 240000, `Screen ${s} had unexpected blackPx=${blackPx}`);

    const crc = TrmnlEngine.crc32(res.ditheredPixels);
    digests.add(crc);
  }
  assert.equal(digests.size, 4);
});

// ============================================================================
// 5. OFFICIAL TRMNL BYOS PROTOCOL HANDLERS & BATTERY PHYSICS
// ============================================================================

test('parseTrmnlHeaders extracts official ESP32-C3 TRMNL device headers', () => {
  const parsed = TrmnlEngine.parseTrmnlHeaders({
    'ID': 'a0:b7:65:fe:12:9c',
    'Access-Token': 'tok_123',
    'Refresh-Rate': '600',
    'Battery-Voltage': '3.92',
    'FW-Version': '1.6.9',
    'RSSI': '-67'
  });
  assert.equal(parsed.mac, 'A0:B7:65:FE:12:9C');
  assert.equal(parsed.accessToken, 'tok_123');
  assert.equal(parsed.refreshRate, 600);
  assert.equal(parsed.batteryVoltage, 3.92);
  assert.equal(parsed.fwVersion, '1.6.9');
  assert.equal(parsed.rssi, -67);
});

test('handleApiSetup returns status 200, api_key, friendly_id, and image_url', () => {
  const res = TrmnlEngine.handleApiSetup(
    { ID: 'A0:B7:65:FE:12:9C' },
    { baseUrl: 'http://192.168.1.50:8080' }
  );
  assert.equal(res.status, 200);
  assert.equal(res.friendly_id, 'FE1-29C');
  assert.ok(res.api_key.startsWith('trmnl_byos_'));
  assert.equal(res.image_url, 'http://192.168.1.50:8080/api/bitmap/setup-welcome.bmp');
});

test('handleApiDisplay returns status 0, .bmp image_url, filename, and refresh_rate', () => {
  const res = TrmnlEngine.handleApiDisplay(
    {
      'ID': 'A0:B7:65:FE:12:9C',
      'Battery-Voltage': '4.08',
      'RSSI': '-55',
      'Refresh-Rate': '300'
    },
    {
      baseUrl: 'https://trmnl.local',
      screenId: 'orbital',
      ditherMode: 'atkinson',
      refreshRate: 450,
      epochTag: 'p42'
    }
  );
  assert.equal(res.status, 0);
  assert.equal(res.filename, 'horizon-orbital-atkinson-p42.bmp');
  assert.equal(res.image_url, 'https://trmnl.local/api/bitmap/horizon-orbital-atkinson-p42.bmp');
  assert.equal(res.refresh_rate, 450);
  assert.equal(res.reset_firmware, false);
  assert.equal(res.update_firmware, false);
});

test('handleApiLog stores incoming ESP32-C3 diagnostic log entries', () => {
  const store = [];
  const res = TrmnlEngine.handleApiLog(
    { 'ID': 'A0:B7:65:FE:12:9C', 'Battery-Voltage': '3.85', 'RSSI': '-71' },
    { log: { logs_array: [{ wifi_status: 'connected', sleep_duration: 300 }, { wifi_status: 'retry' }] } },
    store
  );
  assert.equal(res.status, 200);
  assert.equal(res.entries_recorded, 2);
  assert.equal(store.length, 1);
  assert.equal(store[0].mac, 'A0:B7:65:FE:12:9C');
});

test('estimateBatteryLife models wake interval, RSSI penalty, and LiPo capacity accurately', () => {
  const fastWake = TrmnlEngine.estimateBatteryLife({
    capacityMah: 1800,
    refreshIntervalSec: 120,
    rssi: -55,
    batteryVoltage: 4.10
  });
  const slowWake = TrmnlEngine.estimateBatteryLife({
    capacityMah: 1800,
    refreshIntervalSec: 1800,
    rssi: -55,
    batteryVoltage: 4.10
  });
  const weakWifi = TrmnlEngine.estimateBatteryLife({
    capacityMah: 1800,
    refreshIntervalSec: 300,
    rssi: -85,
    batteryVoltage: 4.10
  });
  const strongWifi = TrmnlEngine.estimateBatteryLife({
    capacityMah: 1800,
    refreshIntervalSec: 300,
    rssi: -50,
    batteryVoltage: 4.10
  });

  assert.ok(slowWake.estimatedDaysFull > fastWake.estimatedDaysFull);
  assert.ok(weakWifi.activeDurationSec > strongWifi.activeDurationSec);
  assert.ok(weakWifi.mahPerDay > strongWifi.mahPerDay);
  assert.ok(fastWake.socPercent >= 85 && fastWake.socPercent <= 100);
});

test('generateLiquidTemplate outputs valid TRMNL Framework markup for all views and screens', () => {
  for (const screen of ['corridor', 'orbital', 'labbench', 'rhythm']) {
    for (const view of ['full', 'half_horizontal', 'half_vertical', 'quadrant']) {
      const liquid = TrmnlEngine.generateLiquidTemplate(screen, view);
      assert.ok(liquid.includes(`class="view view--${view}"`));
      assert.ok(liquid.includes('class="title_bar"'));
    }
  }
});

// ============================================================================
// 6. LIVE HTTP BYOS SERVER INTEGRATION TESTS
// ============================================================================

function httpRequest(port, method, path, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve({ statusCode: res.statusCode, headers: res.headers, buffer });
        });
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

test('BYOS HTTP Server serves /api/setup, /api/display, /api/log, /api/bitmap, and /api/status', async () => {
  const { server } = createByosServer({ defaultScreen: 'corridor', refreshRate: 300 });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // 1. GET /api/setup
    const setupRes = await httpRequest(port, 'GET', '/api/setup', {
      'ID': 'A0:B7:65:FE:12:9C'
    });
    assert.equal(setupRes.statusCode, 200);
    const setupJson = JSON.parse(setupRes.buffer.toString('utf8'));
    assert.equal(setupJson.status, 200);
    assert.equal(setupJson.friendly_id, 'FE1-29C');

    // 2. GET /api/display
    const dispRes = await httpRequest(port, 'GET', '/api/display?screen=orbital&dither=atkinson', {
      'ID': 'A0:B7:65:FE:12:9C',
      'Battery-Voltage': '4.05',
      'RSSI': '-60'
    });
    assert.equal(dispRes.statusCode, 200);
    const dispJson = JSON.parse(dispRes.buffer.toString('utf8'));
    assert.equal(dispJson.status, 0);
    assert.ok(dispJson.filename.includes('horizon-orbital-atkinson'));

    // 3. GET /api/bitmap/:filename.bmp returns 48,062-byte 1-bit BMP
    const bmpRes = await httpRequest(port, 'GET', `/api/bitmap/${dispJson.filename}`);
    assert.equal(bmpRes.statusCode, 200);
    assert.equal(bmpRes.headers['content-type'], 'image/bmp');
    assert.equal(bmpRes.buffer.byteLength, 48062);

    // 4. POST /api/log
    const logRes = await httpRequest(
      port,
      'POST',
      '/api/log',
      { 'Content-Type': 'application/json', 'ID': 'A0:B7:65:FE:12:9C' },
      JSON.stringify({ log: { logs_array: [{ wifi_status: 'ok' }] } })
    );
    assert.equal(logRes.statusCode, 200);
    const logJson = JSON.parse(logRes.buffer.toString('utf8'));
    assert.equal(logJson.entries_recorded, 1);

    // 5. GET /api/status
    const statusRes = await httpRequest(port, 'GET', '/api/status');
    assert.equal(statusRes.statusCode, 200);
    const statusJson = JSON.parse(statusRes.buffer.toString('utf8'));
    assert.equal(statusJson.status, 'ok');
    assert.equal(statusJson.devices.length, 1);
    assert.equal(statusJson.devices[0].mac, 'A0:B7:65:FE:12:9C');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ============================================================================
// 7. ADDITIONAL GRANULAR PROTOCOL, GRAPHICS & ENCODER TESTS (46+ TESTS TOTAL)
// ============================================================================

test('EInkFramebuffer clear resets all pixels to specified gray level', () => {
  const fb = new TrmnlEngine.EInkFramebuffer(40, 30, 0);
  assert.equal(fb.getPixel(20, 15), 0);
  fb.clear(180);
  assert.equal(fb.getPixel(0, 0), 180);
  assert.equal(fb.getPixel(39, 29), 180);
});

test('EInkFramebuffer drawHLine and drawVLine clip safely at canvas edges', () => {
  const fb = new TrmnlEngine.EInkFramebuffer(50, 50, 255);
  fb.drawHLine(-10, 10, 30, 0);
  assert.equal(fb.getPixel(0, 10), 0);
  assert.equal(fb.getPixel(19, 10), 0);
  assert.equal(fb.getPixel(20, 10), 255);

  fb.drawVLine(25, -5, 20, 0);
  assert.equal(fb.getPixel(25, 0), 0);
  assert.equal(fb.getPixel(25, 14), 0);
  assert.equal(fb.getPixel(25, 15), 255);
});

test('EInkFramebuffer drawDashedHLine alternates ink and substrate segments', () => {
  const fb = new TrmnlEngine.EInkFramebuffer(40, 10, 255);
  fb.drawDashedHLine(0, 5, 20, 0, 3, 2);
  assert.equal(fb.getPixel(0, 5), 0);
  assert.equal(fb.getPixel(2, 5), 0);
  assert.equal(fb.getPixel(3, 5), 255);
  assert.equal(fb.getPixel(4, 5), 255);
  assert.equal(fb.getPixel(5, 5), 0);
});

test('EInkFramebuffer fillGradientRect interpolates horizontally and vertically', () => {
  const fb = new TrmnlEngine.EInkFramebuffer(20, 20, 255);
  fb.fillGradientRect(0, 0, 10, 5, 0, 200, false);
  assert.equal(fb.getPixel(0, 0), 0);
  assert.equal(fb.getPixel(9, 0), 200);

  fb.fillGradientRect(0, 10, 5, 10, 50, 250, true);
  assert.equal(fb.getPixel(0, 10), 50);
  assert.equal(fb.getPixel(0, 19), 250);
});

test('quantizePixel supports binary (2-level) and multi-level quantization', () => {
  assert.equal(TrmnlEngine.quantizePixel(0, 2), 0);
  assert.equal(TrmnlEngine.quantizePixel(127, 2), 0);
  assert.equal(TrmnlEngine.quantizePixel(128, 2), 255);
  assert.equal(TrmnlEngine.quantizePixel(255, 2), 255);
  assert.equal(TrmnlEngine.quantizePixel(80, 4), 85);
  assert.equal(TrmnlEngine.quantizePixel(175, 4), 170);
});

test('crc32 and adler32 match standard RFC 1950 / RFC 1952 test vectors', () => {
  const ascii = new TextEncoder().encode('123456789');
  assert.equal(TrmnlEngine.crc32(ascii), 0xcbf43926);
  const wiki = new TextEncoder().encode('Wikipedia');
  assert.equal(TrmnlEngine.adler32(wiki), 0x11e60398);
});

test('encode1BitBMP pads non-multiple-of-32 widths to 4-byte row stride', () => {
  // 10x4 image: rawRowBytes = 2, padded stride = 4 bytes/row -> 4*4 = 16 pixel bytes + 62 header = 78 bytes
  const px = new Uint8Array(10 * 4).fill(255);
  const bmp = TrmnlEngine.encode1BitBMP(px, 10, 4);
  assert.equal(bmp.byteLength, 78);
});

test('deriveFriendlyId and deriveApiKey normalize MAC addresses consistently', () => {
  assert.equal(TrmnlEngine.deriveFriendlyId('a0:b7:65:fe:12:9c'), 'FE1-29C');
  assert.equal(TrmnlEngine.deriveFriendlyId('11-22-33-44-55-66'), '445-566');
  assert.equal(TrmnlEngine.deriveApiKey('A0:B7:65:FE:12:9C'), 'trmnl_byos_a0b765fe129c_horizon');
});

test('voltageToSocPercent clamps extremes at 3.20V (0%) and 4.18V+ (100%)', () => {
  assert.equal(TrmnlEngine.voltageToSocPercent(4.22), 100);
  assert.equal(TrmnlEngine.voltageToSocPercent(4.18), 100);
  assert.equal(TrmnlEngine.voltageToSocPercent(3.20), 0);
  assert.equal(TrmnlEngine.voltageToSocPercent(3.05), 0);
  const mid = TrmnlEngine.voltageToSocPercent(3.75);
  assert.ok(mid > 40 && mid < 65);
});

test('renderCorridorScreen honors custom stationName and headwayAdherencePct overrides', () => {
  const res1 = TrmnlEngine.renderScreen('corridor', {
    data: { stationName: 'CUSTOM TERMINAL ALPHA', headwayAdherencePct: 51 }
  });
  const res2 = TrmnlEngine.renderScreen('corridor', {
    data: { stationName: 'CUSTOM TERMINAL BETA', headwayAdherencePct: 99 }
  });
  assert.notEqual(TrmnlEngine.crc32(res1.ditheredPixels), TrmnlEngine.crc32(res2.ditheredPixels));
});

test('renderOrbitalScreen honors custom satellite and elevation overrides', () => {
  const res1 = TrmnlEngine.renderScreen('orbital', {
    data: { targetSat: 'NOAA-19 APT', maxElevationDeg: 32 }
  });
  const res2 = TrmnlEngine.renderScreen('orbital', {
    data: { targetSat: 'ISS (ZARYA)', maxElevationDeg: 85 }
  });
  assert.notEqual(TrmnlEngine.crc32(res1.ditheredPixels), TrmnlEngine.crc32(res2.ditheredPixels));
});

test('renderLabBenchScreen honors custom clusterName and firmwareTarget overrides', () => {
  const res1 = TrmnlEngine.renderScreen('labbench', {
    data: { clusterName: 'NODE-ALPHA', firmwareTarget: 'FW 1.5.0' }
  });
  const res2 = TrmnlEngine.renderScreen('labbench', {
    data: { clusterName: 'NODE-OMEGA', firmwareTarget: 'FW 1.7.0' }
  });
  assert.notEqual(TrmnlEngine.crc32(res1.ditheredPixels), TrmnlEngine.crc32(res2.ditheredPixels));
});

test('renderRhythmScreen honors custom ragaName and bpm overrides', () => {
  const res1 = TrmnlEngine.renderScreen('rhythm', {
    data: { ragaName: 'RAGA BHAIRAVI', bpm: 80 }
  });
  const res2 = TrmnlEngine.renderScreen('rhythm', {
    data: { ragaName: 'RAGA MALKAUNS', bpm: 180 }
  });
  assert.notEqual(TrmnlEngine.crc32(res1.ditheredPixels), TrmnlEngine.crc32(res2.ditheredPixels));
});

test('applyDithering modes produce distinct pixel patterns on corridor screen', () => {
  const modes = ['atkinson', 'floyd-steinberg', 'bayer4', 'bayer8', 'threshold'];
  const hashes = new Set();
  for (const mode of modes) {
    const r = TrmnlEngine.renderScreen('corridor', { ditherMode: mode });
    hashes.add(TrmnlEngine.crc32(r.ditheredPixels));
  }
  assert.equal(hashes.size, modes.length);
});

test('BYOS Server autoRotate cycles across corridor, orbital, labbench, and rhythm', async () => {
  const { server } = createByosServer({ autoRotate: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const filenames = [];
    for (let i = 0; i < 4; i++) {
      const r = await httpRequest(port, 'GET', '/api/display', { ID: 'AA:BB:CC:DD:EE:FF' });
      const j = JSON.parse(r.buffer.toString('utf8'));
      filenames.push(j.filename);
    }
    assert.ok(filenames[0].includes('corridor'));
    assert.ok(filenames[1].includes('orbital'));
    assert.ok(filenames[2].includes('labbench'));
    assert.ok(filenames[3].includes('rhythm'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('BYOS Server serves PNG bitmap at /api/bitmap/*.png', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await httpRequest(port, 'GET', '/api/bitmap/horizon-rhythm-bayer4-v1.png');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.deepEqual(Array.from(res.buffer.subarray(0, 4)), [137, 80, 78, 71]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('BYOS Server serves Liquid markup at /api/liquid', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await httpRequest(port, 'GET', '/api/liquid?screen=orbital&view=half_horizontal');
    assert.equal(res.statusCode, 200);
    const text = res.buffer.toString('utf8');
    assert.ok(text.includes('view--half_horizontal'));
    assert.ok(text.includes('Orbital Ephemeris'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('BYOS Server serves index.html workbench at GET / and 404 for unknown routes', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const rootRes = await httpRequest(port, 'GET', '/');
    assert.equal(rootRes.statusCode, 200);
    assert.ok(rootRes.buffer.toString('utf8').includes('TRMNL-HORIZON'));

    const missingRes = await httpRequest(port, 'GET', '/nonexistent-file.xyz');
    assert.equal(missingRes.statusCode, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('BYOS Server responds to OPTIONS preflight with 204 No Content', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const optRes = await httpRequest(port, 'OPTIONS', '/api/display');
    assert.equal(optRes.statusCode, 204);
    assert.equal(optRes.headers['access-control-allow-origin'], '*');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('handleApiSetup allows custom apiKey override', () => {
  const res = TrmnlEngine.handleApiSetup(
    { ID: '12:34:56:78:9A:BC' },
    { apiKey: 'custom_secret_key_99', baseUrl: 'http://localhost:8080' }
  );
  assert.equal(res.api_key, 'custom_secret_key_99');
  assert.equal(res.friendly_id, '789-ABC');
});

test('handleApiDisplay supports firmware update flags when specified', () => {
  const res = TrmnlEngine.handleApiDisplay(
    { ID: '12:34:56:78:9A:BC' },
    {
      updateFirmware: true,
      firmwareUrl: 'http://localhost:8080/fw/1.7.0.bin',
      resetFirmware: false
    }
  );
  assert.equal(res.update_firmware, true);
  assert.equal(res.firmware_url, 'http://localhost:8080/fw/1.7.0.bin');
});

test('handleApiLog handles flat logs_array payload and caps logStore at 100 entries', () => {
  const logStore = new Array(100).fill({ dummy: true });
  const res = TrmnlEngine.handleApiLog(
    { ID: 'AA:BB:CC:11:22:33' },
    { logs_array: [{ msg: 'boot' }, { msg: 'sleep' }, { msg: 'wake' }] },
    logStore
  );
  assert.equal(res.entries_recorded, 3);
  assert.equal(logStore.length, 100);
  assert.equal(logStore[0].mac, 'AA:BB:CC:11:22:33');
});

test('estimateBatteryLife scales linearly with battery pack capacityMah', () => {
  const std = TrmnlEngine.estimateBatteryLife({ capacityMah: 1800, refreshIntervalSec: 600 });
  const ext = TrmnlEngine.estimateBatteryLife({ capacityMah: 3600, refreshIntervalSec: 600 });
  assert.equal(ext.estimatedDaysFull, std.estimatedDaysFull * 2);
});

test('FONT_5X7 contains all uppercase, lowercase, digits, and punctuation glyphs', () => {
  const sample = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-+=:;,.<>?/';
  for (const ch of sample) {
    assert.ok(Array.isArray(TrmnlEngine.FONT_5X7[ch]), `Missing glyph for ${ch}`);
    assert.equal(TrmnlEngine.FONT_5X7[ch].length, 5);
  }
});

test('generateLiquidTemplate escapes quotes and backslashes in custom data defaults', () => {
  const liquid = TrmnlEngine.generateLiquidTemplate('corridor', 'full', {
    stationName: 'PENN "NORTH" CONCOURSE',
    activeAlerts: 'TRACK 4\\5 BOARDING'
  });
  assert.ok(liquid.includes('default: "PENN \\"NORTH\\" CONCOURSE"'));
  assert.ok(liquid.includes('default: "TRACK 4\\\\5 BOARDING"'));
  const nested = TrmnlEngine.generateLiquidTemplate('orbital', 'full', {
    sunEvents: { sunrise: '06:1"2', sunset: '18:40' }
  });
  assert.ok(nested.includes('default: "06:1\\"2"'));
});

test('generateLiquidTemplate escapes newlines, carriage returns and tabs in custom data', () => {
  const liquid = TrmnlEngine.generateLiquidTemplate('corridor', 'full', {
    stationName: 'PENN\nCONCOURSE',
    activeAlerts: 'TRACK\r\n4\tBOARDING'
  });
  assert.ok(liquid.includes('default: "PENN\\nCONCOURSE"'));
  assert.ok(liquid.includes('default: "TRACK\\r\\n4\\tBOARDING"'));
  // Every quoted default literal stays on a single line so the Liquid parse holds.
  for (const m of liquid.matchAll(/default: "((?:\\.|[^"\\])*)"/g)) {
    assert.ok(!/[\n\r\t]/.test(m[1]), `raw control char inside default literal: ${m[1]}`);
  }
});

test('parseTrmnlHeaders clamps refresh rate to a sane range', () => {
  assert.equal(TrmnlEngine.parseTrmnlHeaders({ 'Refresh-Rate': '-5' }).refreshRate, 15);
  assert.equal(TrmnlEngine.parseTrmnlHeaders({ 'Refresh-Rate': '999999' }).refreshRate, 86400);
  assert.equal(TrmnlEngine.parseTrmnlHeaders({ 'Refresh-Rate': 'garbage' }).refreshRate, 300);
});

test('BYOS Server caps the device registry at 256 entries', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    for (let i = 0; i < 300; i++) {
      const mac = `AA:BB:CC:${(i >> 8).toString(16).padStart(2, '0')}:${(i & 0xff).toString(16).padStart(2, '0')}:00`;
      const res = await httpRequest(port, 'GET', '/api/setup', { 'ID': mac });
      assert.equal(res.statusCode, 200);
    }
    const statusRes = await httpRequest(port, 'GET', '/api/status');
    const statusJson = JSON.parse(statusRes.buffer.toString('utf8'));
    assert.ok(statusJson.devices.length <= 256, `expected <=256 devices, got ${statusJson.devices.length}`);
    assert.equal(statusJson.devices.length, 256);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('BYOS Server survives a malformed Host header without crashing', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const bad = await httpRequest(port, 'GET', '/api/status', { 'Host': '::bad::' });
    assert.equal(bad.statusCode, 200);
    const ipv6 = await httpRequest(port, 'GET', '/api/setup', {
      'Host': '[::1]:8080',
      'ID': 'AA:BB:CC:00:11:22'
    });
    assert.equal(ipv6.statusCode, 200);
    const setup = JSON.parse(ipv6.buffer.toString('utf8'));
    assert.ok(setup.image_url.startsWith('http://[::1]:8080/'));
    const ok = await httpRequest(port, 'GET', '/api/status');
    assert.equal(ok.statusCode, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Static handler serves only the workbench allowlist, never repo internals', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    for (const p of ['/', '/index.html', '/style.css', '/app.js', '/trmnl_engine.js']) {
      const res = await httpRequest(port, 'GET', p);
      assert.equal(res.statusCode, 200, `${p} should serve`);
    }
    for (const p of ['/.git/config', '/.git/HEAD', '/server.js', '/test.js', '/package.json', '/README.md', '/plugins/orbital/full.liquid']) {
      const res = await httpRequest(port, 'GET', p);
      assert.equal(res.statusCode, 404, `${p} must not be served`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('POST /api/log enforces the byte cap with a clean 413', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // 300,000 bytes of 3-byte UTF-8 chars: 100k chars, used to slip past the old char cap
    const bigBody = 'x'.repeat(300000);
    const res = await httpRequest(port, 'POST', '/api/log', {
      'Content-Type': 'application/json', 'ID': 'AA:BB:CC:00:11:22'
    }, bigBody);
    assert.equal(res.statusCode, 413);
    const ok = await httpRequest(port, 'POST', '/api/log', {
      'Content-Type': 'application/json', 'ID': 'AA:BB:CC:00:11:22'
    }, JSON.stringify({ log: { logs_array: [{ wifi_status: 'ok' }] } }));
    assert.equal(ok.statusCode, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('/api/bitmap serves PNG for mixed-case .PnG filename', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res = await httpRequest(port, 'GET', '/api/bitmap/horizon-corridor-atkinson-v1.PnG');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/png');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('/api/display whitelists screen and dither params in the advertised filename', () => {
  const res = TrmnlEngine.handleApiDisplay({ ID: 'AA:BB:CC:00:11:22' }, {
    baseUrl: 'http://localhost:8080', screenId: '../../etc', ditherMode: '<img>'
  });
  assert.equal(res.filename, 'horizon-corridor-atkinson-v1.bmp');
  const res2 = TrmnlEngine.handleApiDisplay({ ID: 'AA:BB:CC:00:11:22' }, {
    baseUrl: 'http://localhost:8080', screenId: 'orbital', ditherMode: 'bayer8'
  });
  assert.equal(res2.filename, 'horizon-orbital-bayer8-v1.bmp');
});

test('dither functions throw on undersized, empty, or non-finite input buffers', () => {
  const half = new Uint8Array(800 * 240).fill(128);
  assert.throws(() => TrmnlEngine.ditherThreshold(half, 800, 480), RangeError);
  assert.throws(() => TrmnlEngine.ditherAtkinson(half, 800, 480), RangeError);
  assert.throws(() => TrmnlEngine.ditherThreshold(new Uint8Array(0), 800, 480), RangeError);
  const nanBuf = new Float32Array(800 * 480).fill(128);
  nanBuf[7] = NaN;
  assert.throws(() => TrmnlEngine.ditherFloydSteinberg(nanBuf, 800, 480), RangeError);
  assert.throws(() => TrmnlEngine.ditherBayer(nanBuf, 800, 480), RangeError);
  assert.throws(() => TrmnlEngine.ditherThreshold(new Uint8Array(100).fill(5), 0, 10), RangeError);
});

test('renderScreen repairs mistyped customData instead of crashing', () => {
  const r1 = TrmnlEngine.renderScreen('corridor', { data: { departures: 'garbage' } });
  assert.equal(r1.ditheredPixels.length, 800 * 480);
  const r2 = TrmnlEngine.renderScreen('orbital', { data: { sunEvents: null } });
  assert.equal(r2.ditheredPixels.length, 800 * 480);
  const r3 = TrmnlEngine.renderScreen('corridor', { data: { departures: 5 } });
  assert.equal(r3.ditheredPixels.length, 800 * 480);
  const r4 = TrmnlEngine.renderScreen('corridor', { data: { departures: [{ line: 7, dest: null }] } });
  assert.equal(r4.ditheredPixels.length, 800 * 480);
});

test('liquid templates use real trmnl.device vars, per-view loop limits, and else fallbacks', () => {
  const lab = TrmnlEngine.generateLiquidTemplate('labbench', 'full');
  assert.ok(lab.includes('trmnl.device.percent_charged'));
  assert.ok(lab.includes('trmnl.device.wifi_strength'));
  assert.ok(!lab.includes('trmnl.battery_voltage'));
  const quad = TrmnlEngine.generateLiquidTemplate('corridor', 'quadrant');
  assert.ok(quad.includes('limit:2'));
  assert.ok(quad.includes('{% else %}'));
  const full = TrmnlEngine.generateLiquidTemplate('orbital', 'full');
  assert.ok(full.includes('limit:5'));
});

test('parseTrmnlHeaders clamps battery voltage to a finite range', () => {
  assert.equal(TrmnlEngine.parseTrmnlHeaders({ 'Battery-Voltage': 'Infinity' }).batteryVoltage, 4.04);
  assert.equal(TrmnlEngine.parseTrmnlHeaders({ 'Battery-Voltage': '99' }).batteryVoltage, 30);
  assert.equal(TrmnlEngine.parseTrmnlHeaders({ 'Battery-Voltage': '-2' }).batteryVoltage, 0);
  assert.equal(TrmnlEngine.parseTrmnlHeaders({ 'Battery-Voltage': 'junk' }).batteryVoltage, 4.04);
});
