// Terraplenagem do projeto inteiro: uma única superfície combinada (designSurfaceFunction) integrada contra o
// terreno. Objetos que se sobrepõem não são contados duas vezes; cada objeto continua com o próprio volume.
import {designSurfaceFunction} from './grading.js';
import {compileLine, lineRefine} from './lineGrading.js';
import {corridorElevationAt, corridorBase, corridorRefine} from './corridor.js';
import {gridVolumes} from './slopes.js';

/**
 * @param {Array<{kind:'platform'|'line'|'corridor', platform?, line?, info?, mesh}>} designs objetos calculados (com malha)
 * @returns {{cut, fill, footprint, outside, cells, sum:{cut,fill}, overlap:boolean}} sum = soma simples dos objetos
 */
export function projectEarthworks(designs, {terrainAt, gradeCtx = null, maxCells = 250000, cell, volumes = [], bbox = null} = {}) {
  const list = designs.filter(d => bbox ? (d.platform || d.line || d.info?.ok) : d.mesh && d.mesh.vertices.length);
  if (!list.length) return null;
  const platforms = list.filter(d => d.kind === 'platform').map(d => d.platform), lines = list.filter(d => d.kind === 'line').map(d => d.line);
  const corridors = list.filter(d => d.kind === 'corridor' && d.info?.ok);
  const designAt = designSurfaceFunction(platforms, terrainAt, lines, gradeCtx, corridors.map(d => ({kind: 'road', at: (x, y, T) => corridorElevationAt(d.info, x, y, T), base: corridorBase(d.info)})));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  if (bbox) ({minX, minY, maxX, maxY} = bbox);
  else for (const d of list) for (const v of d.mesh.vertices) { if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x; if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; }
  const pad = bbox ? 0 : Math.max(maxX - minX, maxY - minY) * 0.01;
  const refines = [...lines.map(l => lineRefine(l, compileLine(l, terrainAt, gradeCtx))), ...corridors.map(d => corridorRefine(d.info))];
  const v = gridVolumes(designAt, terrainAt, {minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad}, {cell, maxCells, refine: refines.length ? (x, y, h) => refines.some(f => f(x, y, h)) : null});
  const sum = volumes.filter(Boolean).reduce((s, q) => ({cut: s.cut + q.cut, fill: s.fill + q.fill}), {cut: 0, fill: 0});
  const overlap = volumes.length > 1 && Math.abs(sum.cut + sum.fill - v.cut - v.fill) > Math.max(1, 0.01 * (v.cut + v.fill));
  return {...v, sum, overlap};
}

/**
 * Malha da superfície final (projeto onde há projeto, terreno no resto) amostrada em grade, para o 3D.
 * É a mesma superfície das seções e dos volumes: objetos sobrepostos aparecem já combinados, sem taludes
 * atravessando pistas ou pisos. Células sem nenhum nó de projeto ficam de fora (o terreno aparece ali).
 * @returns {{vertices:Array<{x,y,z}>, triangles:number[][], types:string[], cell:number}} types: base ('platform', 'road'…), 'cut', 'fill'
 */
export function finalSurfaceMesh(designAt, terrainAt, bbox, {cell, maxCells = 90000} = {}) {
  const w = bbox.maxX - bbox.minX, h = bbox.maxY - bbox.minY;
  if (!(w > 0 && h > 0)) return {vertices: [], triangles: [], types: [], cell: 0};
  const c = Math.max(cell || 0, Math.sqrt(w * h / maxCells)), nx = Math.max(1, Math.ceil(w / c)), ny = Math.max(1, Math.ceil(h / c));
  const dx = w / nx, dy = h / ny, N = (nx + 1) * (ny + 1), Z = new Float64Array(N), D = new Uint8Array(N), T = new Float64Array(N), K = new Array(N).fill(null);
  const ev = designAt.evaluate || ((x, y, t) => ({z: designAt(x, y, t), kind: designAt.classify?.(x, y, t) ?? null}));
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const k = j * (nx + 1) + i, x = bbox.minX + i * dx, y = bbox.minY + j * dy, t = terrainAt(x, y), r = ev(x, y, t);
    T[k] = t ?? NaN; K[k] = r.kind;
    if (r.z !== null && r.z !== undefined) { Z[k] = r.z; D[k] = 1; } else Z[k] = t ?? NaN;
  }
  const vertices = [], triangles = [], types = [], index = new Int32Array(N).fill(-1);
  const vid = k => { if (index[k] < 0) { const i = k % (nx + 1), j = (k / (nx + 1)) | 0; index[k] = vertices.push({x: bbox.minX + i * dx, y: bbox.minY + j * dy, z: Z[k]}) - 1; } return index[k]; };
  // tipo do triângulo pelos nós: base quando a maioria dos nós é da mesma base; senão corte/aterro (horizontal = berma/fundo)
  const kind = ([p, q, r]) => {
    const kp = K[p], kq = K[q], kr = K[r];
    if (kp && kp === kq && kp === kr) return kp;
    const z = (Z[p] + Z[q] + Z[r]) / 3, tv = [p, q, r].map(k => Number.isFinite(T[k]) ? T[k] : Z[k]), tz = (tv[0] + tv[1] + tv[2]) / 3;
    const flat = Math.max(Z[p], Z[q], Z[r]) - Math.min(Z[p], Z[q], Z[r]) < 1e-3;
    return z < tz - 1e-3 ? (flat ? 'floor' : 'cut') : z > tz + 1e-3 ? (flat ? 'floor' : 'fill') : 'none';
  };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
    if (!(D[a] | D[b] | D[d] | D[e])) continue; // só terreno: fica com a malha do terreno
    if (!(Number.isFinite(Z[a]) && Number.isFinite(Z[b]) && Number.isFinite(Z[d]) && Number.isFinite(Z[e]))) continue; // fora do levantamento
    for (const t of [[a, b, e], [a, e, d]]) { if (!(D[t[0]] | D[t[1]] | D[t[2]])) continue; triangles.push(t.map(vid)); types.push(kind(t)); }
  }
  return {vertices, triangles, types, cell: Math.max(dx, dy)};
}

/**
 * Recorta as linhas de desenho (offsets, hachuras, bermas, bordos) ao que está de fato na superfície final:
 * o trecho de um talude encoberto por outro objeto (ex.: a volta vizinha de um acesso em espiral) some.
 * @returns {(pts:Array<{x,y,z}>) => Array<Array<{x,y,z}>>} trechos visíveis da polilinha
 */
export function finalSurfaceFilter(designAt, terrainAt, tol = 0.05) {
  const on = v => { const t = terrainAt(v.x, v.y), z = designAt(v.x, v.y, t) ?? t; return z === null || z === undefined || Math.abs(z - v.z) <= tol; };
  return pts => {
    const runs = []; let run = [];
    for (const v of pts) { if (on(v)) run.push(v); else { if (run.length > 1) runs.push(run); run = []; } }
    if (run.length > 1) runs.push(run);
    return runs;
  };
}
