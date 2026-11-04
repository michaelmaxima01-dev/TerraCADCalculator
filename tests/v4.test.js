import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSurface, validateProject} from '../src/core/surface.js';
import {gradeGeometry, gradeElevation, sampleGrade, insertPVI, movePVI, validateGrade} from '../src/core/grade.js';
import {drapeBreakline} from '../src/core/breaklines.js';
import {gradePlatform, platformVolumes, designElevationAt, designSurfaceFunction, validatePolygon, meanTerrainInside} from '../src/core/grading.js';
import {pointAtStation, sectionStations, sampleSection, averageEndArea} from '../src/core/sections.js';
import {createSnapIndex} from '../src/core/snap.js';
import {toDXF, toLandXML} from '../src/core/exporters.js';
import {triangleLocator} from '../src/core/profile.js';

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b} (±${eps})`);
const gridPts = (n, step, zf) => { const pts = []; for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) { const x = i * step, y = j * step; pts.push({id: `G${j}_${i}`, x, y, z: zf(x, y), description: 'TN'}); } return pts; };

// ---------- Greide ----------
test('grade: tangents, symmetric parabolic vertical curve and K value', () => {
  const geo = gradeGeometry([{station: 0, z: 100}, {station: 100, z: 102, curve: 40}, {station: 200, z: 98}]);
  close(geo.slopes[0], 0.02); close(geo.slopes[1], -0.04);
  const c = geo.curves[1]; close(c.bvc, 80); close(c.evc, 120); close(c.A, -6); close(c.K, 40 / 6); assert.equal(c.type, 'convexa');
  close(gradeElevation(geo, 50), 101); close(gradeElevation(geo, 150), 100);
  close(gradeElevation(geo, 80), 101.6); close(gradeElevation(geo, 120), 101.2);
  // meio da curva: z_PVI + (g2-g1)L/8 = 102 - 0.06*40/8
  close(gradeElevation(geo, 100), 102 - 0.06 * 40 / 8);
  assert.equal(gradeElevation(geo, -1), null); assert.equal(gradeElevation(geo, 201), null);
  // continuidade da derivada em BVC
  const d = 1e-4; close((gradeElevation(geo, 80 + d) - gradeElevation(geo, 80)) / d, 0.02, 1e-4);
});

test('grade: curve length is clamped by neighbours; editing keeps order', () => {
  const geo = gradeGeometry([{station: 0, z: 0}, {station: 10, z: 1, curve: 100}, {station: 30, z: 0}]);
  close(geo.curves[1].length, 10);
  const {grade, index} = insertPVI([{station: 0, z: 0, curve: 0}, {station: 30, z: 0, curve: 0}], {station: 12, z: 5});
  assert.equal(index, 1); assert.equal(grade.length, 3);
  const moved = movePVI(grade, 1, 50, 7); assert.ok(moved[1].station < 30); assert.equal(moved[1].z, 7);
  assert.throws(() => insertPVI(grade, {station: 12, z: 1}), /Já existe/);
  assert.throws(() => validateGrade([{station: 5, z: 0}, {station: 5, z: 1}]), /crescentes/);
  assert.ok(sampleGrade(gradeGeometry(grade), 1).length >= 3);
});

// ---------- Linhas obrigatórias livres ----------
test('free breakline is draped on the TIN, densified at edge crossings and honoured after retriangulation', () => {
  const pts = gridPts(4, 10, (x, y) => 100 + 0.1 * x + 0.05 * y);
  const mesh = buildSurface(pts);
  const at = triangleLocator(pts, mesh.triangles);
  const items = [{x: 3, y: 4}, {x: 37, y: 33}];
  const {points: next, indices, added} = drapeBreakline(pts, mesh.triangles, items);
  assert.ok(added >= 5, 'cruzamentos com arestas viram vértices');
  for (const i of indices) close(next[i].z, at(next[i].x, next[i].y), 1e-9);
  assert.equal(next[indices[0]].description, 'RUPTURA');
  const rebuilt = buildSurface(next, [indices]);
  const keys = new Set(rebuilt.constraints.map(([a, b]) => [a, b].sort((u, v) => u - v).join(':')));
  for (let k = 1; k < indices.length; k++) assert.ok(keys.has([indices[k - 1], indices[k]].sort((u, v) => u - v).join(':')));
  // a superfície plana continua exatamente plana após inserir a linha (concordância)
  const at2 = triangleLocator(next, rebuilt.triangles);
  for (const [x, y] of [[5, 5], [20, 31], [33, 12]]) close(at2(x, y), 100 + 0.1 * x + 0.05 * y, 1e-9);
});

test('free breakline reuses existing points, keeps given vertex elevation and rejects lines off the surface', () => {
  const pts = gridPts(2, 10, () => 50);
  const mesh = buildSurface(pts);
  const r = drapeBreakline(pts, mesh.triangles, [{index: 0}, {x: 15, y: 5, z: 55}], {densify: false});
  assert.equal(r.indices[0], 0); assert.equal(r.added, 1); assert.equal(r.points.at(-1).z, 55);
  assert.throws(() => drapeBreakline(pts, mesh.triangles, [{x: 5, y: 5}, {x: 50, y: 5}]), /fora da superfície/);
  assert.throws(() => drapeBreakline(pts, mesh.triangles, [{x: 5, y: 5}]), /dois vértices/);
});

// ---------- Plataforma e taludes ----------
const flat = gridPts(10, 10, () => 10); // 100 x 100, z = 10
const flatMesh = buildSurface(flat);
const square = [{x: 40, y: 40}, {x: 60, y: 40}, {x: 60, y: 60}, {x: 40, y: 60}];

test('design elevation follows the distance model in fill and cut', () => {
  const pf = {polygon: square, elevation: 12, cutSlope: 1, fillSlope: 2};
  assert.equal(designElevationAt(pf, 50, 50, 10), 12);
  close(designElevationAt(pf, 62, 50, 10), 11); // aterro: 12 - 2/2
  assert.equal(designElevationAt(pf, 65, 50, 10), null); // além do offset (d=4 encontra o terreno)
  const cut = {polygon: square, elevation: 8, cutSlope: 1, fillSlope: 2};
  close(designElevationAt(cut, 61, 50, 10), 9); assert.equal(designElevationAt(cut, 63, 50, 10), null);
});

test('fill platform volume on flat ground matches the analytic prism + slopes + corner cone', () => {
  // corpo 20x20x2 = 800; laterais 4 * (0.5*4*2) * 20 = 320; cantos = cone r=4 h=2 = π·16·2/3
  const pf = {polygon: square, elevation: 12, cutSlope: 1, fillSlope: 2};
  const v = platformVolumes(flat, flatMesh.triangles, pf, {cell: 0.05});
  const exact = 800 + 320 + Math.PI * 16 * 2 / 3;
  close(v.fill, exact, exact * 0.003); close(v.cut, 0);
  close(v.footprint, 28 * 28 - (4 - Math.PI) * 16, 3); // quadrado expandido com cantos arredondados
});

test('cut platform on flat ground mirrors the fill result with its own slope', () => {
  const pf = {polygon: square, elevation: 7, cutSlope: 1.5, fillSlope: 2};
  const v = platformVolumes(flat, flatMesh.triangles, pf, {cell: 0.05});
  // h=3, alcance=4.5: 400*3 + 4*(0.5*4.5*3)*20 + π·4.5²·3/3
  const exact = 1200 + 540 + Math.PI * 4.5 * 4.5;
  close(v.cut, exact, exact * 0.003); close(v.fill, 0);
});

test('grading mesh: daylight sits on the terrain, at the slope distance, with platform and slope faces', () => {
  const pf = {polygon: square, elevation: 12, cutSlope: 1, fillSlope: 2};
  const g = gradePlatform(flat, flatMesh.triangles, pf);
  assert.deepEqual(g.warnings, []);
  for (const d of g.daylight) { close(d.z, 10, 1e-6); }
  // pontos médios das laterais: offset a 4 m da borda
  const east = g.daylight.filter(d => Math.abs(d.y - 50) < 1e-6 && d.x > 60);
  assert.ok(east.length); close(east[0].x, 64, 1e-4);
  assert.ok(g.types.includes('platform') && g.types.includes('fill') && !g.types.includes('cut'));
  // área plana da malha da plataforma = 400
  let platArea = 0; g.triangles.forEach((t, k) => { if (g.types[k] !== 'platform') return; const [a, b, c] = t.map(i => g.vertices[i]); platArea += Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2; });
  close(platArea, 400, 1e-6);
});

test('platform on sloping ground has both cut and fill and reports warnings at the surface edge', () => {
  const slope = gridPts(10, 10, x => 100 + 0.1 * x);
  const m = buildSurface(slope);
  const sym = platformVolumes(slope, m.triangles, {polygon: square, elevation: 105, cutSlope: 1, fillSlope: 1}, {cell: 0.1});
  close(sym.cut, sym.fill, sym.cut * 0.01); // inclinações iguais: simetria em torno de x = 50
  const pf = {polygon: square, elevation: 105, cutSlope: 1, fillSlope: 1.5};
  const v = platformVolumes(slope, m.triangles, pf, {cell: 0.1});
  assert.ok(v.cut > 0 && v.fill > v.cut, 'aterro mais abatido alcança mais longe');
  const g = gradePlatform(slope, m.triangles, pf);
  assert.ok(g.types.includes('cut') && g.types.includes('fill'));
  const near = gradePlatform(slope, m.triangles, {polygon: [{x: 0, y: 0}, {x: 30, y: 0}, {x: 30, y: 30}, {x: 0, y: 30}], elevation: 120, cutSlope: 1, fillSlope: 1.5});
  assert.ok(near.warnings.length > 0);
});

test('reentrant (L-shaped) platform: volume is exact on flat ground despite the concave corner', () => {
  const L = [{x: 30, y: 30}, {x: 70, y: 30}, {x: 70, y: 40}, {x: 40, y: 40}, {x: 40, y: 70}, {x: 30, y: 70}];
  const pf = {polygon: L, elevation: 11, cutSlope: 1, fillSlope: 1};
  const v = platformVolumes(flat, flatMesh.triangles, pf, {cell: 0.04});
  // V = área·h + ∫₀¹ (1 - r) dA(r), com A(r) = P·r + c·r² e c = 5·(π/4) - 1 (5 cantos convexos, 1 reentrante)
  // ⇒ V = área + P/2 + c/3 (h = 1, H = 1)
  const area = 40 * 10 + 10 * 30, perimeter = 40 + 10 + 30 + 30 + 10 + 40;
  close(v.fill, area + perimeter / 2 + (5 * Math.PI / 4 - 1) / 3, 0.05);
  assert.throws(() => validatePolygon([{x: 0, y: 0}, {x: 2, y: 2}, {x: 2, y: 0}, {x: 0, y: 1}]), /cruza/);
});

test('design surface function combines platforms; mean terrain inside polygon', () => {
  const at = triangleLocator(flat, flatMesh.triangles);
  const f = designSurfaceFunction([{polygon: square, elevation: 12, cutSlope: 1, fillSlope: 2}], at);
  assert.equal(f(50, 50), 12); assert.equal(f(90, 90), null);
  close(meanTerrainInside(flat, flatMesh.triangles, square), 10);
});

// ---------- Seções ----------
test('sections: stations, normals and cut/fill areas against a flat fill platform', () => {
  const path = [{x: 50, y: 10}, {x: 50, y: 90}];
  const st = sectionStations(80, 20, [33]); assert.deepEqual(st, [0, 20, 33, 40, 60, 80]);
  const p = pointAtStation(path, 40); close(p.x, 50); close(p.y, 50); close(p.ty, 1);
  const at = triangleLocator(flat, flatMesh.triangles);
  const designAt = designSurfaceFunction([{polygon: square, elevation: 12, cutSlope: 1, fillSlope: 2}], at);
  const sec = sampleSection(path, 40, 30, {points: flat, triangles: flatMesh.triangles, designAt}, 600);
  // seção no meio da plataforma: área = 20*2 + 2*(0.5*4*2) = 48
  close(sec.fillArea, 48, 0.2); close(sec.cutArea, 0);
  assert.ok(sec.left.x < 50, 'offsets negativos à esquerda do sentido do traçado');
  const total = averageEndArea([{station: 0, cutArea: 0, fillArea: 10}, {station: 10, cutArea: 2, fillArea: 30}]);
  close(total.fill, 200); close(total.cut, 10);
  assert.throws(() => sectionStations(1e6, 1), /pequeno/);
});

// ---------- Snap ----------
test('snap index: priority node/vertex > midpoint > nearest, within aperture', () => {
  const idx = createSnapIndex({nodes: [{x: 0, y: 0, ref: 'A'}, {x: 10, y: 0, ref: 'B'}], vertices: [{x: 5, y: 5, ref: 'V'}], segments: [{a: {x: 0, y: 0}, b: {x: 10, y: 0}, ref: 'AB'}]});
  assert.equal(idx.query(0.4, 0.3, 1).ref, 'A');
  assert.equal(idx.query(5.1, 4.8, 1).kind, 'vertex');
  assert.equal(idx.query(5.2, 0.3, 1).kind, 'midpoint');
  const near = idx.query(2.5, 0.4, 1); assert.equal(near.kind, 'nearest'); close(near.x, 2.5); close(near.y, 0);
  assert.equal(idx.query(2.5, 3, 1), null);
  assert.equal(idx.query(0.4, 0.3, 1, {node: false, vertex: false, midpoint: false, nearest: true}).kind, 'nearest');
  // muitos itens: continua encontrando o mais próximo
  const many = createSnapIndex({nodes: Array.from({length: 5000}, (_, i) => ({x: i % 100, y: Math.floor(i / 100), ref: i}))});
  assert.equal(many.query(37.2, 12.1, 0.5).ref, 1237);
});

// ---------- Exportação e projeto ----------
test('DXF and LandXML include the design surface, offset line and greide', () => {
  const pf = {polygon: square, elevation: 12, cutSlope: 1, fillSlope: 2};
  const mesh = gradePlatform(flat, flatMesh.triangles, pf);
  const dxf = toDXF({points: flat, triangles: flatMesh.triangles, designs: [{platform: pf, mesh}], gradeLine: [{x: 0, y: 0, z: 1}, {x: 10, y: 0, z: 2}]}, {tin: false, points: false, labels: false});
  assert.ok(dxf.includes('TC_PLATAFORMA') && dxf.includes('TC_TALUDE_ATERRO') && dxf.includes('TC_OFFSET') && dxf.includes('TC_GREIDE'));
  const lines = dxf.split('\n'); if (lines.at(-1) === '') lines.pop(); assert.equal(lines.length % 2, 0);
  const faces = lines.filter((l, i) => i % 2 === 1 && lines[i - 1] === '0' && l === '3DFACE').length;
  assert.equal(faces, mesh.triangles.length);
  const xml = toLandXML({points: flat, triangles: flatMesh.triangles}, {extra: [{name: 'Projeto', vertices: mesh.vertices, triangles: mesh.triangles}]});
  assert.equal((xml.match(/<Surface /g) || []).length, 2); assert.ok(xml.includes('name="Projeto"'));
});

test('project v4 round-trips grade and platforms and validates them', () => {
  const project = {version: 4, points: flat, triangles: flatMesh.triangles, breaklines: [], boundary: [], maxEdge: 0, alignment: [{x: 0, y: 0}, {x: 50, y: 50}],
    grade: [{station: 0, z: 10, curve: 0}, {station: 70, z: 12, curve: 0}], platforms: [{id: 'p1', name: 'Pátio', polygon: square, elevation: 12, cutSlope: 1, fillSlope: 2}]};
  const r = validateProject(JSON.parse(JSON.stringify(project)));
  assert.equal(r.grade.length, 2); assert.equal(r.platforms[0].name, 'Pátio'); assert.equal(r.platforms[0].visible, true);
  assert.throws(() => validateProject({...project, platforms: [{...project.platforms[0], cutSlope: 0}]}), /Inclinações/);
  assert.throws(() => validateProject({...project, grade: [{station: 1, z: 0}, {station: 0, z: 0}]}), /crescentes/);
  const v3 = validateProject({...project, version: 3, grade: undefined, platforms: undefined});
  assert.deepEqual(v3.grade, []); assert.deepEqual(v3.platforms, []);
});

test('terrain clipping removes covered parts and keeps exact elevations and area', async () => {
  const {clipTerrainMesh} = await import('../src/core/grading.js');
  const pts = gridPts(2, 50, (x, y) => 10 + 0.1 * x);
  const m = buildSurface(pts);
  const hole = (x, y) => x > 30 && x < 70 && y > 30 && y < 70;
  const c = clipTerrainMesh(pts, m.triangles, hole, {bounds: [{minX: 30, minY: 30, maxX: 70, maxY: 70}], minEdge: 2});
  let area = 0;
  for (const t of c.triangles) {
    const [a, b, d] = t.map(i => c.vertices[i]);
    area += Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x)) / 2;
    for (const v of [a, b, d]) close(v.z, 10 + 0.1 * v.x, 1e-9);
    assert.ok(!hole((a.x + b.x + d.x) / 3, (a.y + b.y + d.y) / 3));
  }
  close(area, 10000 - 1600, 120); // buraco 40 x 40, bordas em degraus de ~2 m
  // projeto pequeno dentro de um único triângulo grande (sem vértices cobertos) também é recortado
  const tiny = (x, y) => Math.hypot(x - 20, y - 12) < 3;
  const t2 = clipTerrainMesh(pts, m.triangles, tiny, {bounds: [{minX: 17, minY: 9, maxX: 23, maxY: 15}], minEdge: 0.5});
  assert.ok(t2.triangles.length > m.triangles.length);
  assert.equal(clipTerrainMesh(pts, m.triangles, () => false).triangles.length, m.triangles.length);
});

test('a second free breakline crossing the first gets a shared vertex instead of being rejected', () => {
  const pts = gridPts(4, 10, (x, y) => 100 + 0.2 * x - 0.1 * y);
  const m1 = buildSurface(pts);
  const a = drapeBreakline(pts, m1.triangles, [{x: 2, y: 3}, {x: 38, y: 36}]);
  const m2 = buildSurface(a.points, [a.indices]);
  const b = drapeBreakline(a.points, m2.triangles, [{x: 3, y: 37}, {x: 36, y: 4}]);
  const m3 = buildSurface(b.points, [a.indices, b.indices]); // não lança "cruzam sem vértice comum"
  assert.ok(m3.triangles.length > 0);
  const at = triangleLocator(b.points, m3.triangles);
  for (const [x, y] of [[20, 20], [5, 30], [33, 9]]) close(at(x, y), 100 + 0.2 * x - 0.1 * y, 1e-9);
});
