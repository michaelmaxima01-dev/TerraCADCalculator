// Perfil longitudinal: amostra a TIN ao longo de uma polilinha em planta.
// As amostras incluem os vértices do traçado e cada cruzamento com arestas da TIN,
// portanto a interpolação linear entre amostras reproduz exatamente a superfície.
import {edgesOf} from './tin.js';

export function validateAlignment(path) {
  if (!Array.isArray(path)) throw Error('Traçado de perfil inválido.');
  if (path.length && path.length < 2) throw Error('O perfil exige pelo menos dois vértices.');
  if (path.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw Error('Traçado de perfil com coordenadas inválidas.');
  return path.map(p => ({x: p.x, y: p.y}));
}

export function alignmentLength(path) {
  let s = 0; for (let i = 1; i < path.length; i++) s += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y); return s;
}

// Índice espacial simples (grade uniforme) para localizar o triângulo sob um ponto.
export function triangleLocator(points, triangles) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const t of triangles) for (const i of t) { const p = points[i]; minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const n = Math.max(1, Math.ceil(Math.sqrt(triangles.length / 2)));
  const w = Math.max(maxX - minX, 1e-9) / n, h = Math.max(maxY - minY, 1e-9) / n, cells = new Map();
  const cell = (x, y) => [Math.min(n - 1, Math.max(0, Math.floor((x - minX) / w))), Math.min(n - 1, Math.max(0, Math.floor((y - minY) / h)))];
  triangles.forEach((t, ti) => {
    const ps = t.map(i => points[i]);
    const [x0, y0] = cell(Math.min(...ps.map(p => p.x)), Math.min(...ps.map(p => p.y)));
    const [x1, y1] = cell(Math.max(...ps.map(p => p.x)), Math.max(...ps.map(p => p.y)));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = x * n + y; if (!cells.has(k)) cells.set(k, []); cells.get(k).push(ti); }
  });
  return function elevationAt(x, y) {
    if (!triangles.length || x < minX - 1e-9 || x > maxX + 1e-9 || y < minY - 1e-9 || y > maxY + 1e-9) return null;
    const [cx, cy] = cell(x, y);
    for (const ti of cells.get(cx * n + cy) || []) {
      const [a, b, c] = triangles[ti].map(i => points[i]);
      const d = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(d) < 1e-15) continue;
      const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / d;
      const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / d;
      const l3 = 1 - l1 - l2, eps = 1e-9;
      if (l1 >= -eps && l2 >= -eps && l3 >= -eps) return l1 * a.z + l2 * b.z + l3 * c.z;
    }
    return null;
  };
}

/**
 * @returns {{length:number, samples:Array<{station:number,x:number,y:number,z:number|null,vertex:boolean}>}}
 * z = null marca trechos fora da superfície (lacunas); o gráfico interrompe a linha nesses pontos.
 */
export function profileContext(points, triangles) { return {elevationAt: triangleLocator(points, triangles), edges: edgesOf(triangles)}; }

export function sampleProfile(points, triangles, path, context = null) {
  path = validateAlignment(path);
  if (path.length < 2) return {length: 0, samples: []};
  const {elevationAt, edges} = context || profileContext(points, triangles);
  const samples = [];
  let base = 0;
  for (let s = 1; s < path.length; s++) {
    const p = path[s - 1], q = path[s], dx = q.x - p.x, dy = q.y - p.y, len = Math.hypot(dx, dy);
    if (len < 1e-12) continue;
    const ts = [0, 1];
    for (const e of edges) {
      const a = points[e.a], b = points[e.b], ex = b.x - a.x, ey = b.y - a.y, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-15) continue;
      const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / den, u = ((a.x - p.x) * dy - (a.y - p.y) * dx) / den;
      if (t > 1e-12 && t < 1 - 1e-12 && u >= -1e-12 && u <= 1 + 1e-12) ts.push(t);
    }
    ts.sort((u, v) => u - v);
    const unique = ts.filter((t, i) => i === 0 || t - ts[i - 1] > 1e-12);
    unique.forEach((t, i) => {
      if (s > 1 && i === 0) return; // vértice compartilhado com o segmento anterior
      if (i > 0) { // detecta lacuna entre duas amostras consecutivas
        const tm = (t + unique[i - 1]) / 2;
        if (elevationAt(p.x + tm * dx, p.y + tm * dy) === null && samples.at(-1)?.z !== null) samples.push({station: base + tm * len, x: p.x + tm * dx, y: p.y + tm * dy, z: null, vertex: false});
      }
      const x = p.x + t * dx, y = p.y + t * dy;
      samples.push({station: base + t * len, x, y, z: elevationAt(x, y), vertex: t === 0 || t === 1});
    });
    base += len;
  }
  return {length: base, samples};
}

/** Resumo de rampas: inclinação máxima (%) entre amostras válidas consecutivas. */
export function profileSummary(profile) {
  const valid = profile.samples.filter(s => s.z !== null);
  if (!valid.length) return {minZ: null, maxZ: null, maxGrade: null};
  let maxGrade = 0;
  for (let i = 1; i < profile.samples.length; i++) {
    const a = profile.samples[i - 1], b = profile.samples[i];
    if (a.z === null || b.z === null || b.station - a.station < 1e-9) continue;
    maxGrade = Math.max(maxGrade, Math.abs((b.z - a.z) / (b.station - a.station)) * 100);
  }
  return {minZ: Math.min(...valid.map(s => s.z)), maxZ: Math.max(...valid.map(s => s.z)), maxGrade};
}
