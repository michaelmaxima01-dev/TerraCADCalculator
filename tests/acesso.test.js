import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCorridor, compileCorridor, corridorElevationAt, roadZ, gradeCorridor, corridorVolumes, serviceNotes, serviceNotesCSV, stationLabel, corridorEdges} from '../src/core/corridor.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);
// eixo reto de 100 m em x, greide plano em 98, terreno plano em 100 (corte de 2 m no eixo)
const axis = [{x: 0, y: 0}, {x: 100, y: 0}], flatGrade = {gradeAt: () => 98};
const box = {minX: -100, minY: -100, maxX: 200, maxY: 100, minZ: 100, maxZ: 100};
const T100 = (x, y) => (x >= -100 && x <= 200 && Math.abs(y) <= 100 ? 100 : null);

test('validateCorridor: padrão e limites', () => {
  const c = validateCorridor(null); assert.equal(c.width, 10); assert.equal(c.fall, 'crown'); assert.equal(c.enabled, false);
  assert.throws(() => validateCorridor({width: 0}), /Largura/); assert.throws(() => validateCorridor({crossfall: 30}), /Caimento/);
  assert.throws(() => validateCorridor({fall: 'x'}), /abaulado/); assert.throws(() => validateCorridor({cutSlope: 0}), /H:V/);
});

test('roadZ: abaulado e caimento para um lado (offset + à esquerda)', () => {
  const c = {crossfall: 2, fall: 'crown'};
  close(roadZ(c, 100, 5), 99.9, 1e-12); close(roadZ(c, 100, -5), 99.9, 1e-12); close(roadZ(c, 100, 0), 100, 1e-12);
  close(roadZ({crossfall: 3, fall: 'left'}, 100, 4), 99.88, 1e-12); close(roadZ({crossfall: 3, fall: 'left'}, 100, -4), 100.12, 1e-12);
  close(roadZ({crossfall: 3, fall: 'right'}, 100, -4), 99.88, 1e-12);
});

test('acesso em corte plano: pista, talude 1:1 e pontas retas', () => {
  const c = validateCorridor({enabled: true, width: 10, crossfall: 0, cutSlope: 1}), info = compileCorridor(axis, flatGrade, c);
  assert.ok(info.ok);
  close(corridorElevationAt(info, 50, 0, 100), 98, 1e-9); close(corridorElevationAt(info, 50, 5, 100), 98, 1e-9);
  close(corridorElevationAt(info, 50, -6, 100), 99, 1e-9, 'talude a 1 m do bordo direito');
  assert.equal(corridorElevationAt(info, 50, 7.5, 100), null, 'além do offset (5 + 2 m)');
  assert.equal(corridorElevationAt(info, -1, 0, 100), null, 'antes do início do eixo');
  assert.equal(corridorElevationAt(info, 101, 0, 100), null, 'depois do fim');
});

test('volume do acesso = L·(w·h + H·h²) sem caimento e com abaulado', () => {
  const c = validateCorridor({enabled: true, width: 10, crossfall: 0, cutSlope: 1}), info = compileCorridor(axis, flatGrade, c);
  const v = corridorVolumes(info, {terrainAt: T100, box, maxCells: 400000});
  close(v.cut, 100 * (10 * 2 + 1 * 4), 2400 * 0.005, 'corte'); close(v.fill, 0, 1e-9);
  // abaulado 2 %: seção = ∫(2 + 0,02|o|) do em [-5,5] + 2 × H·he²/2, he = 2,1 → 20,5 + 4,41 = 24,91 m²
  const c2 = validateCorridor({enabled: true, width: 10, crossfall: 2, fall: 'crown', cutSlope: 1}), v2 = corridorVolumes(compileCorridor(axis, flatGrade, c2), {terrainAt: T100, box, maxCells: 400000});
  close(v2.cut, 2491, 2491 * 0.005, 'corte abaulado');
});

test('acesso em aterro com talude 1,5:1: seção L·(w·h + H·h²)', () => {
  const c = validateCorridor({enabled: true, width: 8, crossfall: 0, fillSlope: 1.5}), info = compileCorridor(axis, {gradeAt: () => 103}, c);
  const v = corridorVolumes(info, {terrainAt: T100, box, maxCells: 400000});
  close(v.fill, 100 * (8 * 3 + 1.5 * 9), 3750 * 0.005, 'aterro'); close(v.cut, 0, 1e-9);
});

test('nota de serviço: bordos, offsets e alturas por estaca', () => {
  const c = validateCorridor({enabled: true, width: 10, crossfall: 2, fall: 'crown', cutSlope: 1}), info = compileCorridor(axis, flatGrade, c);
  const [r] = serviceNotes(info, [50], T100);
  close(r.terrainZ, 100, 1e-9); close(r.gradeZ, 98, 1e-9); close(r.axisH, 2, 1e-9);
  for (const sd of [r.left, r.right]) { close(sd.edgeOffset, 5, 1e-12); close(sd.edgeZ, 97.9, 1e-9); close(sd.offset, 7.1, 1e-6, 'offset'); close(sd.offsetZ, 100, 1e-9); close(sd.h, 2.1, 1e-6); assert.equal(sd.kind, 'C'); }
  const csv = serviceNotesCSV([r]);
  assert.match(csv, /0\+050,00;100,000;98,000;C 2,00;7,10;100,000;C;2,10;5,00;97,900/);
  assert.equal(stationLabel(1020.5), '1+020,50');
});

test('nota de serviço em aterro e greide variando ao longo do eixo', () => {
  const c = validateCorridor({enabled: true, width: 6, crossfall: 0, fillSlope: 2}), info = compileCorridor(axis, {gradeAt: s => 100 + s / 50}, c); // 2 %
  const [a, b] = serviceNotes(info, [0, 100], T100);
  close(a.gradeZ, 100, 1e-9); assert.equal(a.left.kind, '—');
  close(b.gradeZ, 102, 1e-9); close(b.axisH, -2, 1e-9); assert.equal(b.right.kind, 'A'); close(b.right.offset, 3 + 2 * 2, 1e-6); close(b.right.h, -2, 1e-6);
});

test('malha do acesso: pista abaulada e taludes encontram o terreno', () => {
  const c = validateCorridor({enabled: true, width: 10, crossfall: 2, fall: 'crown', cutSlope: 1}), info = compileCorridor(axis, flatGrade, c);
  const m = gradeCorridor(info, {terrainAt: T100, points: [{x: -100, y: -100}, {x: 200, y: 100}], spacing: 2, maxDistance: 100});
  assert.ok(m.types.includes('road') && m.types.includes('cut')); assert.equal(m.triangles.length, m.types.length);
  m.daylight.forEach(v => close(v.z, 100, 1e-3, 'offset no terreno'));
  m.daylight.filter(v => v.x > 1 && v.x < 99).forEach(v => close(Math.abs(v.y), 7.1, 0.02, 'afastamento do offset'));
  const e = corridorEdges(info); e.left.forEach(v => { close(v.y, 5, 1e-9); close(v.z, 97.9, 1e-9); });
});

test('eixo com curva: o bordo interno não dobra para trás', () => {
  const bent = [{x: 0, y: 0}, {x: 50, y: 0}, {x: 50, y: 50}];
  const c = validateCorridor({enabled: true, width: 20}), info = compileCorridor(bent, flatGrade, c), {left, right} = corridorEdges(info);
  for (const L of [left, right]) for (let k = 2; k < L.length; k++) { const a = L[k - 2], b = L[k - 1], q = L[k]; assert.ok((b.x - a.x) * (q.x - b.x) + (b.y - a.y) * (q.y - b.y) > -1e-9, 'sem reversão'); }
  // o canto externo (à direita, curva para a esquerda) fica a w/2 dos dois trechos
  const arc = right.filter(v => v.x > 50 + 1e-9 && v.y < -1e-9); assert.ok(arc.length >= 3, 'arco no canto externo');
  arc.forEach(v => close(Math.hypot(v.x - 50, v.y), 10, 1e-9, 'arco a w/2 do PI'));
  assert.ok(left.some(v => Math.abs(v.x - 40) < 1e-6 && Math.abs(v.y - 10) < 1e-6), 'esquina interna em (40,10)');
  left.forEach(v => assert.ok(!(v.x > 40 + 1e-6 && v.y < 10 - 1e-6), 'nada dentro da pista no lado interno'));
});

test('sem eixo ou sem greide: avisos e nada calculado', () => {
  const c = validateCorridor({enabled: true});
  assert.match(compileCorridor([], flatGrade, c).warnings[0], /eixo/);
  assert.match(compileCorridor(axis, null, c).warnings[0], /greide/);
  assert.equal(corridorElevationAt(compileCorridor(axis, null, c), 1, 1, 100), null);
});

import {buildSurface, validateProject} from '../src/core/surface.js';
test('validateProject: v8 guarda o gabarito do acesso; v7 abre sem gabarito', () => {
  const pts = [[0, 0], [100, 0], [100, 100], [0, 100], [50, 50]].map(([x, y], i) => ({id: 'P' + i, x, y, z: 10 + i, description: ''}));
  const tri = buildSurface(pts).triangles;
  const r = validateProject({version: 8, points: pts, triangles: tri, corridor: {enabled: true, width: 12, crossfall: 3, fall: 'left', cutSlope: 0.75, fillSlope: 2}});
  assert.deepEqual([r.corridor.enabled, r.corridor.width, r.corridor.fall, r.corridor.cutSlope], [true, 12, 'left', 0.75]);
  assert.equal(validateProject({version: 7, points: pts, triangles: tri}).corridor, null);
  assert.throws(() => validateProject({version: 8, points: pts, triangles: tri, corridor: {width: -1}}), /Largura/);
});

import {toDXF} from '../src/core/exporters.js';
test('DXF do acesso: pista, bordos, eixo e offsets em camadas próprias', () => {
  const c = validateCorridor({enabled: true, width: 10, crossfall: 2, cutSlope: 1}), info = compileCorridor(axis, flatGrade, c);
  const mesh = gradeCorridor(info, {terrainAt: T100, points: [{x: -100, y: -100}, {x: 200, y: 100}], spacing: 5, maxDistance: 100});
  const dxf = toDXF({points: [{x: 0, y: 0, z: 0, description: ''}], designs: [{kind: 'corridor', corridor: c, mesh}]}, {tin: false, points: false, labels: false, contours: false});
  for (const layer of ['TC_AC_PISTA', 'TC_AC_BORDO', 'TC_AC_EIXO', 'TC_AC_OFFSET', 'TC_TALUDE_CORTE']) assert.ok(dxf.includes('\n' + layer + '\n') || dxf.includes(layer), layer);
  assert.ok((dxf.match(/TC_AC_OFFSET/g) || []).length > 2);
});

// ---------- superfície combinada: objetos sobrepostos não contam duas vezes ----------
import {validatePlatform, platformVolumes, designSurfaceFunction, gradePlatform} from '../src/core/grading.js';
import {projectEarthworks} from '../src/core/earthworks.js';
import {gridVolumes, castSlopes} from '../src/core/slopes.js';
const sqP = (id, x0, y0, L, z, extra = {}) => validatePlatform({id, name: id, polygon: [{x: x0, y: y0}, {x: x0 + L, y: y0}, {x: x0 + L, y: y0 + L}, {x: x0, y: y0 + L}], elevation: z, cutSlope: 1, fillSlope: 1.5, ...extra});
const grid = () => { const pts = [], N = 40; for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) pts.push({x: i * 10 - 100, y: j * 10 - 100, z: 100}); const tris = []; for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const a = i * (N + 1) + j, b = a + N + 1; tris.push([a, b, a + 1], [b, b + 1, a + 1]); } return {pts, tris}; };

test('duas plataformas sobrepostas: total = união (60×40, 5 m) e não a soma', () => {
  const A = sqP('A', -20, -20, 40, 95), B = sqP('B', 0, -20, 40, 95), {pts, tris} = grid(), T = (x, y) => (Math.abs(x) <= 100 && Math.abs(y) <= 100 ? 100 : null);
  const exact = 60 * 40 * 5 + (60 + 40) * 1 * 25 + Math.PI * 125 / 3; // prisma + faces + cantos (cone)
  const vA = platformVolumes(pts, tris, A, {elevationAt: T}), vB = platformVolumes(pts, tris, B, {elevationAt: T});
  const designs = [A, B].map(p => ({kind: 'platform', platform: p, mesh: gradePlatform(pts, tris, p, {elevationAt: T})}));
  const e = projectEarthworks(designs, {terrainAt: T, volumes: [vA, vB], maxCells: 400000});
  assert.ok(Math.abs(e.cut - exact) / exact < 0.003, `${e.cut} ≠ ${exact}`);
  assert.ok(e.overlap); close(e.sum.cut, vA.cut + vB.cut, 1e-6);
  // o piso de B não é invadido pelo talude de A
  const f = designSurfaceFunction([A, B], T); close(f(30, 0), 95, 1e-9); close(f(-21, 0), 96, 1e-9);
});

test('taludes sobrepostos: vale a escavação mais baixa; aterros, o envelope mais alto', () => {
  const T = () => 100, A = sqP('A', 0, 0, 10, 90), B = sqP('B', 18, 0, 10, 90), f = designSurfaceFunction([A, B], T);
  close(f(13, 5), 93, 1e-9, 'corte: A a 3 m (93) e B a 5 m (95) → 93');
  const C = sqP('C', 0, 0, 10, 110), D = sqP('D', 18, 0, 10, 106), g = designSurfaceFunction([C, D], T); // aterros 1,5:1
  close(g(14, 5), 110 - 4 / 1.5, 1e-9, 'aterro: envelope mais alto');
});

test('acesso com bermas: seção 20 + 2 × 3 m² (bancada 1 m, berma 1 m, 1:1) × 100 m', () => {
  const c = validateCorridor({enabled: true, width: 10, crossfall: 0, cutSlope: 1, benches: {enabled: true, height: 1, width: 1, apply: 'cut'}}), info = compileCorridor(axis, flatGrade, c);
  close(corridorVolumes(info, {terrainAt: T100, box, maxCells: 400000}).cut, 2600, 2600 * 0.003);
  const [r] = serviceNotes(info, [50], T100); close(r.left.offset, 5 + 3, 1e-6, 'offset com berma');
});

test('acesso sobre plataforma: total combinado ≤ soma e piso preservado', () => {
  const c = validateCorridor({enabled: true, width: 10, crossfall: 0}), info = compileCorridor(axis, flatGrade, c), P = sqP('P', 40, -20, 20, 98), {pts, tris} = grid();
  const T = (x, y) => (Math.abs(x) <= 100 && Math.abs(y) <= 100 ? 100 : null);
  const designs = [{kind: 'platform', platform: P, mesh: gradePlatform(pts, tris, P, {elevationAt: T})}, {kind: 'corridor', info, mesh: gradeCorridor(info, {terrainAt: T, points: pts})}];
  const vP = platformVolumes(pts, tris, P, {elevationAt: T}), vC = corridorVolumes(info, {terrainAt: T, points: pts, triangles: tris});
  const e = projectEarthworks(designs, {terrainAt: T, volumes: [vP, vC], maxCells: 400000});
  assert.ok(e.cut < vP.cut + vC.cut && e.overlap);
});

test('término por profundidade com bermas de aterro: aviso em vez de ignorar calado', () => {
  const base = [{x: 0, y: 0, z: 100}, {x: 10, y: 0, z: 100}, {x: 10, y: 10, z: 100}, {x: 0, y: 10, z: 100}];
  const m = castSlopes(base, {closed: true, side: 'outside', terrainAt: () => 99, nearest: () => ({d: 1, z: 100}), ruleFor: md => ({H: 1, bench: md === 'fill' ? {height: 1, width: 1} : null}), spacing: 2, maxDistance: 20, depth: {end: {mode: 'depth', depth: 2, floorZ: null}, H: 1, bench: null}});
  assert.ok(m.warnings.some(w => /aterro não são aplicadas/.test(w)));
});
