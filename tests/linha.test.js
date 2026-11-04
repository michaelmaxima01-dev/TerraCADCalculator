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
  assert.ok(m.types.every(t => t === 'cut' || t === 'wall'));
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

test('buildLineBase informa estaca e cota de cada PI (meio do arco quando há curva)', () => {
  const info = buildLineBase(validateDesignLine({pis: [{x: 0, y: 0}, {x: 100, y: 0, radius: 20}, {x: 100, y: 100}], elevation: {mode: 'ramp', start: 50, slope: 1}}));
  assert.equal(info.piStations.length, 3);
  close(info.piStations[0], 0, 1e-9); close(info.piStations[1], 80 + 5 * Math.PI, 0.05); close(info.piStations[2], info.length, 1e-9);
  close(info.piZ[2], 50 + info.length / 100, 1e-9);
});

test('linha de um lado só ganha a parede vertical do lado sem talude (só desenho)', () => {
  const {points, triangles} = planeTerrain(() => 105);
  const m = gradeLine(points, triangles, reta());
  const walls = m.triangles.filter((_, k) => m.types[k] === 'wall');
  assert.ok(walls.length >= 2, `paredes: ${walls.length}`);
  const zs = walls.flat().map(i => m.vertices[i].z);
  close(Math.min(...zs), 100, 1e-9); close(Math.max(...zs), 105, 1e-9);
  assert.equal(gradeLine(points, triangles, reta({side: 'both'})).types.filter(t => t === 'wall').length, 0);
});

// ---------- Task 6: edição por arraste ----------
import {moveVertex, insertVertex, removeVertex} from '../src/core/designLine.js';

test('rejeita arraste que cruza; aceita movimento válido sem perder cota e raio', () => {
  const sq = [{x: 0, y: 0}, {x: 10, y: 0, radius: 2}, {x: 10, y: 10}, {x: 0, y: 10}];
  assert.throws(() => moveVertex(sq, 1, {x: 5, y: 20}, {closed: true}), /cruza/); // (0,0)→(5,20) cruza o lado y = 10
  const ok = moveVertex(sq, 1, {x: 12, y: -1}, {closed: true});
  assert.deepEqual(ok[1], {x: 12, y: -1, radius: 2}); assert.deepEqual(sq[1], {x: 10, y: 0, radius: 2}, 'não altera o original');
  assert.throws(() => moveVertex(sq, 1, {x: 0, y: 0}, {closed: true}), /repetidos/);
});

test('inserir PI no meio de um trecho e remover respeitando o mínimo', () => {
  const l = [{x: 0, y: 0, z: 10}, {x: 10, y: 0, z: 20}];
  const ins = insertVertex(l, 0, {x: 5, y: 0}, {closed: false});
  assert.equal(ins.length, 3); assert.deepEqual(ins[1], {x: 5, y: 0, z: 15});
  assert.equal(removeVertex(ins, 1, {closed: false}).length, 2);
  assert.throws(() => removeVertex(l, 0, {closed: false}), /pelo menos 2/);
  assert.throws(() => removeVertex([{x: 0, y: 0}, {x: 1, y: 0}, {x: 1, y: 1}], 0, {closed: true}), /pelo menos 3/);
});

test('lineNearest com índice espacial dá o mesmo resultado da busca completa', () => {
  const pis = Array.from({length: 60}, (_, i) => ({x: i * 7, y: 40 * Math.sin(i / 6), radius: i % 5 === 2 ? 4 : undefined}));
  const info = buildLineBase(validateDesignLine({pis, elevation: {mode: 'ramp', start: 10, slope: 1.5}}));
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 3000; k++) {
    const x = -80 + rnd() * 600, y = -150 + rnd() * 300;
    assert.deepEqual(lineNearest(info, x, y), lineNearest(info, x, y, {brute: true}), `ponto ${x},${y}`);
  }
});

// ---------- Task 8: término por profundidade, fundo e cava ----------
import {platformVolumes, gradePlatform, designElevationAt} from '../src/core/grading.js';

const cava = (extra = {}) => validateDesignLine({pis: [{x: 0, y: 0}, {x: 40, y: 0}, {x: 40, y: 40}, {x: 0, y: 40}], closed: true, side: 'inside', elevation: {mode: 'ramp', start: 100, slope: 0}, cutSlope: 1, end: {mode: 'depth', depth: 8}, ...extra});

test('cava quadrada até 8 m: volume = ∫(40 − 2z)² dz = (40³ − 24³)/6', () => {
  const {points, triangles} = planeTerrain(() => 100);
  const v = lineVolumes(points, triangles, cava(), {maxCells: 400000});
  close(v.cut, 8362.6667, 8362.6667 * 0.005, 'cava'); assert.ok(v.fill < 1e-6);
  const info = compileLine(cava(), null);
  close(lineElevationAt(cava(), info, 20, 20, 100), 92, 1e-9, 'fundo'); close(lineElevationAt(cava(), info, 3, 20, 100), 97, 1e-9, 'talude');
  assert.equal(lineElevationAt(cava(), info, -1, 20, 100), null, 'fora da cava');
});

test('2 bermas em 8 m: cristas a 8/3 e 16/3 abaixo da borda e fundo a 92', () => {
  const {points, triangles} = planeTerrain(() => 100);
  const l = cava({benches: {enabled: true, count: 2, width: 1, apply: 'cut'}});
  const m = gradeLine(points, triangles, l);
  const zs = [...new Set(m.benchLines.flatMap(b => b.map(v => Math.round(v.z * 1000) / 1000)))].sort((a, b) => a - b);
  assert.deepEqual(zs, [Math.round((100 - 16 / 3) * 1000) / 1000, Math.round((100 - 8 / 3) * 1000) / 1000]);
  const floorZ = m.triangles.filter((_, k) => m.types[k] === 'floor').flat().map(i => m.vertices[i].z);
  assert.ok(floorZ.length > 0); floorZ.forEach(z => close(z, 92, 1e-6, 'fundo'));
  assert.ok(m.floorOutline.length >= 4);
});

test('fundo sem terreno: para no limite da superfície com aviso e volume finito', () => {
  const {points, triangles} = planeTerrain(() => 105, {min: -20, max: 60, step: 20});
  const p = {polygon: [{x: 10, y: 10}, {x: 30, y: 10}, {x: 30, y: 30}, {x: 10, y: 30}], elevation: 100, cutSlope: 1, fillSlope: 1.5, end: {mode: 'depth', depth: 50}};
  const m = gradePlatform(points, triangles, p);
  assert.ok(m.warnings.some(w => /limite da superfície/.test(w)), m.warnings.join(' | '));
  const v = platformVolumes(points, triangles, p); assert.ok(Number.isFinite(v.cut) && v.cut > 0);
});

test('morro cônico: plataforma no alto descendo 10 m confere com integração fina do modelo', () => {
  const {points, triangles} = planeTerrain((x, y) => 150 - Math.hypot(x - 50, y - 50) / 2, {min: -50, max: 150, step: 5});
  const at = triangleLocator(points, triangles);
  const p = {polygon: [{x: 40, y: 40}, {x: 60, y: 40}, {x: 60, y: 60}, {x: 40, y: 60}], elevation: 140, cutSlope: 1, fillSlope: 1.5, end: {mode: 'depth', depth: 10}};
  const v = platformVolumes(points, triangles, p, {maxCells: 250000});
  let ref = 0; const h = 0.1;
  for (let x = -50 + h / 2; x < 150; x += h) for (let y = -50 + h / 2; y < 150; y += h) { const T = at(x, y); if (T === null) continue; const D = designElevationAt(p, x, y, T); if (D !== null && T > D) ref += (T - D) * h * h; }
  close(v.cut, ref, ref * 0.005, 'morro');
  close(designElevationAt(p, 50, 70, at(50, 70)), 130, 1e-9, 'fundo a 10 m');
});

test('bermas por quantidade exigem término por profundidade', () => {
  assert.throws(() => validateDesignLine({pis: [{x: 0, y: 0}, {x: 10, y: 0}], benches: {enabled: true, count: 2}}), /término por profundidade/);
});

test('cava: raios param na aresta entre faces (não atravessam até a borda oposta)', () => {
  const {points, triangles} = planeTerrain(() => 100);
  const m = gradeLine(points, triangles, cava({benches: {enabled: true, count: 2, width: 1, apply: 'cut'}}));
  assert.equal(m.daylight.filter(v => Math.abs(v.z - 100) < 1e-6).length, 0, 'nenhum raio termina na borda');
  m.daylight.forEach(v => assert.ok(v.z <= 100 && v.z >= 92 - 1e-6));
});

test('exportação da cava: fundo, contorno do fundo, pé e face das bermas em camadas próprias', () => {
  const {points, triangles} = planeTerrain(() => 100);
  const l = cava({benches: {enabled: true, count: 2, width: 1, apply: 'cut'}}), mesh = gradeLine(points, triangles, l);
  assert.equal(mesh.benchLineKinds.length, mesh.benchLines.length);
  assert.ok(mesh.benchLineKinds.includes('crest') && mesh.benchLineKinds.includes('toe'));
  const dxf = toDXF({points, triangles, designs: [{kind: 'line', line: l, mesh}]});
  for (const layer of ['TC_FUNDO', 'TC_LP_FUNDO', 'TC_LP_PE', 'TC_LP_CRISTA', 'TC_BERMA_FACE']) assert.match(dxf, new RegExp(`\\n${layer}\\r?\\n`), layer);
});
