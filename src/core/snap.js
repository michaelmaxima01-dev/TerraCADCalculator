// Motor de atração (snap) em coordenadas do mundo, com índice em grade.
// Prioridade semelhante a CAD: nó/vértice > ponto médio > mais próximo, dentro da abertura.

const KINDS = ['node', 'vertex', 'midpoint', 'nearest'];
export const SNAP_LABELS = {node: 'Nó', vertex: 'Vértice', midpoint: 'Ponto médio', nearest: 'Mais próximo'};

/**
 * @param {{nodes?:Array<{x,y,ref?}>, vertices?:Array<{x,y,ref?}>, segments?:Array<{a:{x,y},b:{x,y},ref?}>}} data
 */
export function createSnapIndex({nodes = [], vertices = [], segments = []} = {}) {
  const items = [];
  nodes.forEach(n => items.push({kind: 'node', x: n.x, y: n.y, ref: n.ref}));
  vertices.forEach(v => items.push({kind: 'vertex', x: v.x, y: v.y, ref: v.ref}));
  segments.forEach(s => items.push({kind: 'midpoint', x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2, ref: s.ref}));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; };
  items.forEach(p => grow(p.x, p.y)); segments.forEach(s => { grow(s.a.x, s.a.y); grow(s.b.x, s.b.y); });
  if (!Number.isFinite(minX)) return {query: () => null, size: 0};
  const count = items.length + segments.length;
  const cell = Math.max(Math.max(maxX - minX, maxY - minY, 1e-6) / Math.max(1, Math.sqrt(count)), 1e-6);
  const key = (i, j) => i * 73856093 ^ j * 19349663;
  const pts = new Map(), segs = new Map();
  const ci = x => Math.floor((x - minX) / cell), cj = y => Math.floor((y - minY) / cell);
  const add = (map, k, v) => { let l = map.get(k); if (!l) map.set(k, l = []); l.push(v); };
  items.forEach(p => add(pts, key(ci(p.x), cj(p.y)), p));
  segments.forEach(s => {
    const i0 = ci(Math.min(s.a.x, s.b.x)), i1 = ci(Math.max(s.a.x, s.b.x)), j0 = cj(Math.min(s.a.y, s.b.y)), j1 = cj(Math.max(s.a.y, s.b.y));
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) { add(segs, 'long', s); return; }
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) add(segs, key(i, j), s);
  });
  function query(x, y, radius, modes = {node: true, vertex: true, midpoint: true, nearest: true}) {
    if (!(radius > 0)) return null;
    const i0 = ci(x - radius), i1 = ci(x + radius), j0 = cj(y - radius), j1 = cj(y + radius);
    const cells = (i1 - i0 + 1) * (j1 - j0 + 1);
    const best = {};
    const consider = (kind, px, py, ref, d) => { if (d <= radius && (!best[kind] || d < best[kind].d)) best[kind] = {kind, x: px, y: py, ref, d}; };
    const scanPoint = p => { if (modes[p.kind]) consider(p.kind, p.x, p.y, p.ref, Math.hypot(p.x - x, p.y - y)); };
    const seen = new Set();
    const scanSeg = s => {
      if (!modes.nearest || seen.has(s)) return; seen.add(s);
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, t = Math.max(0, Math.min(1, ((x - s.a.x) * dx + (y - s.a.y) * dy) / (dx * dx + dy * dy || 1)));
      const px = s.a.x + t * dx, py = s.a.y + t * dy; consider('nearest', px, py, s.ref, Math.hypot(px - x, py - y));
    };
    if (cells > 2500) { items.forEach(scanPoint); segments.forEach(scanSeg); }
    else for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { (pts.get(key(i, j)) || []).forEach(scanPoint); (segs.get(key(i, j)) || []).forEach(scanSeg); }
    (segs.get('long') || []).forEach(scanSeg);
    const strong = [best.node, best.vertex].filter(Boolean).sort((a, b) => a.d - b.d)[0];
    return strong || best.midpoint || best.nearest || null;
  }
  return {query, size: count};
}

export {KINDS as SNAP_KINDS};
