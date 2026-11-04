// Linhas obrigatórias livres: o traçado não precisa passar por pontos existentes.
// O traçado é "assentado" na TIN atual: cada vértice e (opcionalmente) cada cruzamento com
// arestas da malha recebe a cota interpolada e vira ponto do levantamento. A retriangulação
// restrita então honra a linha sem alterar a forma do terreno ao longo dela (concordância).
import {sampleProfile} from './profile.js';

/**
 * @param {Array} points pontos do levantamento
 * @param {Array} triangles TIN atual
 * @param {Array<{index:number}|{x:number,y:number,z?:number}>} items vértices: índice de ponto ou coordenada livre
 * @param {{densify?:boolean, prefix?:string, description?:string, tolerance?:number}} options
 * @returns {{points:Array, indices:number[], added:number}}
 */
export function drapeBreakline(points, triangles, items, {densify = true, prefix = 'RL', description = 'RUPTURA', tolerance = 1e-6} = {}) {
  if (!Array.isArray(items) || items.length < 2) throw Error('A linha obrigatória exige pelo menos dois vértices.');
  const path = items.map(it => {
    if (Number.isInteger(it.index)) { if (!points[it.index]) throw Error('Vértice de ruptura inválido.'); return {...points[it.index], index: it.index}; }
    if (!Number.isFinite(it.x) || !Number.isFinite(it.y)) throw Error('Vértice de ruptura com coordenadas inválidas.');
    return {x: it.x, y: it.y, z: Number.isFinite(it.z) ? it.z : undefined};
  });
  const next = points.slice(), indices = [];
  const ids = new Set(points.map(p => p.id));
  let serial = 1;
  const newId = () => { let id; do id = `${prefix}${String(serial++).padStart(3, '0')}`; while (ids.has(id)); ids.add(id); return id; };
  // índice espacial simples para reaproveitar pontos coincidentes
  const byXY = new Map(points.map((p, i) => [`${Math.round(p.x / tolerance)}:${Math.round(p.y / tolerance)}`, i]));
  const findExisting = (x, y) => {
    const kx = Math.round(x / tolerance), ky = Math.round(y / tolerance);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const i = byXY.get(`${kx + dx}:${ky + dy}`); if (i !== undefined && Math.hypot(next[i].x - x, next[i].y - y) <= tolerance) return i; }
    return undefined;
  };
  const push = (x, y, z) => {
    let i = findExisting(x, y);
    if (i === undefined) {
      if (!Number.isFinite(z)) throw Error(`Trecho da linha fora da superfície (E ${x.toFixed(3)} N ${y.toFixed(3)}). Ajuste o traçado ou informe pontos com cota.`);
      i = next.length; next.push({id: newId(), x, y, z, description});
      byXY.set(`${Math.round(x / tolerance)}:${Math.round(y / tolerance)}`, i);
    }
    if (indices.at(-1) !== i) indices.push(i);
  };
  for (let s = 1; s < path.length; s++) {
    const a = path[s - 1], b = path[s];
    if (Math.hypot(b.x - a.x, b.y - a.y) < tolerance) continue;
    const prof = sampleProfile(points, triangles, [a, b]);
    const samples = densify ? prof.samples.filter(p => p.z !== null || p.vertex) : prof.samples.filter(p => p.vertex);
    samples.forEach((p, k) => {
      const isStart = k === 0, isEnd = k === samples.length - 1;
      if (s > 1 && isStart) return;
      const vertex = isStart ? a : isEnd ? b : null;
      if (vertex?.index !== undefined) { if (indices.at(-1) !== vertex.index) indices.push(vertex.index); return; }
      const z = vertex && Number.isFinite(vertex.z) ? vertex.z : p.z;
      push(p.x, p.y, z === null ? NaN : z);
    });
  }
  if (indices.length < 2) throw Error('A linha obrigatória precisa de dois vértices distintos.');
  return {points: next, indices, added: next.length - points.length};
}
