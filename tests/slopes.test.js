import test from 'node:test';
import assert from 'node:assert/strict';
import {castSlopes, gridVolumes} from '../src/core/slopes.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);

function squareNearest(L) {
  return (x, y) => {
    const dx = Math.max(0 - x, 0, x - L), dy = Math.max(0 - y, 0, y - L);
    return {d: Math.hypot(dx, dy), z: 100};
  };
}

test('castSlopes: base quadrada fechada em corte encontra o terreno plano', () => {
  const L = 40, base = [{x: 0, y: 0, z: 100}, {x: L, y: 0, z: 100}, {x: L, y: L, z: 100}, {x: 0, y: L, z: 100}];
  const m = castSlopes(base, {closed: true, side: 'outside', terrainAt: () => 130, nearest: squareNearest(L), ruleFor: () => ({H: 1, bench: null}), spacing: 2, maxDistance: 200});
  assert.ok(m.daylight.length > 8);
  m.daylight.forEach(v => close(v.z, 130, 1e-3, 'offset'));
  assert.equal(m.triangles.length, m.types.length);
  assert.ok(m.types.includes('platform') && m.types.includes('cut'));
  close(m.stats.maxCut, 30, 1e-9);
});

test('gridVolumes: projeto plano 1 m abaixo do terreno em 10×10 dá 100 m³ de corte', () => {
  const v = gridVolumes(() => 100, () => 101, {minX: 0, minY: 0, maxX: 10, maxY: 10}, {maxCells: 10000});
  close(v.cut, 100, 0.5); assert.equal(v.fill, 0); close(v.footprint, 100, 0.5);
});

// ---------- Task 7: bancadas a partir de X m e por quantidade ----------
import {slopeRise, slopeBreaks, slopeReach, validateBenches, resolveBench} from '../src/core/slopes.js';

test('startAfter: talude contínuo até 4 m, berma, depois bancadas de 5 m', () => {
  const b = {height: 5, width: 2, startAfter: 4};
  assert.deepEqual(slopeBreaks(1, b, 20).map(q => [q.d, q.kind]), [[4, 'crest'], [6, 'toe'], [11, 'crest'], [13, 'toe'], [18, 'crest']]);
  close(slopeRise(4, 1, b), 4, 1e-12); close(slopeRise(5, 1, b), 4, 1e-12); close(slopeRise(6, 1, b), 4, 1e-12);
  close(slopeRise(11, 1, b), 9, 1e-12); close(slopeRise(12, 1, b), 9, 1e-12); close(slopeRise(14, 1, b), 10, 1e-12);
  close(slopeRise(3, 1, b), 3, 1e-12);
  // alcance cobre a primeira berma
  assert.ok(slopeReach(9, 1, b) >= 11);
});

test('resolveBench: N bermas numa profundidade dão bancadas iguais; startAfter é ignorado', () => {
  const r = resolveBench({enabled: true, height: 10, width: 1, apply: 'cut', startAfter: 3, count: 2}, 8);
  close(r.height, 8 / 3, 1e-12); assert.equal(r.startAfter, 0);
  assert.deepEqual(resolveBench({enabled: true, height: 4, width: 1, count: null}, 8).height, 4);
});

test('validateBenches: novos campos e limites', () => {
  const v = validateBenches({enabled: true, height: 5, width: 2});
  assert.equal(v.startAfter, 0); assert.equal(v.count, null);
  assert.equal(validateBenches({startAfter: 4, count: 3}).count, 3);
  assert.throws(() => validateBenches({count: 0}), /entre 1 e 50/);
  assert.throws(() => validateBenches({count: 2.5}), /entre 1 e 50/);
  assert.throws(() => validateBenches({startAfter: -1}), /a partir de/i);
});

test('hachura do talude termina no início do fundo (não atravessa o fundo plano)', () => {
  const L = 40, base = [{x: 0, y: 0, z: 100}, {x: L, y: 0, z: 100}, {x: L, y: L, z: 100}, {x: 0, y: L, z: 100}];
  const nearest = (x, y) => { const dx = Math.max(0 - x, 0, x - L), dy = Math.max(0 - y, 0, y - L); return {d: Math.hypot(dx, dy), z: 100}; };
  const m = castSlopes(base, {closed: true, side: 'outside', terrainAt: (x, y) => (Math.hypot(x - 20, y - 20) < 70 ? 110 : null), nearest, ruleFor: () => ({H: 1, bench: null}), spacing: 2, maxDistance: 200, depth: {end: {mode: 'depth', depth: 5, floorZ: null}, H: 1, bench: null}});
  assert.ok(m.hatch.length > 0);
  m.hatch.forEach(([, b]) => { close(b.z, 95, 1e-6, 'cota do pé'); close(nearest(b.x, b.y).d, 5, 0.05, 'fim da hachura no pé do talude, a 5 m da borda'); });
});
