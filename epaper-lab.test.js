'use strict';

/**
 * epaper-lab.test.js - node:test suite for the TRMNL-Horizon E-Paper Frontier Lab.
 * Covers the pure SHA-256 + canonical JSON core, the 16-combo comparator matrix,
 * battery frontier monotonicity, the audited proof brief, the fail-closed
 * #thlab= codec, HTTP integration of the new static allowlist entry, and DOM
 * wiring between index.html, style.css and app.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const TrmnlEngine = require('./trmnl_engine.js');
const Lab = require('./epaper-lab.js');
const { createByosServer } = require('./server.js');

const lab = Lab.createLab(TrmnlEngine);

function httpRequest(port, method, reqPath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: '127.0.0.1', port, method, path: reqPath, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          buffer: Buffer.concat(chunks)
        }));
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ============================================================================
// 1. PURE-JS SHA-256: FIPS 180-4 KATs + 0..160 BYTE BOUNDARY SWEEP VS crypto
// ============================================================================

test('sha256Hex matches FIPS 180-4 empty-message vector', () => {
  assert.equal(Lab.sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sha256Hex matches FIPS 180-4 "abc" vector', () => {
  assert.equal(Lab.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256Hex matches 448-bit two-block vector', () => {
  assert.equal(
    Lab.sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'
  );
});

test('sha256Hex matches million-a vector spot check (56 x "a" boundary)', () => {
  const s = 'a'.repeat(56);
  assert.equal(Lab.sha256Hex(s), crypto.createHash('sha256').update(s).digest('hex'));
});

test('sha256Hex handles multi-byte UTF-8 identically to node crypto', () => {
  for (const s of ['°', 'e\u0301', 'TRMNL °C \u4e2d\u6587', '\ud83d\ude80']) {
    assert.equal(Lab.sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('sha256Hex KAT table entries all verify', () => {
  for (const [msg, expected] of Lab.SHA256_KATS) {
    assert.equal(Lab.sha256Hex(msg), expected, `KAT mismatch for ${JSON.stringify(msg.slice(0, 20))}`);
  }
});

// 0..160 byte boundary sweep against node:crypto (161 tests)
for (let len = 0; len <= 160; len++) {
  test(`sha256Hex byte sweep len=${len} matches node crypto`, () => {
    const buf = Buffer.alloc(len);
    for (let i = 0; i < len; i++) buf[i] = (i * 167 + 13) & 0xff;
    assert.equal(Lab.sha256Hex(buf), crypto.createHash('sha256').update(buf).digest('hex'));
  });
}

// ============================================================================
// 2. CANONICAL JSON: KEY ORDER, CYCLES, DEPTH, BLOCKED KEYS
// ============================================================================

test('canonicalJson sorts object keys recursively', () => {
  assert.equal(
    Lab.canonicalJson({ b: 1, a: { d: [3, 2], c: 0 } }),
    '{"a":{"c":0,"d":[3,2]},"b":1}'
  );
});

test('canonicalJson is byte-stable regardless of insertion order', () => {
  const a = Lab.canonicalJson({ x: 1, y: { p: 1, q: 2 }, z: 3 });
  const b = Lab.canonicalJson({ z: 3, y: { q: 2, p: 1 }, x: 1 });
  assert.equal(a, b);
});

test('canonicalJson survives circular references without throwing', () => {
  const cyc = { a: 1 };
  cyc.self = cyc;
  const out = Lab.canonicalJson(cyc);
  assert.equal(typeof out, 'string');
  assert.ok(out.includes('"a":1'));
});

test('canonicalJson is depth-bounded on very deep input', () => {
  let deep = {};
  let cur = deep;
  for (let i = 0; i < 300; i++) { cur.n = {}; cur = cur.n; }
  const out = Lab.canonicalJson(deep);
  assert.equal(typeof out, 'string');
});

test('canonicalJson maps non-finite numbers to null', () => {
  assert.equal(Lab.canonicalJson({ a: NaN, b: Infinity, c: -Infinity, d: 4 }), '{"a":null,"b":null,"c":null,"d":4}');
});

test('canonicalJson drops functions, symbols and undefined values', () => {
  const out = Lab.canonicalJson({ f: () => 1, s: Symbol('x'), u: undefined, k: 1 });
  assert.equal(out, '{"k":1}');
});

test('canonicalJson strips blocked prototype-pollution keys', () => {
  const raw = JSON.parse('{"a":1,"__proto__":{"x":1},"constructor":2,"prototype":3}');
  const out = Lab.canonicalJson(raw);
  assert.equal(out, '{"a":1}');
});

test('canonicalJson only reads own properties', () => {
  const proto = { inherited: 9 };
  const obj = Object.create(proto);
  obj.own = 1;
  assert.equal(Lab.canonicalJson(obj), '{"own":1}');
});

// ============================================================================
// 3. 16-COMBO COMPARATOR MATRIX: PER-ROW INVARIANTS
// ============================================================================

const matrix = lab.comparatorMatrix();

test('comparator matrix exposes exactly 16 rows across 4 screens x 4 dithers', () => {
  assert.equal(matrix.rows.length, 16);
  assert.deepEqual(matrix.screens, ['corridor', 'orbital', 'labbench', 'rhythm']);
  assert.deepEqual(matrix.dithers, ['atkinson', 'floyd-steinberg', 'bayer4', 'bayer8']);
});

for (const row of matrix.rows) {
  test(`combo ${row.screenId} x ${row.ditherId}: ink, RLE, fidelity, BMP and determinism`, () => {
    assert.ok(row.inkPct > 3 && row.inkPct < 70, `inkPct ${row.inkPct} out of range`);
    assert.ok(row.blackPx + row.whitePx === 800 * 480);
    assert.ok(row.runs > 0 && row.rleBytes === row.runs * 2);
    assert.ok(row.rleRatio > 0);
    assert.ok(row.byteEntropy >= 0 && row.byteEntropy <= 8);
    assert.ok(row.psnrDb >= 0 && row.psnrDb <= 99);
    assert.ok(row.ssim >= -1 && row.ssim <= 1);
    assert.equal(row.bmpBytes, 48062);
    assert.equal(row.bmpHeaderOk, true);
    assert.equal(row.bmpIs48062, true);
    assert.equal(row.deterministic, true);
    assert.equal(row.index, Lab.SCREENS.indexOf(row.screenId) * 4 + Lab.DITHER_IDS.indexOf(row.ditherId));
  });
}

test('comparator matrix rows carry at least 12 distinct frame CRC32s', () => {
  const crcs = new Set(matrix.rows.map((r) => r.crc32));
  assert.ok(crcs.size >= 12, `only ${crcs.size} distinct frames`);
});

test('comparator matrix is deterministic across a second independent run', () => {
  const m2 = Lab.runComparatorMatrix(TrmnlEngine);
  for (let i = 0; i < 16; i++) {
    assert.equal(m2.rows[i].crc32, matrix.rows[i].crc32, `row ${i} crc drifted`);
    assert.equal(m2.rows[i].inkPct, matrix.rows[i].inkPct);
  }
});

test('measureCombo reproduces matrix row for a single combo', () => {
  const single = lab.measureCombo('orbital', 'bayer8');
  const inMatrix = matrix.rows.find((r) => r.screenId === 'orbital' && r.ditherId === 'bayer8');
  assert.equal(single.crc32, inMatrix.crc32);
  assert.equal(single.inkPct, inMatrix.inkPct);
});

// ============================================================================
// 4. EXACT 48,062-BYTE BMP HEADER ASSERTIONS
// ============================================================================

const bmpFixture = (() => {
  const r = TrmnlEngine.renderScreen('corridor', { ditherMode: 'atkinson' });
  return { rendered: r, bmp: TrmnlEngine.encode1BitBMP(r.ditheredPixels, 800, 480) };
})();

test('verifyBmp48k reports 48062-byte size and clean header for 800x480', () => {
  const v = Lab.verifyBmp48k(TrmnlEngine, bmpFixture.rendered.ditheredPixels, 800, 480);
  assert.equal(v.bmpBytes, 48062);
  assert.equal(v.bmpHeaderOk, true);
  assert.equal(v.bmpIs48062, true);
});

test('BMP file header carries BM magic, size field and 62-byte pixel offset', () => {
  const view = new DataView(bmpFixture.bmp.buffer, bmpFixture.bmp.byteOffset, bmpFixture.bmp.byteLength);
  assert.equal(bmpFixture.bmp[0], 0x42);
  assert.equal(bmpFixture.bmp[1], 0x4d);
  assert.equal(view.getUint32(2, true), 48062);
  assert.equal(view.getUint32(6, true), 0);
  assert.equal(view.getUint32(10, true), 62);
});

test('BMP DIB header carries 40-byte BITMAPINFOHEADER, 800x480, 1-bit planes', () => {
  const view = new DataView(bmpFixture.bmp.buffer, bmpFixture.bmp.byteOffset, bmpFixture.bmp.byteLength);
  assert.equal(view.getUint32(14, true), 40);
  assert.equal(view.getInt32(18, true), 800);
  assert.equal(view.getInt32(22, true), 480);
  assert.equal(view.getUint16(26, true), 1);
  assert.equal(view.getUint16(28, true), 1);
  assert.equal(view.getUint32(30, true), 0);
  assert.equal(view.getUint32(34, true), 48000);
  assert.equal(view.getUint32(46, true), 2);
  assert.equal(view.getUint32(50, true), 2);
});

test('BMP palette holds black index 0 and white index 1', () => {
  const b = bmpFixture.bmp;
  assert.equal(b[54], 0x00); assert.equal(b[55], 0x00); assert.equal(b[56], 0x00);
  assert.equal(b[58], 0xff); assert.equal(b[59], 0xff); assert.equal(b[60], 0xff);
});

test('every matrix row encodes its own 48062-byte BMP', () => {
  for (const row of matrix.rows) {
    const r = TrmnlEngine.renderScreen(row.screenId, { ditherMode: row.ditherId });
    const bmp = TrmnlEngine.encode1BitBMP(r.ditheredPixels, 800, 480);
    assert.equal(bmp.byteLength, 48062, `${row.screenId} x ${row.ditherId}`);
  }
});

// ============================================================================
// 5. PNG ENCODER: SIGNATURE, IHDR CRC32, IEND
// ============================================================================

test('PNG signature is the RFC 2083 8-byte magic', () => {
  const png = TrmnlEngine.encodeGrayscalePNG(bmpFixture.rendered.ditheredPixels, 800, 480);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('PNG IHDR chunk CRC32 verifies against engine crc32', () => {
  const png = TrmnlEngine.encodeGrayscalePNG(bmpFixture.rendered.ditheredPixels, 800, 480);
  const crc = TrmnlEngine.crc32(png.subarray(12, 29));
  const stored = ((png[29] << 24) | (png[30] << 16) | (png[31] << 8) | png[32]) >>> 0;
  assert.equal(crc, stored);
});

test('PNG IHDR declares 800x480 8-bit grayscale color type 0', () => {
  const png = TrmnlEngine.encodeGrayscalePNG(bmpFixture.rendered.ditheredPixels, 800, 480);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  assert.equal(view.getUint32(16, false), 800);
  assert.equal(view.getUint32(20, false), 480);
  assert.equal(png[24], 8);
  assert.equal(png[25], 0);
});

test('PNG terminates with an IEND chunk', () => {
  const png = TrmnlEngine.encodeGrayscalePNG(bmpFixture.rendered.ditheredPixels, 800, 480);
  const tail = String.fromCharCode(png[png.length - 8], png[png.length - 7], png[png.length - 6], png[png.length - 5]);
  assert.equal(tail, 'IEND');
});

// ============================================================================
// 6. BATTERY FRONTIER MONOTONICITY
// ============================================================================

for (const cap of Lab.CAPACITY_OPTIONS) {
  test(`battery daysRemaining is non-decreasing across refresh intervals at ${cap} mAh`, () => {
    const curve = Lab.batteryCurve(TrmnlEngine, { capacityMah: cap, rssi: -58, batteryVoltage: 4.04 });
    assert.ok(curve.points.length >= 10);
    for (let i = 1; i < curve.points.length; i++) {
      assert.ok(
        curve.points[i].daysRemaining >= curve.points[i - 1].daysRemaining,
        `${cap}mAh: drop between ${curve.points[i - 1].intervalSec}s and ${curve.points[i].intervalSec}s`
      );
    }
  });
}

for (const rssi of Lab.RSSI_OPTIONS) {
  test(`battery daysRemaining is non-decreasing across intervals at ${rssi} dBm`, () => {
    const curve = Lab.batteryCurve(TrmnlEngine, { capacityMah: 1800, rssi, batteryVoltage: 4.04 });
    for (let i = 1; i < curve.points.length; i++) {
      assert.ok(curve.points[i].daysRemaining >= curve.points[i - 1].daysRemaining);
    }
  });
}

for (const cap of Lab.CAPACITY_OPTIONS) {
  for (const rssi of Lab.RSSI_OPTIONS) {
    test(`battery daysRemaining <= daysFull for ${cap} mAh at ${rssi} dBm`, () => {
      const est = TrmnlEngine.estimateBatteryLife({
        capacityMah: cap, refreshIntervalSec: 600, rssi, batteryVoltage: 4.04
      });
      assert.ok(est.estimatedDaysRemaining <= est.estimatedDaysFull);
      assert.ok(est.estimatedDaysRemaining >= 0);
    });
  }
}

test('batteryFrontier returns 3 packs x 5 RSSI x 13 interval grid', () => {
  const f = Lab.batteryFrontier(TrmnlEngine, {});
  assert.equal(f.days.length, 3);
  assert.equal(f.days[0].length, 5);
  assert.equal(f.days[0][0].length, 13);
});

test('batteryFrontier days are non-decreasing within every (cap, rssi) row', () => {
  const f = Lab.batteryFrontier(TrmnlEngine, {});
  for (let ci = 0; ci < f.days.length; ci++) {
    for (let ri = 0; ri < f.days[ci].length; ri++) {
      const row = f.days[ci][ri];
      for (let i = 1; i < row.length; i++) {
        assert.ok(row[i] >= row[i - 1], `cap ${f.capacities[ci]} rssi ${f.rssis[ri]}`);
      }
    }
  }
});

test('battery mahPerDay drops when refresh interval widens', () => {
  const fast = TrmnlEngine.estimateBatteryLife({ capacityMah: 1800, refreshIntervalSec: 60, rssi: -58, batteryVoltage: 4.04 });
  const slow = TrmnlEngine.estimateBatteryLife({ capacityMah: 1800, refreshIntervalSec: 3600, rssi: -58, batteryVoltage: 4.04 });
  assert.ok(fast.mahPerDay > slow.mahPerDay);
  assert.ok(fast.wakesPerDay > slow.wakesPerDay);
});

test('battery curve honors custom interval lists and clamps to 60..3600', () => {
  const curve = Lab.batteryCurve(TrmnlEngine, { intervals: [10, 60, 900, 99999], capacityMah: 1800, rssi: -58 });
  assert.equal(curve.points[0].intervalSec, 60);
  assert.equal(curve.points[3].intervalSec, 3600);
});

test('capacity monotone: 1200 < 1800 < 2500 mAh daysRemaining', () => {
  const d = Lab.CAPACITY_OPTIONS.map((cap) => TrmnlEngine.estimateBatteryLife({
    capacityMah: cap, refreshIntervalSec: 300, rssi: -58, batteryVoltage: 4.04
  }).estimatedDaysRemaining);
  assert.ok(d[0] < d[1] && d[1] < d[2], JSON.stringify(d));
});

test('rssi penalty: -88 dBm burns more mAh/day than -45 dBm', () => {
  const strong = TrmnlEngine.estimateBatteryLife({ capacityMah: 1800, refreshIntervalSec: 300, rssi: -45, batteryVoltage: 4.04 });
  const weak = TrmnlEngine.estimateBatteryLife({ capacityMah: 1800, refreshIntervalSec: 300, rssi: -88, batteryVoltage: 4.04 });
  assert.ok(weak.activeDurationSec > strong.activeDurationSec);
  assert.ok(weak.mahPerDay > strong.mahPerDay);
  assert.ok(weak.estimatedDaysRemaining < strong.estimatedDaysRemaining);
});

// ============================================================================
// 7. DITHER QUALITY METRICS (RLE, ENTROPY, PSNR, SSIM)
// ============================================================================

test('inkCoverage counts quantized black pixels exactly', () => {
  const buf = new Uint8Array([0, 255, 0, 255, 127, 128]);
  const cov = Lab.inkCoverage(buf);
  assert.equal(cov.blackPx, 3);
  assert.equal(cov.whitePx, 3);
  assert.equal(cov.inkPct, 50);
});

test('runLengthStats counts horizontal runs and transitions', () => {
  const buf = new Uint8Array([0, 0, 255, 255, 0, 0, 255, 255]);
  const r = Lab.runLengthStats(buf, 8, 1);
  assert.equal(r.runs, 4);
  assert.equal(r.transitions, 3);
  assert.equal(r.rawBytes, 1);
  assert.equal(r.rleBytes, 8);
});

test('byteEntropy is 0 for a uniform frame and ~8 for uniform-random bytes', () => {
  const flat = new Uint8Array(800 * 480).fill(255);
  const e0 = Lab.byteEntropy(TrmnlEngine, flat, 800, 480);
  assert.equal(e0.bitsPerByte, 0);
  assert.equal(e0.packedBytes, 48000);
  const packed = new Uint8Array(800 * 480);
  for (let i = 0; i < packed.length; i++) packed[i] = (i * 31 + 7) & 0xff ? 255 : 0;
  const e1 = Lab.byteEntropy(TrmnlEngine, packed, 800, 480);
  assert.ok(e1.bitsPerByte > 0);
});

test('midtonePsnr returns 99 for a lossless frame and finite for dithered', () => {
  const gray = new Uint8Array(64).fill(128);
  assert.equal(Lab.midtonePsnr(gray, gray), 99);
  const d = TrmnlEngine.applyDithering(gray, 8, 8, 'atkinson');
  const p = Lab.midtonePsnr(gray, d);
  assert.ok(p >= 0 && p < 99);
});

test('ssimLikeBlockFidelity is near 1 for identical frames and lower after dither', () => {
  const r = TrmnlEngine.renderScreen('corridor', { ditherMode: 'atkinson' });
  const same = Lab.ssimLikeBlockFidelity(r.grayPixels, r.grayPixels, 800, 480);
  assert.ok(same > 0.99);
  const dithered = Lab.ssimLikeBlockFidelity(r.grayPixels, r.ditheredPixels, 800, 480);
  assert.ok(dithered < same && dithered >= -1 && dithered <= 1);
});

test('fidelity scatter exposes 4 kernel points per screen', () => {
  for (const s of Lab.SCREENS) {
    const sc = Lab.fidelityScatter(TrmnlEngine, s);
    assert.equal(sc.screenId, s);
    assert.equal(sc.points.length, 4);
    const ids = sc.points.map((p) => p.ditherId).sort();
    assert.deepEqual(ids, ['atkinson', 'bayer4', 'bayer8', 'floyd-steinberg']);
    for (const p of sc.points) {
      assert.ok(p.inkPct > 0 && p.ssim >= -1 && p.ssim <= 1 && p.runs > 0);
    }
  }
});

// ============================================================================
// 8. AUDITED PROOF BRIEF: DIGEST, CACHE, VERIFY, TAMPER
// ============================================================================

const SNAP = {
  screenId: 'corridor', ditherId: 'atkinson',
  refreshIntervalSec: 300, batteryVoltage: 4.04, rssi: -58, capacityMah: 1800
};

test('buildAuditBrief stamps a 64-hex SHA-256 digest and freezes the payload', () => {
  const brief = lab.buildAuditBrief(SNAP);
  assert.ok(/^[0-9a-f]{64}$/.test(brief.auditDigest));
  assert.ok(Object.isFrozen(brief));
  assert.equal(brief.format, Lab.BRIEF_FORMAT);
});

test('buildAuditBrief returns the identical cached object for the same state', () => {
  const b1 = lab.buildAuditBrief(SNAP);
  const b2 = lab.buildAuditBrief({ ...SNAP });
  assert.equal(b1, b2);
  assert.equal(b1.auditDigest, b2.auditDigest);
});

test('buildAuditBrief carries all 16 matrix rows with bmpOk flags', () => {
  const brief = lab.buildAuditBrief(SNAP);
  assert.equal(brief.matrix.length, 16);
  for (const r of brief.matrix) {
    assert.equal(r.bmpOk, true);
    assert.ok(r.bmpBytes === 48062);
  }
});

test('brief digest changes when workbench state changes', () => {
  const b1 = lab.buildAuditBrief(SNAP);
  const b2 = lab.buildAuditBrief({ ...SNAP, refreshIntervalSec: 900 });
  const b3 = lab.buildAuditBrief({ ...SNAP, screenId: 'orbital' });
  assert.notEqual(b1.auditDigest, b2.auditDigest);
  assert.notEqual(b1.auditDigest, b3.auditDigest);
});

test('verifyAuditBrief accepts a clean stamped brief', () => {
  const brief = lab.buildAuditBrief(SNAP);
  const v = Lab.verifyAuditBrief(brief);
  assert.equal(v.ok, true);
  assert.equal(v.reason, 'OK');
  assert.equal(v.expectedDigest, brief.auditDigest);
});

test('verifyAuditBrief rejects malformed and digest-less briefs', () => {
  assert.equal(Lab.verifyAuditBrief(null).reason, 'MALFORMED_BRIEF');
  assert.equal(Lab.verifyAuditBrief([1, 2]).reason, 'MALFORMED_BRIEF');
  assert.equal(Lab.verifyAuditBrief({ auditDigest: 'xyz' }).reason, 'MISSING_DIGEST');
  assert.equal(Lab.verifyAuditBrief({ a: 1 }).reason, 'MISSING_DIGEST');
});

test('verifyAuditBrief detects a 1-unit tamper on active metrics', () => {
  const brief = lab.buildAuditBrief(SNAP);
  const tampered = Lab.tamperAuditBrief(brief);
  const v = Lab.verifyAuditBrief(tampered);
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'DIGEST_MISMATCH');
});

test('tamperAuditBrief mutates exactly one unit of measured data', () => {
  const brief = lab.buildAuditBrief(SNAP);
  const t = Lab.tamperAuditBrief(brief);
  assert.equal(t.active.blackPx, brief.active.blackPx + 1);
  assert.equal(t.auditDigest, brief.auditDigest);
});

test('brief disclosure states deterministic local audit provenance', () => {
  const brief = lab.buildAuditBrief(SNAP);
  assert.ok(brief.disclosure.includes('trmnl_engine.js'));
  assert.ok(brief.disclosure.length > 40);
});

test('digest parity: identical digest appears in badge JSON CSV and Markdown', () => {
  const brief = lab.buildAuditBrief(SNAP);
  const d = brief.auditDigest;
  assert.ok(Lab.exportJsonBrief(brief).includes(d));
  assert.ok(Lab.exportCsvBrief(brief).includes(d));
  assert.ok(Lab.exportMarkdownBrief(brief).includes(d));
});

test('JSON export round-trips through JSON.parse preserving the digest', () => {
  const brief = lab.buildAuditBrief(SNAP);
  const parsed = JSON.parse(Lab.exportJsonBrief(brief));
  assert.equal(parsed.auditDigest, brief.auditDigest);
  assert.equal(parsed.matrix.length, 16);
});

// ============================================================================
// 9. FORMULA-SAFE CSV EXPORT
// ============================================================================

test('csvEscapeCell prefixes = + - @ tab and CR leads with an apostrophe', () => {
  for (const h of ['=SUM(1)', '+x', '-10', '@cmd', '\t=1', '\r=2']) {
    const esc = Lab.csvEscapeCell(h);
    const core = esc.startsWith('"') ? esc.slice(1, -1) : esc;
    assert.ok(core.startsWith("'"), `cell ${JSON.stringify(h)} not prefixed`);
  }
});

test('csvEscapeCell leaves plain values untouched', () => {
  assert.equal(Lab.csvEscapeCell('corridor'), 'corridor');
  assert.equal(Lab.csvEscapeCell(42), '42');
  assert.equal(Lab.csvEscapeCell(null), '');
  assert.equal(Lab.csvEscapeCell(undefined), '');
});

test('csvEscapeCell doubles embedded quotes and wraps in double quotes', () => {
  assert.equal(Lab.csvEscapeCell('say "hi"'), '"say ""hi"""');
  assert.equal(Lab.csvEscapeCell('a,b'), '"a,b"');
  assert.equal(Lab.csvEscapeCell('a\nb'), '"a\nb"');
});

test('CSV export carries header row plus 16 matrix rows', () => {
  const csv = Lab.exportCsvBrief(lab.buildAuditBrief(SNAP));
  const lines = csv.trim().split('\n');
  const data = lines.filter((l) => !l.startsWith('#'));
  assert.equal(data[0], 'screen,dither,ink_pct,h_runs,rle_bytes,byte_entropy,psnr_db,ssim_like,bmp_bytes,bmp_ok');
  assert.equal(data.length - 1, 16);
});

test('CSV export stamps the identical sha256 as the JSON export', () => {
  const brief = lab.buildAuditBrief(SNAP);
  const csv = Lab.exportCsvBrief(brief);
  assert.ok(csv.includes('# sha256 ' + brief.auditDigest));
});

test('Markdown export renders a 16-row table plus sha256 footer', () => {
  const md = Lab.exportMarkdownBrief(lab.buildAuditBrief(SNAP));
  assert.ok(md.includes('| Screen | Dither |'));
  assert.ok(md.includes('sha256: '));
  const rows = md.split('\n').filter((l) => l.startsWith('| corridor') || l.startsWith('| orbital') || l.startsWith('| labbench') || l.startsWith('| rhythm'));
  assert.equal(rows.length, 16);
});

// ============================================================================
// 10. FAIL-CLOSED #thlab= CODEC
// ============================================================================

test('encodeLabHash produces a #thlab= base64url token', () => {
  const h = Lab.encodeLabHash({ v: 1, s: 'corridor' });
  assert.ok(h.startsWith('#thlab='));
  assert.ok(/^[A-Za-z0-9_-]+$/.test(h.slice(7)));
});

test('codec round-trips every screen id', () => {
  for (const s of Lab.SCREENS) {
    const dec = Lab.decodeLabHash(Lab.encodeLabHash({ v: 1, s }));
    assert.equal(dec.ok, true);
    assert.equal(dec.state.s, s);
  }
});

test('codec round-trips every lab dither id', () => {
  for (const d of Lab.DITHER_IDS) {
    const dec = Lab.decodeLabHash(Lab.encodeLabHash({ v: 1, s: 'corridor', d }));
    assert.equal(dec.ok, true);
    assert.equal(dec.state.d, d);
  }
});

test('codec round-trips refresh bounds 60s and 3600s', () => {
  for (const r of [60, 3600]) {
    const dec = Lab.decodeLabHash(Lab.encodeLabHash({ v: 1, s: 'corridor', r }));
    assert.equal(dec.ok, true);
    assert.equal(dec.state.r, r);
  }
});

test('codec round-trips voltage bounds 3.25V and 4.20V as integer centivolts', () => {
  for (const b of [325, 420]) {
    const dec = Lab.decodeLabHash(Lab.encodeLabHash({ v: 1, s: 'corridor', b }));
    assert.equal(dec.ok, true);
    assert.equal(dec.state.b, b);
  }
});

test('codec round-trips RSSI bounds -88 and -42 dBm', () => {
  for (const q of [-88, -42]) {
    const dec = Lab.decodeLabHash(Lab.encodeLabHash({ v: 1, s: 'corridor', q }));
    assert.equal(dec.ok, true);
    assert.equal(dec.state.q, q);
  }
});

test('codec round-trips all three pack capacities', () => {
  for (const c of Lab.CAPACITY_OPTIONS) {
    const dec = Lab.decodeLabHash(Lab.encodeLabHash({ v: 1, s: 'corridor', c }));
    assert.equal(dec.ok, true);
    assert.equal(dec.state.c, c);
  }
});

test('codec round-trips matrix selection -1, 0 and 15', () => {
  for (const m of [-1, 0, 15]) {
    const dec = Lab.decodeLabHash(Lab.encodeLabHash({ v: 1, s: 'corridor', m }));
    assert.equal(dec.ok, true);
    assert.equal(dec.state.m, m);
  }
});

test('codec restores a full 7-field state exactly', () => {
  const src = { v: 1, s: 'rhythm', d: 'bayer4', r: 1500, b: 385, q: -70, c: 1200, m: 12 };
  const dec = Lab.decodeLabHash(Lab.encodeLabHash(src));
  assert.equal(dec.ok, true);
  assert.deepEqual(dec.state, src);
});

test('codec fills defaults for omitted optional fields', () => {
  const dec = Lab.decodeLabHash(Lab.encodeLabHash({ v: 1, s: 'orbital' }));
  assert.equal(dec.ok, true);
  assert.deepEqual(dec.state, { v: 1, s: 'orbital', d: 'atkinson', r: 300, b: 404, q: -58, c: 1800, m: -1 });
});

test('codec rejects __proto__ key payloads', () => {
  const raw = '{"v":1,"s":"corridor","__proto__":{"x":1}}';
  const res = Lab.decodeLabHash('#thlab=' + Lab.b64urlEncodeText(raw));
  assert.equal(res.ok, false);
});

test('codec rejects constructor and prototype keys', () => {
  for (const k of ['constructor', 'prototype']) {
    const raw = `{"v":1,"s":"corridor","${k}":{"x":1}}`;
    const res = Lab.decodeLabHash('#thlab=' + Lab.b64urlEncodeText(raw));
    assert.equal(res.ok, false, k);
  }
});

test('codec rejects wrong version numbers', () => {
  for (const v of [0, 2, 99, '1']) {
    const res = Lab.decodeLabHash('#thlab=' + Lab.b64urlEncodeText(JSON.stringify({ v, s: 'corridor' })));
    assert.equal(res.ok, false, `v=${v}`);
  }
});

test('codec rejects unknown screen ids', () => {
  for (const s of ['NOPE', 'CORRIDOR', 'corridor2', '']) {
    const res = Lab.decodeLabHash('#thlab=' + Lab.b64urlEncodeText(JSON.stringify({ v: 1, s })));
    assert.equal(res.ok, false, `s=${s}`);
  }
});

test('codec rejects non-lab dither ids even if engine would accept them', () => {
  for (const d of ['threshold', 'gray2bit', 'HACK', 'fs', 'atkinson ']) {
    const res = Lab.decodeLabHash('#thlab=' + Lab.b64urlEncodeText(JSON.stringify({ v: 1, s: 'corridor', d })));
    assert.equal(res.ok, false, `d=${d}`);
  }
});

test('codec rejects out-of-range refresh, rssi, voltage, capacity, matrix', () => {
  const bads = [
    { r: 59 }, { r: 3601 }, { r: 1.5 }, { r: '300' }, { r: NaN },
    { q: -89 }, { q: -41 }, { q: -58.5 },
    { b: 324 }, { b: 421 }, { b: 404.4 },
    { c: 9999 }, { c: 1800.5 },
    { m: -2 }, { m: 16 }, { m: 4.5 }
  ];
  for (const extra of bads) {
    const raw = Object.assign({ v: 1, s: 'corridor' }, extra);
    const res = Lab.decodeLabHash('#thlab=' + Lab.b64urlEncodeText(JSON.stringify(raw)));
    assert.equal(res.ok, false, JSON.stringify(extra));
  }
});

test('codec rejects non-object JSON payloads', () => {
  for (const raw of ['[1,2,3]', '"x"', '5', 'true', 'null', 'not json', '{bad']) {
    const res = Lab.decodeLabHash('#thlab=' + Lab.b64urlEncodeText(raw));
    assert.equal(res.ok, false, raw);
  }
});

test('codec rejects garbage, empty, non-string and oversized inputs', () => {
  assert.equal(Lab.decodeLabHash('').ok, false);
  assert.equal(Lab.decodeLabHash('#thlab=').ok, false);
  assert.equal(Lab.decodeLabHash('#thlab=!!!').ok, false);
  assert.equal(Lab.decodeLabHash('#thlab=A').ok, false);
  assert.equal(Lab.decodeLabHash(null).ok, false);
  assert.equal(Lab.decodeLabHash(42).ok, false);
  assert.equal(Lab.decodeLabHash({}).ok, false);
  assert.equal(Lab.decodeLabHash('#thlab=' + 'A'.repeat(5000)).ok, false);
});

test('codec finds the thlab token inside a full location.hash', () => {
  const h = Lab.encodeLabHash({ v: 1, s: 'labbench', d: 'floyd-steinberg' });
  const dec = Lab.decodeLabHash('https://x.test/page' + h);
  assert.equal(dec.ok, true);
  assert.equal(dec.state.s, 'labbench');
  assert.equal(dec.state.d, 'floyd-steinberg');
});

test('encodeLabHash returns null for un-normalizable input', () => {
  assert.equal(Lab.encodeLabHash(null), null);
  assert.equal(Lab.encodeLabHash({ v: 9, s: 'corridor' }), null);
  assert.equal(Lab.encodeLabHash({ v: 1, s: 'NOPE' }), null);
});

test('normalizeLabState rejects non-plain shapes', () => {
  for (const bad of [null, undefined, 5, 'x', [], [{ v: 1, s: 'corridor' }]]) {
    assert.equal(Lab.normalizeLabState(bad), null);
  }
});

// ============================================================================
// 11. BASE64URL + STRICT UTF-8 PRIMITIVES
// ============================================================================

test('b64url round-trips ASCII, accented, CJK and surrogate-pair text', () => {
  for (const s of ['a', 'hello world', 'e\u0301', '\u4e2d\u6587\u6d4b\u8bd5', '\ud83d\ude80\ud83c\udfa8']) {
    const dec = Lab.b64urlDecodeText(Lab.b64urlEncodeText(s));
    assert.equal(dec, s, JSON.stringify(s));
  }
});

test('b64urlEncodeText output matches Buffer base64url for sample strings', () => {
  for (const s of ['corridor', 'a', 'ab', 'abc', 'TRMNL']) {
    const expected = Buffer.from(s, 'utf8').toString('base64url').replace(/=+$/, '');
    assert.equal(Lab.b64urlEncodeText(s), expected, s);
  }
});

test('b64urlDecodeText rejects invalid alphabets and bad lengths', () => {
  assert.equal(Lab.b64urlDecodeText(''), null);
  assert.equal(Lab.b64urlDecodeText('a==='), null);
  assert.equal(Lab.b64urlDecodeText('ab!c'), null);
  assert.equal(Lab.b64urlDecodeText('A'), null);
  assert.equal(Lab.b64urlDecodeText(null), null);
  assert.equal(Lab.b64urlDecodeText(42), null);
});

test('b64urlDecodeText rejects overlong and truncated UTF-8 sequences', () => {
  // 0xC0 0x80 is an overlong encoding of NUL: must be rejected by strict decode.
  const overlong = Buffer.from([0xc0, 0x80]).toString('base64url');
  assert.equal(Lab.b64urlDecodeText(overlong), null);
  // Lone continuation byte.
  const cont = Buffer.from([0x80]).toString('base64url');
  assert.equal(Lab.b64urlDecodeText(cont), null);
});

// ============================================================================
// 12. HTTP INTEGRATION: epaper-lab.js SERVED, INTERNALS STILL 404
// ============================================================================

test('server serves /epaper-lab.js with 200 and JS content type', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const res = await httpRequest(port, 'GET', '/epaper-lab.js');
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.ok(res.buffer.toString('utf8').includes('TrmnlEpaperLab'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('server still serves the original four workbench files', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    for (const p of ['/', '/index.html', '/style.css', '/app.js', '/trmnl_engine.js']) {
      const res = await httpRequest(port, 'GET', p);
      assert.equal(res.statusCode, 200, p);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('server returns 404 for repo internals and traversal attempts', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    for (const p of [
      '/.git/config', '/.git/HEAD', '/server.js', '/test.js', '/epaper-lab.test.js',
      '/package.json', '/README.md', '/plugins/corridor/full.liquid',
      '/../server.js', '/%2e%2e/server.js', '/..%2fserver.js', '/.git'
    ]) {
      const res = await httpRequest(port, 'GET', p);
      assert.equal(res.statusCode, 404, p);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('index.html served over HTTP references epaper-lab.js before app.js', async () => {
  const { server } = createByosServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    const res = await httpRequest(port, 'GET', '/');
    const html = res.buffer.toString('utf8');
    const labIdx = html.indexOf('src="epaper-lab.js"');
    const appIdx = html.indexOf('src="app.js"');
    const engIdx = html.indexOf('src="trmnl_engine.js"');
    assert.ok(engIdx > -1 && labIdx > engIdx && appIdx > labIdx, 'script order engine < lab < app');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ============================================================================
// 13. IN-PAGE SELF-TEST SUITE META-CHECKS
// ============================================================================

test('runLabSelfTests reports at least 18 checks and all pass', () => {
  const suite = lab.runLabSelfTests();
  assert.ok(suite.total >= 18, `only ${suite.total} checks`);
  assert.equal(suite.passed, suite.total);
  assert.equal(suite.ok, true);
});

test('runLabSelfTests result ids are unique', () => {
  const suite = lab.runLabSelfTests();
  const ids = new Set(suite.results.map((r) => r.id));
  assert.equal(ids.size, suite.results.length);
});

test('every self-test result carries ok boolean and detail string', () => {
  const suite = lab.runLabSelfTests();
  for (const r of suite.results) {
    assert.equal(typeof r.ok, 'boolean');
    assert.equal(typeof r.detail, 'string');
    assert.ok(r.detail.length > 0);
  }
});

// ============================================================================
// 14. DOM WIRING SMOKE TESTS (static verification of index.html/app.js/css)
// ============================================================================

const ROOT = __dirname;
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const styleCss = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

for (const id of [
  'matrixTbody', 'batteryChart', 'fidelityChart', 'labDigestBadge',
  'briefStatus', 'selfTestOut', 'selfTestBadge', 'batteryChartBadge',
  'scatterBadge', 'btnRunSelfTests', 'btnVerifyDigest', 'btnTamperDemo',
  'btnBriefJson', 'btnBriefCsv', 'btnBriefMd'
]) {
  test(`index.html exposes #${id} for the lab UI`, () => {
    assert.ok(indexHtml.includes(`id="${id}"`), `missing #${id}`);
  });
}

test('app.js binds every lab element id it needs', () => {
  for (const id of ['matrixTbody', 'batteryChart', 'fidelityChart', 'labDigestBadge', 'selfTestOut', 'btnRunSelfTests']) {
    assert.ok(appJs.includes(`getElementById('${id}')`), `app.js does not bind #${id}`);
  }
});

test('index.html loads epaper-lab.js between engine and app', () => {
  const eng = indexHtml.indexOf('src="trmnl_engine.js"');
  const labIdx = indexHtml.indexOf('src="epaper-lab.js"');
  const app = indexHtml.indexOf('src="app.js"');
  assert.ok(eng > -1 && labIdx > eng && app > labIdx);
});

test('index.html makes no external http/https resource requests', () => {
  assert.ok(!/src="https?:/i.test(indexHtml), 'external script src found');
  assert.ok(!/href="https?:/i.test(indexHtml), 'external link href found');
});

test('style.css guards grid tracks with minmax(0, ...) and children min-width: 0', () => {
  assert.ok(styleCss.includes('minmax(0, 1fr)'), 'missing minmax guard');
  assert.ok(styleCss.includes('min-width: 0'), 'missing min-width: 0 guard');
  assert.ok(styleCss.includes('overflow-x: auto'), 'missing overflow-x auto wrapper');
});

test('app.js exposes hash codec restore and update calls', () => {
  assert.ok(appJs.includes('decodeLabHash'));
  assert.ok(appJs.includes('encodeLabHash'));
  assert.ok(appJs.includes('restoreFromHash'));
  assert.ok(appJs.includes('updateHash'));
});

test('server.js allowlist includes epaper-lab.js and keeps internals unlisted', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.ok(src.includes("'/epaper-lab.js': 'epaper-lab.js'"));
  assert.ok(!src.includes("'/server.js'"));
  assert.ok(!src.includes("'/test.js'"));
});

// ============================================================================
// 15. EXTRA EDGE COVERAGE: LAB STATE, EXPORTS, UMD SHAPE
// ============================================================================

test('lab module is a pure UMD export with the documented surface', () => {
  for (const k of [
    'sha256Hex', 'canonicalJson', 'runComparatorMatrix', 'batteryCurve',
    'batteryFrontier', 'fidelityScatter', 'createLab', 'runLabSelfTests',
    'encodeLabHash', 'decodeLabHash', 'exportJsonBrief', 'exportCsvBrief',
    'exportMarkdownBrief', 'verifyAuditBrief', 'tamperAuditBrief', 'csvEscapeCell',
    'inkCoverage', 'runLengthStats', 'byteEntropy', 'midtonePsnr',
    'ssimLikeBlockFidelity', 'verifyBmp48k', 'measureCombo', 'normalizeLabState'
  ]) {
    assert.equal(typeof Lab[k], 'function', `missing ${k}`);
  }
  assert.deepEqual(Lab.SCREENS, ['corridor', 'orbital', 'labbench', 'rhythm']);
  assert.equal(Lab.DITHERS.length, 4);
});

test('comparatorMatrix caches results per options key', () => {
  const ctx = Lab.createLab(TrmnlEngine);
  const a = ctx.comparatorMatrix();
  const b = ctx.comparatorMatrix();
  assert.equal(a, b);
  const c = ctx.comparatorMatrix({ batteryVoltage: 3.9 });
  assert.notEqual(a, c);
  assert.ok(ctx._matrixCacheSize() >= 2);
});

test('matrix metrics genuinely shift when telemetry overrides change', () => {
  const a = lab.measureCombo('corridor', 'atkinson', { batteryVoltage: 3.3, rssi: -80 });
  const b = lab.measureCombo('corridor', 'atkinson', { batteryVoltage: 4.2, rssi: -45 });
  assert.notEqual(a.crc32, b.crc32);
});

test('fidelity scatter accepts telemetry options like the matrix', () => {
  const sc = Lab.fidelityScatter(TrmnlEngine, 'corridor', { batteryVoltage: 3.9 });
  assert.equal(sc.points.length, 4);
});

test('brief active combo mirrors the selected screen and dither', () => {
  const brief = lab.buildAuditBrief({ screenId: 'rhythm', ditherId: 'bayer8', refreshIntervalSec: 600 });
  assert.equal(brief.active.screenId, 'rhythm');
  assert.equal(brief.active.ditherId, 'bayer8');
  assert.equal(brief.workbench.refreshIntervalSec, 600);
});

test('brief snapshot tolerates missing and hostile-ish fields by clamping', () => {
  const brief = lab.buildAuditBrief({ screenId: 'NOPE', ditherId: 'HACK', refreshIntervalSec: 5, rssi: 'junk' });
  assert.equal(brief.active.screenId, 'corridor');
  assert.equal(brief.active.ditherId, 'atkinson');
  assert.equal(brief.workbench.refreshIntervalSec, 60);
  assert.equal(brief.workbench.rssi, -58);
});

test('verifyAuditBrief recomputes digest over canonical payload key order', () => {
  const brief = lab.buildAuditBrief(SNAP);
  const scrambled = JSON.parse(Lab.exportJsonBrief(brief));
  const reordered = {};
  for (const k of Object.keys(scrambled).reverse()) reordered[k] = scrambled[k];
  const v = Lab.verifyAuditBrief(reordered);
  assert.equal(v.ok, true);
});

test('tamperAuditBrief leaves the original frozen brief untouched', () => {
  const brief = lab.buildAuditBrief(SNAP);
  const before = brief.active.blackPx;
  Lab.tamperAuditBrief(brief);
  assert.equal(brief.active.blackPx, before);
});

test('CSV export escapes hostile screen-like cell content safely', () => {
  const esc = Lab.csvEscapeCell('=1+1,calc');
  assert.ok(esc.includes("'") && esc.startsWith('"'));
});

test('decodeLabHash returns reason codes on failure', () => {
  assert.equal(Lab.decodeLabHash(5).reason, 'NON_STRING_HASH');
  assert.equal(Lab.decodeLabHash('no-token-here').reason, 'MISSING_PREFIX');
  assert.equal(Lab.decodeLabHash('#thlab=@@@').reason, 'INVALID_TOKEN');
  const badJson = Lab.decodeLabHash('#thlab=' + Lab.b64urlEncodeText('{oops'));
  assert.equal(badJson.reason, 'INVALID_JSON');
  const badState = Lab.decodeLabHash('#thlab=' + Lab.b64urlEncodeText('{"v":9}'));
  assert.equal(badState.reason, 'INVALID_STATE');
});

test('runLabSelfTests throws without an engine argument', () => {
  assert.throws(() => Lab.runLabSelfTests(null), /requires TrmnlEngine/);
  assert.throws(() => Lab.createLab(), /requires TrmnlEngine/);
});

test('matrix row indexes map 1:1 to screen x dither enumeration', () => {
  const seen = new Set();
  for (const row of matrix.rows) {
    assert.ok(!seen.has(row.index));
    seen.add(row.index);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 16 }, (_v, i) => i));
});

test('distinctBytes stays within 256-symbol alphabet', () => {
  for (const row of matrix.rows) {
    assert.ok(row.distinctBytes >= 1 && row.distinctBytes <= 256);
  }
});

test('RLE compressibility differs across kernels but stays positive', () => {
  const atk = matrix.rows.find((r) => r.screenId === 'corridor' && r.ditherId === 'atkinson');
  const b8 = matrix.rows.find((r) => r.screenId === 'corridor' && r.ditherId === 'bayer8');
  assert.ok(atk.runs > 0 && b8.runs > 0);
  assert.notEqual(atk.runs, b8.runs);
});
