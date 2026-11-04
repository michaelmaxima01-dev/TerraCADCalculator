// Importação de desenhos CAD (DWG/DXF) para pontos de terreno.
//
// Modelo CAD normalizado (produzido por parseDXF ou normalizeLibreDwg):
//   {entities, blocks:{nome:{base:{x,y,z}, entities}}, format}
// Entidades normalizadas:
//   {type:'point', layer, x, y, z}
//   {type:'polyline', layer, closed, vertices:[{x,y,z}]}
//   {type:'face', layer, vertices:[{x,y,z}]}            (3DFACE / malhas)
//   {type:'insert', layer, name, x, y, z, sx, sy, sz, rotation(rad), attrs:{TAG:valor}}
//
// extractSources agrupa a geometria em "fontes" (contêiner × tipo × camada) para o usuário escolher;
// buildCadPoints transforma as fontes escolhidas em pontos {id,x,y,z,description}.

const Z_TAGS = ['COTA', 'Z', 'ELEV', 'ELEVACAO', 'ELEVAÇÃO', 'ALTITUDE', 'ALT'];
const ID_TAGS = ['PONTO', 'PT', 'ID', 'NUM', 'NUMERO', 'NÚMERO', 'N', 'P'];
const DESC_TAGS = ['DESC', 'DESCRICAO', 'DESCRIÇÃO', 'DESCRIPTION', 'COD', 'CODIGO', 'CÓDIGO'];
const MAX_DEPTH = 8;
export const MODEL_CONTAINER = 'Desenho';

/** Número de atributo: aceita vírgula decimal ("313,361"). */
export function attrNumber(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim().replace(/\s+/g, '');
  if (!s) return null;
  const n = Number(/,\d+$/.test(s) && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}
const pick = (attrs, tags) => { for (const t of tags) if (attrs[t] !== undefined && String(attrs[t]).trim() !== '') return String(attrs[t]).trim(); return null; };

// Transformação afim: x' = a·x + b·y + e ; y' = c·x + d·y + f ; z' = sz·z + tz
const IDENTITY = {a: 1, b: 0, c: 0, d: 1, e: 0, f: 0, sz: 1, tz: 0};
const apply = (T, p) => ({x: T.a * p.x + T.b * p.y + T.e, y: T.c * p.x + T.d * p.y + T.f, z: T.sz * (p.z || 0) + T.tz});
function compose(P, L) { // P ∘ L
  return {a: P.a * L.a + P.b * L.c, b: P.a * L.b + P.b * L.d, c: P.c * L.a + P.d * L.c, d: P.c * L.b + P.d * L.d,
    e: P.a * L.e + P.b * L.f + P.e, f: P.c * L.e + P.d * L.f + P.f, sz: P.sz * L.sz, tz: P.sz * L.tz + P.tz};
}
/** Transformação de um INSERT: p' = R(rot)·S(sx,sy)·(p − base) + inserção. */
export function insertTransform(ins, base = {x: 0, y: 0, z: 0}) {
  const cos = Math.cos(ins.rotation || 0), sin = Math.sin(ins.rotation || 0), sx = ins.sx ?? 1, sy = ins.sy ?? 1, sz = ins.sz ?? 1;
  const a = cos * sx, b = -sin * sy, c = sin * sx, d = cos * sy;
  return {a, b, c, d, e: ins.x - (a * base.x + b * base.y), f: ins.y - (c * base.x + d * base.y), sz, tz: (ins.z || 0) - sz * (base.z || 0)};
}

/** Converte o DwgDatabase da LibreDWG (@mlightcad/libredwg-web) no modelo normalizado. */
export function normalizeLibreDwg(db) {
  const flipX = e => (e.extrusionDirection?.z ?? 1) < 0;
  const conv = list => {
    const out = [];
    for (const e of list || []) {
      const layer = String(e.layer ?? '0').trim() || '0', fx = flipX(e) ? -1 : 1;
      const P = p => ({x: Number(p?.x) || 0, y: Number(p?.y) || 0, z: Number(p?.z) || 0});
      switch (e.type) {
        case 'POINT': out.push({type: 'point', layer, ...P(e.position)}); break;
        case 'LINE': out.push({type: 'polyline', layer, closed: false, vertices: [P(e.startPoint), P(e.endPoint)]}); break;
        case 'LWPOLYLINE': out.push({type: 'polyline', layer, closed: !!(e.flag & 1 || e.flag & 512), vertices: (e.vertices || []).map(v => ({x: fx * (Number(v.x) || 0), y: Number(v.y) || 0, z: Number(e.elevation) || 0}))}); break;
        case 'POLYLINE2D': out.push({type: 'polyline', layer, closed: !!(e.flag & 1), vertices: (e.vertices || []).map(v => ({x: fx * (Number(v.x) || 0), y: Number(v.y) || 0, z: Number(v.z) || Number(e.elevation) || 0}))}); break;
        case 'POLYLINE3D': out.push({type: 'polyline', layer, closed: !!(e.flag & 1), vertices: (e.vertices || []).map(P)}); break;
        case '3DFACE': out.push({type: 'face', layer, vertices: [e.corner1, e.corner2, e.corner3, e.corner4].filter(Boolean).map(P)}); break;
        case 'INSERT': {
          const attrs = {};
          for (const a of e.attribs || []) attrs[String(a.tag || '').trim().toUpperCase()] = String(a.text?.text ?? a.text ?? '').trim();
          const ip = P(e.insertionPoint);
          out.push({type: 'insert', layer, name: String(e.name || ''), x: fx * ip.x, y: ip.y, z: ip.z, sx: fx * (e.xScale ?? 1), sy: e.yScale ?? 1, sz: e.zScale ?? 1, rotation: fx * (Number(e.rotation) || 0), attrs});
          break;
        }
        default: break;
      }
    }
    return out;
  };
  const records = db?.tables?.BLOCK_RECORD?.entries || [];
  const model = records.find(r => /^\*model_space$/i.test(r.name));
  const blocks = {};
  for (const r of records) if (r !== model) blocks[r.name] = {base: {x: r.basePoint?.x || 0, y: r.basePoint?.y || 0, z: r.basePoint?.z || 0}, entities: conv(r.entities)};
  return {entities: conv(model ? model.entities : db?.entities), blocks, format: 'DWG'};
}

/**
 * Agrupa a geometria com cota em fontes selecionáveis.
 * Blocos inseridos são expandidos com posição/escala/rotação. Blocos de ponto (com atributo de
 * cota/número, ou símbolo inserido com Z) viram um ponto. Blocos definidos mas nunca inseridos
 * aparecem como fontes próprias (ex.: levantamentos guardados como bloco).
 */
export function extractSources(model) {
  const blocks = model.blocks || {}, has3DCache = new Map();
  const has3D = (name, depth = 0) => {
    if (has3DCache.has(name)) return has3DCache.get(name);
    has3DCache.set(name, false);
    const b = blocks[name]; let r = false;
    if (b && depth < MAX_DEPTH) for (const e of b.entities) {
      if ((e.type === 'polyline' || e.type === 'face') && e.vertices.some(v => v.z !== 0)) { r = true; break; }
      if (e.type === 'point' && e.z !== 0) { r = true; break; }
      if (e.type === 'insert' && has3D(e.name, depth + 1)) { r = true; break; }
    }
    has3DCache.set(name, r); return r;
  };
  const sources = new Map();
  const sourceFor = (container, kind, layer, inserted) => {
    const key = `${container}\u0000${kind}\u0000${layer}`;
    let s = sources.get(key);
    if (!s) sources.set(key, s = {key, container, inserted, kind, layer, items: []});
    return s;
  };
  function walk(list, T, inheritLayer, container, inserted, depth) {
    for (const e of list) {
      const layer = e.layer === '0' && inheritLayer ? inheritLayer : e.layer;
      if (e.type === 'point') sourceFor(container, 'points', layer, inserted).items.push({...apply(T, e), id: null, description: null});
      else if (e.type === 'polyline') { if (e.vertices.length >= 2) sourceFor(container, 'lines', layer, inserted).items.push(e.vertices.map(v => apply(T, v))); }
      else if (e.type === 'face') { if (e.vertices.length >= 3) sourceFor(container, 'faces', layer, inserted).items.push(e.vertices.map(v => apply(T, v))); }
      else if (e.type === 'insert') {
        const block = blocks[e.name]; if (!block) continue;
        const attrs = e.attrs || {}, w = apply(T, e), zAttr = attrNumber(pick(attrs, Z_TAGS)), id = pick(attrs, ID_TAGS);
        if (zAttr !== null || id !== null || (w.z !== 0 && !has3D(e.name))) {
          sourceFor(container, 'points', layer, inserted).items.push({x: w.x, y: w.y, z: w.z !== 0 ? w.z : zAttr ?? 0, id, description: pick(attrs, DESC_TAGS)});
        } else if (depth < MAX_DEPTH) walk(block.entities, compose(T, insertTransform(e, block.base)), layer, container, inserted, depth + 1);
      }
    }
  }
  walk(model.entities || [], IDENTITY, null, MODEL_CONTAINER, true, 0);
  // blocos raiz nunca referenciados (nem no desenho, nem em outros blocos ou layouts)
  const referenced = new Set();
  const mark = list => list.forEach(e => e.type === 'insert' && referenced.add(e.name));
  mark(model.entities || []); Object.values(blocks).forEach(b => mark(b.entities));
  for (const [name, b] of Object.entries(blocks)) {
    if (name.startsWith('*') || referenced.has(name)) continue;
    walk(b.entities, insertTransform({x: 0, y: 0, z: 0}, {x: 0, y: 0, z: 0}), null, `Bloco ${name}`, false, 0);
  }
  const out = [...sources.values()].map(s => {
    const vs = s.kind === 'points' ? s.items : s.items.flat();
    let zMin = Infinity, zMax = -Infinity, minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const v of vs) { if (v.z < zMin) zMin = v.z; if (v.z > zMax) zMax = v.z; if (v.x < minX) minX = v.x; if (v.x > maxX) maxX = v.x; if (v.y < minY) minY = v.y; if (v.y > maxY) maxY = v.y; }
    const flat = vs.every(v => v.z === 0);
    return {...s, count: s.items.length, vertexCount: vs.length, zMin, zMax, bbox: {minX, minY, maxX, maxY}, flat, defaultOn: false};
  }).filter(s => s.vertexCount > 0);
  // padrão: fontes com cota do próprio desenho (ou, sem elas, de blocos não inseridos),
  // apenas da região principal — a que reúne mais vértices.
  let candidates = out.filter(s => s.inserted && !s.flat);
  if (!candidates.length) {
    const byContainer = new Map();
    out.filter(s => !s.flat).forEach(s => byContainer.set(s.container, (byContainer.get(s.container) || 0) + s.vertexCount));
    const best = [...byContainer].sort((a, b) => b[1] - a[1])[0];
    candidates = best ? out.filter(s => s.container === best[0] && !s.flat) : [];
  }
  const groups = clusterSources(candidates);
  const main = groups.sort((a, b) => b.reduce((t, s) => t + s.vertexCount, 0) - a.reduce((t, s) => t + s.vertexCount, 0))[0] || [];
  main.forEach(s => { s.defaultOn = true; });
  return out.sort((a, b) => Number(a.flat) - Number(b.flat) || Number(b.inserted) - Number(a.inserted) || b.vertexCount - a.vertexCount);
}

/** Remove vértices mais próximos que `spacing` (em XY) do último mantido; mantém sempre as pontas. */
export function decimateLine(vertices, spacing) {
  if (!(spacing > 0) || vertices.length <= 2) return vertices.slice();
  const out = [vertices[0]];
  for (let i = 1; i < vertices.length - 1; i++) {
    const p = out[out.length - 1], v = vertices[i];
    if (Math.hypot(v.x - p.x, v.y - p.y) >= spacing) out.push(v);
  }
  out.push(vertices[vertices.length - 1]);
  return out;
}

/**
 * Pontos de terreno a partir das fontes escolhidas.
 * @param {object[]} sources fontes de extractSources (já filtradas pelo usuário)
 * @param {{spacing?:number}} options espaçamento mínimo entre vértices de linhas (m)
 * @returns {{points:Array<{id,x,y,z,description}>, stats:{points:number, lines:number, faces:number, duplicates:number}}}
 */
export function buildCadPoints(sources, {spacing = 0} = {}) {
  const points = [], seen = new Set(), ids = new Set(), stats = {points: 0, lines: 0, faces: 0, duplicates: 0}, counters = {P: 0, C: 0, F: 0};
  const uniqueId = (raw, prefix) => {
    let base = raw ? String(raw).trim() : '';
    if (!base) { do base = prefix + ++counters[prefix]; while (ids.has(base)); }
    let id = base, k = 2; while (ids.has(id)) id = `${base}-${k++}`;
    ids.add(id); return id;
  };
  const push = (v, rawId, description, prefix, kind) => {
    if (![v.x, v.y, v.z].every(Number.isFinite)) return;
    const key = `${Math.round(v.x * 1e4)}:${Math.round(v.y * 1e4)}`;
    if (seen.has(key)) { stats.duplicates++; return; }
    seen.add(key); stats[kind]++;
    points.push({id: uniqueId(rawId, prefix), x: v.x, y: v.y, z: v.z, description: String(description || '').trim()});
  };
  for (const s of sources) {
    if (s.kind === 'points') s.items.forEach(p => push(p, p.id, p.description || s.layer, 'P', 'points'));
    else if (s.kind === 'lines') s.items.forEach(line => decimateLine(line, spacing).forEach(v => push(v, null, s.layer, 'C', 'lines')));
    else s.items.forEach(face => face.forEach(v => push(v, null, s.layer, 'F', 'faces')));
  }
  return {points, stats};
}

/**
 * Verifica se as fontes escolhidas formam regiões separadas (ex.: dois levantamentos em lugares
 * diferentes). Triangular tudo junto criaria uma malha distorcida entre elas.
 * @returns {null | {regions:number, distance:number}} distância entre centros das regiões mais afastadas (m)
 */
export function separateRegions(sources) {
  const groups = clusterSources(sources);
  if (groups.length < 2) return null;
  const centers = groups.map(g => { const b = unionBox(g); return {x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2}; });
  let distance = 0;
  for (let i = 0; i < centers.length; i++) for (let j = i + 1; j < centers.length; j++) distance = Math.max(distance, Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y));
  return {regions: groups.length, distance};
}

const unionBox = list => list.reduce((g, s) => ({minX: Math.min(g.minX, s.bbox.minX), minY: Math.min(g.minY, s.bbox.minY), maxX: Math.max(g.maxX, s.bbox.maxX), maxY: Math.max(g.maxY, s.bbox.maxY)}), {minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity});

/** Agrupa fontes cujas extensões se tocam (com folga de meia diagonal da maior fonte, mín. 25 m). */
export function clusterSources(sources) {
  const list = sources.filter(s => Number.isFinite(s.bbox?.minX));
  if (!list.length) return [];
  const diag = s => Math.hypot(s.bbox.maxX - s.bbox.minX, s.bbox.maxY - s.bbox.minY);
  const margin = Math.max(50, ...list.map(diag)) * 0.5;
  const parent = list.map((_, i) => i), find = i => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const near = (a, b) => a.bbox.minX - margin <= b.bbox.maxX && b.bbox.minX - margin <= a.bbox.maxX && a.bbox.minY - margin <= b.bbox.maxY && b.bbox.minY - margin <= a.bbox.maxY;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) if (near(list[i], list[j])) parent[find(i)] = find(j);
  const groups = new Map();
  list.forEach((s, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(s); });
  return [...groups.values()];
}

/**
 * Espaçamento sugerido para as linhas: o menor da escala que mantém o total perto de `target`
 * pontos (a triangulação leva ≈ 3 s para 10 mil pontos).
 */
export function suggestSpacing(sources, target = 6000) {
  for (const spacing of [0, 0.25, 0.5, 1, 2, 5, 10, 20, 50]) if (buildCadPoints(sources, {spacing}).points.length <= target) return spacing;
  return 50;
}

/** Resumo leve das fontes (sem a geometria), para exibir antes de importar. */
export const summarizeSource = ({items, ...rest}) => rest;
