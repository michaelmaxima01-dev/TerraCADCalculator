// Exportadores para intercâmbio com CAD/BIM.
// - DXF R12 ASCII (AC1009): lido por AutoCAD, Civil 3D, BricsCAD, QGIS, LibreCAD.
// - LandXML 1.2: superfície TIN importável no Civil 3D (Prospector > Superfícies > Importar).
// - CSV PENZD: pontos no formato usual de levantamento.

const n = v => (Math.round(v * 1e4) / 1e4).toString();
const pair = (code, value) => `${code}\n${value}\n`;
const safeLayer = s => String(s || 'SEM_DESCRICAO').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9_-]/g, '_').slice(0, 31) || 'SEM_DESCRICAO';

export const DXF_LAYERS = {
  TIN: {name: 'TC_TIN', color: 8}, BORDA: {name: 'TC_BORDA', color: 4}, RUPTURA: {name: 'TC_RUPTURA', color: 30},
  CONTORNO: {name: 'TC_CONTORNO', color: 5}, CN_MESTRA: {name: 'TC_CN_MESTRA', color: 1}, CN_INTERMEDIARIA: {name: 'TC_CN_INTERMEDIARIA', color: 9},
  PERFIL: {name: 'TC_PERFIL', color: 6}, PONTOS: {name: 'TC_PONTOS', color: 7}, ROTULOS: {name: 'TC_ROTULOS', color: 2},
  PLATAFORMA: {name: 'TC_PLATAFORMA', color: 253}, TALUDE_CORTE: {name: 'TC_TALUDE_CORTE', color: 30}, TALUDE_ATERRO: {name: 'TC_TALUDE_ATERRO', color: 140},
  PLAT_BORDA: {name: 'TC_PLAT_BORDA', color: 7}, BERMA: {name: 'TC_BERMA', color: 2}, LP_EIXO: {name: 'TC_LP_EIXO', color: 6}, LP_OFFSET: {name: 'TC_LP_OFFSET', color: 3}, LP_CRISTA: {name: 'TC_LP_CRISTA', color: 2}, LP_PE: {name: 'TC_LP_PE', color: 30}, LP_FUNDO: {name: 'TC_LP_FUNDO', color: 5}, FUNDO: {name: 'TC_FUNDO', color: 8}, BERMA_FACE: {name: 'TC_BERMA_FACE', color: 42}, OFFSET: {name: 'TC_OFFSET', color: 3}, GREIDE: {name: 'TC_GREIDE', color: 1}, SECOES: {name: 'TC_SECOES', color: 4}
};

function polyline3D(layer, coords, closed) {
  let s = pair(0, 'POLYLINE') + pair(8, layer) + pair(66, 1) + pair(10, 0) + pair(20, 0) + pair(30, 0) + pair(70, 8 | (closed ? 1 : 0));
  for (const [x, y, z] of coords) s += pair(0, 'VERTEX') + pair(8, layer) + pair(10, n(x)) + pair(20, n(y)) + pair(30, n(z)) + pair(70, 32);
  return s + pair(0, 'SEQEND') + pair(8, layer);
}

/**
 * @param {object} model {points, triangles, breaklines, boundary, contours, alignment, profile}
 * @param {object} options {tin, points, labels, contours, breaklines, boundary, alignment}
 */
export function toDXF(model, options = {}) {
  const o = {tin: true, points: true, labels: true, contours: true, breaklines: true, boundary: true, alignment: true, ...options};
  const {points, triangles = [], breaklines = [], boundary = [], contours = null, profile = null, designs = [], gradeLine = null, sections = []} = model;
  const groupLayers = new Map();
  if (o.points) points.forEach(p => groupLayers.set(p.description, 'TC_PT_' + safeLayer(p.description).slice(0, 25)));
  const layers = [...Object.values(DXF_LAYERS), ...[...new Set(groupLayers.values())].map(name => ({name, color: 3}))];
  let out = pair(0, 'SECTION') + pair(2, 'HEADER') + pair(9, '$ACADVER') + pair(1, 'AC1009') + pair(9, '$INSUNITS') + pair(70, 6) + pair(0, 'ENDSEC');
  out += pair(0, 'SECTION') + pair(2, 'TABLES') + pair(0, 'TABLE') + pair(2, 'LAYER') + pair(70, layers.length);
  for (const l of layers) out += pair(0, 'LAYER') + pair(2, l.name) + pair(70, 0) + pair(62, l.color) + pair(6, 'CONTINUOUS');
  out += pair(0, 'ENDTAB') + pair(0, 'ENDSEC') + pair(0, 'SECTION') + pair(2, 'ENTITIES');
  if (o.tin) for (const t of triangles) {
    const [a, b, c] = t.map(i => points[i]); let s = pair(0, '3DFACE') + pair(8, DXF_LAYERS.TIN.name);
    [a, b, c, c].forEach((p, k) => { s += pair(10 + k, n(p.x)) + pair(20 + k, n(p.y)) + pair(30 + k, n(p.z)); });
    out += s;
  }
  if (o.points) for (const p of points) {
    const layer = groupLayers.get(p.description);
    out += pair(0, 'POINT') + pair(8, layer) + pair(10, n(p.x)) + pair(20, n(p.y)) + pair(30, n(p.z));
    if (o.labels) out += pair(0, 'TEXT') + pair(8, DXF_LAYERS.ROTULOS.name) + pair(10, n(p.x)) + pair(20, n(p.y)) + pair(30, n(p.z)) + pair(40, 0.5) + pair(1, `${p.id} ${n(p.z)}${p.description ? ' ' + p.description : ''}`);
  }
  const P = i => [points[i].x, points[i].y, points[i].z];
  if (o.breaklines) for (const line of breaklines) out += polyline3D(DXF_LAYERS.RUPTURA.name, line.map(P), false);
  if (o.boundary && boundary.length) out += polyline3D(DXF_LAYERS.CONTORNO.name, boundary.map(P), true);
  if (o.contours && contours) for (const level of contours.levels) for (const line of level.lines)
    out += polyline3D(level.major ? DXF_LAYERS.CN_MESTRA.name : DXF_LAYERS.CN_INTERMEDIARIA.name, line.coords.map(([x, y]) => [x, y, level.z]), line.closed);
  if (o.alignment && profile?.samples?.length) {
    let run = [];
    const flush = () => { if (run.length > 1) out += polyline3D(DXF_LAYERS.PERFIL.name, run, false); run = []; };
    for (const s of profile.samples) { if (s.z === null) flush(); else run.push([s.x, s.y, s.z]); }
    flush();
  }
  // Projeto: plataformas e taludes (3DFACE por tipo), borda da plataforma e linha de offset
  const face = (layer, [a, b, c]) => { let f = pair(0, '3DFACE') + pair(8, layer); [a, b, c, c].forEach((p, k) => { f += pair(10 + k, n(p.x)) + pair(20 + k, n(p.y)) + pair(30 + k, n(p.z)); }); return f; };
  for (const d of designs) {
    d.mesh.triangles.forEach((t, k) => { const type = d.mesh.types[k]; if (type === 'wall') return; out += face(type === 'platform' ? DXF_LAYERS.PLATAFORMA.name : type === 'floor' ? DXF_LAYERS.FUNDO.name : type === 'bench' ? DXF_LAYERS.BERMA_FACE.name : type === 'fill' ? DXF_LAYERS.TALUDE_ATERRO.name : DXF_LAYERS.TALUDE_CORTE.name, t.map(i => d.mesh.vertices[i])); });
    if (d.kind === 'line') { // linha de projeto: eixo 3D, offset e cristas/pés das bermas
      if (d.mesh.base?.length > 1) out += polyline3D(DXF_LAYERS.LP_EIXO.name, d.mesh.base.map(p => [p.x, p.y, p.z]), d.line.closed);
      (d.mesh.benchLines || []).forEach((line, k) => { out += polyline3D(d.mesh.benchLineKinds?.[k] === 'toe' ? DXF_LAYERS.LP_PE.name : DXF_LAYERS.LP_CRISTA.name, line.map(p => [p.x, p.y, p.z]), false); });
      if (d.mesh.floorOutline?.length > 1) out += polyline3D(DXF_LAYERS.LP_FUNDO.name, d.mesh.floorOutline.map(p => [p.x, p.y, p.z]), d.line.closed);
      if (d.mesh.daylight.length > 1) out += polyline3D(DXF_LAYERS.LP_OFFSET.name, d.mesh.daylight.map(p => [p.x, p.y, p.z]), d.line.closed);
      continue;
    }
    out += polyline3D(DXF_LAYERS.PLAT_BORDA.name, d.platform.polygon.map(p => [p.x, p.y, Number.isFinite(p.z) ? p.z : d.platform.elevation]), true);
    for (const line of d.mesh.benchLines || []) out += polyline3D(DXF_LAYERS.BERMA.name, line.map(p => [p.x, p.y, p.z]), false);
    out += polyline3D(DXF_LAYERS.OFFSET.name, d.mesh.daylight.map(p => [p.x, p.y, p.z]), true);
    if (d.mesh.floorOutline?.length > 1) out += polyline3D(DXF_LAYERS.LP_FUNDO.name, d.mesh.floorOutline.map(p => [p.x, p.y, p.z]), true);
  }
  if (gradeLine && gradeLine.length > 1) out += polyline3D(DXF_LAYERS.GREIDE.name, gradeLine.map(p => [p.x, p.y, p.z]), false);
  for (const sec of sections) {
    let run = [];
    const flush = () => { if (run.length > 1) out += polyline3D(DXF_LAYERS.SECOES.name, run, false); run = []; };
    for (const p of sec.terrain3D || []) { if (p.z === null) flush(); else run.push([p.x, p.y, p.z]); }
    flush();
  }
  return out + pair(0, 'ENDSEC') + pair(0, 'EOF');
}

const xml = s => String(s).replace(/[<>&"']/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'}[c]));

/** LandXML 1.2 com uma superfície TIN. Pnts usam a ordem Norte Este Cota, como o padrão exige. */
export function toLandXML({points, triangles, boundary = []}, {name = 'TerraCAD', date = new Date(), extra = []} = {}) {
  const used = [...new Set(triangles.flat())].sort((a, b) => a - b), id = new Map(used.map((p, k) => [p, k + 1]));
  const d = date.toISOString();
  let s = `<?xml version="1.0" encoding="UTF-8"?>\n<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" date="${d.slice(0, 10)}" time="${d.slice(11, 19)}">\n`;
  s += ` <Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="milliBars"/></Units>\n`;
  s += ` <Application name="Terra CAD" version="4.0"/>\n <Surfaces>\n  <Surface name="${xml(name)}">\n`;
  if (boundary.length) s += `   <SourceData><Boundaries><Boundary bndType="outer" edgeTrim="true" name="Contorno"><PntList3D>${[...boundary, boundary[0]].map(i => `${n(points[i].y)} ${n(points[i].x)} ${n(points[i].z)}`).join(' ')}</PntList3D></Boundary></Boundaries></SourceData>\n`;
  s += `   <Definition surfType="TIN">\n    <Pnts>\n`;
  for (const p of used) s += `     <P id="${id.get(p)}">${n(points[p].y)} ${n(points[p].x)} ${n(points[p].z)}</P>\n`;
  s += `    </Pnts>\n    <Faces>\n`;
  for (const t of triangles) s += `     <F>${t.map(i => id.get(i)).join(' ')}</F>\n`;
  s += `    </Faces>\n   </Definition>\n  </Surface>\n`;
  for (const e of extra) {
    if (!e.triangles.length) continue;
    s += `  <Surface name="${xml(e.name)}">\n   <Definition surfType="TIN">\n    <Pnts>\n`;
    e.vertices.forEach((p, k) => { s += `     <P id="${k + 1}">${n(p.y)} ${n(p.x)} ${n(p.z)}</P>\n`; });
    s += `    </Pnts>\n    <Faces>\n`;
    for (const t of e.triangles) s += `     <F>${t.map(i => i + 1).join(' ')}</F>\n`;
    s += `    </Faces>\n   </Definition>\n  </Surface>\n`;
  }
  return s + ` </Surfaces>\n</LandXML>\n`;
}

export function toCSV(points) {
  const q = s => /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  return 'P;E;N;Z;D\n' + points.map(p => [q(p.id), n(p.x), n(p.y), n(p.z), q(p.description)].join(';')).join('\n') + '\n';
}
