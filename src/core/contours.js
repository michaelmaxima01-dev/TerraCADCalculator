// Curvas de nível por interseção de planos horizontais com a TIN (marching triangles).
// Cada vértice é classificado como "acima" quando z >= nível; assim um vértice exatamente
// na cota não gera segmentos degenerados e triângulos vizinhos produzem a mesma interseção.
import {edgeKey} from './tin.js';

export const MAX_CONTOUR_LEVELS = 2000;

export function contourLevels(minZ, maxZ, interval, base = 0) {
  if (!Number.isFinite(interval) || interval <= 0) throw Error('Intervalo das curvas deve ser maior que zero.');
  if (!Number.isFinite(base)) throw Error('Cota base inválida.');
  if (!Number.isFinite(minZ) || !Number.isFinite(maxZ) || maxZ < minZ) return [];
  const first = Math.ceil((minZ - base) / interval - 1e-9);
  const last = Math.floor((maxZ - base) / interval + 1e-9);
  if (last - first + 1 > MAX_CONTOUR_LEVELS) throw Error(`Intervalo pequeno demais: mais de ${MAX_CONTOUR_LEVELS} curvas. Aumente o intervalo.`);
  const levels = [];
  for (let k = first; k <= last; k++) levels.push({index: k, z: round(base + k * interval)});
  return levels;
}

const round = v => Math.round(v * 1e9) / 1e9;

/**
 * @returns {{interval:number, majorEvery:number, levels:Array<{z:number, major:boolean, lines:Array<{closed:boolean, coords:number[][]}>}>}}
 * coords em coordenadas originais [x, y]; z de cada linha é o nível.
 */
export function buildContours(points, triangles, {interval = 1, majorEvery = 5, base = 0} = {}) {
  if (!Number.isInteger(majorEvery) || majorEvery < 1) throw Error('Curva mestra: informe um inteiro maior ou igual a 1.');
  if (!triangles.length) return {interval, majorEvery, levels: []};
  let minZ = Infinity, maxZ = -Infinity;
  for (const t of triangles) for (const i of t) { const z = points[i].z; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  const levels = contourLevels(minZ, maxZ, interval, base);
  if (!levels.length) return {interval, majorEvery, levels: []};
  const first = levels[0].index;
  // segmentos agrupados por nível: lista de pares de chaves de aresta
  const segments = levels.map(() => []);
  const crossing = levels.map(() => new Map()); // edgeKey -> [x,y]
  for (const t of triangles) {
    const [a, b, c] = t, za = points[a].z, zb = points[b].z, zc = points[c].z;
    const lo = Math.min(za, zb, zc), hi = Math.max(za, zb, zc);
    const from = Math.max(0, Math.ceil((lo - base) / interval - 1e-9) - first);
    const to = Math.min(levels.length - 1, Math.floor((hi - base) / interval + 1e-9) - first);
    for (let li = from; li <= to; li++) {
      const z = levels[li].z, keys = [];
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const above = points[u].z >= z, aboveV = points[v].z >= z;
        if (above === aboveV) continue;
        const key = edgeKey(u, v);
        if (!crossing[li].has(key)) {
          const p = points[u], q = points[v], s = (z - p.z) / (q.z - p.z);
          crossing[li].set(key, [p.x + s * (q.x - p.x), p.y + s * (q.y - p.y)]);
        }
        keys.push(key);
      }
      if (keys.length === 2) segments[li].push(keys);
    }
  }
  return {
    interval, majorEvery,
    levels: levels.map((level, li) => ({
      z: level.z,
      major: ((level.index % majorEvery) + majorEvery) % majorEvery === 0,
      lines: chain(segments[li]).map(line => ({closed: line.closed, coords: line.keys.map(k => crossing[li].get(k))}))
    })).filter(l => l.lines.length)
  };
}

// Une segmentos que compartilham a mesma aresta da TIN em polilinhas abertas ou fechadas.
function chain(segments) {
  const byKey = new Map();
  segments.forEach((s, i) => s.forEach(k => { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(i); }));
  const used = new Uint8Array(segments.length), lines = [];
  const next = (key, from) => (byKey.get(key) || []).find(i => i !== from && !used[i]);
  const walk = (start, key) => { const out = []; let seg = start, k = key; for (;;) { const i = next(k, seg); if (i === undefined) return out; used[i] = 1; const s = segments[i]; k = s[0] === k ? s[1] : s[0]; out.push(k); seg = i; } };
  // começa pelas pontas (chaves com um só segmento) para gerar polilinhas abertas inteiras
  const order = [...segments.keys()].sort((i, j) => degree(segments[i], byKey) - degree(segments[j], byKey));
  for (const i of order) {
    if (used[i]) continue; used[i] = 1;
    const [k0, k1] = segments[i];
    const forward = walk(i, k1), backward = walk(i, k0);
    const keys = [...backward.reverse(), k0, k1, ...forward];
    const closed = keys.length > 3 && keys[0] === keys[keys.length - 1];
    lines.push({closed, keys: closed ? keys.slice(0, -1) : keys});
  }
  return lines;
}
const degree = (s, byKey) => Math.min(byKey.get(s[0]).length, byKey.get(s[1]).length);

/** Simplifica para desenho: contagem total de vértices (útil para limites de UI). */
export function contourVertexCount(contours) {
  return contours.levels.reduce((n, l) => n + l.lines.reduce((m, line) => m + line.coords.length, 0), 0);
}
