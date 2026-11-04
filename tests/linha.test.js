import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDesignLine, buildLineBase, lineNearest} from '../src/core/designLine.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);
const line = (pis, extra = {}) => validateDesignLine({pis, ...extra});
const noNaN = base => base.every(v => [v.x, v.y, v.z, v.s].every(Number.isFinite));

test('validateDesignLine aplica os padrões da especificação', () => {
  const l = line([{x: 0, y: 0}, {x: 10, y: 0}]);
  assert.equal(l.closed, false); assert.equal(l.side, 'right'); assert.equal(l.visible, true);
  assert.deepEqual(l.elevation, {mode: 'ramp', start: 0, slope: 0, drop: 0});
  assert.deepEqual(l.end, {mode: 'terrain', depth: 8, floorZ: null});
  assert.equal(l.cutSlope, 1); assert.equal(l.fillSlope, 1.5); assert.equal(l.benches.enabled, false);
});

test('arco: curva de canto em L com raio 20', () => {
  const info = buildLineBase(line([{x: 0, y: 0}, {x: 100, y: 0, radius: 20}, {x: 100, y: 100}]));
  assert.equal(info.curves.length, 1);
  close(info.curves[0].T, 20, 1e-9); close(info.curves[0].arcLength, 10 * Math.PI, 0.01);
  close(info.length, 200 - 40 + 10 * Math.PI, 0.02);
  assert.ok(noNaN(info.base));
  // flecha ≤ 2 cm: nenhum ponto da corda se afasta mais que isso do arco (centro em (80,20))
  for (let i = 1; i < info.base.length; i++) {
    const a = info.base[i - 1], b = info.base[i], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = Math.hypot(mx - 80, my - 20);
    if (Math.hypot(a.x - 80, a.y - 20) < 20.001 && Math.hypot(b.x - 80, b.y - 20) < 20.001) assert.ok(20 - r <= 0.02 + 1e-9, `flecha ${20 - r}`);
  }
});

test('raio limitado quando a tangente passa da metade do segmento', () => {
  const info = buildLineBase(line([{x: 0, y: 0}, {x: 30, y: 0, radius: 50}, {x: 30, y: 30}]));
  assert.equal(info.curves[0].clamped, true); close(info.curves[0].T, 15, 1e-9); close(info.curves[0].radius, 15, 1e-9);
  assert.ok(info.warnings.some(w => /Raio limitado a 15(,00)? m no PI 2/.test(w)), info.warnings.join(' | '));
});

test('rampa: reta de 100 m com −2% termina 2 m abaixo', () => {
  const info = buildLineBase(line([{x: 0, y: 0}, {x: 100, y: 0}], {elevation: {mode: 'ramp', start: 120, slope: -2}}));
  close(info.base.at(-1).z, 118, 1e-9); close(info.base[0].z, 120, 1e-9); close(info.length, 100, 1e-9);
});

test('pis: cota interpolada por estaca entre os PIs', () => {
  const info = buildLineBase(line([{x: 0, y: 0, z: 100}, {x: 50, y: 0, z: 110}], {elevation: {mode: 'pis'}}));
  close(lineNearest(info, 25, 0).z, 105, 1e-9);
});

test('terreno: cota do terreno menos o desnível; PI fora da superfície gera aviso', () => {
  const terrain = (x) => x > 50 ? null : 200 + x / 10;
  const ok = buildLineBase(line([{x: 0, y: 0}, {x: 40, y: 0}], {elevation: {mode: 'terrain', drop: 3}}), terrain);
  close(ok.base[0].z, 197, 1e-9); close(ok.base.at(-1).z, 201, 1e-9);
  const fora = buildLineBase(line([{x: 0, y: 0}, {x: 80, y: 0}], {elevation: {mode: 'terrain', drop: 3}}), terrain);
  assert.deepEqual(fora.base, []);
  assert.ok(fora.warnings.some(w => /PI 2 fora da superfície/.test(w)));
});

test('PIs repetidos e linha que cruza a si mesma são recusados', () => {
  assert.throws(() => line([{x: 0, y: 0}, {x: 0, y: 0}, {x: 10, y: 0}]), /PIs repetidos/);
  assert.throws(() => line([{x: 0, y: 0}, {x: 10, y: 10}, {x: 10, y: 0}, {x: 0, y: 10}]), /cruza a si mesma/);
  assert.throws(() => line([{x: 0, y: 0}]), /pelo menos 2 PIs/);
  assert.throws(() => line([{x: 0, y: 0}, {x: 5, y: 0}], {closed: true}), /pelo menos 3 PIs/);
});

test('grampo e colinear com raio não geram NaN', () => {
  const g = buildLineBase(line([{x: 0, y: 0}, {x: 10, y: 0, radius: 5}, {x: 0, y: 0.001}]));
  assert.ok(noNaN(g.base)); assert.ok(g.length > 0);
  const c = buildLineBase(line([{x: 0, y: 0}, {x: 5, y: 0, radius: 5}, {x: 10, y: 0}]));
  assert.ok(noNaN(c.base)); close(c.length, 10, 1e-9); assert.equal(c.curves.length, 0);
});

test('lineNearest: distância, lado e pontas', () => {
  const info = buildLineBase(line([{x: 0, y: 0}, {x: 100, y: 0}], {elevation: {mode: 'ramp', start: 50, slope: 0}}));
  const q = lineNearest(info, 50, -3);
  close(q.d, 3, 1e-9); assert.equal(q.side, 'right'); assert.equal(q.atEnd, false); close(q.s, 50, 1e-9); close(q.z, 50, 1e-9);
  assert.equal(lineNearest(info, 50, 3).side, 'left');
  assert.equal(lineNearest(info, -2, -3).atEnd, true);
  assert.equal(lineNearest(info, 103, 1).atEnd, true);
});

test('linha fechada: estaca cobre o perímetro e a curva também vale no 1º PI', () => {
  const info = buildLineBase(line([{x: 0, y: 0, radius: 5}, {x: 40, y: 0}, {x: 40, y: 40}, {x: 0, y: 40}], {closed: true}));
  close(info.length, 160 - 2 * 5 + 5 * Math.PI / 2, 0.02);
  assert.equal(info.closed, true); assert.ok(noNaN(info.base));
});
