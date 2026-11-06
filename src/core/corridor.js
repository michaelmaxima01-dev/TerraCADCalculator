// Gabarito de acesso (seção-tipo) aplicado ao longo do eixo do perfil, na cota do greide.
// Seção: pista de largura `width` centrada no eixo, com caimento transversal (abaulado ou para um lado),
// taludes de corte e aterro (H:V) a partir dos bordos, com bermas opcionais. Modelo de distância igual ao das
// plataformas e linhas: fora da pista, z = cota do bordo ± subida(d), d = distância ao bordo.
// Pontas retas: além do início e do fim do eixo não há projeto.
import {buildLineBase, lineNearest} from './designLine.js';
import {castSlopes, gridVolumes, slopeRise, slopeReach, validateBenches, meshDefaults} from './slopes.js';
import {pointAtStation} from './sections.js';

export const CROSSFALLS = ['crown', 'left', 'right'];
export const CORRIDOR_DEFAULT = Object.freeze({enabled: false, width: 10, crossfall: 2, fall: 'crown', cutSlope: 1, fillSlope: 1.5});

const num = (v, d) => v === undefined || v === null || v === '' ? d : Number(v);

/** Normaliza e valida o gabarito (lança Error com orientação em português). */
export function validateCorridor(c) {
  if (c === undefined || c === null) return {...CORRIDOR_DEFAULT, benches: validateBenches(null)};
  if (typeof c !== 'object') throw Error('Gabarito de acesso inválido.');
  const width = num(c.width, CORRIDOR_DEFAULT.width), crossfall = num(c.crossfall, CORRIDOR_DEFAULT.crossfall), fall = c.fall ?? CORRIDOR_DEFAULT.fall;
  const cutSlope = num(c.cutSlope, CORRIDOR_DEFAULT.cutSlope), fillSlope = num(c.fillSlope, CORRIDOR_DEFAULT.fillSlope);
  if (!(width > 0 && width <= 200)) throw Error('Largura da pista deve estar entre 0 e 200 m.');
  if (!(crossfall >= 0 && crossfall <= 20)) throw Error('Caimento transversal deve estar entre 0 e 20 %.');
  if (!CROSSFALLS.includes(fall)) throw Error('Caimento: escolha abaulado, para a esquerda ou para a direita.');
  if (!(cutSlope > 0 && cutSlope <= 100) || !(fillSlope > 0 && fillSlope <= 100)) throw Error('Inclinações dos taludes devem estar entre 0 e 100 (H:V).');
  const benches = validateBenches(c.benches);
  if (benches.count !== null) benches.count = null; // quantidade de bermas só existe com término por profundidade
  return {enabled: !!c.enabled, width, crossfall, fall, cutSlope, fillSlope, benches};
}

/** Cota da pista no afastamento o (positivo à esquerda do sentido do eixo), com greide g no eixo. */
export function roadZ(c, g, o) {
  const i = c.crossfall / 100;
  if (c.fall === 'crown') return g - i * Math.abs(o);
  return c.fall === 'left' ? g - i * o : g + i * o;
}

const benchFor = (c, mode) => c.benches?.enabled && (c.benches.apply === 'both' || c.benches.apply === mode) ? c.benches : null;

const cache = new WeakMap();
/**
 * Geometria do acesso: eixo densificado na cota do greide (mesma base das linhas que seguem o greide).
 * @returns {{ok:boolean, warnings:string[], axis, half:number, corridor}}
 */
export function compileCorridor(alignment, gradeCtx, corridor) {
  const key = cache.get(corridor);
  if (key && key.alignment === alignment && key.gradeCtx === gradeCtx) return key.info;
  const c = corridor, warnings = [];
  let axis = {base: [], length: 0, closed: false};
  if (!(alignment?.length > 1)) warnings.push('Trace o eixo (ferramenta P) para aplicar o gabarito.');
  else if (!gradeCtx?.gradeAt) warnings.push('Crie o greide no perfil para aplicar o gabarito.');
  else {
    axis = buildLineBase({pis: alignment, closed: false, elevation: {mode: 'grade', start: 0, slope: 0, drop: 0}}, null, {path: alignment, gradeAt: gradeCtx.gradeAt});
    warnings.push(...axis.warnings);
  }
  const zs = axis.base.map(v => v.z), fall = c.crossfall / 100 * c.width / 2;
  // eixo em planta só com os vértices originais (busca do ponto mais próximo barata); a cota sai do greide na estaca
  let acc = 0; const raw = {closed: false, base: (alignment || []).map((p, i, a) => { if (i) acc += Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y); return {x: p.x, y: p.y, z: 0, s: acc}; })}; raw.length = acc;
  const info = {ok: axis.base.length > 1, warnings, axis, raw, gradeAt: gradeCtx?.gradeAt, half: c.width / 2, corridor: c, zMin: Math.min(...zs) - fall, zMax: Math.max(...zs) + fall};
  cache.set(corridor, {alignment, gradeCtx, info});
  return info;
}

/**
 * Posição do ponto em relação ao acesso: estaca, afastamento com sinal (+ esquerda), greide no eixo e se cai
 * além das pontas.
 */
export function corridorLocate(info, x, y, maxD = Infinity) {
  const q = lineNearest(info.raw, x, y, {maxD});
  const g = Number.isFinite(q.d) ? info.gradeAt(Math.min(Math.max(q.s, 0), info.raw.length)) : NaN;
  return {s: q.s, o: q.side === 'left' ? q.d : -q.d, d: q.d, g, atEnd: q.atEnd};
}

/** Cota de projeto do acesso em (x,y) com terreno T; null fora da terraplenagem. */
export function corridorElevationAt(info, x, y, T) {
  if (!info.ok) return null;
  const c = info.corridor;
  // alcance máximo do talude com este terreno: além dele não há projeto (evita varrer o eixo inteiro)
  const rise = T === null || T === undefined ? 0 : Math.max(T - info.zMin, info.zMax - T, 0);
  const reach = info.half + Math.max(slopeReach(rise, c.cutSlope, benchFor(c, 'cut')), slopeReach(rise, c.fillSlope, benchFor(c, 'fill'))) + 1e-6;
  const q = corridorLocate(info, x, y, reach);
  if (q.atEnd || !Number.isFinite(q.d)) return null;
  if (q.d <= info.half + 1e-9) return roadZ(c, q.g, q.o);
  if (T === null || T === undefined) return null;
  const ze = roadZ(c, q.g, Math.sign(q.o) * info.half), dd = q.d - info.half;
  if (T > ze) { const z = ze + slopeRise(dd, c.cutSlope, benchFor(c, 'cut')); return z < T ? z : null; }
  if (T < ze) { const z = ze - slopeRise(dd, c.fillSlope, benchFor(c, 'fill')); return z > T ? z : null; }
  return null;
}

/**
 * Bordos da pista (esquerdo e direito) como polilinhas 3D a w/2 do eixo: no lado externo das curvas o bordo
 * contorna o vértice em arco (igual ao modelo de distância); no lado interno, os pontos que ficariam dentro da pista
 * do outro trecho são descartados (sem dobras).
 */
export function corridorEdges(info) {
  if (!info.ok) return {left: [], right: []};
  const b = info.axis.base, c = info.corridor, h = info.half, n = b.length, left = [], right = [];
  const segN = k => { const a = b[k], q = b[k + 1], L = Math.hypot(q.x - a.x, q.y - a.y) || 1; return {x: -(q.y - a.y) / L, y: (q.x - a.x) / L}; }; // normal à esquerda
  for (let k = 0; k < n; k++) {
    const p = b[k], g = p.z, n1 = segN(Math.max(0, k - 1)), n2 = segN(Math.min(n - 2, k));
    const turn = n1.x * n2.y - n1.y * n2.x, ang = Math.atan2(turn, n1.x * n2.x + n1.y * n2.y);
    for (const [sign, out] of [[1, left], [-1, right]]) {
      const z = roadZ(c, g, sign * h);
      if (Math.abs(ang) < 1e-9 || k === 0 || k === n - 1) { const m = k === 0 ? n2 : n1; out.push({x: p.x + sign * m.x * h, y: p.y + sign * m.y * h, z, s: p.s}); continue; }
      // curva para a esquerda (ang > 0): o lado direito é o externo
      const outer = (ang > 0 && sign < 0) || (ang < 0 && sign > 0);
      if (outer) {
        const steps = Math.max(1, Math.ceil(Math.abs(ang) / (10 * Math.PI / 180))), a0 = Math.atan2(sign * n1.y, sign * n1.x);
        for (let j = 0; j <= steps; j++) { const t = a0 + ang * j / steps; out.push({x: p.x + h * Math.cos(t), y: p.y + h * Math.sin(t), z, s: p.s}); }
      } else {
        const bx = n1.x + n2.x, by = n1.y + n2.y, bl = Math.hypot(bx, by) || 1, cosH = Math.max(.2, (bx * n1.x + by * n1.y) / bl);
        out.push({x: p.x + sign * bx / bl * h / cosH, y: p.y + sign * by / bl * h / cosH, z, s: p.s});
      }
    }
  }
  const keep = pts => pts.filter(v => corridorLocate(info, v.x, v.y).d >= h - 1e-6 * Math.max(1, h));
  return {left: keep(left), right: keep(right)};
}

/** Malha do acesso: pista (tipo 'road') e taludes até o terreno (mesmo formato das plataformas e linhas). */
export function gradeCorridor(info, {terrainAt, points, spacing, maxDistance} = {}) {
  const mesh = {vertices: [], triangles: [], types: [], daylight: [], daylightRuns: [], hatch: [], benchLines: [], benchLineKinds: [], warnings: [...info.warnings], stats: {maxCut: 0, maxFill: 0, rays: 0}, edges: {left: [], right: []}, axis: info.axis.base};
  if (!info.ok) return mesh;
  const c = info.corridor, edges = corridorEdges(info), b = info.axis.base;
  mesh.edges = edges;
  // pista: faixa entre os bordos, com o eixo no meio quando abaulada
  const strip = c.fall === 'crown' ? [edges.left, b.map(p => ({x: p.x, y: p.y, z: p.z, s: p.s})), edges.right] : [edges.left, edges.right];
  for (let r = 1; r < strip.length; r++) {
    const A = strip[r - 1], B = strip[r], oa = mesh.vertices.length;
    mesh.vertices.push(...A.map(v => ({x: v.x, y: v.y, z: v.z})));
    const ob = mesh.vertices.length; mesh.vertices.push(...B.map(v => ({x: v.x, y: v.y, z: v.z})));
    let i = 0, j = 0; // costura por estaca (os bordos podem ter números de pontos diferentes)
    while (i < A.length - 1 || j < B.length - 1) {
      const advA = j >= B.length - 1 || (i < A.length - 1 && A[i + 1].s <= B[j + 1].s);
      if (advA) { mesh.triangles.push([oa + i, ob + j, oa + i + 1]); i++; } else { mesh.triangles.push([oa + i, ob + j, ob + j + 1]); j++; }
      mesh.types.push('road');
    }
  }
  const d = meshDefaults(points || b, info.axis.length), H = c.width / 2;
  const nearest = (x, y) => { const q = corridorLocate(info, x, y); return {d: Math.max(0, q.d - H), z: roadZ(c, q.g, Math.sign(q.o || 1) * H)}; };
  const opts = {closed: false, terrainAt, nearest, ruleFor: mode => mode === 'cut' ? {H: c.cutSlope, bench: benchFor(c, 'cut')} : {H: c.fillSlope, bench: benchFor(c, 'fill')},
    spacing: spacing > 0 ? spacing : d.spacing, maxDistance: maxDistance > 0 ? maxDistance : d.maxDistance};
  for (const [side, base] of [['left', edges.left], ['right', edges.right]]) {
    if (base.length < 2) continue;
    const m = castSlopes(base, {...opts, side}), off = mesh.vertices.length;
    mesh.vertices.push(...m.vertices); m.triangles.forEach(t => mesh.triangles.push(t.map(i => i + off))); mesh.types.push(...m.types);
    mesh.daylight.push(...m.daylight); mesh.daylightRuns.push(m.daylight); mesh.hatch.push(...m.hatch); mesh.benchLines.push(...m.benchLines); mesh.benchLineKinds.push(...(m.benchLineKinds || [])); mesh.warnings.push(...m.warnings);
    mesh.stats.maxCut = Math.max(mesh.stats.maxCut, m.stats.maxCut); mesh.stats.maxFill = Math.max(mesh.stats.maxFill, m.stats.maxFill); mesh.stats.rays += m.stats.rays;
  }
  mesh.warnings = [...new Set(mesh.warnings)];
  return mesh;
}

/** Caixa do terreno (para limitar a integração). */
function terrainBox(points, triangles) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const t of triangles) for (const i of t) { const q = points[i]; if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x; if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y; if (q.z < minZ) minZ = q.z; if (q.z > maxZ) maxZ = q.z; }
  return {minX, minY, maxX, maxY, minZ, maxZ};
}

/** Volumes de corte e aterro do acesso, integrados em grade (células junto das pontas são subamostradas). */
export function corridorVolumes(info, {terrainAt, points, triangles, cell, maxCells = 250000, box = null} = {}) {
  if (!info.ok) return gridVolumes(() => null, terrainAt, {minX: 0, minY: 0, maxX: 0, maxY: 0});
  const c = info.corridor, b = info.axis.base, t = box || terrainBox(points, triangles), zs = b.map(v => v.z);
  const zMin = Math.min(...zs) - c.crossfall / 100 * info.half, zMax = Math.max(...zs) + c.crossfall / 100 * info.half;
  const reach = info.half + Math.max(slopeReach(t.maxZ - zMin, c.cutSlope, benchFor(c, 'cut')), slopeReach(zMax - t.minZ, c.fillSlope, benchFor(c, 'fill')), 0);
  const xs = b.map(v => v.x), ys = b.map(v => v.y);
  const bbox = {minX: Math.max(Math.min(...xs) - reach, t.minX), maxX: Math.min(Math.max(...xs) + reach, t.maxX), minY: Math.max(Math.min(...ys) - reach, t.minY), maxY: Math.min(Math.max(...ys) + reach, t.maxY)};
  return gridVolumes((x, y, T) => corridorElevationAt(info, x, y, T), terrainAt, bbox, {cell, maxCells, refine: corridorRefine(info)});
}

/** Células junto das pontas retas do acesso (descontinuidade do projeto) para subamostrar no volume. */
export function corridorRefine(info) {
  const b = info.axis.base, n = b.length, along = (p0, p1, x, y) => { const dx = p1.x - p0.x, dy = p1.y - p0.y, l = Math.hypot(dx, dy) || 1; return ((x - p0.x) * dx + (y - p0.y) * dy) / l; };
  return (x, y, h) => n > 1 && (Math.abs(along(b[0], b[1], x, y)) < h || Math.abs(along(b[n - 1], {x: 2 * b[n - 1].x - b[n - 2].x, y: 2 * b[n - 1].y - b[n - 2].y}, x, y)) < h);
}
/** Base do acesso (a pista) para a combinação com outros objetos. */
export const corridorBase = info => (x, y) => { if (!info.ok) return false; const q = corridorLocate(info, x, y, info.half + 1e-9); return !q.atEnd && q.d <= info.half + 1e-9; };

/**
 * Nota de serviço por estaca: terreno e greide no eixo, altura no eixo, bordos da pista e offsets (crista do corte
 * ou pé do aterro) de cada lado, com afastamento, cota e altura do talude.
 * @param {number[]} stations estacas
 * @param {(x,y)=>number|null} terrainAt
 * @returns {Array<{station, terrainZ, gradeZ, axisH, left:Side, right:Side}>}  Side = {edgeOffset, edgeZ, offset, offsetZ, h, kind:'C'|'A'|'—'}
 *   h > 0 corte, < 0 aterro; offset = afastamento do eixo (m) até o offset; null quando o talude sai do terreno levantado.
 */
export function serviceNotes(info, stations, terrainAt, {maxDistance = 1000} = {}) {
  if (!info.ok) return [];
  const c = info.corridor, path = info.axis.base, H = info.half;
  return stations.map(s0 => {
    const s = Math.min(Math.max(s0, 0), info.axis.length), p = pointAtStation(path, s);
    if (!p) return null;
    const g = gradeOnAxis(info, s), T = terrainAt(p.x, p.y), nx = -p.ty, ny = p.tx;
    const side = sign => {
      const ez = roadZ(c, g, sign * H), at = o => ({x: p.x + nx * sign * o, y: p.y + ny * sign * o});
      const e = at(H), Te = terrainAt(e.x, e.y);
      const kind = Te === null ? '—' : Math.abs(Te - ez) < 1e-6 ? '—' : Te > ez ? 'C' : 'A';
      if (Te === null) return {edgeOffset: H, edgeZ: ez, offset: null, offsetZ: null, h: null, kind};
      if (kind === '—') return {edgeOffset: H, edgeZ: ez, offset: H, offsetZ: ez, h: 0, kind};
      // o projeto existe enquanto o talude não encontra o terreno: procura a primeira distância sem projeto
      const design = o => { const q = at(o), Tq = terrainAt(q.x, q.y); return Tq === null ? undefined : corridorElevationAt(info, q.x, q.y, Tq); };
      let lo = H, hi = null, step = Math.max(.25, H / 10);
      for (let o = H + step; o <= H + maxDistance; o += step) { const z = design(o); if (z === undefined) return {edgeOffset: H, edgeZ: ez, offset: null, offsetZ: null, h: null, kind}; if (z === null) { hi = o; break; } lo = o; }
      if (hi === null) return {edgeOffset: H, edgeZ: ez, offset: null, offsetZ: null, h: null, kind};
      for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; if (design(m) === null) hi = m; else lo = m; }
      const q = at(lo), oz = terrainAt(q.x, q.y);
      return {edgeOffset: H, edgeZ: ez, offset: lo, offsetZ: oz, h: oz - ez, kind};
    };
    return {station: s, x: p.x, y: p.y, terrainZ: T, gradeZ: g, axisH: T === null ? null : T - g, left: side(1), right: side(-1)};
  }).filter(Boolean);
}

function gradeOnAxis(info, s) {
  const b = info.axis.base;
  if (s <= b[0].s) return b[0].z;
  for (let k = 1; k < b.length; k++) if (s <= b[k].s + 1e-9) { const a = b[k - 1], q = b[k], t = q.s > a.s ? (s - a.s) / (q.s - a.s) : 0; return a.z + t * (q.z - a.z); }
  return b.at(-1).z;
}

const f = (v, d = 3) => v === null || v === undefined || !Number.isFinite(v) ? '' : v.toFixed(d).replace('.', ',');
/** Estaca no formato km+metros (ex.: 0+120,00). */
export const stationLabel = s => `${Math.floor(s / 1000)}+${(s % 1000).toFixed(2).padStart(6, '0').replace('.', ',')}`;

/** Nota de serviço em CSV (separador ;, vírgula decimal), pronta para planilha. */
export function serviceNotesCSV(rows, {title = 'Nota de serviço'} = {}) {
  const head = ['Estaca', 'Terreno eixo', 'Greide', 'Eixo C/A (m)', 'Esq. offset (m)', 'Esq. cota offset', 'Esq. C/A', 'Esq. altura talude (m)', 'Esq. bordo (m)', 'Esq. cota bordo', 'Dir. bordo (m)', 'Dir. cota bordo', 'Dir. altura talude (m)', 'Dir. C/A', 'Dir. cota offset', 'Dir. offset (m)'];
  const ca = h => h === null ? '' : `${h >= 0 ? 'C' : 'A'} ${f(Math.abs(h), 2)}`;
  const lines = rows.map(r => [stationLabel(r.station), f(r.terrainZ), f(r.gradeZ), ca(r.axisH), f(r.left.offset, 2), f(r.left.offsetZ), r.left.kind, f(r.left.h === null ? null : Math.abs(r.left.h), 2), f(r.left.edgeOffset, 2), f(r.left.edgeZ), f(r.right.edgeOffset, 2), f(r.right.edgeZ), f(r.right.h === null ? null : Math.abs(r.right.h), 2), r.right.kind, f(r.right.offsetZ), f(r.right.offset, 2)].join(';'));
  return [title, head.join(';'), ...lines].join('\r\n') + '\r\n';
}
