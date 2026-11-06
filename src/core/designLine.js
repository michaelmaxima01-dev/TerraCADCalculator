// Linha de projeto: PIs editáveis, curvas de canto com raio, estaqueamento e cota da linha.
// A geometria daqui alimenta os taludes (lineGrading.js): a "base" é a polilinha 3D já com os arcos
// discretizados e a estaca s (comprimento 2D acumulado) em cada vértice.
import {validateBenches, validateEnd, checkBenchEnd} from './slopes.js';
import {stationAt} from './sections.js';

const ELEV_MODES = ['ramp', 'pis', 'terrain', 'grade'], OPEN_SIDES = ['left', 'right', 'both'], CLOSED_SIDES = ['outside', 'inside'];
const MAX_SAGITTA = 0.02, MAX_STEP = 3 * Math.PI / 180;
const num = (v, d) => v === undefined || v === null || v === '' ? d : Number(v);
const fmt = v => Number(v).toLocaleString('pt-BR', {maximumFractionDigits: 2});
const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;

function segmentsCross(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Próximo nome livre com o prefixo (ex.: "Plataforma 3" mesmo depois de apagar a 2; nunca repete um nome). */
export function nextName(list, prefix) {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
  const top = (list || []).reduce((m, o) => { const k = re.exec(String(o?.name ?? '')); return k ? Math.max(m, Number(k[1])) : m; }, 0);
  return `${prefix} ${top + 1}`;
}

/** Vértices sem repetição e sem auto-cruzamento (lança Error em português). */
export function checkVertices(pts, closed) {
  const n = pts.length, segs = closed ? n : n - 1;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 1e-6) throw Error(`PIs repetidos (${i + 1} e ${j + 1}). Remova um deles.`);
  for (let i = 0; i < segs; i++) for (let j = i + 2; j < segs; j++) {
    if (closed && i === 0 && j === segs - 1) continue;
    if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) throw Error('A linha cruza a si mesma. Mova os PIs para desfazer o cruzamento.');
  }
  return pts;
}

/** Move o vértice i para p (mantém cota e raio); recusa se repetir ou cruzar. Não altera a lista original. */
export function moveVertex(vertices, i, p, {closed}) {
  return checkVertices(vertices.map((v, k) => k === i ? {...v, x: p.x, y: p.y} : v), closed);
}
/** Insere um vértice em p no trecho que começa no vértice `seg` (cota interpolada quando os dois lados têm cota). */
export function insertVertex(vertices, seg, p, {closed}) {
  const n = vertices.length, a = vertices[seg], b = vertices[(seg + 1) % n], dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  const v = {x: p.x, y: p.y}; if (Number.isFinite(a.z) && Number.isFinite(b.z)) v.z = a.z + t * (b.z - a.z);
  return checkVertices([...vertices.slice(0, seg + 1), v, ...vertices.slice(seg + 1)], closed);
}
/** Remove o vértice i respeitando o mínimo (2 na aberta, 3 na fechada). */
export function removeVertex(vertices, i, {closed}) {
  const min = closed ? 3 : 2;
  if (vertices.length <= min) throw Error(`A ${closed ? 'linha fechada ou plataforma' : 'linha'} precisa de pelo menos ${min} vértices.`);
  return checkVertices(vertices.filter((_, k) => k !== i), closed);
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
  checkVertices(pis, closed);
  const e = l.elevation || {}, mode = e.mode ?? 'ramp';
  if (!ELEV_MODES.includes(mode)) throw Error('Modo de cota da linha inválido.');
  const elevation = {mode, start: num(e.start, 0), slope: num(e.slope, 0), drop: num(e.drop, 0)};
  if (![elevation.start, elevation.slope, elevation.drop].every(Number.isFinite)) throw Error('Cota, rampa e desnível da linha devem ser números.');
  const side = l.side ?? (closed ? 'outside' : 'right');
  if (!(closed ? CLOSED_SIDES : OPEN_SIDES).includes(side)) throw Error(closed ? 'Linha fechada: o talude vai para fora ou para dentro.' : 'Linha aberta: o talude vai para a esquerda, a direita ou os dois lados.');
  const cutSlope = num(l.cutSlope, 1), fillSlope = num(l.fillSlope, 1.5);
  if (!(cutSlope > 0 && cutSlope <= 100) || !(fillSlope > 0 && fillSlope <= 100)) throw Error('Inclinações dos taludes devem estar entre 0 e 100 (H:V).');
  const end = validateEnd(l.end), benches = validateBenches(l.benches);
  checkBenchEnd(benches, end);
  return {id: String(l.id || ''), name: String(l.name || 'Linha'), visible: l.visible !== false, closed, pis, elevation, side, cutSlope, fillSlope, benches, end};
}

/**
 * Polilinha de base da linha: arcos discretizados (flecha ≤ 2 cm, passo ≤ 3°), estaca e cota em cada vértice.
 * @param {object} line linha validada
 * @param {(x,y)=>number|null} [terrainAt] necessário no modo de cota 'terrain'
 * @returns {{base:Array<{x,y,z,s}>, length:number, closed:boolean, curves:Array<{pi,radius,clamped,T,arcLength}>, warnings:string[], piStations:number[], piZ:number[]}}
 */
export function buildLineBase(line, terrainAt = null, gradeCtx = {}) {
  const {pis, closed, elevation} = line, n = pis.length, warnings = [], curves = [];
  const gradeZ = elevation.mode === 'grade' && gradeCtx?.path?.length > 1 && gradeCtx.gradeAt ? (x, y) => { const z = gradeCtx.gradeAt(stationAt(gradeCtx.path, x, y).s); return Number.isFinite(z) ? z - elevation.drop : null; } : null;
  if (elevation.mode === 'grade' && !gradeZ) return {base: [], length: 0, closed, curves, warnings: ['Trace o eixo e crie o greide no perfil para a linha seguir o greide.'], piStations: pis.map(() => 0), piZ: pis.map(() => NaN)};
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
  // pontos coincidentes (ex.: dois arcos vizinhos limitados à metade do trecho) viram um só, mantendo a âncora
  for (let k = pts.length - 1; k >= 1; k--) {
    const a = pts[k - 1], b = pts[k];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) { if (a.anchor === undefined && b.anchor !== undefined) a.anchor = b.anchor; if (a.arcMid === undefined && b.arcMid !== undefined) a.arcMid = b.arcMid; pts.splice(k, 1); }
  }
  if (closed && pts.length > 1 && Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y) < 1e-6) { const b = pts.pop(); if (pts[0].anchor === undefined && b.anchor !== undefined) pts[0].anchor = b.anchor; }
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
  if (gradeZ) { // segue o greide: densifica para acompanhar curvas verticais e tira a cota de cada ponto pela estaca no eixo
    const dense = [], step = Math.max(1, length / 300);
    for (let k = 0; k < base.length; k++) {
      const a = base[k], b = base[k + 1] ?? (closed ? {...base[0], s: length} : null); dense.push(a);
      if (!b) continue; const L = b.s - a.s, m = Math.floor(L / step);
      for (let j = 1; j < m; j++) { const t = j / m; dense.push({x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: 0, s: a.s + t * L}); }
    }
    base.splice(0, base.length, ...dense);
    let bad = false; base.forEach(v => { const z = gradeZ(v.x, v.y); if (z === null) bad = true; v.z = z ?? 0; });
    if (bad) return {base: [], length: 0, closed, curves, warnings: ['O greide não cobre toda a linha: estenda o greide no perfil.'], piStations: pis.map(() => 0), piZ: pis.map(() => NaN)};
    const piStations = pis.map((_, i) => { const a = anchors.find(q => q.i === i); return a ? a.s : 0; });
    return {base, length, closed, curves, warnings, piStations, piZ: pis.map(p => gradeZ(p.x, p.y))};
  }
  base.forEach(v => { v.z = zAt(v.s); });
  const piStations = pis.map((_, i) => { const a = anchors.find(q => q.i === i); return a ? a.s : 0; });
  return {base, length, closed, curves, warnings, piStations, piZ: piStations.map(zAt)};
}

// Índice em grade dos trechos da base (acelera o ponto mais próximo nas integrações de volume)
const indexes = new WeakMap();
function segmentIndex(info) {
  let ix = indexes.get(info); if (ix) return ix;
  const {base, closed} = info, n = base.length, segs = closed ? n : n - 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const v of base) { if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x; if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; }
  const cell = Math.max(Math.max(maxX - minX, maxY - minY, 1e-6) / Math.max(1, Math.sqrt(segs) * 2), 1e-6);
  const cells = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  for (let i = 0; i < segs; i++) {
    const a = base[i], b = base[(i + 1) % n];
    const i0 = Math.floor((Math.min(a.x, b.x) - minX) / cell), i1 = Math.floor((Math.max(a.x, b.x) - minX) / cell);
    const j0 = Math.floor((Math.min(a.y, b.y) - minY) / cell), j1 = Math.floor((Math.max(a.y, b.y) - minY) / cell);
    for (let u = i0; u <= i1; u++) for (let w = j0; w <= j1; w++) { const k = key(u, w); let l = cells.get(k); if (!l) cells.set(k, l = []); l.push(i); }
  }
  ix = {minX, minY, cell, cells, key, ni: Math.floor((maxX - minX) / cell), nj: Math.floor((maxY - minY) / cell), segs, stamp: new Int32Array(segs), tick: 0, lx: NaN, ly: NaN, last: null};
  indexes.set(info, ix); return ix;
}

/**
 * Ponto mais próximo na base: distância, cota, estaca, lado (no sentido do traçado) e se cai além das pontas.
 * @returns {{d:number, z:number, s:number, side:'left'|'right', atEnd:boolean}}
 */
export function lineNearest(info, x, y, {brute = false, maxD = Infinity} = {}) {
  const {base, closed} = info, n = base.length;
  let best = {d: Infinity, z: 0, s: 0, side: 'right', atEnd: false}, bi = -1;
  if (n < 2) return best;
  const segs = closed ? n : n - 1;
  const visit = i => {
    const a = base[i], b = base[(i + 1) % n], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-30;
    const raw = ((x - a.x) * dx + (y - a.y) * dy) / L2, t = Math.max(0, Math.min(1, raw));
    const d = Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
    if (d < best.d - 1e-12 || (Math.abs(d - best.d) <= 1e-12 && i < bi)) { // empate: o trecho de menor índice (igual à busca completa)
      const sa = a.s, sb = i + 1 < n ? b.s : info.length;
      best = {d, z: a.z + t * (b.z - a.z), s: sa + t * (sb - sa), side: cross2(dx, dy, x - a.x, y - a.y) > 0 ? 'left' : 'right',
        atEnd: !closed && ((i === 0 && raw < -1e-9) || (i === segs - 1 && raw > 1 + 1e-9))}; bi = i;
    }
  };
  if (brute || segs < 16) { for (let i = 0; i < segs; i++) visit(i); return best; }
  const ix = segmentIndex(info);
  // mesma consulta repetida (ex.: refinamento e cota na mesma célula); um resultado "longe" só serve para limite menor ou igual
  if (x === ix.lx && y === ix.ly && (ix.lexact || maxD <= ix.lcap)) return {...ix.last};
  const ci = Math.floor((x - ix.minX) / ix.cell), cj = Math.floor((y - ix.minY) / ix.cell), tick = ++ix.tick;
  if (tick > 2e9) { ix.stamp.fill(0); ix.tick = 1; }
  const far = Math.max(Math.abs(ci), Math.abs(cj), Math.abs(ci - ix.ni), Math.abs(cj - ix.nj)) + 1;
  // anel mínimo que já toca a grade (pontos longe da linha não varrem células vazias fora dela)
  const r0 = Math.max(0, -ci, ci - ix.ni, -cj, cj - ix.nj);
  const scan = (u, w) => { if (u < 0 || w < 0 || u > ix.ni || w > ix.nj) return; const l = ix.cells.get(ix.key(u, w)); if (l) for (const i of l) if (ix.stamp[i] !== ix.tick) { ix.stamp[i] = ix.tick; visit(i); } };
  for (let r = r0; r <= far; r++) {
    if (r === 0) scan(ci, cj);
    else {
      for (let u = Math.max(ci - r, 0); u <= Math.min(ci + r, ix.ni); u++) { scan(u, cj - r); scan(u, cj + r); }
      for (let w = Math.max(cj - r + 1, 0); w <= Math.min(cj + r - 1, ix.nj); w++) { scan(ci - r, w); scan(ci + r, w); }
    }
    // tudo que falta está a pelo menos r·cell do ponto: pode parar quando o melhor já é mais perto (com folga de empate)
    if (best.d + 1e-9 < r * ix.cell) break;
    if (r * ix.cell > maxD) break; // nada mais perto que o limite: o chamador só precisa saber que está longe
  }
  const exact = best.d <= maxD || maxD === Infinity;
  if (!exact) best = {...best, d: Infinity};
  ix.lx = x; ix.ly = y; ix.last = best; ix.lexact = exact; ix.lcap = maxD;
  return {...best};
}
