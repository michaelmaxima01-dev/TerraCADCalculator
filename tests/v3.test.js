import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSurface, validateProject} from '../src/core/surface.js';
import {buildContours, contourLevels} from '../src/core/contours.js';
import {surfaceStats, volumeToPlane, balanceElevation} from '../src/core/volumes.js';
import {sampleProfile, profileSummary, triangleLocator, alignmentLength} from '../src/core/profile.js';
import {toDXF, toLandXML, toCSV} from '../src/core/exporters.js';
import {parsePoints} from '../src/core/parser.js';

// Plano inclinado z = 100 + 0.1x em grade 0..100 (passo 10): resultados analíticos conhecidos.
const grid = [];
for (let j = 0; j <= 10; j++) for (let i = 0; i <= 10; i++) grid.push({id: `G${j}_${i}`, x: 320000 + i * 10, y: 7420000 + j * 10, z: 100 + i, description: j === 0 ? 'BD' : 'TN'});
const plane = buildSurface(grid);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('contour levels respect interval, base and level cap', () => {
  assert.deepEqual(contourLevels(100.2, 102.9, 1).map(l => l.z), [101, 102]);
  assert.deepEqual(contourLevels(100, 101, 0.5, 0.25).map(l => l.z), [100.25, 100.75]);
  assert.throws(() => contourLevels(0, 1e6, 0.1), /Intervalo pequeno/);
  assert.throws(() => contourLevels(0, 1, 0), /maior que zero/);
});

test('contours on inclined plane are straight N-S lines at the exact abscissa', () => {
  const c = buildContours(grid, plane.triangles, {interval: 2.5, majorEvery: 2});
  // convenção z >= nível: a cota mínima exata não gera linha; a máxima coincide com a borda
  assert.deepEqual(c.levels.map(l => l.z), [102.5, 105, 107.5, 110]);
  for (const level of c.levels) {
    assert.equal(level.lines.length, 1, `nível ${level.z} deve ser uma única polilinha`);
    const xs = level.lines[0].coords.map(([x]) => x);
    for (const x of xs) close(x, 320000 + (level.z - 100) * 10, 1e-6);
    const ys = level.lines[0].coords.map(([, y]) => y);
    close(Math.max(...ys) - Math.min(...ys), 100);
  }
  assert.equal(c.levels.find(l => l.z === 105).major, true);
  assert.equal(c.levels.find(l => l.z === 102.5).major, false);
});

test('contour around a peak is a single closed loop', () => {
  const pts = [{x: 0, y: 0, z: 0}, {x: 10, y: 0, z: 0}, {x: 10, y: 10, z: 0}, {x: 0, y: 10, z: 0}, {x: 5, y: 5, z: 10}].map((p, i) => ({...p, id: String(i), description: ''}));
  const c = buildContours(pts, buildSurface(pts).triangles, {interval: 5});
  const level = c.levels.find(l => l.z === 5);
  assert.equal(level.lines.length, 1); assert.equal(level.lines[0].closed, true); assert.equal(level.lines[0].coords.length, 4);
});

test('surface stats: 2D area, 3D area of tilted plane and z range', () => {
  const s = surfaceStats(grid, plane.triangles);
  close(s.area2D, 10000); close(s.area3D, 10000 * Math.hypot(1, 0.1), 1e-6); assert.equal(s.minZ, 100); assert.equal(s.maxZ, 110);
});

test('cut/fill against a plane is exact for a linear surface', () => {
  // z - 105 = 0.1x' - 5 em x' ∈ [0,100]: corte = aterro = 0.5*50*5*100 = 12500
  const r = volumeToPlane(grid, plane.triangles, 105);
  close(r.cut, 12500, 1e-6); close(r.fill, 12500, 1e-6); close(r.net, 0, 1e-6); close(r.areaCut, 5000, 1e-6); close(r.areaFill, 5000, 1e-6);
  const below = volumeToPlane(grid, plane.triangles, 90);
  close(below.cut, 10000 * 15, 1e-6); close(below.fill, 0);
  close(balanceElevation(grid, plane.triangles), 105, 1e-3);
  assert.throws(() => volumeToPlane(grid, plane.triangles, NaN), /referência/);
});

test('vertex exactly on reference elevation is counted in both parts', () => {
  const pts = [{x: 0, y: 0, z: 0}, {x: 1, y: 0, z: -1}, {x: 0, y: 1, z: -1}].map((p, i) => ({...p, id: String(i), description: ''}));
  const r = volumeToPlane(pts, [[0, 1, 2]], 0);
  close(r.fill, 0.5 * (0 + 1 + 1) / 3); close(r.cut, 0);
});

test('profile across the plane samples every TIN edge and interpolates exactly', () => {
  const path = [{x: 320000, y: 7420005}, {x: 320100, y: 7420095}];
  const p = sampleProfile(grid, plane.triangles, path);
  close(p.length, alignmentLength(path)); close(p.length, Math.hypot(100, 90));
  assert.ok(p.samples.length > 20);
  for (const s of p.samples) close(s.z, 100 + (s.x - 320000) / 10, 1e-6);
  for (let i = 1; i < p.samples.length; i++) assert.ok(p.samples[i].station > p.samples[i - 1].station);
  const sum = profileSummary(p); close(sum.minZ, 100); close(sum.maxZ, 110); close(sum.maxGrade, 100 * 10 / Math.hypot(100, 90) / 1, 1e-6);
});

test('profile marks gaps outside the trimmed surface with null elevation', () => {
  const pts = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [.5, .5], [.5, 3], [3, .5]].map(([x, y], i) => ({id: String(i), x, y, z: 10 + x, description: ''}));
  const mesh = buildSurface(pts, [], [0, 1, 2, 3, 4, 5]);
  const p = sampleProfile(pts, mesh.triangles, [{x: 0.5, y: 3.5}, {x: 3.5, y: 0.5}]);
  assert.ok(p.samples.some(s => s.z === null), 'a diagonal atravessa o recorte em L');
  assert.equal(triangleLocator(pts, mesh.triangles)(3, 3), null);
  close(triangleLocator(pts, mesh.triangles)(0.5, 0.5), 10.5);
  assert.throws(() => sampleProfile(pts, mesh.triangles, [{x: 0, y: 0}]), /dois vértices/);
});

test('DXF export is well-formed and contains every requested entity', () => {
  const contours = buildContours(grid, plane.triangles, {interval: 5});
  const profile = sampleProfile(grid, plane.triangles, [{x: 320000, y: 7420005}, {x: 320100, y: 7420005}]);
  const dxf = toDXF({points: grid, triangles: plane.triangles, breaklines: [[0, 1, 2]], boundary: [0, 10, 120, 110], contours, profile});
  const lines = dxf.split('\n'); if (lines.at(-1) === '') lines.pop();
  assert.equal(lines.length % 2, 0);
  for (let i = 0; i < lines.length; i += 2) assert.match(lines[i], /^\d+$/, `código inválido na linha ${i + 1}`);
  const count = e => lines.filter((l, i) => i % 2 === 1 && lines[i - 1] === '0' && l === e).length;
  assert.equal(count('3DFACE'), plane.triangles.length); assert.equal(count('POINT'), grid.length); assert.equal(count('TEXT'), grid.length);
  assert.equal(count('POLYLINE'), 1 + 1 + contours.levels.reduce((s, l) => s + l.lines.length, 0) + 1);
  assert.equal(count('POLYLINE'), count('SEQEND'));
  assert.ok(dxf.includes('TC_CN_MESTRA') && dxf.includes('TC_PT_BD') && dxf.endsWith('0\nEOF\n'));
  assert.ok(dxf.includes('\n7420000\n') && dxf.includes('\n320000\n'), 'coordenadas originais preservadas');
});

test('LandXML lists each used point once, in N E Z order, and faces by id', () => {
  const xml = toLandXML({points: grid, triangles: plane.triangles, boundary: [0, 10, 120, 110]}, {name: 'Teste <A&B>', date: new Date('2026-10-26T12:00:00Z')});
  assert.equal((xml.match(/<P id=/g) || []).length, grid.length);
  assert.equal((xml.match(/<F>/g) || []).length, plane.triangles.length);
  assert.ok(xml.includes('<P id="1">7420000 320000 100</P>'));
  assert.ok(xml.includes('name="Teste &lt;A&amp;B&gt;"') && xml.includes('surfType="TIN"') && xml.includes('bndType="outer"'));
});

test('CSV export round-trips through the importer', () => {
  const pts = [{id: 'A1', x: 1.5, y: 2.25, z: 3.125, description: 'marco; norte'}, {id: 'B', x: 4, y: 5, z: 6, description: ''}, {id: 'C', x: 7, y: 9, z: 1, description: 'TN'}];
  assert.deepEqual(parsePoints(toCSV(pts)).points, pts);
});

test('project v3 keeps alignment and rejects malformed alignment', () => {
  const mesh = buildSurface(grid);
  const project = {version: 3, points: grid, triangles: mesh.triangles, breaklines: [], boundary: [], maxEdge: 0, alignment: [{x: 320000, y: 7420000}, {x: 320050, y: 7420050}]};
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))).alignment, project.alignment);
  assert.throws(() => validateProject({...project, alignment: [{x: 1, y: 'a'}, {x: 2, y: 2}]}), /perfil/);
  assert.deepEqual(validateProject({...project, version: 2, alignment: undefined}).alignment, []);
});
