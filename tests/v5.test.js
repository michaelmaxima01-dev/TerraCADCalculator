import test from 'node:test';
import assert from 'node:assert/strict';
import {slopeRise, slopeReach, slopeBreaks, validatePlatform, validateBenches, designElevationAt, platformVolumes, gradePlatform, shiftPlatform, applyPlaneSlope, flattenPlatform, platformVertexZ, isRamp} from '../src/core/grading.js';
import {buildSurface, validateProject} from '../src/core/surface.js';

const close = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} ${a} ≠ ${b} (±${eps})`);
/** Terreno: plano z = f(x,y) amostrado em grade (TIN exata para planos). */
function planeTerrain(f, {min = -120, max = 160, step = 20} = {}) {
  const points = [];
  for (let x = min; x <= max; x += step) for (let y = min; y <= max; y += step) points.push({id: `T${points.length}`, x, y, z: f(x, y), description: 'TN'});
  return {points, triangles: buildSurface(points).triangles};
}
const square = (L = 40) => [{x: 0, y: 0}, {x: L, y: 0}, {x: L, y: L}, {x: 0, y: L}];

test('slopeRise: talude com bancadas sobe h em h·H e anda w na berma', () => {
  const b = {height: 10, width: 5};
  assert.equal(slopeRise(10, 1, b), 10);  // crista da 1ª bancada
  assert.equal(slopeRise(12, 1, b), 10);  // sobre a berma
  assert.equal(slopeRise(15, 1, b), 10);  // pé da 2ª bancada
  assert.equal(slopeRise(20, 1, b), 15);
  assert.equal(slopeRise(40, 1, b), 30);
  assert.equal(slopeRise(30, 1.5, null), 20); // sem bancadas: d/H
  assert.equal(slopeReach(30, 1, b), 30 + 3 * 5);
  assert.deepEqual(slopeBreaks(1, b, 31).map(q => [q.d, q.kind]), [[10, 'crest'], [15, 'toe'], [25, 'crest'], [30, 'toe']]);
});

test('validateBenches e compatibilidade: plataforma v4 ganha bermas desligadas', () => {
  const p = validatePlatform({polygon: square(), elevation: 100, cutSlope: 1, fillSlope: 1.5});
  assert.deepEqual(p.benches, {enabled: false, height: 10, width: 5, apply: 'cut'});
  assert.throws(() => validateBenches({height: 0}), /Altura/);
  assert.throws(() => validateBenches({width: -1}), /Largura/);
  assert.throws(() => validateBenches({apply: 'x'}), /corte, aterro/);
});

test('volume de corte com bermas = prisma + ∫(T − Zp − subida)(P + 2πd) dd (Pappus, quadrado)', () => {
  const T = 130, Zp = 100, L = 40, benches = {enabled: true, height: 10, width: 5, apply: 'cut'};
  const {points, triangles} = planeTerrain(() => T);
  const v = platformVolumes(points, triangles, {polygon: square(L), elevation: Zp, cutSlope: 1, fillSlope: 1.5, benches}, {maxCells: 400000});
  // integral exata (numérica fina) do modelo de distância
  const P = 4 * L; let outside = 0; const n = 200000, D = 40;
  for (let i = 0; i < n; i++) { const d = (i + .5) * D / n, h = T - Zp - slopeRise(d, 1, benches); if (h > 0) outside += h * (P + 2 * Math.PI * d) * D / n; }
  const expected = L * L * (T - Zp) + outside;
  close(v.cut, expected, expected * 0.004, 'corte');
  assert.ok(v.fill < 1e-6);
  // sem bermas o volume é menor (talude contínuo 1:1)
  const plain = platformVolumes(points, triangles, {polygon: square(L), elevation: Zp, cutSlope: 1, fillSlope: 1.5}, {maxCells: 400000});
  assert.ok(v.cut > plain.cut * 1.1, 'bermas aumentam o corte');
});

test('bermas só no corte não alteram o aterro', () => {
  const {points, triangles} = planeTerrain(() => 90);
  const base = {polygon: square(), elevation: 100, cutSlope: 1, fillSlope: 1.5};
  const a = platformVolumes(points, triangles, base), b = platformVolumes(points, triangles, {...base, benches: {enabled: true, height: 3, width: 4, apply: 'cut'}});
  close(b.fill, a.fill, 1e-6);
  const c = platformVolumes(points, triangles, {...base, benches: {enabled: true, height: 3, width: 4, apply: 'fill'}});
  assert.ok(c.fill > a.fill * 1.05, 'bermas no aterro aumentam o aterro');
});

test('malha com bermas: cristas na cota Zp + k·h, linhas de berma e offset no terreno', () => {
  const T = 125, Zp = 100;
  const {points, triangles} = planeTerrain(() => T);
  const m = gradePlatform(points, triangles, {polygon: square(), elevation: Zp, cutSlope: 1, fillSlope: 1.5, benches: {enabled: true, height: 10, width: 5, apply: 'cut'}});
  assert.ok(m.benchLines.length >= 4, `linhas de berma: ${m.benchLines.length}`);
  const zs = new Set(m.benchLines.flatMap(l => l.map(v => Math.round(v.z * 1000) / 1000)));
  assert.deepEqual([...zs].sort((a, b) => a - b), [110, 120]);
  m.daylight.forEach(v => close(v.z, T, 1e-3, 'offset'));
  assert.ok(m.triangles.every(t => t.every(i => Number.isFinite(m.vertices[i].z))));
  assert.equal(m.triangles.length, m.types.length);
  assert.ok(m.types.filter(t => t === 'cut').length > m.types.filter(t => t === 'platform').length);
});

test('rampa: applyPlaneSlope gera plano exato; interior e malha seguem o plano', () => {
  const p0 = validatePlatform({polygon: [{x: 0, y: 0}, {x: 40, y: 0}, {x: 40, y: 20}, {x: 0, y: 20}], elevation: 100, cutSlope: 1, fillSlope: 1.5});
  const p = validatePlatform(applyPlaneSlope(p0, {slope: 5, azimuth: 90})); // desce 5% para leste
  const plane = (x) => 100 - 0.05 * (x - 20);
  assert.deepEqual(platformVertexZ(p), [101, 99, 99, 101]);
  assert.ok(isRamp(p)); assert.equal(isRamp(p0), false);
  for (const [x, y] of [[5, 5], [20, 10], [33, 17], [39.9, 0.1]]) close(designElevationAt(p, x, y, 0), plane(x), 1e-9, `interior ${x},${y}`);
  // continuidade na borda: fora, d → 0 leva a cota à da borda
  close(designElevationAt(p, 40.001, 10, 200), plane(40), 0.01, 'borda');
  const {points, triangles} = planeTerrain((x) => plane(x) + 2);
  const m = gradePlatform(points, triangles, p);
  m.triangles.forEach((t, k) => { if (m.types[k] === 'platform') t.forEach(i => close(m.vertices[i].z, plane(m.vertices[i].x), 1e-9, 'malha')); });
});

test('rampa: corte = área × desnível quando o terreno é o plano da rampa + 2 m (talude íngreme)', () => {
  const plane = (x) => 100 - 0.05 * (x - 20);
  const p = applyPlaneSlope({polygon: [{x: 0, y: 0}, {x: 40, y: 0}, {x: 40, y: 20}, {x: 0, y: 20}], elevation: 100, cutSlope: 0.05, fillSlope: 0.05}, {slope: 5, azimuth: 90});
  const {points, triangles} = planeTerrain((x) => plane(x) + 2);
  const v = platformVolumes(points, triangles, p, {maxCells: 400000});
  // prisma 800 m² × 2 m + taludes estreitos (≈ perímetro × 2 × 0,1 / 2 = 12 m³)
  assert.ok(v.cut > 1600 && v.cut < 1630, `corte ${v.cut}`);
  assert.ok(v.fill < 1, `aterro ${v.fill}`);
});

test('shiftPlatform preserva a rampa; flattenPlatform remove', () => {
  const p = applyPlaneSlope({polygon: square(10), elevation: 50, cutSlope: 1, fillSlope: 1}, {slope: 10, azimuth: 0});
  const s = shiftPlatform(p, 2.5);
  assert.deepEqual(platformVertexZ(s), platformVertexZ(p).map(z => z + 2.5));
  assert.equal(s.elevation, 52.5);
  assert.deepEqual(platformVertexZ(flattenPlatform(s)), [52.5, 52.5, 52.5, 52.5]);
});

test('validateProject abre v5 com rampa e bermas e continua abrindo v4', () => {
  const pts = [[0, 0], [100, 0], [100, 100], [0, 100], [50, 50]].map(([x, y], i) => ({id: 'P' + i, x, y, z: 10 + i, description: ''}));
  const tri = buildSurface(pts).triangles;
  const platform = {id: 'a', name: 'Rampa', polygon: [{x: 10, y: 10, z: 11}, {x: 30, y: 10, z: 12}, {x: 30, y: 30}], elevation: 11.5, cutSlope: 1, fillSlope: 1.5, benches: {enabled: true, height: 5, width: 3, apply: 'both'}};
  const r = validateProject({version: 5, points: pts, triangles: tri, platforms: [platform]});
  assert.deepEqual(r.platforms[0].polygon[0], {x: 10, y: 10, z: 11});
  assert.deepEqual(r.platforms[0].polygon[2], {x: 30, y: 30});
  assert.equal(r.platforms[0].benches.apply, 'both');
  const r4 = validateProject({version: 4, points: pts, triangles: tri, platforms: [{...platform, polygon: platform.polygon.map(({x, y}) => ({x, y})), benches: undefined}]});
  assert.equal(r4.platforms[0].benches.enabled, false);
  assert.throws(() => validateProject({version: 7, points: pts, triangles: tri}), /Versão/);
});
