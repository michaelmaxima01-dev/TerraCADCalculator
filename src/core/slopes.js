// Regras de talude compartilhadas por plataformas e linhas de projeto.
// Modelo de distância: fora da base, com d = distância horizontal à base e Zb = cota da base no
// ponto mais próximo, o projeto vale Zb ± subida(d). subida(d, H) = d / H sem bancadas; com bancadas
// de altura h e berma de largura w, sobe h em h·H de distância horizontal e anda w na berma, repetindo.
import cdt2d from 'cdt2d';

const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

export const BENCH_DEFAULT = Object.freeze({enabled: false, height: 10, width: 5, apply: 'cut'});
const BENCH_APPLY = ['cut', 'fill', 'both'];

/**
 * Bancadas (bermas) do talude: altura vertical entre bermas, largura horizontal da berma, onde aplicar,
 * altura a partir da qual começam (startAfter: talude contínuo até ela, 1ª berma nela) e, opcionalmente,
 * a quantidade de bermas numa profundidade (count; a altura vem de resolveBench).
 */
export function validateBenches(b) {
  if (b === undefined || b === null) return {...BENCH_DEFAULT, startAfter: 0, count: null};
  if (typeof b !== 'object') throw Error('Configuração de bermas inválida.');
  const height = Number(b.height ?? BENCH_DEFAULT.height), width = Number(b.width ?? BENCH_DEFAULT.width), apply = b.apply ?? BENCH_DEFAULT.apply;
  const startAfter = Number(b.startAfter ?? 0), count = b.count === undefined || b.count === null || b.count === '' ? null : Number(b.count);
  if (!(height > 0 && height <= 1000)) throw Error('Altura da bancada deve ser maior que zero.');
  if (!(width >= 0 && width <= 1000)) throw Error('Largura da berma não pode ser negativa.');
  if (!BENCH_APPLY.includes(apply)) throw Error('Bermas: escolha corte, aterro ou ambos.');
  if (!(startAfter >= 0 && startAfter <= 1000)) throw Error('A altura "a partir de" não pode ser negativa.');
  if (count !== null && !(Number.isInteger(count) && count >= 1 && count <= 50)) throw Error('Quantidade de bermas deve ser um número inteiro entre 1 e 50.');
  return {enabled: !!b.enabled, height, width, apply, startAfter, count};
}

const END_MODES = ['terrain', 'depth'];
/** Término do talude: até o terreno, ou descendo `depth` m (ou até a cota `floorZ`) e seguindo num fundo plano. */
export function validateEnd(en) {
  const e = en || {}, mode = e.mode ?? 'terrain';
  if (!END_MODES.includes(mode)) throw Error('Término do talude inválido.');
  const depth = e.depth === undefined || e.depth === null || e.depth === '' ? 8 : Number(e.depth);
  const floorZ = e.floorZ === undefined || e.floorZ === null || e.floorZ === '' ? null : Number(e.floorZ);
  if (!(depth > 0)) throw Error('A profundidade deve ser maior que zero.');
  if (floorZ !== null && !Number.isFinite(floorZ)) throw Error('Cota final inválida.');
  return {mode, depth, floorZ};
}
/** Cota do fundo para uma base na cota zb (cota final, se informada, nunca acima da base). */
export const floorOf = (end, zb) => end.floorZ !== null && end.floorZ !== undefined ? Math.min(end.floorZ, zb) : zb - end.depth;
/** Recusa bermas por quantidade sem término por profundidade. */
export function checkBenchEnd(benches, end) {
  if (benches?.enabled && benches.count && end.mode !== 'depth') throw Error('Bermas por quantidade exigem término por profundidade: escolha a profundidade ou informe a altura da bancada.');
}
/** Cota de projeto descendo da base (zb) à distância d, até o fundo, com bancadas resolvidas para a profundidade. */
export function descendZ(zb, d, H, bench, end) {
  const fl = floorOf(end, zb);
  return Math.max(fl, zb - slopeRise(d, H, resolveBench(bench, zb - fl)));
}
/** Distância em planta para descer exatamente `rise` (inversa de slopeRise; com bancadas, termina no pé da face). */
export function slopeRun(rise, H, bench = null) {
  if (!(rise > 0)) return 0;
  if (!bench) return rise * H;
  const s0 = startOf(H, bench);
  if (bench.startAfter > 0 && rise <= bench.startAfter) return rise * H;
  const rest = rise - s0.rise, k = Math.max(0, Math.ceil(rest / bench.height - 1e-12) - 1);
  return s0.d + k * (bench.height * H + bench.width) + (rest - k * bench.height) * H;
}

/** Bancada efetiva: com `count` e uma profundidade, altura = profundidade / (count + 1) e sem `startAfter`. */
export function resolveBench(bench, depth) {
  if (!bench || !bench.count || !(depth > 0)) return bench;
  return {...bench, height: depth / (bench.count + 1), startAfter: 0};
}

// parte regular das bancadas: face de altura h (h·H em planta) seguida de berma w, repetindo
const regularRise = (d, H, b) => { const run = b.height * H, period = run + b.width, k = Math.floor(d / period), r = d - k * period; return k * b.height + Math.min(r, run) / H; };
const startOf = (H, b) => b.startAfter > 0 ? {rise: b.startAfter, d: b.startAfter * H + b.width} : {rise: 0, d: 0};

/** Subida vertical do talude a uma distância horizontal d (com ou sem bancadas). */
export function slopeRise(d, H, bench = null) {
  if (!(d > 0)) return 0;
  if (!bench) return d / H;
  const s0 = startOf(H, bench);
  if (bench.startAfter > 0) {
    if (d <= bench.startAfter * H) return d / H;
    if (d <= s0.d) return bench.startAfter;
  }
  return s0.rise + regularRise(d - s0.d, H, bench);
}
/** Distância horizontal máxima para vencer um desnível (limite superior, para recortes de busca). */
export function slopeReach(rise, H, bench = null) {
  if (!(rise > 0)) return 0;
  if (!bench) return rise * H;
  const s0 = startOf(H, bench);
  if (bench.startAfter > 0 && rise <= bench.startAfter) return rise * H;
  const rest = rise - s0.rise;
  return s0.d + rest * H + Math.ceil(rest / bench.height) * bench.width;
}
/** Distâncias (em planta) das quebras do talude com bancadas: crista da berma e pé da bancada seguinte. */
export function slopeBreaks(H, bench, maxD) {
  if (!bench || !(maxD > 0)) return [];
  const out = [], s0 = startOf(H, bench);
  if (bench.startAfter > 0) {
    if (bench.startAfter * H < maxD) out.push({d: bench.startAfter * H, kind: 'crest', k: -1});
    if (bench.width > 0 && s0.d < maxD) out.push({d: s0.d, kind: 'toe', k: -1});
  }
  const run = bench.height * H, period = run + bench.width;
  for (let k = 0; s0.d + k * period < maxD && out.length < 2000; k++) {
    if (s0.d + k * period + run < maxD) out.push({d: s0.d + k * period + run, kind: 'crest', k});
    if (bench.width > 0 && s0.d + (k + 1) * period < maxD) out.push({d: s0.d + (k + 1) * period, kind: 'toe', k});
  }
  return out;
}

/** Espaçamento e alcance padrão dos raios a partir da extensão do terreno e do comprimento da base. */
export function meshDefaults(points, baseLength) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of points) { if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y; }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  return {spacing: Math.max(baseLength / 240, span / 400, 1e-3), maxDistance: span * 2};
}

/** Parâmetro t do raio em que a distância à base vale `d` (busca binária; d(t) é não decrescente). */
function tAtDistance(at, d, tMax) {
  let a = 0, b = tMax;
  for (let k = 0; k < 40; k++) { const m = (a + b) / 2, v = at(m); if (v && v.d < d) a = m; else b = m; }
  return b;
}

/**
 * Lança os taludes a partir de uma base (polilinha 3D) até o terreno e gera a malha.
 * @param {Array<{x,y,z}>} base fechada: sentido anti-horário; aberta: sentido do traçado
 * @param {{closed:boolean, side:'outside'|'inside'|'right'|'left', terrainAt:(x,y)=>number|null, nearest:(x,y)=>{d:number,z:number},
 *   ruleFor:(mode:'cut'|'fill')=>{H:number, bench:object|null}, spacing:number, maxDistance:number,
 *   depth?:{end:{mode,depth,floorZ}, H:number, bench:object|null}}} opts  depth: o talude desce da base até o fundo (corte)
 *   e o fundo segue plano até o terreno; com side 'inside' o fundo é o polígono das pontas dos raios.
 *   'outside' (fechada) e 'right' usam a normal à direita do segmento; 'left' e 'inside' invertem a base ('inside' sem interior). Na base aberta, as pontas
 *   recebem um único raio perpendicular (pontas retas).
 * @returns {{vertices, triangles, types, daylight, hatch, benchLines, warnings:string[], stats:{maxCut,maxFill,rays}}}
 */
export function castSlopes(base0, {closed, side, terrainAt, nearest, ruleFor, spacing, maxDistance, depth = null}) {
  const poly = side === 'left' || side === 'inside' ? base0.slice().reverse() : base0, n = poly.length, warnings = new Set();
  const segCount = closed ? n : n - 1;
  const normal = i => { const a = poly[i], b = poly[(i + 1) % n], l = Math.hypot(b.x - a.x, b.y - a.y) || 1; return {x: (b.y - a.y) / l, y: -(b.x - a.x) / l}; };
  // 1. Amostras da base + raios (leque nos cantos convexos, bissetriz nos reentrantes, perpendicular nas pontas)
  const base = [], rays = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], bi = base.push({x: a.x, y: a.y, z: a.z}) - 1;
    const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    const np = hasPrev ? normal((i - 1 + n) % n) : null, nn = hasNext ? normal(i) : null;
    if (!np || !nn) { const v = np || nn; rays.push({base: bi, dx: v.x, dy: v.y}); }
    else {
      const turn = cross(poly[(i - 1 + n) % n], a, poly[(i + 1) % n]);
      if (turn > 1e-12) {
        const a0 = Math.atan2(np.y, np.x); let sweep = Math.atan2(nn.y, nn.x) - a0;
        while (sweep <= 0) sweep += 2 * Math.PI; while (sweep > Math.PI) sweep -= 2 * Math.PI;
        const steps = Math.max(1, Math.ceil(sweep / (Math.PI / 12)));
        for (let k = 0; k <= steps; k++) { const ang = a0 + sweep * k / steps; rays.push({base: bi, dx: Math.cos(ang), dy: Math.sin(ang)}); }
      } else if (turn < -1e-12) {
        const bx = np.x + nn.x, by = np.y + nn.y, l = Math.hypot(bx, by) || 1; rays.push({base: bi, dx: bx / l, dy: by / l});
      } else rays.push({base: bi, dx: nn.x, dy: nn.y});
    }
    if (i < segCount) {
      const b = poly[(i + 1) % n], len = Math.hypot(b.x - a.x, b.y - a.y), m = Math.max(1, Math.ceil(len / spacing));
      for (let k = 1; k < m; k++) { const t = k / m, j = base.push({x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z)}) - 1; rays.push({base: j, dx: nn.x, dy: nn.y}); }
    }
  }
  // 2. Offset por raio, com o mesmo modelo usado no volume; vértices nas quebras das bermas
  let maxCut = 0, maxFill = 0, anyBench = false;
  const step = spacing / 2, vertices = base.slice(), daylight = [], hatch = [], floorSet = new Set(), floorOutline = [];
  for (const r of rays) {
    const b = base[r.base], T0 = terrainAt(b.x, b.y);
    r.chain = [r.base]; r.mode = 'none'; r.tags = [null];
    if (T0 === null) { warnings.add('Parte da base do talude está fora do terreno.'); daylight.push(b); continue; }
    if (depth) { // desce da base até o fundo; o fundo segue plano até o terreno (ou termina na cava)
      const fl = floorOf(depth.end, b.z), D = b.z - fl, bench = resolveBench(depth.bench, D), H = depth.H;
      if (bench) anyBench = true;
      const dFloor = slopeRun(D, H, bench);
      const at = t => { const x = b.x + r.dx * t, y = b.y + r.dy * t, T = terrainAt(x, y); if (T === null) return null; const q = nearest(x, y), z = descendZ(q.z, q.d, H, depth.bench, depth.end); return {x, y, z, f: T - z, d: q.d}; };
      let lo = 0, prev = {x: b.x, y: b.y, z: b.z, d: 0, f: T0 - b.z}, endT = 0, status = 'far', floorStart = null;
      for (let t = step; t <= maxDistance + 1e-9; t += step) {
        const cur = at(t);
        if (!cur) { status = 'edge'; endT = lo; break; }
        if (cur.f > 0) maxCut = Math.max(maxCut, cur.f);
        if (side === 'inside' && cur.d + 1e-9 < prev.d) { status = 'ridge'; break; } // passou da aresta entre faces: a outra face cobre daqui
        if (side === 'inside' && cur.d >= dFloor) { // cava: o raio para no início do fundo
          let a = lo, cc = t; for (let k = 0; k < 40; k++) { const mid = (a + cc) / 2, v = at(mid); if (v && v.d < dFloor) a = mid; else cc = mid; }
          prev = at(cc) || cur; endT = cc; status = 'floor'; break;
        }
        if (cur.f <= 0) {
          let a = lo, cc = t;
          for (let k = 0; k < 40; k++) { const mid = (a + cc) / 2, v = at(mid); if (v && v.f > 0) a = mid; else cc = mid; }
          prev = at(cc) || cur; endT = cc; status = 'ok'; break;
        }
        lo = t; prev = cur; endT = t;
      }
      if (status === 'edge') warnings.add('O fundo atinge o limite da superfície antes de encontrar o terreno.');
      if (status === 'far') warnings.add('O fundo não encontrou o terreno dentro da distância máxima.');
      r.mode = 'cut';
      const lastD = Math.min(prev.d, dFloor);
      for (const br of slopeBreaks(H, bench, lastD - 1e-6)) { const v = at(tAtDistance(at, br.d, endT)); if (!v || v.f <= 0) continue; r.chain.push(vertices.push({x: v.x, y: v.y, z: v.z}) - 1); r.tags.push(`${br.kind}${br.k}`); }
      if (side !== 'inside' && prev.d > dFloor + 1e-6) { const v = at(tAtDistance(at, dFloor, endT)); if (v) { floorStart = vertices.push({x: v.x, y: v.y, z: v.z}) - 1; r.chain.push(floorStart); r.tags.push('floor'); floorSet.add(floorStart); floorOutline.push(vertices[floorStart]); } }
      const end = {x: prev.x, y: prev.y, z: prev.z}, ei = vertices.push(end) - 1;
      r.chain.push(ei); r.tags.push('end'); daylight.push(end);
      if (status === 'floor') { floorSet.add(ei); floorOutline.push(end); }
      else if (floorStart !== null) floorSet.add(ei);
      continue;
    }
    if (Math.abs(T0 - b.z) <= 1e-9) { daylight.push(b); continue; }
    const mode = T0 > b.z ? 'cut' : 'fill';
    if (mode === 'cut') maxCut = Math.max(maxCut, T0 - b.z); else maxFill = Math.max(maxFill, b.z - T0);
    const {H, bench} = ruleFor(mode), sign = mode === 'cut' ? 1 : -1;
    if (bench) anyBench = true;
    const at = t => { const x = b.x + r.dx * t, y = b.y + r.dy * t, T = terrainAt(x, y); if (T === null) return null; const q = nearest(x, y), z = q.z + sign * slopeRise(q.d, H, bench); return {x, y, z, f: sign * (T - z), d: q.d}; };
    let lo = 0, prev = {x: b.x, y: b.y, z: b.z, d: 0}, endT = 0, status = 'far';
    for (let t = step; t <= maxDistance + 1e-9; t += step) {
      const cur = at(t);
      if (!cur) { status = 'edge'; endT = lo; break; }
      if (side === 'inside' && cur.d + 1e-9 < prev.d) { status = 'ridge'; break; } // passou da aresta entre faces
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
    for (const br of slopeBreaks(H, bench, prev.d - 1e-6)) {
      const v = at(tAtDistance(at, br.d, endT)); if (!v || v.f <= 0) continue;
      r.chain.push(vertices.push({x: v.x, y: v.y, z: v.z}) - 1); r.tags.push(`${br.kind}${br.k}`);
    }
    const end = {x: prev.x, y: prev.y, z: prev.z};
    r.chain.push(vertices.push(end) - 1); r.tags.push('end'); daylight.push(end);
  }
  rays.forEach((r, k) => { if (k % 3 === 0 && r.mode !== 'none') hatch.push([base[r.base], vertices[r.chain.at(-1)], r.mode]); });
  // linhas das bermas (crista e pé), ligando raios consecutivos que têm a mesma quebra
  const benchLines = [], benchLineKinds = [];
  if (anyBench) {
    const open = new Map();
    rays.forEach(r => {
      const here = new Set();
      r.tags.forEach((tag, i) => { if (!tag || tag === 'end' || tag === 'floor') return; const key = r.mode + tag; here.add(key); let line = open.get(key); if (!line) { line = []; open.set(key, line); benchLines.push(line); benchLineKinds.push(tag.startsWith('toe') ? 'toe' : 'crest'); } line.push(vertices[r.chain[i]]); });
      for (const key of [...open.keys()]) if (!here.has(key)) open.delete(key);
    });
    for (let i = benchLines.length - 1; i >= 0; i--) if (benchLines[i].length < 2) { benchLines.splice(i, 1); benchLineKinds.splice(i, 1); }
  }
  // 3. Triangulação: interior (fechada) + faixas de talude entre raios (costura)
  const tris = [], types = [];
  if (depth && side === 'inside' && floorOutline.length >= 3) { // fundo da cava
    // pontos do fundo triangulados sem restrição; ficam só os triângulos cujo centro está mesmo no fundo
    const idx = [...floorSet], o = vertices[idx[0]];
    try {
      cdt2d(idx.map(i => [vertices[i].x - o.x, vertices[i].y - o.y]), [], {delaunay: true}).forEach(t => {
        const [a, b, c] = t.map(k => vertices[idx[k]]), cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, q = nearest(cx, cy);
        if (descendZ(q.z, q.d, depth.H, depth.bench, depth.end) <= floorOf(depth.end, q.z) + 1e-6) { tris.push(t.map(k => idx[k])); types.push('floor'); }
      });
    } catch { warnings.add('O fundo da cava não pôde ser triangulado; os volumes não são afetados.'); }
  }
  if (closed && side !== 'inside') {
    const o = base[0], loop = base.map((_, i) => [i, (i + 1) % base.length]);
    cdt2d(base.map(q => [q.x - o.x, q.y - o.y]), loop, {delaunay: true, exterior: false}).forEach(t => { tris.push(t); types.push('platform'); });
  }
  const area2 = (a, b, cc) => Math.abs(cross(vertices[a], vertices[b], vertices[cc]));
  const typeOf = (r1, r2) => r1.mode === r2.mode ? r1.mode : r1.mode === 'none' ? r2.mode : r2.mode === 'none' ? r1.mode : 'mixed';
  const flatTri = t => Math.abs(vertices[t[0]].z - vertices[t[1]].z) < 1e-6 && Math.abs(vertices[t[1]].z - vertices[t[2]].z) < 1e-6;
  const add = (t, r1, r2) => { if (t[0] === t[1] || t[1] === t[2] || t[0] === t[2] || area2(...t) < 1e-10) return; tris.push(t); types.push(t.every(i => floorSet.has(i)) ? 'floor' : anyBench && flatTri(t) ? 'bench' : typeOf(r1, r2)); };
  const param = r => { const L = r.chain.length - 1; return r.chain.map((_, i) => L ? i / L : 0); };
  const strips = closed ? rays.length : rays.length - 1;
  for (let k = 0; k < strips; k++) {
    const r1 = rays[k], r2 = rays[(k + 1) % rays.length], A = r1.chain, B = r2.chain, sa = param(r1), sb = param(r2);
    let i = 0, j = 0;
    if (r1.base !== r2.base) { add([A[0], B[0], B[Math.min(1, B.length - 1)]], r1, r2); if (B.length > 1) j = 1; }
    while (i < A.length - 1 || j < B.length - 1) {
      const advA = j >= B.length - 1 || (i < A.length - 1 && sa[i + 1] <= sb[j + 1]);
      if (advA) { add([A[i], B[j], A[i + 1]], r1, r2); i++; } else { add([A[i], B[j], B[j + 1]], r1, r2); j++; }
    }
  }
  return {vertices, triangles: tris, types, daylight, hatch, benchLines, benchLineKinds, floorOutline, warnings: [...warnings], stats: {maxCut, maxFill, rays: rays.length}};
}

/**
 * Volumes de corte e aterro entre terreno e projeto, integrados em grade regular.
 * @param {(x:number,y:number,T:number)=>number|null} designAt cota de projeto (null = fora da terraplenagem)
 * @param {{minX,minY,maxX,maxY}} bbox região de integração (já limitada ao terreno)
 * @param {{cell?:number, maxCells?:number, inside?:(x,y)=>boolean, refine?:(x,y,h)=>boolean}} opts inside: área de projeto sem
 *   terreno conta em `outside`; refine: célula junto de uma descontinuidade do projeto (ex.: a própria linha aberta), que é
 *   subamostrada 8×8 para não depender do alinhamento da grade.
 */
export function gridVolumes(designAt, terrainAt, bbox, {cell, maxCells = 250000, inside = null, refine = null} = {}) {
  const {minX, minY, maxX, maxY} = bbox;
  const out = {cut: 0, fill: 0, net: 0, areaCut: 0, areaFill: 0, footprint: 0, cell: 0, outside: 0};
  if (!(maxX > minX && maxY > minY)) return out;
  let h = cell > 0 ? cell : Math.sqrt((maxX - minX) * (maxY - minY) / maxCells);
  h = Math.max(h, Math.sqrt((maxX - minX) * (maxY - minY) / maxCells));
  const nx = Math.ceil((maxX - minX) / h), ny = Math.ceil((maxY - minY) / h), A = h * h;
  out.cell = h;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const x = minX + (i + .5) * h, y = minY + (j + .5) * h;
    if (refine && refine(x, y, h)) {
      const k = 8, a = A / (k * k);
      for (let u = 0; u < k; u++) for (let v = 0; v < k; v++) {
        const sx = minX + (i + (u + .5) / k) * h, sy = minY + (j + (v + .5) / k) * h, T = terrainAt(sx, sy);
        if (T === null) { if (inside && inside(sx, sy)) out.outside += a; continue; }
        const D = designAt(sx, sy, T); if (D === null) continue;
        out.footprint += a; const diff = T - D;
        if (diff > 0) { out.cut += diff * a; out.areaCut += a; } else if (diff < 0) { out.fill -= diff * a; out.areaFill += a; }
      }
      continue;
    }
    const T = terrainAt(x, y);
    if (T === null) { if (inside && inside(x, y)) out.outside += A; continue; }
    const D = designAt(x, y, T);
    if (D === null) continue;
    out.footprint += A;
    const diff = T - D;
    if (diff > 0) { out.cut += diff * A; out.areaCut += A; } else if (diff < 0) { out.fill -= diff * A; out.areaFill += A; }
  }
  out.net = out.cut - out.fill;
  return out;
}
