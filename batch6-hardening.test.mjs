import test from 'node:test';
import assert from 'node:assert/strict';

async function loadModule(rel) {
  const ns = await import(new URL(rel, import.meta.url));
  return ns.default ?? ns;
}

const M = await loadModule('./epaper-lab.js');

function cellValue(s) {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/""/g, '"') : s;
}

test('batch6 csv escaping neutralizes hidden formula prefixes', () => {
  const fn = M.csvEscapeCell;
  for (const hostile of ['=1', ' =1', '\u200b=1', '\ufeff=1', '\u00a0=1', '\t=1', '\t123', '\r=1', '+cmd', '@SUM(1)', '  -42x']) {
    assert.equal(cellValue(fn(hostile)).startsWith("'"), true, JSON.stringify(hostile));
  }
  assert.equal(fn('\r=1').startsWith('"') && fn('\r=1').endsWith('"'), true, 'carriage return cell stays quoted');
  assert.equal(fn('-42'), '-42');
  assert.equal(cellValue(fn('  -42')).startsWith("'"), true);
});

test('batch6 audit verification rejects hostile prototype keys', () => {
  const hostile = JSON.parse('{"__proto__":{"polluted":true}}');
  hostile.auditDigest = '0'.repeat(64);
  const verdict = M.verifyAuditBrief(hostile);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'HOSTILE_KEYS');
  assert.equal({}.polluted, undefined);
});

test('batch6 epaper text truncation helper is applied', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('./trmnl_engine.js', import.meta.url), 'utf8');
  assert.equal(source.includes('function cpSlice('), true);
  assert.equal(source.includes('cpSlice(row.dest, 16)'), true);
  assert.equal(source.includes('cpSlice(item.task, 44)'), true);
});
