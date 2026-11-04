// Linha de projeto: PIs editáveis, curvas de canto com raio, estaqueamento e cota da linha.
// A geometria daqui alimenta os taludes (lineGrading.js): a "base" é a polilinha 3D já com os arcos
// discretizados e a estaca s (comprimento 2D acumulado) em cada vértice.
import {validateBenches} from './slopes.js';

const ELEV_MODES = ['ramp', 'pis', 'terrain'], OPEN_SIDES = ['left', 'right', 'both'], CLOSED_SIDES = ['outside', 'inside'], END_MODES = ['terrain', 'depth'];
const MAX_SAGITTA = 0.02, MAX_STEP = 3 * Math.PI / 180;
const num = (v, d) => v === undefined || v === null || v === '' ? d : Number(v);
const fmt = v => Number(v).toLocaleString('pt-BR', {maximumFractionDigits: 2});
const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Normaliza e valida uma linha de projeto (lança Error com a orientação em português). */
export function validateDesignLine(l) {
  if (!l || typeof l !== 'object') throw Error('Linha de projeto inválida.');
  const closed = !!l.closed;
  if (!Array.isArray(l.pis) || l.pis.length < (closed ? 3 : 2)) throw Error(`A linha exige pelo menos ${closed ? 3 : 2} PIs${closed ? ' para ser fechada' : ''}.`);
  const pis = l.pis.map((p, i) => {
    if (!p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.y))) throw Error(`PI ${i + 1} com coordenadas inválidas.`);
    const q = {x: Number(p.x), y: Number(p.y)};
    if (p.z !== undefined && p.z !== null && p.z !== '') { if (!Number.isFinite(Number(p.z))) throw Error(`Cota inválida no PI ${i + 1}.`); q.z = Number(p.z); }
    if (p.radius !== undefined && p.radius !== null && p.radius !== '' && Number(p.radius) !== 0) { if (!(Number(p.radius) > 0)) throw Error(`Raio inválido no PI ${i + 1}: use um valor maior que zero.`); q.radius = Number(p.radius); }
    return q;
  });
  const n = pis.length, segs = closed ? n : n - 1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.hypot(pis[i].x - pis[j].x, pis[i].y - pis[j].y) < 1e-6) throw Error(`PIs repetidos (${i + 1} e ${j + 1}). Remova um deles.`);
  for (let i = 0; i < segs; i++) for (let j = i + 2; j < segs; j++) {
    if (closed && i === 0 && j === segs - 1) continue;
    if (segmentsCross(pis[i], pis[(i + 1) % n], pis[j], pis[(j + 1) % n])) throw Error('A linha cruza a si mesma. Mova os PIs para desfazer o cruzamento.');
  }
  const e = l.elevation || {}, mode = e.mode ?? 'ramp';
  if (!ELEV_MODES.includes(mode)) throw Error('Modo de cota da linha inválido.');
  const elevation = {mode, start: num(e.start, 0), slope: num(e.slope, 0), drop: num(e.drop, 0)};
  if (![elevation.start, elevation.slope, elevation.drop].every(Number.isFinite)) throw Error('Cota, rampa e desnível da linha devem ser números.');
  const side = l.side ?? (closed ? 'outside' : 'right');
  if (!(closed ? CLOSED_SIDES : OPEN_SIDES).includes(side)) throw Error(closed ? 'Linha fechada: o talude vai para fora ou para dentro.' : 'Linha aberta: o talude vai para a esquerda, a direita ou os dois lados.');
  const cutSlope = num(l.cutSlope, 1), fillSlope = num(l.fillSlope, 1.5);
  if (!(cutSlope > 0 && cutSlope <= 100) || !(fillSlope > 0 && fillSlope <= 100)) throw Error('Inclinações dos taludes devem estar entre 0 e 100 (H:V).');
  const en = l.end || {}, endMode = en.mode ?? 'terrain';
  if (!END_MODES.includes(endMode)) throw Error('Término do talude inválido.');
  const end = {mode: endMode, depth: num(en.depth, 8), floorZ: en.floorZ === undefined || en.floorZ === '' ? null : en.floorZ === null ? null : Number(en.floorZ)};
  if (!(end.depth > 0)) throw Error('A profundidade deve ser maior que zero.');
  if (end.floorZ !== null && !Number.isFinite(end.floorZ)) throw Error('Cota final inválida.');
  return {id: String(l.id || ''), name: String(l.name || 'Linha'), visible: l.visible !== false, closed, pis, elevation, side, cutSlope, fillSlope, benches: validateBenches(l.benches), end};
}

/**
 * Polilinha de base da linha: arcos discretizados (flecha ≤ 2 cm, passo ≤ 3°), estaca e cota em cada vértice.
 * @param {object} line linha validada
 * @param {(x,y)=>number|null} [terrainAt] necessário no modo de cota 'terrain'
 * @returns {{base:Array<{x,y,z,s}>, length:number, closed:boolean, curves:Array<{pi,radius,clamped,T,arcLength}>, warnings:string[], piStations:number[], piZ:number[]}}
 */
export function buildLineBase(line, terrainAt = null) {
  const {pis, closed, elevation} = line, n = pis.length, warnings = [], curves = [];
  // cota em cada PI
  let piZ = null;
  if (elevation.mode === 'pis') piZ = pis.map((p, i) => { if (Number.isFinite(p.z)) return p.z; warnings.push(`PI ${i + 1} sem cota: usada a cota inicial.`); return elevation.start; });
  else if (elevation.mode === 'terrain') {
    piZ = pis.map(p => terrainAt ? terrainAt(p.x, p.y) : null);
    const out = piZ.map((z, i) => z === null || z === undefined ? i + 1 : 0).filter(Boolean);
    if (out.length) return {base: [], length: 0, closed, curves, warnings: out.map(i => `PI ${i} fora da superfície: mova-o para dentro do terreno.`), piStations: pis.map(() => 0), piZ: pis.map(() => NaN)};
    piZ = piZ.map(z => z - elevation.drop);
  }
  // vértices com curvas de canto
  const pts = [], anchors = [];
  for (let i = 0; i < n; i++) {
    const p = pis[i], hasNeighbors = closed || (i > 0 && i < n - 1), R0 = p.radius || 0;
    if (!hasNeighbors || !(R0 > 0)) { pts.push({x: p.x, y: p.y, anchor: i}); continue; }
    const a = pis[(i - 1 + n) % n], b = pis[(i + 1) % n];
    const l1 = Math.hypot(p.x - a.x, p.y - a.y), l2 = Math.hypot(b.x - p.x, b.y - p.y);
    const u1 = {x: (p.x - a.x) / l1, y: (p.y - a.y) / l1}, u2 = {x: (b.x - p.x) / l2, y: (b.y - p.y) / l2};
    const delta = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y))), tanH = Math.tan(delta / 2);
    if (!(delta > 1e-6) || !Number.isFinite(tanH)) { pts.push({x: p.x, y: p.y, anchor: i}); continue; }
    let R = R0, T = R * tanH, clamped = false;
    const maxT = Math.min(l1, l2) / 2;
    if (T > maxT) { T = maxT; R = T / tanH; clamped = true; warnings.push(`Raio limitado a ${fmt(R)} m no PI ${i + 1} (não cabe entre os PIs vizinhos).`); }
    if (!(R > 1e-9)) { pts.push({x: p.x, y: p.y, anchor: i}); continue; }
    const turn = Math.sign(cross2(u1.x, u1.y, u2.x, u2.y));
    const tc = {x: p.x - u1.x * T, y: p.y - u1.y * T}, nx = -u1.y * turn, ny = u1.x * turn, c = {x: tc.x + nx * R, y: tc.y + ny * R};
    const a0 = Math.atan2(tc.y - c.y, tc.x - c.x), stepMax = Math.min(MAX_STEP, MAX_SAGITTA >= R ? Math.PI : 2 * Math.acos(1 - MAX_SAGITTA / R));
    const steps = Math.max(1, Math.ceil(delta / stepMax)), mid = steps / 2;
    for (let k = 0; k <= steps; k++) {
      const ang = a0 + turn * delta * k / steps;
      pts.push({x: c.x + R * Math.cos(ang), y: c.y + R * Math.sin(ang), anchor: k === mid ? i : undefined, arcMid: Number.isInteger(mid) ? undefined : (k === Math.floor(mid) ? i : undefined)});
    }
    curves.push({pi: i, radius: R, clamped, T, arcLength: R * delta, center: c});
  }
  // estacas
  let s = 0;
  const base = pts.map((p, k) => { if (k) s += Math.hypot(p.x - pts[k - 1].x, p.y - pts[k - 1].y); return {x: p.x, y: p.y, z: 0, s}; });
  const length = closed ? s + Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y) : s;
  // âncoras de cota (PI sem curva: o próprio PI; com curva: o meio do arco)
  pts.forEach((p, k) => {
    if (p.anchor !== undefined) anchors.push({s: base[k].s, i: p.anchor});
    else if (p.arcMid !== undefined) anchors.push({s: (base[k].s + base[k + 1].s) / 2, i: p.arcMid});
  });
  anchors.sort((a, b) => a.s - b.s);
  const zAt = st => {
    if (elevation.mode === 'ramp') return elevation.start + elevation.slope / 100 * st;
    const list = closed ? [{s: anchors.at(-1).s - length, i: anchors.at(-1).i}, ...anchors, {s: anchors[0].s + length, i: anchors[0].i}] : anchors;
    if (st <= list[0].s) return piZ[list[0].i];
    for (let k = 1; k < list.length; k++) if (st <= list[k].s) { const a = list[k - 1], b = list[k], t = b.s > a.s ? (st - a.s) / (b.s - a.s) : 0; return piZ[a.i] + t * (piZ[b.i] - piZ[a.i]); }
    return piZ[list.at(-1).i];
  };
  base.forEach(v => { v.z = zAt(v.s); });
  const piStations = pis.map((_, i) => { const a = anchors.find(q => q.i === i); return a ? a.s : 0; });
  return {base, length, closed, curves, warnings, piStations, piZ: piStations.map(zAt)};
}

/**
 * Ponto mais próximo na base: distância, cota, estaca, lado (no sentido do traçado) e se cai além das pontas.
 * @returns {{d:number, z:number, s:number, side:'left'|'right', atEnd:boolean}}
 */
export function lineNearest(info, x, y) {
  const {base, closed} = info, n = base.length;
  let best = {d: Infinity, z: 0, s: 0, side: 'right', atEnd: false};
  if (n < 2) return best;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = base[i], b = base[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-30;
    const raw = ((x - a.x) * dx + (y - a.y) * dy) / L2, t = Math.max(0, Math.min(1, raw));
    const d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
    if (d < best.d - 1e-12) {
      const len = Math.sqrt(L2), sa = a.s, sb = i + 1 < n ? b.s : info.length;
      best = {d, z: a.z + t * (b.z - a.z), s: sa + t * (sb - sa), side: cross2(dx, dy, x - a.x, y - a.y) > 0 ? 'left' : 'right',
        atEnd: !closed && ((i === 0 && raw < -1e-9) || (i === segs - 1 && raw > 1 + 1e-9)), len};
    }
  }
  delete best.len;
  return best;
}
