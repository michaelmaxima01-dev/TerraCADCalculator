// Seções transversais ao longo do traçado: terreno, projeto (plataformas/taludes) e greide.
import {sampleProfile, alignmentLength, profileContext} from './profile.js';

/** Ponto e direção do traçado na estaca s. */
export function pointAtStation(path, s) {
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-12) continue;
    if (s <= acc + len + 1e-9 || i === path.length - 1) {
      const t = Math.max(0, Math.min(1, (s - acc) / len)), tx = (b.x - a.x) / len, ty = (b.y - a.y) / len;
      let dir = {x: tx, y: ty};
      // nos vértices internos usa a bissetriz das duas tangentes
      if (Math.abs(t - 1) < 1e-9 && i < path.length - 1) { const c = path[i + 1], l2 = Math.hypot(c.x - b.x, c.y - b.y) || 1, bx = tx + (c.x - b.x) / l2, by = ty + (c.y - b.y) / l2, l = Math.hypot(bx, by); if (l > 1e-9) dir = {x: bx / l, y: by / l}; }
      return {x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), tx: dir.x, ty: dir.y};
    }
    acc += len;
  }
  return null;
}

export function sectionStations(length, interval, extra = []) {
  if (!(interval > 0)) throw Error('Intervalo das seções deve ser maior que zero.');
  if (length / interval > 5000) throw Error('Intervalo pequeno demais para o traçado (mais de 5.000 seções).');
  const set = new Set();
  for (let s = 0; s < length - 1e-9; s += interval) set.add(Math.round(s * 1e6) / 1e6);
  set.add(Math.round(length * 1e6) / 1e6);
  extra.filter(s => s >= 0 && s <= length).forEach(s => set.add(Math.round(s * 1e6) / 1e6));
  return [...set].sort((a, b) => a - b);
}

/**
 * @param {object} ctx {points, triangles, designAt?(x,y), gradeAt?(s)}
 * @returns {{station, center, left, right, terrain:Array<{offset,z}>, design:Array<{offset,z}>, gradeZ, cutArea, fillArea}}
 * Offsets negativos à esquerda do sentido do traçado.
 */
export function sampleSection(path, station, halfWidth, {points, triangles, designAt, gradeAt, context}, samples = 160) {
  const c = pointAtStation(path, station);
  if (!c) return null;
  const nx = -c.ty, ny = c.tx; // esquerda
  const left = {x: c.x + nx * halfWidth, y: c.y + ny * halfWidth}, right = {x: c.x - nx * halfWidth, y: c.y - ny * halfWidth};
  const prof = sampleProfile(points, triangles, [left, right], context);
  const terrain = prof.samples.map(p => ({offset: p.station - halfWidth, z: p.z}));
  const design = [];
  let cutArea = 0, fillArea = 0;
  if (designAt) {
    const n = Math.max(2, samples), h = 2 * halfWidth / n;
    const tAt = o => { const x = c.x - nx * o, y = c.y - ny * o; return {x, y}; };
    let prevDiff = null;
    for (let k = 0; k <= n; k++) {
      const o = -halfWidth + k * h, {x, y} = tAt(o), z = designAt(x, y);
      design.push({offset: o, z});
      const T = interpolate(terrain, o);
      const diff = z === null || T === null ? null : T - z;
      if (diff !== null && prevDiff !== null) { const m = (diff + prevDiff) / 2; if (m > 0) cutArea += m * h; else fillArea -= m * h; }
      prevDiff = diff;
    }
  }
  return {station, center: {x: c.x, y: c.y}, left, right, terrain, design, gradeZ: gradeAt ? gradeAt(station) : null, cutArea, fillArea};
}

function interpolate(series, o) {
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1], b = series[i];
    if (o >= a.offset - 1e-9 && o <= b.offset + 1e-9) {
      if (a.z === null || b.z === null) return null;
      const t = (o - a.offset) / Math.max(b.offset - a.offset, 1e-12); return a.z + t * (b.z - a.z);
    }
  }
  return null;
}

/** Volume por média das áreas extremas entre seções consecutivas. */
export function averageEndArea(sections) {
  let cut = 0, fill = 0;
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1], b = sections[i], L = b.station - a.station;
    cut += (a.cutArea + b.cutArea) / 2 * L; fill += (a.fillArea + b.fillArea) / 2 * L;
  }
  return {cut, fill};
}

export {alignmentLength, profileContext};
