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
