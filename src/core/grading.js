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

export const BENCH_DEFAULT = Object.freeze({enabled: false, height: 10, width: 5, apply: 'cut'});
const BENCH_APPLY = ['cut', 'fill', 'both'];

/** Bancadas (bermas) do talude: altura vertical entre bermas e largura horizontal da berma. */
export function validateBenches(b) {
  if (b === undefined || b === null) return {...BENCH_DEFAULT};
  if (typeof b !== 'object') throw Error('Configuração de bermas inválida.');
  const height = Number(b.height ?? BENCH_DEFAULT.height), width = Number(b.width ?? BENCH_DEFAULT.width), apply = b.apply ?? BENCH_DEFAULT.apply;
  if (!(height > 0 && height <= 1000)) throw Error('Altura da bancada deve ser maior que zero.');
  if (!(width >= 0 && width <= 1000)) throw Error('Largura da berma não pode ser negativa.');
  if (!BENCH_APPLY.includes(apply)) throw Error('Bermas: escolha corte, aterro ou ambos.');
  return {enabled: !!b.enabled, height, width, apply};
}

export function validatePlatform(p) {
  if (!p || typeof p !== 'object') throw Error('Plataforma inválida.');
  const polygon = validatePolygon(p.polygon);
  const elevation = Number(p.elevation), cutSlope = Number(p.cutSlope), fillSlope = Number(p.fillSlope);
  if (!Number.isFinite(elevation)) throw Error('Cota da plataforma inválida.');
  if (!(cutSlope > 0 && cutSlope <= 100) || !(fillSlope > 0 && fillSlope <= 100)) throw Error('Inclinações dos taludes devem estar entre 0 e 100 (H:V).');
  return {id: String(p.id || ''), name: String(p.name || 'Plataforma'), polygon, elevation, cutSlope, fillSlope, benches: validateBenches(p.benches), visible: p.visible !== false};
}

/** Cota de cada vértice (a cota própria do vértice ou, sem ela, a cota da plataforma). */
export const platformVertexZ = p => p.polygon.map(v => Number.isFinite(v.z) ? v.z : p.elevation);
/** true quando a plataforma tem cotas diferentes entre os vértices (rampa). */
export const isRamp = p => { const z = platformVertexZ(p); return z.some(v => Math.abs(v - z[0]) > 1e-9); };

/** Subida vertical do talude a uma distância horizontal d (com ou sem bancadas). */
export function slopeRise(d, H, bench = null) {
  if (!(d > 0)) return 0;
  if (!bench) return d / H;
  const run = bench.height * H, period = run + bench.width;
  const k = Math.floor(d / period), r = d - k * period;
  return k * bench.height + Math.min(r, run) / H;
}
/** Distância horizontal máxima para vencer um desnível (limite superior, para recortes de busca). */
export function slopeReach(rise, H, bench = null) {
  if (!(rise > 0)) return 0;
  return rise * H + (bench ? Math.ceil(rise / bench.height) * bench.width : 0);
}
/** Distâncias (em planta) das quebras do talude com bancadas: crista da berma e pé da bancada seguinte. */
export function slopeBreaks(H, bench, maxD) {
  if (!bench || !(maxD > 0)) return [];
  const run = bench.height * H, period = run + bench.width, out = [];
  for (let k = 0; k * period < maxD && out.length < 2000; k++) {
    if (k * period + run < maxD) out.push({d: k * period + run, kind: 'crest', k});
    if (bench.width > 0 && (k + 1) * period < maxD) out.push({d: (k + 1) * period, kind: 'toe', k});
  }
  return out;
}
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
  if (terrainZ > zb) { const z = zb + slopeRise(d, platform.cutSlope, c.benchCut); return z < terrainZ ? z : null; }
  if (terrainZ < zb) { const z = zb - slopeRise(d, platform.fillSlope, c.benchFill); return z > terrainZ ? z : null; }
  return null;
}

/** Função de cota de projeto combinando várias plataformas (primeira que cobre o ponto). */
export function designSurfaceFunction(platforms, terrainAt) {
  const list = platforms.filter(p => p.visible !== false);
  return (x, y) => {
    let t;
    for (const p of list) {
      if (t === undefined) t = terrainAt(x, y);
      const z = designElevationAt(p, x, y, t); if (z !== null) return z;
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
  const terrainAt = elevationAt || triangleLocator(points, triangles);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of points) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  let perimeter = 0; for (let i = 0; i < poly.length; i++) perimeter += Math.hypot(poly[(i + 1) % poly.length].x - poly[i].x, poly[(i + 1) % poly.length].y - poly[i].y);
  spacing = spacing > 0 ? spacing : Math.max(perimeter / 240, span / 400, 1e-3);
  maxDistance = maxDistance > 0 ? maxDistance : span * 2;
  const warnings = new Set();
  // 1. Amostras do contorno (com a cota interpolada da borda) + raios (leque nos cantos convexos)
  const base = [], rays = [];
  const n = poly.length;
  const normal = i => { const a = poly[i], b = poly[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y); return {x: (b.y - a.y) / l, y: -(b.x - a.x) / l}; };
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], prev = poly[(i - 1 + n) % n];
    const np = normal((i - 1 + n) % n), nn = normal(i);
    const bi = base.push({x: a.x, y: a.y, z: a.z}) - 1;
    const turn = cross(prev, a, b);
    if (turn > 1e-12) {
      const a0 = Math.atan2(np.y, np.x); let sweep = Math.atan2(nn.y, nn.x) - a0;
      while (sweep <= 0) sweep += 2 * Math.PI; while (sweep > Math.PI) sweep -= 2 * Math.PI;
      const steps = Math.max(1, Math.ceil(sweep / (Math.PI / 12)));
      for (let k = 0; k <= steps; k++) { const ang = a0 + sweep * k / steps; rays.push({base: bi, dx: Math.cos(ang), dy: Math.sin(ang)}); }
    } else if (turn < -1e-12) {
      const bx = np.x + nn.x, by = np.y + nn.y, l = Math.hypot(bx, by) || 1; rays.push({base: bi, dx: bx / l, dy: by / l});
    } else rays.push({base: bi, dx: nn.x, dy: nn.y});
    const len = Math.hypot(b.x - a.x, b.y - a.y), m = Math.max(1, Math.ceil(len / spacing));
    for (let k = 1; k < m; k++) { const t = k / m, j = base.push({x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z)}) - 1; rays.push({base: j, dx: nn.x, dy: nn.y}); }
  }
  // 2. Daylight por raio, com o mesmo modelo usado no volume; vértices nas quebras das bermas
  let maxCut = 0, maxFill = 0;
  const step = spacing / 2;
  const vertices = base.slice(), daylight = [], hatch = [];
  for (const r of rays) {
    const b = base[r.base], T0 = terrainAt(b.x, b.y);
    r.chain = [r.base]; r.mode = 'none'; r.tags = [null];
    if (T0 === null) { warnings.add('Parte do contorno da plataforma está fora do terreno.'); daylight.push(b); continue; }
    if (Math.abs(T0 - b.z) <= 1e-9) { daylight.push(b); continue; }
    const mode = T0 > b.z ? 'cut' : 'fill';
    if (mode === 'cut') maxCut = Math.max(maxCut, T0 - b.z); else maxFill = Math.max(maxFill, b.z - T0);
    const H = mode === 'cut' ? p.cutSlope : p.fillSlope, sign = mode === 'cut' ? 1 : -1, bench = mode === 'cut' ? c.benchCut : c.benchFill;
    const at = t => { const x = b.x + r.dx * t, y = b.y + r.dy * t, T = terrainAt(x, y); if (T === null) return null; const q = c.nearest(x, y), z = q.z + sign * slopeRise(q.d, H, bench); return {x, y, z, f: sign * (T - z), d: q.d}; };
    let lo = 0, prev = {x: b.x, y: b.y, z: b.z, d: 0}, endT = 0, status = 'far';
    for (let t = step; t <= maxDistance + 1e-9; t += step) {
      const cur = at(t);
      if (!cur) { status = 'edge'; endT = lo; break; }
      if (cur.f <= 0) {
        let a = lo, cc = t;
        for (let k = 0; k < 40; k++) { const mid = (a + cc) / 2, v = at(mid); if (v && v.f > 0) a = mid; else cc = mid; }
        prev = at(cc) || cur; endT = cc; status = 'ok'; break;
      }
      lo = t; prev = cur; endT = t;
    }
    if (status === 'edge') warnings.add('Talude atinge o limite da superfície antes de encontrar o terreno.');
    if (status === 'far') warnings.add('Talude não encontrou o terreno dentro da distância máxima.');
    r.mode = mode;
    // quebras das bermas ao longo do raio (d cresce ~linearmente com t)
    const ratio = endT > 0 && prev.d > 0 ? endT / prev.d : 1;
    for (const br of slopeBreaks(H, bench, prev.d - 1e-6)) {
      const v = at(br.d * ratio); if (!v || v.f <= 0) continue;
      r.chain.push(vertices.push({x: v.x, y: v.y, z: v.z}) - 1); r.tags.push(`${br.kind}${br.k}`);
    }
    const end = {x: prev.x, y: prev.y, z: prev.z};
    r.chain.push(vertices.push(end) - 1); r.tags.push('end'); daylight.push(end);
  }
  rays.forEach((r, k) => { if (k % 3 === 0 && r.mode !== 'none') hatch.push([base[r.base], vertices[r.chain.at(-1)], r.mode]); });
  // linhas das bermas (crista e pé), ligando raios consecutivos que têm a mesma quebra
  const benchLines = [];
  if (c.benchCut || c.benchFill) {
    const open = new Map();
    rays.forEach(r => {
      const here = new Set();
      r.tags.forEach((tag, i) => { if (!tag || tag === 'end') return; const key = r.mode + tag; here.add(key); let line = open.get(key); if (!line) { line = []; open.set(key, line); benchLines.push(line); } line.push(vertices[r.chain[i]]); });
      for (const key of [...open.keys()]) if (!here.has(key)) open.delete(key);
    });
    for (let i = benchLines.length - 1; i >= 0; i--) if (benchLines[i].length < 2) benchLines.splice(i, 1);
  }
  // 3. Triangulação: plataforma (CDT restrita ao contorno) + faixas de talude entre raios (costura)
  const tris = [], types = [];
  const o = base[0], loop = base.map((_, i) => [i, (i + 1) % base.length]);
  const flat = cdt2d(base.map(q => [q.x - o.x, q.y - o.y]), loop, {delaunay: true, exterior: false});
  flat.forEach(t => { tris.push(t); types.push('platform'); });
  const area2 = (a, b, cc) => Math.abs(cross(vertices[a], vertices[b], vertices[cc]));
  const typeOf = (r1, r2) => r1.mode === r2.mode ? r1.mode : r1.mode === 'none' ? r2.mode : r2.mode === 'none' ? r1.mode : 'mixed';
  const add = (t, r1, r2) => { if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2] || area2(...t) < 1e-10) return; tris.push(t); types.push(typeOf(r1, r2)); };
  const param = r => { const L = r.chain.length - 1; return r.chain.map((_, i) => L ? i / L : 0); };
  for (let k = 0; k < rays.length; k++) {
    const r1 = rays[k], r2 = rays[(k + 1) % rays.length], A = r1.chain, B = r2.chain, sa = param(r1), sb = param(r2);
    let i = 0, j = 0;
    if (r1.base !== r2.base) { add([A[0], B[0], B[Math.min(1, B.length - 1)]], r1, r2); if (B.length > 1) j = 1; }
    while (i < A.length - 1 || j < B.length - 1) {
      const advA = j >= B.length - 1 || (i < A.length - 1 && sa[i + 1] <= sb[j + 1]);
      if (advA) { add([A[i], B[j], A[i + 1]], r1, r2); i++; } else { add([A[i], B[j], B[j + 1]], r1, r2); j++; }
    }
  }
  return {vertices, triangles: tris, types, daylight, hatch, benchLines, warnings: [...warnings], stats: {maxCut, maxFill, rays: rays.length}};
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
  const reach = Math.max(slopeReach(tmaxZ - c.zMin, p.cutSlope, c.benchCut), slopeReach(c.zMax - tminZ, p.fillSlope, c.benchFill), 0);
  let minX = Math.min(...poly.map(q => q.x)) - reach, maxX = Math.max(...poly.map(q => q.x)) + reach;
  let minY = Math.min(...poly.map(q => q.y)) - reach, maxY = Math.max(...poly.map(q => q.y)) + reach;
  minX = Math.max(minX, tminX); maxX = Math.min(maxX, tmaxX); minY = Math.max(minY, tminY); maxY = Math.min(maxY, tmaxY);
  const out = {cut: 0, fill: 0, net: 0, areaCut: 0, areaFill: 0, footprint: 0, cell: 0, outside: 0};
  if (!(maxX > minX && maxY > minY)) return out;
  let h = cell > 0 ? cell : Math.sqrt((maxX - minX) * (maxY - minY) / maxCells);
  h = Math.max(h, Math.sqrt((maxX - minX) * (maxY - minY) / maxCells));
  const nx = Math.ceil((maxX - minX) / h), ny = Math.ceil((maxY - minY) / h), A = h * h;
  out.cell = h;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const x = minX + (i + .5) * h, y = minY + (j + .5) * h;
    const T = terrainAt(x, y);
    const inside = insidePolygonXY(x, y, poly);
    if (T === null) { if (inside) out.outside += A; continue; }
    const D = designElevationAt(p, x, y, T);
    if (D === null) continue;
    out.footprint += A;
    const diff = T - D;
    if (diff > 0) { out.cut += diff * A; out.areaCut += A; } else if (diff < 0) { out.fill -= diff * A; out.areaFill += A; }
  }
  out.net = out.cut - out.fill;
  return out;
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
