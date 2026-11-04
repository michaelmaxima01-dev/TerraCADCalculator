// Plataformas com taludes de corte e aterro (terraplenagem).
// Modelo de distância: dentro do polígono a superfície de projeto é a própria plataforma — plana ou,
// com cotas por vértice, uma rampa (TIN dos vértices). Fora dela, com d = distância ao polígono e
// Zb = cota da borda no ponto mais próximo:
//   corte (terreno acima de Zb):  z = Zb + subida(d, Hc)     (Hc = razão horizontal:vertical do corte)
//   aterro (terreno abaixo de Zb): z = Zb − subida(d, Hf)
// subida(d, H) = d / H sem bancadas; com bancadas de altura h e berma de largura w, o talude sobe h
// em h·H de distância horizontal e então anda w na horizontal (berma), repetindo.
// O talude termina onde encontra o terreno (linha de offset / "daylight"). O modelo é contínuo, não
// sobrepõe taludes em cantos reentrantes e gera cantos convexos arredondados.
import cdt2d from 'cdt2d';
import {triangleLocator} from './profile.js';
import {BENCH_DEFAULT, validateBenches, slopeRise, slopeReach, slopeBreaks, castSlopes, gridVolumes, meshDefaults, validateEnd, checkBenchEnd, depthDesign} from './slopes.js';
export {BENCH_DEFAULT, validateBenches, slopeRise, slopeReach, slopeBreaks};
import {compileLine, lineElevationAt} from './lineGrading.js';

const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
export function signedArea(poly) { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; } return s / 2; }

export function insidePolygonXY(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distanceToPolygon(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy); if (d < best) best = d;
  }
  return best;
}

export function validatePolygon(poly) {
  if (!Array.isArray(poly) || poly.length < 3) throw Error('A plataforma exige pelo menos três vértices.');
  if (poly.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw Error('Plataforma com coordenadas inválidas.');
  if (poly.some(p => p.z !== undefined && p.z !== null && !Number.isFinite(p.z))) throw Error('Cota de vértice da plataforma inválida.');
  for (let i = 0; i < poly.length; i++) if (Math.hypot(poly[i].x - poly[(i + 1) % poly.length].x, poly[i].y - poly[(i + 1) % poly.length].y) < 1e-9) throw Error('A plataforma tem vértices repetidos.');
  if (Math.abs(signedArea(poly)) < 1e-9) throw Error('Plataforma sem área.');
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const a = poly[i], b = poly[(i + 1) % n], c = poly[j], d = poly[(j + 1) % n];
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) throw Error('O polígono da plataforma cruza a si mesmo.');
  }
  return poly.map(p => Number.isFinite(p.z) ? {x: p.x, y: p.y, z: p.z} : {x: p.x, y: p.y});
}

export function validatePlatform(p) {
  if (!p || typeof p !== 'object') throw Error('Plataforma inválida.');
  const polygon = validatePolygon(p.polygon);
  const elevation = Number(p.elevation), cutSlope = Number(p.cutSlope), fillSlope = Number(p.fillSlope);
  if (!Number.isFinite(elevation)) throw Error('Cota da plataforma inválida.');
  if (!(cutSlope > 0 && cutSlope <= 100) || !(fillSlope > 0 && fillSlope <= 100)) throw Error('Inclinações dos taludes devem estar entre 0 e 100 (H:V).');
  const benches = validateBenches(p.benches), end = validateEnd(p.end);
  checkBenchEnd(benches, end);
  return {id: String(p.id || ''), name: String(p.name || 'Plataforma'), polygon, elevation, cutSlope, fillSlope, benches, end, visible: p.visible !== false};
}

/** Cota de cada vértice (a cota própria do vértice ou, sem ela, a cota da plataforma). */
export const platformVertexZ = p => p.polygon.map(v => Number.isFinite(v.z) ? v.z : p.elevation);
/** true quando a plataforma tem cotas diferentes entre os vértices (rampa). */
export const isRamp = p => { const z = platformVertexZ(p); return z.some(v => Math.abs(v - z[0]) > 1e-9); };

const benchFor = (p, mode) => p.benches?.enabled && (p.benches.apply === 'both' || p.benches.apply === mode) ? p.benches : null;

// Geometria pré-calculada da plataforma (cache por objeto)
const compiled = new WeakMap();
function compile(p) {
  let c = compiled.get(p); if (c) return c;
  const poly = p.polygon, zs = platformVertexZ(p), n = poly.length, flat = zs.every(z => Math.abs(z - zs[0]) < 1e-12);
  let tris = null;
  if (!flat) {
    const o = poly[0];
    tris = cdt2d(poly.map(q => [q.x - o.x, q.y - o.y]), poly.map((_, i) => [i, (i + 1) % n]), {delaunay: true, exterior: false});
  }
  const nearest = (x, y) => {
    let best = Infinity, bz = zs[0];
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
      if (d < best) { best = d; bz = zs[i] + t * (zs[(i + 1) % n] - zs[i]); }
    }
    return {d: best, z: bz};
  };
  const interior = (x, y) => {
    if (flat) return zs[0];
    for (const [i, j, k] of tris) {
      const a = poly[i], b = poly[j], q = poly[k], det = (b.y - q.y) * (a.x - q.x) + (q.x - b.x) * (a.y - q.y);
      if (Math.abs(det) < 1e-18) continue;
      const l1 = ((b.y - q.y) * (x - q.x) + (q.x - b.x) * (y - q.y)) / det, l2 = ((q.y - a.y) * (x - q.x) + (a.x - q.x) * (y - q.y)) / det, l3 = 1 - l1 - l2;
      if (l1 >= -1e-9 && l2 >= -1e-9 && l3 >= -1e-9) return l1 * zs[i] + l2 * zs[j] + l3 * zs[k];
    }
    return nearest(x, y).z;
  };
  c = {poly, zs, flat, tris, nearest, interior, benchCut: benchFor(p, 'cut'), benchFill: benchFor(p, 'fill'), zMin: Math.min(...zs), zMax: Math.max(...zs)};
  compiled.set(p, c); return c;
}

/** Cota de projeto em (x,y) para uma plataforma; null quando fora da área terraplenada. */
export function designElevationAt(platform, x, y, terrainZ) {
  const c = compile(platform);
  if (insidePolygonXY(x, y, c.poly)) return c.interior(x, y);
  if (terrainZ === null || terrainZ === undefined) return null;
  const {d, z: zb} = c.nearest(x, y);
  if (platform.end?.mode === 'depth') return depthDesign(zb, d, platform.cutSlope, c.benchCut, platform.end, terrainZ);
  if (terrainZ > zb) { const z = zb + slopeRise(d, platform.cutSlope, c.benchCut); return z < terrainZ ? z : null; }
  if (terrainZ < zb) { const z = zb - slopeRise(d, platform.fillSlope, c.benchFill); return z > terrainZ ? z : null; }
  return null;
}

/** Função de cota de projeto: plataformas e depois linhas de projeto (vale a primeira que cobre o ponto). */
export function designSurfaceFunction(platforms, terrainAt, lines = []) {
  const list = platforms.filter(p => p.visible !== false), ls = lines.filter(l => l.visible !== false).map(l => ({l, info: compileLine(l, terrainAt)}));
  return (x, y) => {
    let t;
    for (const p of list) {
      if (t === undefined) t = terrainAt(x, y);
      const z = designElevationAt(p, x, y, t); if (z !== null) return z;
    }
    for (const {l, info} of ls) {
      if (t === undefined) t = terrainAt(x, y);
      const z = lineElevationAt(l, info, x, y, t); if (z !== null) return z;
    }
    return null;
  };
}

/** Desloca toda a plataforma (cota e cotas dos vértices) por dz, preservando a rampa. */
export function shiftPlatform(p, dz) {
  return {...p, elevation: p.elevation + dz, polygon: p.polygon.map(v => Number.isFinite(v.z) ? {...v, z: v.z + dz} : {...v})};
}
/** Remove a rampa: todos os vértices voltam à cota da plataforma. */
export const flattenPlatform = p => ({...p, polygon: p.polygon.map(({x, y}) => ({x, y}))});
/**
 * Rampa plana: a cota da plataforma vale no centroide e o caimento (%) desce na direção do azimute
 * (graus, a partir do norte, sentido horário). z = cota − caimento/100 · ((v − centroide) · direção).
 */
export function applyPlaneSlope(p, {slope, azimuth}) {
  if (!Number.isFinite(slope) || !Number.isFinite(azimuth)) throw Error('Informe caimento (%) e direção (°) válidos.');
  const n = p.polygon.length, cx = p.polygon.reduce((s, v) => s + v.x, 0) / n, cy = p.polygon.reduce((s, v) => s + v.y, 0) / n;
  const a = azimuth * Math.PI / 180, ux = Math.sin(a), uy = Math.cos(a);
  return {...p, polygon: p.polygon.map(v => ({x: v.x, y: v.y, z: p.elevation - slope / 100 * ((v.x - cx) * ux + (v.y - cy) * uy)}))};
}

function ccwWithZ(poly, zs) {
  const pts = poly.map((v, i) => ({x: v.x, y: v.y, z: zs[i]}));
  return signedArea(poly) < 0 ? pts.reverse() : pts;
}

/**
 * Gera a malha de projeto (plataforma + taludes, com bermas quando ativas) para visualização e exportação.
 * @returns {{vertices:Array<{x,y,z}>, triangles:number[][], types:string[], daylight:Array<{x,y,z}>, hatch:Array, benchLines:Array<Array<{x,y,z}>>, warnings:string[], stats:{maxCut:number,maxFill:number,rays:number}}}
 */
export function gradePlatform(points, triangles, platform, {spacing, maxDistance, elevationAt} = {}) {
  const p = validatePlatform(platform), c = compile(p), poly = ccwWithZ(p.polygon, c.zs);
  let perimeter = 0; for (let i = 0; i < poly.length; i++) perimeter += Math.hypot(poly[(i + 1) % poly.length].x - poly[i].x, poly[(i + 1) % poly.length].y - poly[i].y);
  const d = meshDefaults(points, perimeter);
  return castSlopes(poly, {closed: true, side: 'outside', terrainAt: elevationAt || triangleLocator(points, triangles), nearest: c.nearest,
    ruleFor: mode => mode === 'cut' ? {H: p.cutSlope, bench: c.benchCut} : {H: p.fillSlope, bench: c.benchFill},
    depth: p.end.mode === 'depth' ? {end: p.end, H: p.cutSlope, bench: c.benchCut} : null,
    spacing: spacing > 0 ? spacing : d.spacing, maxDistance: maxDistance > 0 ? maxDistance : d.maxDistance});
}

/**
 * Volumes de terraplenagem pelo modelo de distância, integrados em grade regular.
 * @returns {{cut:number, fill:number, net:number, areaCut:number, areaFill:number, footprint:number, cell:number}}
 */
export function platformVolumes(points, triangles, platform, {cell, maxCells = 250000, elevationAt} = {}) {
  const p = validatePlatform(platform), c = compile(p), poly = p.polygon;
  const terrainAt = elevationAt || triangleLocator(points, triangles);
  let tminX = Infinity, tminY = Infinity, tmaxX = -Infinity, tmaxY = -Infinity, tminZ = Infinity, tmaxZ = -Infinity;
  for (const t of triangles) for (const i of t) { const q = points[i]; tminX = Math.min(tminX, q.x); tmaxX = Math.max(tmaxX, q.x); tminY = Math.min(tminY, q.y); tmaxY = Math.max(tmaxY, q.y); tminZ = Math.min(tminZ, q.z); tmaxZ = Math.max(tmaxZ, q.z); }
  // extensão máxima possível dos taludes
  // no término por profundidade o fundo segue até o terreno: integra no terreno todo
  const reach = p.end.mode === 'depth' ? Infinity : Math.max(slopeReach(tmaxZ - c.zMin, p.cutSlope, c.benchCut), slopeReach(c.zMax - tminZ, p.fillSlope, c.benchFill), 0);
  let minX = Math.min(...poly.map(q => q.x)) - reach, maxX = Math.max(...poly.map(q => q.x)) + reach;
  let minY = Math.min(...poly.map(q => q.y)) - reach, maxY = Math.max(...poly.map(q => q.y)) + reach;
  minX = Math.max(minX, tminX); maxX = Math.min(maxX, tmaxX); minY = Math.max(minY, tminY); maxY = Math.min(maxY, tmaxY);
  return gridVolumes((x, y, T) => designElevationAt(p, x, y, T), terrainAt, {minX, minY, maxX, maxY}, {cell, maxCells, inside: (x, y) => insidePolygonXY(x, y, poly)});
}

/** Cota média do terreno dentro do polígono (sugestão inicial da plataforma). */
export function meanTerrainInside(points, triangles, polygon, elevationAt) {
  const at = elevationAt || triangleLocator(points, triangles);
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  let sum = 0, n = 0; const N = 40;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = minX + (i + .5) / N * (maxX - minX), y = minY + (j + .5) / N * (maxY - minY);
    if (!insidePolygonXY(x, y, polygon)) continue; const z = at(x, y); if (z !== null) { sum += z; n++; }
  }
  return n ? sum / n : null;
}

/**
 * Terreno para exibição junto do projeto: remove as partes cobertas pela terraplenagem.
 * Triângulos parcialmente cobertos são subdivididos (até `depth` níveis) e só as partes
 * descobertas permanecem. As cotas novas vêm da própria face (interpolação linear exata).
 * @param {(x:number,y:number)=>boolean} covered
 * @returns {{vertices:Array<{x,y,z}>, triangles:number[][]}}
 */
export function clipTerrainMesh(points, triangles, covered, {bounds = [], minEdge = 0, maxDepth = 10} = {}) {
  const vertices = points.map(p => ({x: p.x, y: p.y, z: p.z})), keyMap = new Map(), out = [];
  const flag = points.map(p => covered(p.x, p.y));
  const vid = (x, y, z) => { const k = `${x.toFixed(6)}:${y.toFixed(6)}`; let i = keyMap.get(k); if (i === undefined) { i = vertices.push({x, y, z}) - 1; keyMap.set(k, i); } return i; };
  const mid = (a, b) => { const p = vertices[a], q = vertices[b]; return vid((p.x + q.x) / 2, (p.y + q.y) / 2, (p.z + q.z) / 2); };
  const cache = new Map();
  const cov = i => { if (i < flag.length) return flag[i]; let v = cache.get(i); if (v === undefined) { v = covered(vertices[i].x, vertices[i].y); cache.set(i, v); } return v; };
  const touches = (vs) => {
    const minX = Math.min(...vs.map(v => v.x)), maxX = Math.max(...vs.map(v => v.x)), minY = Math.min(...vs.map(v => v.y)), maxY = Math.max(...vs.map(v => v.y));
    return bounds.some(b => b.minX <= maxX && b.maxX >= minX && b.minY <= maxY && b.maxY >= minY);
  };
  function visit(t, level) {
    const vs = t.map(i => vertices[i]), c = t.map(cov);
    if (!c.some(Boolean) && !touches(vs)) { out.push(t); return; }
    if (c.every(Boolean)) { // inteiramente coberto se também os pontos médios e o centróide estiverem
      const probe = [[0, 1], [1, 2], [2, 0]].every(([i, j]) => covered((vs[i].x + vs[j].x) / 2, (vs[i].y + vs[j].y) / 2)) && covered((vs[0].x + vs[1].x + vs[2].x) / 3, (vs[0].y + vs[1].y + vs[2].y) / 3);
      if (probe) return;
    }
    const longest = Math.max(Math.hypot(vs[0].x - vs[1].x, vs[0].y - vs[1].y), Math.hypot(vs[1].x - vs[2].x, vs[1].y - vs[2].y), Math.hypot(vs[2].x - vs[0].x, vs[2].y - vs[0].y));
    if (level >= maxDepth || longest <= minEdge) {
      if (!covered((vs[0].x + vs[1].x + vs[2].x) / 3, (vs[0].y + vs[1].y + vs[2].y) / 3)) out.push(t);
      return;
    }
    const [a, b, d] = t, ab = mid(a, b), bd = mid(b, d), da = mid(d, a);
    visit([a, ab, da], level + 1); visit([ab, b, bd], level + 1); visit([da, bd, d], level + 1); visit([ab, bd, da], level + 1);
  }
  for (const t of triangles) visit(t, 0);
  return {vertices: vertices.map(({x, y, z}) => ({x, y, z})), triangles: out};
}
