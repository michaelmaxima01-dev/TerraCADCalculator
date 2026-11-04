// Taludes, malha e volumes a partir de uma linha de projeto (mesmo modelo de distância das plataformas).
// Linha aberta: talude para o lado escolhido (ou ambos), pontas retas. Linha fechada para fora: equivale a
// uma plataforma com os vértices da base. Linha fechada para dentro: talude do contorno para o interior.
import {buildLineBase, lineNearest} from './designLine.js';
import {castSlopes, gridVolumes, slopeRise, slopeReach, meshDefaults} from './slopes.js';
import {signedArea, insidePolygonXY, designElevationAt, gradePlatform, platformVolumes} from './grading.js';
import {triangleLocator} from './profile.js';

const cache = new WeakMap();
const benchFor = (l, mode) => l.benches?.enabled && (l.benches.apply === 'both' || l.benches.apply === mode) ? l.benches : null;

/** Geometria pronta da linha (base, estacas, curvas), com cache por linha e função de terreno. */
export function compileLine(line, terrainAt) {
  const hit = cache.get(line);
  if (hit && hit.terrainAt === terrainAt) return hit.info;
  const info = buildLineBase(line, terrainAt);
  if (line.closed && info.base.length > 2 && signedArea(info.base) < 0) info.ccw = info.base.slice().reverse(); else info.ccw = info.base;
  if (line.closed && line.side === 'outside' && info.base.length > 2) {
    info.platform = {id: line.id, name: line.name, polygon: info.ccw.map(v => ({x: v.x, y: v.y, z: v.z})), elevation: info.ccw[0].z, cutSlope: line.cutSlope, fillSlope: line.fillSlope, benches: line.benches, visible: true};
  }
  cache.set(line, {terrainAt, info});
  return info;
}

/** Cota de projeto da linha em (x,y) com terreno T; null fora da terraplenagem. */
export function lineElevationAt(line, info, x, y, T) {
  if (info.platform) return designElevationAt(info.platform, x, y, T);
  if (info.base.length < 2) return null;
  if (line.closed && !insidePolygonXY(x, y, info.base)) return null; // 'inside': só o interior
  const q = lineNearest(info, x, y);
  if (!line.closed && (q.atEnd || (line.side !== 'both' && q.side !== line.side))) return null;
  if (q.d < 1e-12) return q.z;
  if (T === null || T === undefined) return null;
  if (T > q.z) { const z = q.z + slopeRise(q.d, line.cutSlope, benchFor(line, 'cut')); return z < T ? z : null; }
  if (T < q.z) { const z = q.z - slopeRise(q.d, line.fillSlope, benchFor(line, 'fill')); return z > T ? z : null; }
  return null;
}

const emptyMesh = warnings => ({vertices: [], triangles: [], types: [], daylight: [], hatch: [], benchLines: [], warnings, stats: {maxCut: 0, maxFill: 0, rays: 0}});

/** Malha de projeto da linha (mesmo formato de castSlopes, com base e curvas). */
export function gradeLine(points, triangles, line, {elevationAt, spacing, maxDistance} = {}) {
  const terrainAt = elevationAt || triangleLocator(points, triangles), info = compileLine(line, terrainAt);
  if (info.base.length < 2) return {...emptyMesh(info.warnings), base: [], curves: info.curves, piStations: info.piStations, piZ: info.piZ, length: 0, daylightRuns: []};
  let mesh;
  if (info.platform) mesh = gradePlatform(points, triangles, info.platform, {spacing, maxDistance, elevationAt: terrainAt});
  else {
    const d = meshDefaults(points, info.length), opts = {closed: line.closed, terrainAt, nearest: (x, y) => { const q = lineNearest(info, x, y); return {d: q.d, z: q.z}; },
      ruleFor: mode => mode === 'cut' ? {H: line.cutSlope, bench: benchFor(line, 'cut')} : {H: line.fillSlope, bench: benchFor(line, 'fill')},
      spacing: spacing > 0 ? spacing : d.spacing, maxDistance: maxDistance > 0 ? maxDistance : d.maxDistance};
    const sides = line.closed ? ['inside'] : line.side === 'both' ? ['left', 'right'] : [line.side];
    mesh = emptyMesh([]); mesh.daylightRuns = [];
    for (const side of sides) {
      const m = castSlopes(line.closed ? info.ccw : info.base, {...opts, side}), off = mesh.vertices.length;
      mesh.vertices.push(...m.vertices); m.triangles.forEach(t => mesh.triangles.push(t.map(i => i + off))); mesh.types.push(...m.types);
      mesh.daylight.push(...m.daylight); mesh.daylightRuns.push(m.daylight); mesh.hatch.push(...m.hatch); mesh.benchLines.push(...m.benchLines); mesh.warnings.push(...m.warnings);
      mesh.stats.maxCut = Math.max(mesh.stats.maxCut, m.stats.maxCut); mesh.stats.maxFill = Math.max(mesh.stats.maxFill, m.stats.maxFill); mesh.stats.rays += m.stats.rays;
    }
    mesh.warnings = [...new Set(mesh.warnings)];
    // linha aberta de um lado só: parede vertical entre a base e o terreno do outro lado (só desenho)
    if (!line.closed && line.side !== 'both') {
      for (let i = 1; i < info.base.length; i++) {
        const a = info.base[i - 1], b = info.base[i], ta = terrainAt(a.x, a.y), tb = terrainAt(b.x, b.y);
        if (ta === null || tb === null || (Math.abs(ta - a.z) < 1e-6 && Math.abs(tb - b.z) < 1e-6)) continue;
        const k = mesh.vertices.push({...a}, {...b}, {x: b.x, y: b.y, z: tb}, {x: a.x, y: a.y, z: ta}) - 4;
        mesh.triangles.push([k, k + 1, k + 2], [k, k + 2, k + 3]); mesh.types.push('wall', 'wall');
      }
    }
  }
  return {...mesh, warnings: [...new Set([...info.warnings, ...mesh.warnings])], base: info.base, curves: info.curves, piStations: info.piStations, piZ: info.piZ, length: info.length, daylightRuns: mesh.daylightRuns || [mesh.daylight]};
}

/** Volumes de corte e aterro da linha, integrados em grade. */
export function lineVolumes(points, triangles, line, {cell, maxCells = 250000, elevationAt} = {}) {
  const terrainAt = elevationAt || triangleLocator(points, triangles), info = compileLine(line, terrainAt);
  if (info.platform) return platformVolumes(points, triangles, info.platform, {cell, maxCells, elevationAt: terrainAt});
  if (info.base.length < 2) return gridVolumes(() => null, terrainAt, {minX: 0, minY: 0, maxX: 0, maxY: 0});
  let tminX = Infinity, tminY = Infinity, tmaxX = -Infinity, tmaxY = -Infinity, tminZ = Infinity, tmaxZ = -Infinity;
  for (const t of triangles) for (const i of t) { const q = points[i]; if (q.x < tminX) tminX = q.x; if (q.x > tmaxX) tmaxX = q.x; if (q.y < tminY) tminY = q.y; if (q.y > tmaxY) tmaxY = q.y; if (q.z < tminZ) tminZ = q.z; if (q.z > tmaxZ) tmaxZ = q.z; }
  const zs = info.base.map(v => v.z), zMin = Math.min(...zs), zMax = Math.max(...zs);
  const reach = Math.max(slopeReach(tmaxZ - zMin, line.cutSlope, benchFor(line, 'cut')), slopeReach(zMax - tminZ, line.fillSlope, benchFor(line, 'fill')), 0);
  const xs = info.base.map(v => v.x), ys = info.base.map(v => v.y);
  const bbox = {minX: Math.max(Math.min(...xs) - reach, tminX), maxX: Math.min(Math.max(...xs) + reach, tmaxX), minY: Math.max(Math.min(...ys) - reach, tminY), maxY: Math.min(Math.max(...ys) + reach, tmaxY)};
  return gridVolumes((x, y, T) => lineElevationAt(line, info, x, y, T), terrainAt, bbox, {cell, maxCells, inside: line.closed ? (x, y) => insidePolygonXY(x, y, info.base) : null,
    // a linha aberta corta o projeto de forma brusca (no eixo e nas pontas): subamostrar essas células
    refine: (x, y, h) => { const q = lineNearest(info, x, y); return q.d < h || (!line.closed && (q.s < h || q.s > info.length - h)); }});
}
