// Leitor DXF ASCII mínimo para dados de terreno.
// Lê só o que interessa à superfície: POINT, LINE, LWPOLYLINE, POLYLINE/VERTEX, 3DFACE,
// INSERT (com ATTRIB) e as definições de BLOCK. Devolve o modelo CAD normalizado usado por cad.js.

/** Decodifica bytes de DXF: UTF-8 quando válido, senão Windows-1252 (DXF anteriores a 2007). */
export function decodeDxfBytes(bytes) {
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

function pairsOf(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/), out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw Error(`DXF inválido perto da linha ${i + 1}. Salve o desenho novamente como DXF ASCII.`);
    out.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return out;
}

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** Agrupa os pares em registros que começam no código 0. */
function records(pairs, from, to) {
  const out = []; let cur = null;
  for (let i = from; i < to; i++) {
    const [c, v] = pairs[i];
    if (c === 0) { cur = {type: v.trim(), codes: []}; out.push(cur); }
    else if (cur) cur.codes.push([c, v]);
  }
  return out;
}
const first = (r, code, d) => { const p = r.codes.find(([c]) => c === code); return p ? p[1] : d; };
const extrusionZ = r => num(first(r, 230, 1), 1);

/** Converte uma lista de registros (de ENTITIES ou de um BLOCK) em entidades normalizadas. */
function entitiesOf(recs) {
  const out = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i], layer = String(first(r, 8, '0')).trim() || '0';
    const P = (cx, cy, cz) => ({x: num(first(r, cx)), y: num(first(r, cy)), z: num(first(r, cz))});
    if (r.type === 'POINT') out.push({type: 'point', layer, ...P(10, 20, 30)});
    else if (r.type === 'LINE') out.push({type: 'polyline', layer, closed: false, vertices: [P(10, 20, 30), P(11, 21, 31)]});
    else if (r.type === '3DFACE') {
      const v = [P(10, 20, 30), P(11, 21, 31), P(12, 22, 32), P(13, 23, 33)];
      out.push({type: 'face', layer, vertices: v});
    } else if (r.type === 'LWPOLYLINE') {
      const z = num(first(r, 38)), flip = extrusionZ(r) < 0, vertices = []; let cur = null;
      for (const [c, v] of r.codes) {
        if (c === 10) { cur = {x: num(v) * (flip ? -1 : 1), y: 0, z}; vertices.push(cur); }
        else if (c === 20 && cur) cur.y = num(v);
      }
      out.push({type: 'polyline', layer, closed: (num(first(r, 70)) & 1) === 1, vertices});
    } else if (r.type === 'POLYLINE') {
      const flags = num(first(r, 70)), elev = num(first(r, 30)), is3d = (flags & 8) === 8, mesh = (flags & 16) || (flags & 64);
      const flip = !is3d && extrusionZ(r) < 0, vertices = [];
      let j = i + 1;
      for (; j < recs.length && recs[j].type === 'VERTEX'; j++) {
        const v = recs[j], vf = num(first(v, 70));
        if (vf & 128 && !(vf & 64)) continue; // registro de face de polyface (sem coordenada própria)
        if (vf & 16) continue; // ponto de controle de spline
        vertices.push({x: num(first(v, 10)) * (flip ? -1 : 1), y: num(first(v, 20)), z: is3d || (vf & 64) ? num(first(v, 30)) : elev});
      }
      if (recs[j]?.type === 'SEQEND') j++;
      i = j - 1;
      if (mesh) out.push({type: 'face', layer, vertices});
      else out.push({type: 'polyline', layer, closed: (flags & 1) === 1, vertices});
    } else if (r.type === 'INSERT') {
      const attrs = {}; let j = i + 1;
      for (; j < recs.length && recs[j].type === 'ATTRIB'; j++) attrs[String(first(recs[j], 2, '')).trim().toUpperCase()] = String(first(recs[j], 1, '')).trim();
      if (recs[j]?.type === 'SEQEND') j++;
      i = j - 1;
      const flip = extrusionZ(r) < 0;
      out.push({type: 'insert', layer, name: String(first(r, 2, '')).trim(), x: num(first(r, 10)) * (flip ? -1 : 1), y: num(first(r, 20)), z: num(first(r, 30)),
        sx: num(first(r, 41), 1) * (flip ? -1 : 1), sy: num(first(r, 42), 1), sz: num(first(r, 43), 1), rotation: num(first(r, 50)) * Math.PI / 180 * (flip ? -1 : 1), attrs});
    }
  }
  return out;
}

/**
 * Lê um DXF ASCII.
 * @returns {{entities:object[], blocks:Object<string,{base:{x,y,z}, entities:object[]}>, layouts:object[][], format:string}}
 */
export function parseDXF(text) {
  const pairs = pairsOf(text);
  if (!pairs.some(([c, v]) => c === 0 && v.trim() === 'SECTION')) throw Error('O arquivo não parece ser um DXF (sem seções). Salve o desenho como DXF ASCII.');
  const sections = {};
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1].trim() === 'SECTION' && pairs[i + 1]?.[0] === 2) {
      const name = pairs[i + 1][1].trim(); let j = i + 2;
      while (j < pairs.length && !(pairs[j][0] === 0 && pairs[j][1].trim() === 'ENDSEC')) j++;
      sections[name] = [i + 2, j]; i = j;
    }
  }
  const blocks = {};
  if (sections.BLOCKS) {
    const recs = records(pairs, ...sections.BLOCKS);
    for (let i = 0; i < recs.length; i++) {
      if (recs[i].type !== 'BLOCK') continue;
      const b = recs[i], name = String(first(b, 2, '')).trim(); let j = i + 1;
      while (j < recs.length && recs[j].type !== 'ENDBLK') j++;
      blocks[name] = {base: {x: num(first(b, 10)), y: num(first(b, 20)), z: num(first(b, 30))}, entities: entitiesOf(recs.slice(i + 1, j))};
      i = j;
    }
  }
  const entities = sections.ENTITIES ? entitiesOf(records(pairs, ...sections.ENTITIES)) : [];
  const ver = pairs.findIndex(([c, v]) => c === 9 && v.trim() === '$ACADVER');
  return {entities, blocks, layouts: [], format: 'DXF ' + (ver >= 0 ? pairs[ver + 1][1].trim() : '')};
}
