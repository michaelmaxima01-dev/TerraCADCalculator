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

// ---------- Task 3: taludes, malha e volumes da linha ----------
import {lineElevationAt, gradeLine, lineVolumes, compileLine} from '../src/core/lineGrading.js';
import {slopeRise} from '../src/core/slopes.js';
import {buildSurface} from '../src/core/surface.js';

function planeTerrain(f, {min = -60, max = 160, step = 20} = {}) {
  const points = [];
  for (let x = min; x <= max; x += step) for (let y = min; y <= max; y += step) points.push({id: `T${points.length}`, x, y, z: f(x, y), description: 'TN'});
  return {points, triangles: buildSurface(points).triangles};
}
const reta = (extra = {}) => validateDesignLine({pis: [{x: 0, y: 0}, {x: 100, y: 0}], elevation: {mode: 'ramp', start: 100, slope: 0}, side: 'right', cutSlope: 1, ...extra});

test('reta sobre terreno plano: corte = área da seção × comprimento (pontas retas)', () => {
  const {points, triangles} = planeTerrain(() => 105);
  const v = lineVolumes(points, triangles, reta(), {maxCells: 400000});
  close(v.cut, 1250, 1250 * 0.005, 'corte'); assert.ok(v.fill < 1e-6);
});

test('reta com bancadas: corte = seção em degraus × comprimento', () => {
  const benches = {enabled: true, height: 2, width: 1, apply: 'cut'};
  const {points, triangles} = planeTerrain(() => 105);
  const v = lineVolumes(points, triangles, reta({benches}), {maxCells: 400000});
  let area = 0; const n = 100000, D = 20;
  for (let i = 0; i < n; i++) { const d = (i + .5) * D / n, h = 5 - slopeRise(d, 1, benches); if (h > 0) area += h * D / n; }
  close(v.cut, 100 * area, 100 * area * 0.005, 'corte com bancadas');
});

test('lado "both" dobra o volume; o lado oposto fica fora do projeto', () => {
  const {points, triangles} = planeTerrain(() => 105);
  const v = lineVolumes(points, triangles, reta({side: 'both'}), {maxCells: 400000});
  close(v.cut, 2500, 2500 * 0.005, 'ambos');
  const info = compileLine(reta(), null);
  assert.equal(lineElevationAt(reta(), info, 50, 2, 105), null, 'lado esquerdo');
  assert.equal(lineElevationAt(reta(), info, -1, -2, 105), null, 'além da ponta');
  close(lineElevationAt(reta(), info, 50, -2, 105), 102, 1e-9, 'talude 1:1');
});

test('malha da linha: offset no terreno, tipos coerentes e sem NaN', () => {
  const {points, triangles} = planeTerrain(() => 105);
  const m = gradeLine(points, triangles, reta());
  assert.ok(m.daylight.length > 10);
  m.daylight.forEach(v => close(v.z, 105, 1e-3, 'offset'));
  assert.equal(m.triangles.length, m.types.length);
  assert.ok(m.triangles.every(t => t.every(i => Number.isFinite(m.vertices[i].z))));
  assert.ok(m.types.every(t => t === 'cut'));
  assert.ok(m.base.length >= 2);
});

test('linha fechada para fora equivale à plataforma com os mesmos vértices', () => {
  const {points, triangles} = planeTerrain(() => 104);
  const l = validateDesignLine({pis: [{x: 20, y: 20}, {x: 60, y: 20}, {x: 60, y: 60}, {x: 20, y: 60}], closed: true, side: 'outside', elevation: {mode: 'ramp', start: 100, slope: 0}});
  const v = lineVolumes(points, triangles, l);
  // prisma 1600 × 4 + Pappus: ∫0..4 (4 − d)(160 + 2πd) dd
  const expected = 1600 * 4 + (160 * 8 + 2 * Math.PI * (4 ** 3 / 6));
  close(v.cut, expected, expected * 0.005, 'fechada');
});

test('volume da linha aberta não depende do alinhamento da grade', () => {
  const {points, triangles} = planeTerrain(() => 105);
  for (const maxCells of [30000, 100000, 250000]) close(lineVolumes(points, triangles, reta(), {maxCells}).cut, 1250, 1250 * 0.007, `maxCells ${maxCells}`);
});

// ---------- Task 4: projeto v6, superfície combinada e exportação ----------
import {validateProject} from '../src/core/surface.js';
import {designSurfaceFunction} from '../src/core/grading.js';
import {toDXF, toLandXML} from '../src/core/exporters.js';
import {triangleLocator} from '../src/core/profile.js';

const projBase = () => { const pts = [[0, 0], [100, 0], [100, 100], [0, 100], [50, 50]].map(([x, y], i) => ({id: 'P' + i, x, y, z: 10 + i, description: ''})); return {pts, tri: buildSurface(pts).triangles}; };

test('validateProject: v6 com linha de projeto; v5 sem linhas; v7 recusado', () => {
  const {pts, tri} = projBase();
  const r = validateProject({version: 6, points: pts, triangles: tri, designLines: [{id: 'l1', name: 'Acesso', pis: [{x: 10, y: 10}, {x: 50, y: 20, radius: 8}, {x: 90, y: 10}]}]});
  assert.equal(r.designLines.length, 1); assert.equal(r.designLines[0].pis[1].radius, 8); assert.equal(r.designLines[0].name, 'Acesso');
  assert.deepEqual(validateProject({version: 5, points: pts, triangles: tri}).designLines, []);
  assert.throws(() => validateProject({version: 7, points: pts, triangles: tri}), /Versão/);
});

test('designSurfaceFunction considera as linhas depois das plataformas', () => {
  const {points, triangles} = planeTerrain(() => 105);
  const at = triangleLocator(points, triangles), f = designSurfaceFunction([], at, [reta()]);
  close(f(50, -2), 102, 1e-9); assert.equal(f(50, 2), null);
});

test('exportação: DXF com eixo e offset da linha; LandXML com a superfície de projeto', () => {
  const {points, triangles} = planeTerrain(() => 105);
  const l = reta(), mesh = gradeLine(points, triangles, l);
  const dxf = toDXF({points, triangles, designs: [{kind: 'line', line: l, mesh}]});
  assert.match(dxf, /\nTC_LP_EIXO\r?\n/); assert.match(dxf, /\nTC_LP_OFFSET\r?\n/);
  const xml = toLandXML({points, triangles}, {name: 'Terreno', extra: [{name: 'Projeto', vertices: mesh.vertices, triangles: mesh.triangles}]});
  assert.equal((xml.match(/<Surface /g) || []).length, 2);
});
