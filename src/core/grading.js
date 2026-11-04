// Plataformas com taludes de corte e aterro (terraplenagem).
// Modelo: plataforma horizontal na cota Zp limitada por um polígono simples. Fora dela, a
// superfície de projeto é definida pela distância d ao polígono:
//   corte (terreno acima de Zp):  z = Zp + d / Hc     (Hc = razão horizontal:vertical do corte)
//   aterro (terreno abaixo de Zp): z = Zp - d / Hf
// O talude termina onde encontra o terreno (linha de offset / "daylight"). Esse modelo é
// contínuo, não sobrepõe taludes em cantos reentrantes e gera cantos convexos arredondados.
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
  for (let i = 0; i < poly.length; i++) if (Math.hypot(poly[i].x - poly[(i + 1) % poly.length].x, poly[i].y - poly[(i + 1) % poly.length].y) < 1e-9) throw Error('A plataforma tem vértices repetidos.');
  if (Math.abs(signedArea(poly)) < 1e-9) throw Error('Plataforma sem área.');
  const n = poly.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const a = poly[i], b = poly[(i + 1) % n], c = poly[j], d = poly[(j + 1) % n];
    if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) throw Error('O polígono da plataforma cruza a si mesmo.');
  }
  return poly.map(p => ({x: p.x, y: p.y}));
}

export function validatePlatform(p) {
  if (!p || typeof p !== 'object') throw Error('Plataforma inválida.');
  const polygon = validatePolygon(p.polygon);
  const elevation = Number(p.elevation), cutSlope = Number(p.cutSlope), fillSlope = Number(p.fillSlope);
  if (!Number.isFinite(elevation)) throw Error('Cota da plataforma inválida.');
  if (!(cutSlope > 0 && cutSlope <= 100) || !(fillSlope > 0 && fillSlope <= 100)) throw Error('Inclinações dos taludes devem estar entre 0 e 100 (H:V).');
  return {id: String(p.id || ''), name: String(p.name || 'Plataforma'), polygon, elevation, cutSlope, fillSlope, visible: p.visible !== false};
}

/** Cota de projeto em (x,y) para uma plataforma; null quando fora da área terraplenada. */
export function designElevationAt(platform, x, y, terrainZ) {
  const {polygon, elevation: zp, cutSlope, fillSlope} = platform;
  if (insidePolygonXY(x, y, polygon)) return zp;
  if (terrainZ === null || terrainZ === undefined) return null;
  const d = distanceToPolygon(x, y, polygon);
  if (terrainZ > zp) { const z = zp + d / cutSlope; return z < terrainZ ? z : null; }
  if (terrainZ < zp) { const z = zp - d / fillSlope; return z > terrainZ ? z : null; }
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

function ccw(poly) { return signedArea(poly) < 0 ? poly.slice().reverse() : poly.slice(); }

/**
 * Gera a malha de projeto (plataforma + taludes) para visualização e exportação.
 * @returns {{vertices:Array<{x,y,z}>, triangles:number[][], types:string[], daylight:Array<{x,y,z}>, hatch:Array<[{x,y,z},{x,y,z}]>, warnings:string[], stats:{maxCut:number,maxFill:number}}}
 */
export function gradePlatform(points, triangles, platform, {spacing, maxDistance, elevationAt} = {}) {
  const p = validatePlatform(platform), poly = ccw(p.polygon), zp = p.elevation;
  const terrainAt = elevationAt || triangleLocator(points, triangles);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of points) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  let perimeter = 0; for (let i = 0; i < poly.length; i++) perimeter += Math.hypot(poly[(i + 1) % poly.length].x - poly[i].x, poly[(i + 1) % poly.length].y - poly[i].y);
  spacing = spacing > 0 ? spacing : Math.max(perimeter / 240, span / 400, 1e-3);
  maxDistance = maxDistance > 0 ? maxDistance : span * 2;
  const warnings = new Set();
  // 1. Amostras do contorno + raios (leque nos cantos convexos)
  const base = [], rays = [];
  const n = poly.length;
  const normal = i => { const a = poly[i], b = poly[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y); return {x: (b.y - a.y) / l, y: -(b.x - a.x) / l}; };
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], prev = poly[(i - 1 + n) % n];
    const np = normal((i - 1 + n) % n), nn = normal(i);
    const bi = base.push({x: a.x, y: a.y, z: zp}) - 1;
    const turn = cross(prev, a, b);
    if (turn > 1e-12) { // canto convexo: leque de np até nn
      const a0 = Math.atan2(np.y, np.x); let sweep = Math.atan2(nn.y, nn.x) - a0;
      while (sweep <= 0) sweep += 2 * Math.PI; while (sweep > Math.PI) sweep -= 2 * Math.PI;
      const steps = Math.max(1, Math.ceil(sweep / (Math.PI / 12)));
      for (let k = 0; k <= steps; k++) { const ang = a0 + sweep * k / steps; rays.push({base: bi, dx: Math.cos(ang), dy: Math.sin(ang)}); }
    } else if (turn < -1e-12) { // canto reentrante: bissetriz
      const bx = np.x + nn.x, by = np.y + nn.y, l = Math.hypot(bx, by) || 1; rays.push({base: bi, dx: bx / l, dy: by / l});
    } else rays.push({base: bi, dx: nn.x, dy: nn.y});
    const len = Math.hypot(b.x - a.x, b.y - a.y), m = Math.max(1, Math.ceil(len / spacing));
    for (let k = 1; k < m; k++) { const t = k / m, j = base.push({x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: zp}) - 1; rays.push({base: j, dx: nn.x, dy: nn.y}); }
  }
  // 2. Daylight por raio, usando o mesmo modelo de distância que o cálculo de volume
  let maxCut = 0, maxFill = 0;
  const step = spacing / 2;
  const vertices = base.slice(), daylight = [], hatch = [];
  for (const r of rays) {
    const b = base[r.base], T0 = terrainAt(b.x, b.y);
    let end = {x: b.x, y: b.y, z: zp}, mode = 'none';
    if (T0 === null) warnings.add('Parte do contorno da plataforma está fora do terreno.');
    else if (Math.abs(T0 - zp) > 1e-9) {
      mode = T0 > zp ? 'cut' : 'fill';
      if (mode === 'cut') maxCut = Math.max(maxCut, T0 - zp); else maxFill = Math.max(maxFill, zp - T0);
      const H = mode === 'cut' ? p.cutSlope : p.fillSlope, sign = mode === 'cut' ? 1 : -1;
      const at = t => { const x = b.x + r.dx * t, y = b.y + r.dy * t, T = terrainAt(x, y); if (T === null) return null; const z = zp + sign * distanceToPolygon(x, y, poly) / H; return {x, y, z, f: sign * (T - z)}; };
      let lo = 0, prev = {x: b.x, y: b.y, z: zp}, status = 'far';
      for (let t = step; t <= maxDistance + 1e-9; t += step) {
        const cur = at(t);
        if (!cur) { status = 'edge'; break; }
        if (cur.f <= 0) {
          let a = lo, c = t;
          for (let k = 0; k < 40; k++) { const mid = (a + c) / 2, v = at(mid); if (v && v.f > 0) a = mid; else c = mid; }
          prev = at(c) || cur; status = 'ok'; break;
        }
        lo = t; prev = cur;
      }
      if (status === 'edge') warnings.add('Talude atinge o limite da superfície antes de encontrar o terreno.');
      if (status === 'far') warnings.add('Talude não encontrou o terreno dentro da distância máxima.');
      end = {x: prev.x, y: prev.y, z: prev.z};
    }
    r.end = vertices.push(end) - 1; r.mode = mode; daylight.push(end);
  }
  rays.forEach((r, k) => { if (k % 3 === 0 && r.mode !== 'none') hatch.push([base[r.base], vertices[r.end], r.mode]); });
  // 3. Triangulação: plataforma (CDT restrita ao contorno) + faixas de talude entre raios
  const tris = [], types = [];
  const o = base[0], loop = base.map((_, i) => [i, (i + 1) % base.length]);
  const flat = cdt2d(base.map(q => [q.x - o.x, q.y - o.y]), loop, {delaunay: true, exterior: false});
  flat.forEach(t => { tris.push(t); types.push('platform'); });
  const area2 = (a, b, c) => Math.abs(cross(vertices[a], vertices[b], vertices[c]));
  const add = (t, r1, r2) => { if (area2(...t) < 1e-10) return; tris.push(t); types.push(r1.mode === r2.mode ? r1.mode : r1.mode === 'none' ? r2.mode : r2.mode === 'none' ? r1.mode : 'mixed'); };
  for (let k = 0; k < rays.length; k++) {
    const r1 = rays[k], r2 = rays[(k + 1) % rays.length];
    if (r1.base === r2.base) add([r1.base, r1.end, r2.end], r1, r2);
    else { add([r1.base, r2.base, r2.end], r1, r2); add([r1.base, r2.end, r1.end], r1, r2); }
  }
  return {vertices, triangles: tris, types, daylight, hatch, warnings: [...warnings], stats: {maxCut, maxFill, rays: rays.length}};
}

/**
 * Volumes de terraplenagem pelo modelo de distância, integrados em grade regular.
 * @returns {{cut:number, fill:number, net:number, areaCut:number, areaFill:number, footprint:number, cell:number}}
 */
export function platformVolumes(points, triangles, platform, {cell, maxCells = 250000, elevationAt} = {}) {
  const p = validatePlatform(platform), poly = p.polygon, zp = p.elevation;
  const terrainAt = elevationAt || triangleLocator(points, triangles);
  let tminX = Infinity, tminY = Infinity, tmaxX = -Infinity, tmaxY = -Infinity, tminZ = Infinity, tmaxZ = -Infinity;
  for (const t of triangles) for (const i of t) { const q = points[i]; tminX = Math.min(tminX, q.x); tmaxX = Math.max(tmaxX, q.x); tminY = Math.min(tminY, q.y); tmaxY = Math.max(tmaxY, q.y); tminZ = Math.min(tminZ, q.z); tmaxZ = Math.max(tmaxZ, q.z); }
  // extensão máxima possível dos taludes
  const reach = Math.max((tmaxZ - zp) * p.cutSlope, (zp - tminZ) * p.fillSlope, 0);
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
