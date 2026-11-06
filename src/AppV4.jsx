import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Viewport from './components/ViewportV4';
import PointTools from './components/PointTools';
import ProfileEditor from './components/ProfileEditor';
import SectionViewer from './components/SectionViewer';
import CadImportDialog from './components/CadImportDialog';
import Icon from './components/Icons';
import {NumberField} from './components/Fields';
import DesignLineCard from './components/DesignLineCard';
import SlopeFields from './components/SlopeFields';
import {useLicense, AccountMenu, LicenseBanner, LockScreen, AdminPanel} from './auth/Account';
import {pointGroups, upsertPoint} from './core/points';
import {editEdge} from './core/tin';
import {buildSurface} from './core/surface';
import {buildContours} from './core/contours';
import {surfaceStats, volumeToPlane, balanceElevation} from './core/volumes';
import {sampleProfile, profileContext} from './core/profile';
import {gradeGeometry, gradeElevation, sampleGrade} from './core/grade';
import {drapeBreakline} from './core/breaklines';
import {gradePlatform, platformVolumes, designSurfaceFunction, validatePolygon, cleanRing, validatePlatform, meanTerrainInside, clipTerrainMesh, shiftPlatform, applyPlaneSlope, flattenPlatform, isRamp, platformVertexZ, BENCH_DEFAULT} from './core/grading';
import {pointAtStation, sectionStations, sampleSection, averageEndArea, cubageTable} from './core/sections';
import CubageTable from './components/CubageTable';
import CorridorCard from './components/CorridorCard';
import ServiceNotes from './components/ServiceNotes';
import {validateCorridor, compileCorridor, gradeCorridor, corridorVolumes, corridorElevationAt, serviceNotes, serviceNotesCSV} from './core/corridor';
import {validateDesignLine, moveVertex, insertVertex, removeVertex, checkVertices, nextName} from './core/designLine';
import {gradeLine, lineVolumes} from './core/lineGrading';
import {createSnapIndex} from './core/snap';
import {toDXF, toLandXML, toCSV} from './core/exporters';

const VERSION = '5.1';
const demo = Array.from({length: 117}, (_, i) => {
  const x = i % 13 * 15, y = Math.floor(i / 13) * 18;
  return {id: `P${String(i + 1).padStart(3, '0')}`, x: 320000 + x, y: 7420000 + y, z: 100 + 20 * Math.sin(x / 70) * Math.cos(y / 100) + y * .06, description: i % 13 === 0 ? 'BE' : i % 13 === 12 ? 'BD' : 'TN'};
});
const emptyDesign = {alignment: [], grade: [], platforms: [], designLines: [], corridor: null};
const initial = {points: demo, breaklines: [], boundary: [], maxEdge: 0, ...emptyDesign, mesh: buildSurface(demo)};
const defaultStyle = {visible: true, id: true, elevation: false, description: false, color: '#d7eade', size: 12, precision: 3};
const defaultContours = {visible2D: true, visible3D: true, labels: true, interval: 1, majorEvery: 5};
const TOOL_NAMES = {orbit: 'Navegar', breakline: 'Linha obrigatória', boundary: 'Contorno', swap: 'Inverter aresta', delete: 'Aparar malha', profile: 'Eixo do perfil', platform: 'Plataforma', line: 'Linha de projeto'};
const TOOL_HINTS = {
  breakline: 'Clique nós do levantamento ou pontos livres (assentados na TIN). Enter conclui e recalcula.',
  boundary: 'Selecione os pontos do perímetro em sequência. Enter fecha e recorta.',
  profile: 'Clique os vértices do eixo na planta. Enter gera o perfil.',
  platform: 'Clique os vértices da plataforma (mín. 3). Clique no 1º vértice ou Enter para fechar e gerar os taludes. Pode criar quantas quiser.',
  line: 'Clique os PIs da linha. Enter conclui aberta; clique no 1º PI para fechar.'
};
const fmt = (v, d = 2) => Number.isFinite(v) ? v.toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d}) : '—';
const KIND_RANK = {node: 0, vertex: 0, midpoint: 1, nearest: 2};

function useGeometry() {
  const worker = useRef(), pending = useRef(), serial = useRef(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    try {
      const w = new Worker(new URL('./core/geometry.worker.js', import.meta.url), {type: 'module'}); worker.current = w;
      w.onmessage = ({data}) => { if (data.id !== pending.current?.id) return; const job = pending.current; pending.current = null; setBusy(false); data.error ? job.reject(Error(data.error)) : job.resolve(data.result); };
      w.onerror = () => { pending.current?.reject(Error('Falha no cálculo. Recarregue a página e tente novamente.')); pending.current = null; setBusy(false); };
      return () => { w.terminate(); pending.current?.reject(Error('Cálculo cancelado.')); };
    } catch { worker.current = null; }
  }, []);
  const run = useCallback((type, payload) => new Promise((resolve, reject) => {
    if (pending.current) return reject(Error('Aguarde o cálculo em andamento.'));
    if (!worker.current) return reject(Error('Este navegador não iniciou o processamento em segundo plano. Use o endereço HTTP da aplicação.'));
    const id = ++serial.current; pending.current = {id, resolve, reject}; setBusy(true); worker.current.postMessage({id, type, payload});
  }), []);
  return {run, busy};
}
function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const newId = () => 'pf-' + Math.random().toString(36).slice(2, 8);

/** Seção recolhível do painel de propriedades. */
function Panel({title, children, open = true}) {
  return <details className="panel" open={open}><summary>{title}</summary><div className="panel-body">{children}</div></details>;
}
const TOOLS = [['orbit', 'orbit', 'N'], ['breakline', 'breakline', 'L'], ['boundary', 'boundary', 'B'], ['profile', 'profile', 'P'], ['platform', 'platform', 'G'], ['line', 'line', 'T'], ['swap', 'swap', 'S'], ['delete', 'trim', 'D']];
const VIEWS = [['2D', 'Planta', '2'], ['split', '2D + 3D', 'V'], ['3D', '3D', '3'], ['profile', 'Perfil', '4'], ['sections', 'Seções', '5']];
const SIDE_TABS = [['terrain', 'Terreno', 'terrain'], ['design', 'Projeto', 'design'], ['display', 'Exibição', 'display'], ['export', 'Exportar', 'export']];
const Compass = () => <svg className="compass" width="34" height="34" viewBox="0 0 34 34" aria-label="Norte para cima" role="img"><circle cx="17" cy="17" r="15.5"/><path className="needle" d="M17 5l4 12h-8z"/><path d="M17 29l-4-12h8z"/><text x="17" y="4.6">N</text></svg>;


export default function AppV4() {
  const [doc, setDoc] = useState(initial), [history, setHistory] = useState([]), [splitRatio, setSplitRatio] = useState(50), [layout, setLayout] = useState('split');
  const [sideTab, setSideTab] = useState('terrain');
  const [tool, setTool] = useState('orbit'), [selected, setSelected] = useState([]), [pickDraft, setPickDraft] = useState([]);
  const [message, setMessage] = useState(`Versão ${VERSION} · Greide editável, linhas obrigatórias livres, plataformas com taludes, seções e navegação CAD.`), [errors, setErrors] = useState([]);
  const [style, setStyle] = useState(defaultStyle), [preset, setPreset] = useState('id');
  const [layers, setLayers] = useState({points: true, edges: true, breaklines: true, border: true, grid: true, sections: true});
  const [presentation, setPresentation] = useState({style: 'concept', grid: false, referencePlane: true});
  const [groupColors, setGroupColors] = useState({BE: '#80c6ff', BD: '#ffd27b', TN: '#d1efdf', RUPTURA: '#ffbd70'}), [group, setGroup] = useState('');
  const [schema, setSchema] = useState('auto'), [mappingText, setMappingText] = useState('P,E,N,Z,D'), [edgeDraft, setEdgeDraft] = useState('0');
  const [snap, setSnap] = useState(true), [snapModes, setSnapModes] = useState({node: true, vertex: true, midpoint: true, nearest: false}), [snapAperture, setSnapAperture] = useState(18);
  const [zoomSensitivity, setZoomSensitivity] = useState(1), [crosshair, setCrosshair] = useState(true), [fitKey, setFitKey] = useState(0), [densify, setDensify] = useState(true);
  const [showTable, setShowTable] = useState(false), [showProfileDock, setShowProfileDock] = useState(true), [help, setHelp] = useState(false), [revision, setRevision] = useState(0), [cadImport, setCadImport] = useState(null), [rampDraft, setRampDraft] = useState({}), [openSub, setOpenSub] = useState({}), [inspectorOpen, setInspectorOpen] = useState(() => typeof window === 'undefined' || window.innerWidth > 900);
  const [contourStyle, setContourStyle] = useState(defaultContours), [contourDraft, setContourDraft] = useState({interval: '1', majorEvery: '5'});
  const [referenceDraft, setReferenceDraft] = useState(''), [dxfOptions, setDxfOptions] = useState({tin: true, points: true, labels: true, contours: true, design: true, grade: true, sections: false});
  const [selectedPlatform, setSelectedPlatformRaw] = useState(null), [sectionSettings, setSectionSettings] = useState({interval: 20, halfWidth: 30}), [sectionIndex, setSectionIndex] = useState(0), [equalScale, setEqualScale] = useState(false);
  const [viewportH, setViewportH] = useState(() => typeof window === 'undefined' ? 900 : window.innerHeight);
  useEffect(() => { const r = () => setViewportH(window.innerHeight); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r); }, []);
  const license = useLicense(), [adminOpen, setAdminOpen] = useState(false);
  const {run, busy} = useGeometry(); const pointFile = useRef(), projectFile = useRef();
  const {points, mesh, breaklines, boundary, maxEdge, alignment, grade, platforms} = doc, designLines = doc.designLines || [];
  const [selectedLine, setSelectedLineRaw] = useState(null), [dragDraft, setDragDraft] = useState(null), [activeHandle, setActiveHandle] = useState(null);
  const setSelectedPlatform = id => { setSelectedPlatformRaw(id); if (id) setSelectedLineRaw(null); setActiveHandle(null); };
  /** Linha e plataforma não ficam selecionadas ao mesmo tempo (as alças de edição são de um objeto só). */
  const setSelectedLine = id => { setSelectedLineRaw(id); if (id) setSelectedPlatformRaw(null); setActiveHandle(null); };
  // durante o arraste, a geometria do rascunho substitui a do documento (cálculo em grade reduzida)
  const [gradeDraft, setGradeDraft] = useState(null); // greide sendo arrastado no perfil (taludes em tempo real)
  const liveLines = useMemo(() => dragDraft?.kind === 'line' ? designLines.map(l => l.id === dragDraft.id ? {...l, pis: dragDraft.vertices} : l) : designLines, [designLines, dragDraft]);
  const livePlatforms = useMemo(() => dragDraft?.kind === 'platform' ? platforms.map(p => p.id === dragDraft.id ? {...p, polygon: dragDraft.vertices} : p) : platforms, [platforms, dragDraft]);
  const liveEdit = !!(dragDraft || gradeDraft);
  const dragCells = liveEdit ? 12000 : undefined; // grade reduzida no arraste (≤ 30 mil); cálculo completo ao soltar
  // no arraste a malha acompanha cada quadro; o volume é refeito a cada ~0,2 s (rascunho amostrado)
  const [volDraft, setVolDraft] = useState(null), volTimer = useRef(null), lastDraft = useRef(null);
  lastDraft.current = dragDraft;
  useEffect(() => {
    if (!dragDraft) { clearTimeout(volTimer.current); volTimer.current = null; setVolDraft(null); return; }
    if (!volTimer.current) volTimer.current = setTimeout(() => { volTimer.current = null; setVolDraft(lastDraft.current); }, 200);
  }, [dragDraft]);
  const [volGrade, setVolGrade] = useState(null), gradeTimer = useRef(null), lastGrade = useRef(null);
  lastGrade.current = gradeDraft;
  useEffect(() => {
    if (!gradeDraft) { clearTimeout(gradeTimer.current); gradeTimer.current = null; setVolGrade(null); return; }
    if (!gradeTimer.current) gradeTimer.current = setTimeout(() => { gradeTimer.current = null; setVolGrade(lastGrade.current); }, 200);
  }, [gradeDraft]);
  const volDraftEff = dragDraft ? (volDraft || dragDraft) : null;
  const volLines = useMemo(() => volDraftEff?.kind === 'line' ? designLines.map(l => l.id === volDraftEff.id ? {...l, pis: volDraftEff.vertices} : l) : designLines, [designLines, volDraftEff]);
  const volPlatforms = useMemo(() => volDraftEff?.kind === 'platform' ? platforms.map(p => p.id === volDraftEff.id ? {...p, polygon: volDraftEff.vertices} : p) : platforms, [platforms, volDraftEff]);

  // ---------- dados derivados ----------
  const groups = useMemo(() => pointGroups(points), [points]);
  const visibleIndices = useMemo(() => groups.filter(g => !group || g.code === group).flatMap(g => g.indices).sort((a, b) => a - b), [groups, group]);
  const ctx = useMemo(() => mesh.triangles.length ? profileContext(points, mesh.triangles) : null, [points, mesh.triangles]);
  const elevationAt = ctx?.elevationAt ?? null;
  const contourResult = useMemo(() => {
    if (!contourStyle.visible2D && !contourStyle.visible3D && !dxfOptions.contours) return {data: null};
    try { return {data: buildContours(points, mesh.triangles, contourStyle)}; } catch (e) { return {data: null, error: e.message}; }
  }, [points, mesh.triangles, contourStyle.interval, contourStyle.majorEvery, contourStyle.visible2D, contourStyle.visible3D, dxfOptions.contours]);
  const contours = contourResult.data;
  const stats = useMemo(() => surfaceStats(points, mesh.triangles), [points, mesh.triangles]);
  const referenceZ = referenceDraft.trim() === '' ? NaN : Number(referenceDraft.replace(',', '.'));
  const volume = useMemo(() => Number.isFinite(referenceZ) && mesh.triangles.length ? volumeToPlane(points, mesh.triangles, referenceZ) : null, [points, mesh.triangles, referenceZ]);
  const profile = useMemo(() => { try { return alignment.length > 1 && ctx ? sampleProfile(points, mesh.triangles, alignment, ctx) : null; } catch { return null; } }, [points, mesh.triangles, alignment, ctx]);
  const gradeGeo = useMemo(() => { try { return gradeGeometry(gradeDraft || grade); } catch { return gradeGeometry([]); } }, [grade, gradeDraft]);
  // greide como função de cota para as linhas em modo "seguir o greide" (ao vivo e amostrado para volumes)
  const gradeCtx = useMemo(() => alignment.length > 1 && gradeGeo.pvis.length > 1 ? {path: alignment, gradeAt: s => gradeElevation(gradeGeo, s)} : null, [alignment, gradeGeo]);
  const volGradeGeo = useMemo(() => { if (!gradeDraft) return gradeGeo; try { return gradeGeometry(volGrade || gradeDraft); } catch { return gradeGeo; } }, [gradeDraft, volGrade, gradeGeo]);
  const volGradeCtx = useMemo(() => volGradeGeo === gradeGeo ? gradeCtx : alignment.length > 1 && volGradeGeo.pvis.length > 1 ? {path: alignment, gradeAt: s => gradeElevation(volGradeGeo, s)} : null, [volGradeGeo, gradeGeo, gradeCtx, alignment]);
  const gradeAt = useCallback(s => gradeGeo.pvis.length > 1 ? gradeElevation(gradeGeo, s) : null, [gradeGeo]);
  // acesso: gabarito (seção-tipo) aplicado no eixo + greide; segue o greide ao vivo enquanto os PVIs são arrastados
  const corridor = useMemo(() => { try { return validateCorridor(doc.corridor); } catch { return validateCorridor(null); } }, [doc.corridor]);
  const corridorInfo = useMemo(() => corridor.enabled ? compileCorridor(alignment, gradeCtx, corridor) : null, [corridor, alignment, gradeCtx]);
  const volCorridorInfo = useMemo(() => !corridor.enabled ? null : volGradeCtx === gradeCtx ? corridorInfo : compileCorridor(alignment, volGradeCtx, {...corridor}), [corridor, alignment, volGradeCtx, gradeCtx, corridorInfo]);
  const designMeshes = useMemo(() => !elevationAt ? [] : [...livePlatforms.filter(p => p.visible !== false).map(p => {
    try { return {kind: 'platform', platform: p, mesh: gradePlatform(points, mesh.triangles, p, {elevationAt})}; }
    catch (e) { return {kind: 'platform', platform: p, error: e.message}; }
  }), ...liveLines.filter(l => l.visible !== false).map(l => {
    try { return {kind: 'line', line: l, mesh: gradeLine(points, mesh.triangles, l, {elevationAt, gradeCtx})}; }
    catch (e) { return {kind: 'line', line: l, error: e.message}; }
  }), ...(corridorInfo ? [(() => {
    if (!corridorInfo.ok) return {kind: 'corridor', corridor, error: corridorInfo.warnings[0]};
    try { return {kind: 'corridor', corridor, info: corridorInfo, mesh: gradeCorridor(corridorInfo, {terrainAt: elevationAt, points})}; }
    catch (e) { return {kind: 'corridor', corridor, error: e.message}; }
  })()] : [])], [points, mesh.triangles, livePlatforms, liveLines, elevationAt, gradeCtx, corridorInfo, corridor]);
  const designVolumes = useMemo(() => {
    const out = new Map(); if (!elevationAt) return out;
    for (const p of volPlatforms) if (p.visible !== false) { try { out.set('p:' + p.id, platformVolumes(points, mesh.triangles, p, {elevationAt, maxCells: dragCells})); } catch { /* erro já mostrado pela malha */ } }
    for (const l of volLines) if (l.visible !== false) { try { out.set('l:' + l.id, lineVolumes(points, mesh.triangles, l, {elevationAt, maxCells: dragCells, gradeCtx: volGradeCtx})); } catch { /* idem */ } }
    if (volCorridorInfo?.ok) { try { out.set('c', corridorVolumes(volCorridorInfo, {terrainAt: elevationAt, points, triangles: mesh.triangles, maxCells: dragCells})); } catch { /* idem */ } }
    return out;
  }, [points, mesh.triangles, volPlatforms, volLines, elevationAt, dragCells, volGradeCtx, volCorridorInfo]);
  const designs = useMemo(() => designMeshes.map(d => d.error ? d : {...d, volume: d.kind === 'corridor' ? designVolumes.get('c') ?? null : d.kind === 'line' ? (d.mesh.base.length ? designVolumes.get('l:' + d.line.id) ?? null : null) : designVolumes.get('p:' + d.platform.id) ?? null}), [designMeshes, designVolumes]);
  const validDesigns = useMemo(() => designs.filter(d => d.mesh), [designs]);
  const meshDesigns = useMemo(() => designMeshes.filter(d => d.mesh), [designMeshes]);
  const designAt = useMemo(() => elevationAt && validDesigns.length ? designSurfaceFunction(validDesigns.filter(d => d.kind === 'platform').map(d => d.platform), elevationAt, validDesigns.filter(d => d.kind === 'line').map(d => d.line), gradeCtx, validDesigns.filter(d => d.kind === 'corridor').map(d => (x, y, T) => corridorElevationAt(d.info, x, y, T))) : null, [elevationAt, validDesigns, gradeCtx]);
  const frozenDesignAt = useRef(null); if (!liveEdit) frozenDesignAt.current = designAt; // 3D só se refaz ao soltar o arraste
  const designProfile = useMemo(() => {
    if (!profile || !designAt) return null; const n = 400, out = [];
    for (let k = 0; k <= n; k++) { const s = profile.length * k / n, c = pointAtStation(alignment, s); out.push({station: s, z: c ? designAt(c.x, c.y) : null}); }
    return out.some(p => p.z !== null) ? out : null;
  }, [profile, designAt, alignment]);
  const stationList = useMemo(() => { try { return profile ? sectionStations(profile.length, sectionSettings.interval, gradeGeo.pvis.map(p => p.station)) : []; } catch { return []; } }, [profile, sectionSettings.interval, gradeGeo]);
  const sectionLines = useMemo(() => stationList.map(s => { const c = pointAtStation(alignment, s); if (!c) return null; const nx = -c.ty, ny = c.tx, h = sectionSettings.halfWidth; return {station: s, left: {x: c.x + nx * h, y: c.y + ny * h}, right: {x: c.x - nx * h, y: c.y - ny * h}}; }).filter(Boolean), [stationList, alignment, sectionSettings.halfWidth]);
  const sections = useMemo(() => !['sections', 'profile'].includes(layout) || !profile || !ctx ? [] : stationList.map(s => sampleSection(alignment, s, sectionSettings.halfWidth, {points, triangles: mesh.triangles, designAt, gradeAt, context: ctx})).filter(Boolean), [layout, profile, ctx, stationList, alignment, sectionSettings.halfWidth, points, mesh.triangles, designAt, gradeAt]);
  const sectionTotals = useMemo(() => sections.length > 1 ? averageEndArea(sections) : null, [sections]);
  const cubage = useMemo(() => sections.length ? cubageTable(sections) : [], [sections]);
  const notes = useMemo(() => corridorInfo?.ok && elevationAt && layout === 'sections' && !liveEdit ? serviceNotes(corridorInfo, stationList, elevationAt) : [], [corridorInfo, elevationAt, layout, stationList, liveEdit]);
  const [bottomTab, setBottomTab] = useState('cubage');
  const pickStation = s => { const i = stationList.findIndex(v => Math.abs(v - s) < 1e-6); if (i >= 0) setSectionIndex(i); };
  const currentStation = stationList.length ? stationList[Math.min(sectionIndex, stationList.length - 1)] : null;
  const lastTerrain3D = useRef(null);
  const terrain3D = useMemo(() => {
    if (liveEdit) return lastTerrain3D.current; // no arraste, mantém o último recorte (o terreno inteiro esconderia o corte)
    if (!designAt) return null;
    const bounds = validDesigns.filter(d => d.mesh.vertices.length).map(d => { const xs = d.mesh.vertices.map(v => v.x), ys = d.mesh.vertices.map(v => v.y); return {minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys)}; });
    const span = Math.max(...bounds.map(b => Math.max(b.maxX - b.minX, b.maxY - b.minY)), 1);
    return clipTerrainMesh(points, mesh.triangles, (x, y) => designAt(x, y) !== null, {bounds, minEdge: span / 120});
  }, [designAt, validDesigns, points, mesh.triangles, liveEdit]);
  if (!liveEdit) lastTerrain3D.current = terrain3D;
  const gradeLine3D = useMemo(() => {
    if (!profile || gradeGeo.pvis.length < 2) return null;
    return sampleGrade(gradeGeo, Math.max(profile.length / 300, 0.1)).map(p => { const c = pointAtStation(alignment, p.station); return c && p.z !== null ? {x: c.x, y: c.y, z: p.z} : null; }).filter(Boolean);
  }, [profile, gradeGeo, alignment]);
  const baseSnap = useMemo(() => {
    const segs = [];
    for (const [a, b] of mesh.constraints || []) segs.push({a: points[a], b: points[b]});
    for (let i = 1; i < alignment.length; i++) segs.push({a: alignment[i - 1], b: alignment[i]});
    for (const p of platforms) p.polygon.forEach((v, i) => segs.push({a: v, b: p.polygon[(i + 1) % p.polygon.length]}));
    for (const l of designLines) l.pis.forEach((v, i) => { if (i < l.pis.length - 1 || l.closed) segs.push({a: v, b: l.pis[(i + 1) % l.pis.length]}); });
    return createSnapIndex({nodes: points.map((p, i) => ({x: p.x, y: p.y, ref: i})), vertices: [...alignment, ...platforms.flatMap(p => p.polygon), ...designLines.flatMap(l => l.pis)], segments: segs});
  }, [points, mesh.constraints, alignment, platforms, designLines]);
  const snapIndex = useMemo(() => {
    const draft = createSnapIndex({vertices: pickDraft.filter(p => p.index === undefined)});
    return {query: (x, y, r, m) => [baseSnap.query(x, y, r, m), draft.query(x, y, r, m)].filter(Boolean).sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.d - b.d)[0] || null};
  }, [baseSnap, pickDraft]);
  const earthworks = useMemo(() => validDesigns.filter(d => d.volume).reduce((s, d) => ({cut: s.cut + d.volume.cut, fill: s.fill + d.volume.fill, area: s.area + d.volume.footprint}), {cut: 0, fill: 0, area: 0}), [validDesigns]);

  // ---------- edição ----------
  const commit = useCallback((next, text) => { setHistory(h => [...h.slice(-19), doc]); setDoc(next); setSelected([]); setPickDraft([]); setRevision(v => v + 1); setMessage(text); }, [doc]);
  async function recompute(changes = {}, text = 'Superfície recalculada nas duas vistas. Edições manuais reiniciadas.') {
    try {
      const next = {...doc, ...changes};
      const result = await run('surface', {points: next.points, breaklines: next.breaklines, boundary: next.boundary, maxEdge: next.maxEdge});
      commit({...next, mesh: result}, `${text}${result.removed ? ' ' + result.removed + ' triângulos removidos pelo recorte/limite.' : ''}`); return true;
    } catch (e) { setMessage(e.message); return false; }
  }
  async function importFile(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      if (/\.(dwg|dxf)$/i.test(file.name)) {
        if (file.size > 80e6) throw Error('Limite: 80 MB por desenho. Remova imagens e referências externas (XREF) e salve de novo.');
        setMessage(`Lendo ${file.name}…${/\.dwg$/i.test(file.name) ? ' Na primeira vez o leitor de DWG (~11 MB) é baixado.' : ''}`);
        const result = await run('cad', {bytes: await file.arrayBuffer(), name: file.name});
        setCadImport({fileName: file.name, ...result}); setMessage(`${file.name}: escolha o que importar.`); return;
      }
      if (file.size > 10e6) throw Error('Limite: 10 MB por arquivo.');
      let mapping = null;
      if (schema === 'custom') {
        const names = mappingText.toUpperCase().split(/[,;\s]+/).filter(Boolean);
        if (['E', 'N', 'Z'].some(k => !names.includes(k)) || new Set(names).size !== names.length) throw Error('Mapeamento exige E, N e Z, sem colunas repetidas.');
        mapping = {id: names.indexOf('P'), x: names.indexOf('E'), y: names.indexOf('N'), z: names.indexOf('Z'), description: names.indexOf('D')};
      }
      const result = await run('import', {text: await file.text(), options: {schema, mapping}});
      commit({points: result.points, mesh: result.mesh, breaklines: [], boundary: [], maxEdge: 0, ...emptyDesign}, `${file.name}: ${result.points.length} pontos; ${result.errors.length} linhas rejeitadas. Defina um contorno para recortar o levantamento.`);
      setErrors(result.errors); setGroup(''); setEdgeDraft('0'); setReferenceDraft(''); setSelectedPlatform(null); setSectionIndex(0); setFitKey(k => k + 1);
    } catch (e) { setMessage(e.message); }
  }
  async function importCadPoints(cadPoints, text) {
    setCadImport(null);
    try {
      setMessage('Triangulando os pontos do desenho…');
      const mesh = await run('surface', {points: cadPoints, breaklines: [], boundary: [], maxEdge: 0});
      commit({points: cadPoints, mesh, breaklines: [], boundary: [], maxEdge: 0, ...emptyDesign}, text);
      setErrors([]); setGroup(''); setEdgeDraft('0'); setReferenceDraft(''); setSelectedPlatform(null); setSectionIndex(0); setFitKey(k => k + 1);
    } catch (e) { setMessage(e.message); }
  }
  function undo() {
    if (busy) return; const previous = history.at(-1); if (!previous) return;
    setDoc(previous); setHistory(history.slice(0, -1)); setGroup(''); setSelected([]); setPickDraft([]); setEdgeDraft(String(previous.maxEdge)); setRevision(v => v + 1); setMessage('Edição desfeita.');
  }
  async function savePoint(draft, index) { try { const next = upsertPoint(points, draft, index); return await recompute({points: next}, 'Ponto salvo e modelo 3D atualizado.'); } catch (e) { setMessage(e.message); return false; } }
  function chooseTool(next) {
    if (busy) return; setTool(next); setSelected([]); setPickDraft([]);
    if (next !== 'orbit') { if (['3D', 'profile'].includes(layout)) setLayout('split'); if (['swap', 'delete'].includes(next)) setLayers(l => ({...l, edges: true})); }
    setMessage(TOOL_HINTS[next] || 'Ferramenta: ' + (TOOL_NAMES[next] || next));
  }
  const onPick = useCallback(p => {
    if (busy) return;
    if (tool === 'boundary') { if (p.index === undefined) { setMessage('O contorno usa pontos do levantamento: aproxime a mira de um nó.'); return; } setSelected(s => s.at(-1) === p.index ? s : [...s, p.index]); return; }
    const drawn = tool === 'line' || tool === 'platform';
    if (drawn && pickDraft.length >= 3 && (p.close || Math.hypot(pickDraft[0].x - p.x, pickDraft[0].y - p.y) < 1e-3)) { finishRef.current({closed: true}); return; }
    const q = p.index !== undefined ? {x: points[p.index].x, y: points[p.index].y, index: p.index} : {x: p.x, y: p.y}, last = pickDraft.at(-1);
    if (last && Math.hypot(last.x - q.x, last.y - q.y) < 1e-3) return; // clique repetido no mesmo lugar
    if (drawn && pickDraft.length >= 2) { // recusa o vértice que faria o desenho cruzar a si mesmo
      try { checkVertices([...pickDraft, q], false); }
      catch (e) { setMessage(/repetidos/.test(e.message) ? 'Esse ponto já é um vértice do desenho. Para fechar, clique no 1º vértice (círculo verde).' : `Esse vértice faria ${tool === 'platform' ? 'a plataforma' : 'a linha'} cruzar a si mesma. Clique em outro ponto (Backspace retira o último).`); return; }
    }
    setPickDraft(d => [...d, q]);
  }, [busy, tool, points, pickDraft]);
  const onEdge = useCallback((a, b) => {
    if (busy) return;
    try { const triangles = editEdge(points, mesh.triangles, mesh.constraints, a, b, tool); commit({...doc, mesh: {...mesh, triangles}}, tool === 'swap' ? 'Aresta invertida.' : 'Faces adjacentes removidas.'); }
    catch (e) { setMessage(e.message); }
  }, [busy, points, mesh, doc, tool, commit]);
  const onPlanClick = useCallback(w => {
    if (layers.sections && sectionLines.length) { // clique perto de uma linha de seção: vira a estaca ativa
      const tol = Math.max(1, sectionSettings.interval * .2); let best = null, bd = tol;
      sectionLines.forEach((sl, i) => { const dx = sl.right.x - sl.left.x, dy = sl.right.y - sl.left.y, t = Math.max(0, Math.min(1, ((w.x - sl.left.x) * dx + (w.y - sl.left.y) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(w.x - sl.left.x - t * dx, w.y - sl.left.y - t * dy); if (d < bd) { bd = d; best = sl; } });
      if (best) { const i = stationList.findIndex(v => Math.abs(v - best.station) < 1e-6); if (i >= 0) { setSectionIndex(i); setMessage(`Estaca ativa ${(best.station / 1000 | 0)}+${(best.station % 1000).toFixed(2).padStart(6, '0')}: perfil, seções e 3D sincronizados.`); return; } }
    }
    const hit = platforms.find(p => p.polygon.length > 2 && insideXY(w.x, w.y, p.polygon));
    if (hit) { setSelectedPlatform(hit.id); setSideTab('design'); setMessage(`${hit.name} selecionada. Ajuste cota e taludes no painel Projeto.`); }
  }, [platforms, layers.sections, sectionLines, sectionSettings.interval, stationList]);
  const finishRef = useRef();
  async function finish({closed = false} = {}) {
    if (busy) return;
    try {
      if (tool === 'line') {
        if (pickDraft.length < (closed ? 3 : 2)) throw Error(closed ? 'Para fechar, a linha precisa de pelo menos 3 PIs.' : 'A linha exige pelo menos 2 PIs.');
        const z0 = elevationAt?.(pickDraft[0].x, pickDraft[0].y);
        const l = validateDesignLine({id: newId(), name: nextName(designLines, 'Linha'), pis: (closed ? cleanRing(pickDraft) : pickDraft).map(p => ({x: p.x, y: p.y})), closed, side: closed ? 'outside' : 'right', elevation: {mode: 'ramp', start: Math.round((z0 ?? stats.minZ ?? 0) * 100) / 100, slope: 0}});
        commit({...doc, designLines: [...designLines, l]}, `${l.name} criada (${closed ? 'fechada' : 'aberta'}, ${l.pis.length} PIs) na cota do terreno no 1º PI (${l.elevation.start.toFixed(2)}). Ajuste cota, rampa, lado e curvas no painel Projeto.`);
        setSelectedLine(l.id); setSideTab('design'); setTool('orbit'); return;
      }
      if (tool === 'profile') {
        if (pickDraft.length < 2) throw Error('O eixo exige pelo menos dois vértices.');
        commit({...doc, alignment: pickDraft.map(p => ({x: p.x, y: p.y}))}, grade.length ? 'Eixo redesenhado. O greide foi mantido: confira as estacas dos PVIs.' : `Eixo traçado com ${pickDraft.length} vértices. Crie o greide no perfil.`);
        setShowProfileDock(true); setSectionIndex(0); setTool('orbit'); return;
      }
      if (tool === 'platform') {
        if (pickDraft.length < 3) throw Error('A plataforma exige pelo menos três vértices.');
        const polygon = validatePolygon(cleanRing(pickDraft.map(p => ({x: p.x, y: p.y}))));
        const mean = meanTerrainInside(points, mesh.triangles, polygon, elevationAt);
        const p = validatePlatform({id: newId(), name: nextName(platforms, 'Plataforma'), polygon, elevation: Math.round((mean ?? stats.minZ ?? 0) * 100) / 100, cutSlope: 1, fillSlope: 1.5});
        commit({...doc, platforms: [...platforms, p]}, `${p.name} criada na cota média do terreno (${p.elevation.toFixed(2)}), taludes 1:1 e 1,5:1. Desenhe a próxima ou Esc para sair e editar.`);
        setSelectedPlatform(p.id); setSideTab('design'); setPickDraft([]); return; // a ferramenta continua ativa: várias plataformas seguidas
      }
      if (tool === 'boundary') { const ring = selected.at(-1) === selected[0] ? selected.slice(0, -1) : selected; if (await recompute({boundary: ring}, 'Contorno aplicado.')) setTool('orbit'); return; }
      if (tool === 'breakline') {
        if (pickDraft.length < 2) throw Error('A linha obrigatória exige pelo menos dois vértices.');
        const r = drapeBreakline(points, mesh.triangles, pickDraft, {densify});
        if (await recompute({points: r.points, breaklines: [...breaklines, r.indices]}, `Linha obrigatória incorporada: ${r.indices.length} vértices, ${r.added} pontos novos assentados na TIN.`)) setPickDraft([]);
      }
    } catch (e) { setMessage(e.message); }
  }
  finishRef.current = finish;
  // ---------- edição por alças (PIs da linha / vértices da plataforma) ----------
  const editTarget = selectedLine && designLines.some(l => l.id === selectedLine) ? {kind: 'line', obj: designLines.find(l => l.id === selectedLine)}
    : selectedPlatform && platforms.some(p => p.id === selectedPlatform) ? {kind: 'platform', obj: platforms.find(p => p.id === selectedPlatform)} : null;
  const editVertices = t => t.kind === 'line' ? t.obj.pis : t.obj.polygon, editClosed = t => t.kind === 'line' ? t.obj.closed : true;
  const handles = useMemo(() => {
    if (!editTarget) return [];
    const vs = dragDraft && dragDraft.id === editTarget.obj.id ? dragDraft.vertices : editVertices(editTarget);
    return vs.map((v, i) => ({key: i, x: v.x, y: v.y}));
  }, [editTarget?.obj, dragDraft]);
  const handleSegments = useMemo(() => {
    if (!editTarget) return [];
    const vs = editVertices(editTarget), n = vs.length, closed = editClosed(editTarget);
    return vs.slice(0, closed ? n : n - 1).map((a, i) => ({key: i, a, b: vs[(i + 1) % n]}));
  }, [editTarget?.obj]);
  function commitVertices(t, vertices, text) {
    if (t.kind === 'line') updateLine(t.obj.id, {pis: vertices}, text);
    else updatePlatform(t.obj.id, {polygon: vertices}, text);
  }
  const label = t => t.kind === 'line' ? 'PI' : 'Vértice';
  const onHandleDrag = (key, p, phase) => {
    const t = editTarget; if (!t || busy) return;
    if (phase === 'start') { setActiveHandle(key); setDragDraft({kind: t.kind, id: t.obj.id, vertices: editVertices(t), invalid: null}); return; }
    if (phase === 'cancel') { setDragDraft(null); setMessage('Arraste cancelado.'); return; }
    const base = editVertices(t);
    let next = null, invalid = null;
    try { next = moveVertex(base, key, p, {closed: editClosed(t)}); } catch (e) { invalid = e.message; }
    if (phase === 'move') { setDragDraft(d => d && (next ? {...d, vertices: next, invalid: null} : {...d, invalid})); if (invalid) setMessage(invalid); return; }
    setDragDraft(null);
    if (!next) { setMessage(`Arraste recusado: ${invalid} A geometria anterior foi mantida.`); return; }
    if (Math.hypot(base[key].x - p.x, base[key].y - p.y) < 1e-9) return; // só selecionou
    commitVertices(t, next, `${label(t)} ${key + 1} movido. Volumes recalculados (Ctrl+Z desfaz).`);
  };
  const onSegmentInsert = (key, p) => {
    const t = editTarget; if (!t || busy) return;
    try { commitVertices(t, insertVertex(editVertices(t), key, p, {closed: editClosed(t)}), `${label(t)} inserido entre ${key + 1} e ${(key + 1) % editVertices(t).length + 1}.`); setActiveHandle(key + 1); } catch (e) { setMessage(e.message); }
  };
  const onHandleRemove = key => {
    const t = editTarget; if (!t || busy) return;
    try { commitVertices(t, removeVertex(editVertices(t), key, {closed: editClosed(t)}), `${label(t)} ${key + 1} removido.`); setActiveHandle(null); } catch (e) { setMessage(e.message); }
  };
  function updateLine(id, changes, text) {
    try {
      const next = designLines.map(l => l.id === id ? validateDesignLine({...l, ...changes}) : l);
      commit({...doc, designLines: next}, text || 'Linha atualizada: taludes e volumes recalculados.');
    } catch (e) { setMessage(e.message); }
  }
  function updatePlatform(id, changes, text) {
    try {
      const next = platforms.map(p => p.id === id ? validatePlatform({...p, ...changes}) : p);
      commit({...doc, platforms: next}, text || 'Plataforma atualizada: taludes e volumes recalculados.');
    } catch (e) { setMessage(e.message); }
  }
  /** Nova cota de referência: desloca a plataforma inteira (a rampa é preservada). */
  function setPlatformElevation(p, z, text) { updatePlatform(p.id, shiftPlatform(p, z - p.elevation), text); }
  function balancePlatform(p) {
    if (!elevationAt) return;
    let lo = stats.minZ, hi = stats.maxZ;
    for (let k = 0; k < 28; k++) { const mid = (lo + hi) / 2, v = platformVolumes(points, mesh.triangles, shiftPlatform(p, mid - p.elevation), {elevationAt, maxCells: 30000}); if (v.cut > v.fill) lo = mid; else hi = mid; } // mais corte → subir a plataforma
    setPlatformElevation(p, Math.round((lo + hi) / 2 * 1000) / 1000, `${p.name}: cota de equilíbrio entre corte e aterro aplicada.`);
  }
  function applyRamp(p) {
    const d = rampDraft[p.id] || {slope: '2', azimuth: '0'}, slope = Number(String(d.slope).replace(',', '.')), azimuth = Number(String(d.azimuth).replace(',', '.'));
    try { updatePlatform(p.id, applyPlaneSlope(p, {slope, azimuth}), `${p.name}: rampa de ${slope}% descendo para ${azimuth}° aplicada. Ajuste cotas de vértices na tabela, se precisar.`); } catch (e) { setMessage(e.message); }
  }
  function exportNotes() {
    if (!corridorInfo?.ok || !elevationAt) { setMessage('Ative o gabarito de acesso (eixo + greide) para gerar a nota de serviço.'); return; }
    const rows = serviceNotes(corridorInfo, stationList, elevationAt);
    if (!rows.length) { setMessage('Nenhuma estaca para a nota de serviço: confira o intervalo das seções.'); return; }
    downloadText('terra-cad-nota-de-servico.csv', '\ufeff' + serviceNotesCSV(rows, {title: `Nota de serviço · acesso pista ${fmt(corridor.width, 2)} m · caimento ${fmt(corridor.crossfall, 2)} % · corte ${fmt(corridor.cutSlope, 2)}:1 · aterro ${fmt(corridor.fillSlope, 2)}:1`}), 'text/csv');
    setMessage(`Nota de serviço exportada: ${rows.length} estacas a cada ${sectionSettings.interval} m (abre no Excel).`);
  }
  function saveProject() {
    const data = {version: 8, corridor: doc.corridor ? corridor : null, points, triangles: mesh.triangles, breaklines, boundary, maxEdge, alignment, grade, platforms, designLines, labelStyle: style, groupColors, contourStyle, referenceZ: Number.isFinite(referenceZ) ? referenceZ : null, sectionSettings};
    downloadText('terra-cad-projeto.json', JSON.stringify(data, null, 2), 'application/json');
    setMessage('Projeto exportado (JSON v8). Guarde o arquivo no seu computador e abra-o para continuar.');
  }
  async function openProject(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      if (file.size > 30e6) throw Error('Projeto acima do limite de 30 MB.');
      const data = JSON.parse(await file.text()), next = await run('project', data);
      commit({...emptyDesign, ...next}, 'Projeto aberto com terreno, eixo, greide, plataformas e edições.'); setGroup(''); setEdgeDraft(String(next.maxEdge)); setErrors([]); setSelectedPlatform(next.platforms?.[0]?.id ?? null); setSelectedLine(next.designLines?.[0]?.id ?? null); setSectionIndex(0);
      if (data.labelStyle) { const s = data.labelStyle; setStyle({visible: !!s.visible, id: !!s.id, elevation: !!s.elevation, description: !!s.description, color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : defaultStyle.color, size: Math.max(8, Math.min(24, Number(s.size) || 12)), precision: Math.max(0, Math.min(4, Math.round(Number(s.precision) || 0)))}); setPreset('custom'); }
      if (data.groupColors && typeof data.groupColors === 'object') setGroupColors(c => ({...c, ...Object.fromEntries(Object.entries(data.groupColors).filter(([, v]) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)))}));
      const c = data.contourStyle;
      if (c && Number(c.interval) > 0 && Number.isInteger(Number(c.majorEvery)) && Number(c.majorEvery) >= 1) { setContourStyle({visible2D: c.visible2D !== false, visible3D: c.visible3D !== false, labels: c.labels !== false, interval: Number(c.interval), majorEvery: Number(c.majorEvery)}); setContourDraft({interval: String(c.interval), majorEvery: String(c.majorEvery)}); }
      const ss = data.sectionSettings; if (ss && ss.interval > 0 && ss.halfWidth > 0) setSectionSettings({interval: Number(ss.interval), halfWidth: Number(ss.halfWidth)});
      setReferenceDraft(Number.isFinite(data.referenceZ) ? String(data.referenceZ) : '');
      setFitKey(k => k + 1);
    } catch (e) { setMessage('Não foi possível abrir: ' + e.message); }
  }
  function applyContourDraft(key, value) {
    setContourDraft(d => ({...d, [key]: value}));
    const v = Number(String(value).replace(',', '.'));
    if (key === 'interval' ? v > 0 : Number.isInteger(v) && v >= 1) setContourStyle(s => ({...s, [key]: v}));
  }
  function exportFile(kind) {
    try {
      if (kind === 'dxf') {
        let secs = [];
        if (dxfOptions.sections && profile && ctx) secs = stationList.map(s => sampleSection(alignment, s, sectionSettings.halfWidth, {points, triangles: mesh.triangles, context: ctx})).filter(Boolean).map(sec => ({...sec, terrain3D: sec.terrain.map(t => { const k = (t.offset + sectionSettings.halfWidth) / (2 * sectionSettings.halfWidth); return {x: sec.left.x + k * (sec.right.x - sec.left.x), y: sec.left.y + k * (sec.right.y - sec.left.y), z: t.z}; })}));
        const text = toDXF({points, triangles: mesh.triangles, breaklines, boundary, contours: dxfOptions.contours ? contours : null, profile, designs: dxfOptions.design ? validDesigns : [], gradeLine: dxfOptions.grade ? gradeLine3D : null, sections: secs}, {...dxfOptions, contours: dxfOptions.contours && !!contours});
        downloadText('terra-cad.dxf', text, 'application/dxf'); setMessage('DXF exportado (R12) com camadas TC_*: terreno, curvas, rupturas, plataformas, taludes, offset, greide e seções.');
      }
      if (kind === 'landxml') {
        if (!mesh.triangles.length) throw Error('Superfície vazia: nada a exportar.');
        const merged = {name: 'Projeto', vertices: [], triangles: []};
        for (const d of validDesigns) { const o = merged.vertices.length; merged.vertices.push(...d.mesh.vertices); d.mesh.triangles.forEach((t, k) => { if (d.mesh.types[k] !== 'wall') merged.triangles.push(t.map(i => i + o)); }); }
        downloadText('terra-cad-superficies.xml', toLandXML({points, triangles: mesh.triangles, boundary}, {name: 'Terreno', extra: merged.triangles.length ? [merged] : []}), 'application/xml');
        setMessage(merged.triangles.length ? 'LandXML exportado com duas superfícies: Terreno e Projeto.' : 'LandXML exportado: superfície Terreno.');
      }
      if (kind === 'csv') { downloadText('terra-cad-pontos.csv', toCSV(points), 'text/csv'); setMessage('Pontos exportados em CSV (P;E;N;Z;D).'); }
    } catch (e) { setMessage(e.message); }
  }
  useEffect(() => {
    const handler = e => {
      if (e.target.closest('input,select,textarea,.modal') || e.target.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 'f1') { e.preventDefault(); setHelp(v => !v); return; }
      if (k === 'f3') { e.preventDefault(); setSnap(v => !v); setMessage(snap ? 'Atração desligada (F3).' : 'Atração ligada (F3).'); return; }
      if (busy) return;
      if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveProject(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); projectFile.current.click(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'escape') { setSelected([]); setPickDraft([]); setTool('orbit'); }
      else if (k === 'enter' && ['breakline', 'boundary', 'profile', 'platform', 'line'].includes(tool)) { e.preventDefault(); finish(); }
      else if (k === 'delete' && tool === 'orbit' && layout !== 'profile' && editTarget && activeHandle !== null && activeHandle < editVertices(editTarget).length) { e.preventDefault(); onHandleRemove(activeHandle); }
      else if (k === 'backspace' && (selected.length || pickDraft.length)) { e.preventDefault(); tool === 'boundary' ? setSelected(s => s.slice(0, -1)) : setPickDraft(s => s.slice(0, -1)); }
      else if (k === '2') setLayout('2D');
      else if (k === '3') { setLayout('3D'); setTool('orbit'); }
      else if (k === '4') { setLayout('profile'); setTool('orbit'); }
      else if (k === '5') { setLayout('sections'); setTool('orbit'); }
      else if (k === 'v') setLayout('split');
      else if (k === 'z') setFitKey(v => v + 1);
      else if (k === 'l') chooseTool('breakline');
      else if (k === 'b') chooseTool('boundary');
      else if (k === 's') chooseTool('swap');
      else if (k === 'd') chooseTool('delete');
      else if (k === 'n') chooseTool('orbit');
      else if (k === 'p') chooseTool('profile');
      else if (k === 'g') chooseTool('platform');
      else if (k === 't') chooseTool('line');
      else if (k === 'c') setContourStyle(s => { const on = !(s.visible2D || s.visible3D); return {...s, visible2D: on, visible3D: on}; });
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  const setLabel = (k, v) => { setPreset('custom'); setStyle(s => ({...s, [k]: v})); };
  const common = {points, triangles: mesh.triangles, terrain3D, constraints: mesh.constraints, style, tool, selected, pickDraft, visibleIndices, layers, presentation, groupColors, boundary, fitKey, snap, snapModes, snapAperture, snapIndex, crosshair, zoomSensitivity,
    onPick, onEdge, onPlanClick, onNotice: setMessage, contours, contourStyle, alignment, profileSamples: profile?.samples, referenceZ, elevationAt, designAt: frozenDesignAt.current, designs: meshDesigns, selectedPlatform, selectedLine, handles, segments: handleSegments, activeHandle, onHandleDrag, onSegmentInsert, onHandleRemove,
    sectionLines: layers.sections && (layout === 'sections' || profile) ? sectionLines : null, currentStation: profile ? currentStation : null, gradeLine3D};
  const panel = mode => <div key={mode} className={`viewport-panel ${mode === '2D' ? 'plan-panel' : 'model-panel'}`} data-testid={`panel-${mode}`}>
    <div className="panel-heading"><span>{mode === '2D' ? 'Planta' : 'Modelo 3D'}</span><small>{mode === '2D' ? (snap ? 'Atração F3 ligada' : 'Atração F3 desligada') : 'Terreno + projeto'}</small></div>
    <Viewport {...common} mode={mode}/>{mode === '2D' && <Compass/>}
  </div>;
  const picking = ['boundary', 'breakline', 'profile', 'platform', 'line'].includes(tool), pickCount = tool === 'boundary' ? selected.length : pickDraft.length, minPick = ['boundary', 'platform'].includes(tool) ? 3 : 2;
  const editor = profile && <ProfileEditor profile={profile} grade={grade} onGradeDraft={setGradeDraft} onGradeChange={(g, text) => commit({...doc, grade: g}, corridor.enabled ? 'PVI movido: acesso, taludes, seções, nota de serviço e volumes recalculados.' : designLines.some(l => l.elevation.mode === 'grade') ? text : 'Greide alterado. Nada segue o greide ainda: ative o gabarito de acesso (painel Projeto) ou, na linha de projeto, escolha a cota “Seguir o greide do eixo”.')} designProfile={designProfile} referenceZ={referenceZ} precision={style.precision}
    sectionStations={stationList} currentStation={currentStation} onStation={s => { const i = stationList.reduce((b, v, k) => Math.abs(v - s) < Math.abs(stationList[b] - s) ? k : b, 0); setSectionIndex(i); }}
    onRemove={() => commit({...doc, alignment: [], grade: []}, 'Eixo e greide removidos.')} onNotice={setMessage} zoomSensitivity={zoomSensitivity}
    height={layout === 'profile' ? Math.max(360, viewportH - (grade.length ? 360 : 190)) : 210} showTable={layout === 'profile'}/>;
  const selPlat = platforms.find(p => p.id === selectedPlatform);

  const viewDisabled = id => (id === 'profile' || id === 'sections') && !profile;
  return <div className={`app v2 v3 v4 tc5 ${inspectorOpen ? '' : 'inspector-closed'}`}>
    <header className="topbar">
      <a className="brand" href="#" aria-label={`Terra CAD ${VERSION}`}><svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9.5 17h-19z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M6.5 15.5l3.5-3 2.5 2 2.5-3 3 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/></svg><b>TERRA<span>CAD</span></b><em>{VERSION}</em></a>
      <div className="project" title={`${points.length} pontos · ${mesh.triangles.length} triângulos`}><span>Estúdio de superfícies</span><small>{points.length.toLocaleString('pt-BR')} pontos · {mesh.triangles.length.toLocaleString('pt-BR')} triângulos</small></div>
      <nav className="view-switch" role="tablist" aria-label="Vistas">{VIEWS.map(([id, label, key]) => <button role="tab" aria-selected={layout === id} key={id} className={layout === id ? 'active' : ''}
        title={viewDisabled(id) ? `${label} (${key}) · trace um eixo (P) para habilitar` : `${label} (${key})`} disabled={viewDisabled(id)} onClick={() => { setLayout(id); if (id !== '2D' && id !== 'split') setTool('orbit'); }}>{label}<kbd>{key}</kbd></button>)}</nav>
      <div className="top-actions">
        <button className="icon-btn" disabled={busy || !history.length} onClick={undo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><Icon name="undo"/></button>
        <button className="icon-btn" disabled={busy} onClick={() => projectFile.current.click()} title="Abrir projeto (Ctrl+O)" aria-label="Abrir projeto"><Icon name="open"/><span>Abrir</span></button>
        <input hidden type="file" accept=".json" ref={projectFile} onChange={openProject}/>
        <button disabled={busy} className="primary icon-btn" onClick={saveProject} title="Salvar projeto (Ctrl+S)"><Icon name="save"/><span>Salvar</span></button>
        {license && <AccountMenu license={license} onAdmin={() => setAdminOpen(true)}/>}
        <button className={`icon-btn ${inspectorOpen ? 'active' : ''}`} onClick={() => setInspectorOpen(v => !v)} title={inspectorOpen ? 'Recolher painel de propriedades' : 'Abrir painel de propriedades'} aria-label="Painel de propriedades" aria-expanded={inspectorOpen}><Icon name="panel"/></button>
      </div>
    </header>
    <div className="workspace">
      <nav className="toolrail" aria-label="Ferramentas">
        {TOOLS.map(([id, icon, key], i) => <React.Fragment key={id}>{(i === 1 || i === 6) && <hr/>}<button disabled={busy} className={tool === id ? 'active' : ''} aria-pressed={tool === id} title={`${TOOL_NAMES[id]} (${key})`} aria-label={TOOL_NAMES[id]} onClick={() => chooseTool(id)}><Icon name={icon} size={20}/><kbd>{key}</kbd></button></React.Fragment>)}
        <hr/>
        <button onClick={() => setFitKey(k => k + 1)} title="Enquadrar (Z)" aria-label="Enquadrar"><Icon name="fit" size={20}/><kbd>Z</kbd></button>
        <button className={snap ? 'on' : ''} aria-pressed={snap} onClick={() => { setSnap(v => !v); setMessage(snap ? 'Atração desligada (F3).' : 'Atração ligada (F3).'); }} title={`Atração ${snap ? 'ligada' : 'desligada'} (F3)`} aria-label="Atração"><Icon name="snap" size={20}/><kbd>F3</kbd></button>
        <span className="rail-spacer"/>
        <button className={help ? 'active' : ''} onClick={() => setHelp(v => !v)} title="Atalhos (F1)" aria-label="Atalhos"><Icon name="help" size={20}/></button>
      </nav>
      <aside className="inspector" aria-label="Propriedades">
      <div className="side-tabs" role="tablist">{SIDE_TABS.map(([id, label, icon]) => <button key={id} role="tab" aria-selected={sideTab === id} className={sideTab === id ? 'active' : ''} onClick={() => setSideTab(id)}><Icon name={icon} size={16}/>{label}{id === 'design' && (platforms.length + (alignment.length ? 1 : 0)) > 0 && <i className="badge">{platforms.length + (alignment.length ? 1 : 0)}</i>}</button>)}
        <button className="inspector-close" onClick={() => setInspectorOpen(false)} aria-label="Fechar painel"><Icon name="close" size={16}/></button></div>
      <fieldset disabled={busy}>
      {sideTab === 'terrain' && <>
        <Panel title="01 · Pontos e desenhos">
          <button className="upload full" onClick={() => pointFile.current.click()}>＋ Importar pontos ou desenho</button>
          <p className="hint">TXT · CSV · XYZ · DWG · DXF</p>
          <input hidden type="file" ref={pointFile} accept=".txt,.csv,.xyz,.dwg,.dxf" onChange={importFile}/>
          <label>Formato das colunas<select value={schema} onChange={e => setSchema(e.target.value)}><option value="auto">Automático / cabeçalho</option><option value="custom">Personalizado P/E/N/Z/D</option><option value="xyz">X Y Z descrição</option><option value="idxyz">P E N Z descrição</option></select></label>
          {schema === 'custom' && <label>Ordem das colunas<input type="text" value={mappingText} onChange={e => setMappingText(e.target.value)}/></label>}
          <div className="dataset"><i/> Levantamento ativo <b>{points.length}</b></div>
        </Panel>
        <Panel title="02 · Malha e restrições">
          <button className="full" onClick={() => chooseTool('breakline')}>⌁ Linha obrigatória (L)</button>
          <label className="check"><input type="checkbox" checked={densify} onChange={e => setDensify(e.target.checked)}/>Assentar nos cruzamentos da TIN (concordância)</label>
          <p className="hint">Clique nós existentes ou pontos livres: cada vértice recebe a cota da superfície atual e a malha é refeita respeitando a linha.</p>
          <div className="metric"><span>Linhas obrigatórias</span><b>{breaklines.length}</b></div>
          {breaklines.length > 0 && <button className="full" onClick={() => recompute({breaklines: breaklines.slice(0, -1)}, 'Última linha obrigatória removida.')}>Remover última linha</button>}
          <button className="full" onClick={() => chooseTool('boundary')}>⌗ Contorno de recorte (B)</button>
          <div className="metric"><span>Contorno</span><b>{boundary.length ? boundary.length + ' vértices' : 'Não definido'}</b></div>
          {boundary.length > 0 && <button className="full" onClick={() => recompute({boundary: []}, 'Contorno removido.')}>Remover contorno</button>}
          <label>Comprimento máximo da aresta (XY)<input type="number" min="0" step="any" value={edgeDraft} onChange={e => setEdgeDraft(e.target.value)}/></label>
          <button className="full" onClick={() => recompute({maxEdge: Number(edgeDraft)}, 'Limite de aresta aplicado.')}>Aplicar limite e recalcular</button>
          <div className="metric"><span>Triângulos</span><b>{mesh.triangles.length}</b></div>
        </Panel>
        <Panel title="03 · Volumes contra plano">
          <div className="metric"><span>Área plana</span><b>{fmt(stats.area2D)} m²</b></div>
          <div className="metric"><span>Área superficial</span><b>{fmt(stats.area3D)} m²</b></div>
          <div className="metric"><span>Cota mín / máx</span><b>{fmt(stats.minZ, style.precision)} / {fmt(stats.maxZ, style.precision)}</b></div>
          <label>Cota de referência<input aria-label="Cota de referência" type="number" step="any" placeholder="ex.: 105,000" value={referenceDraft} onChange={e => setReferenceDraft(e.target.value)}/></label>
          <div className="two"><button disabled={!mesh.triangles.length} onClick={() => setReferenceDraft(balanceElevation(points, mesh.triangles).toFixed(3))}>Equilíbrio</button><button disabled={!referenceDraft} onClick={() => setReferenceDraft('')}>Limpar</button></div>
          {volume && <div className="volume-card" data-testid="volume-card"><div><span>Corte</span><b className="cut">{fmt(volume.cut)} m³</b></div><div><span>Aterro</span><b className="fill">{fmt(volume.fill)} m³</b></div><div className="net"><span>Saldo</span><b>{fmt(volume.net)} m³</b></div></div>}
          <label className="check"><input type="checkbox" checked={presentation.referencePlane} onChange={e => setPresentation(p => ({...p, referencePlane: e.target.checked}))}/>Mostrar plano no 3D</label>
        </Panel>
        <PointTools key={revision} points={points} groups={groups} group={group} setGroup={g => { setGroup(g); setSelected([]); }} onSave={savePoint} onGroupLine={() => { const g = groups.find(g => g.code === group); if (g) recompute({breaklines: [...breaklines, g.indices]}, 'Grupo interligado na ordem do arquivo.'); }}/>
      </>}
      {sideTab === 'design' && <>
        <Panel title="Eixo e perfil">
          <div className="object-card">
            <div className="object-head"><b>Eixo 1</b><span>{alignment.length ? `${alignment.length} vértices · ${fmt(profile?.length ?? 0)} m` : 'Não traçado'}</span></div>
            <div className="metric"><span>Greide</span><b>{grade.length ? `${grade.length} PVIs` : 'Sem greide'}</b></div>
            <div className="two"><button onClick={() => chooseTool('profile')}>{alignment.length ? 'Redesenhar (P)' : 'Traçar eixo (P)'}</button><button disabled={!profile} onClick={() => { setLayout('profile'); setTool('orbit'); }}>Abrir perfil (4)</button></div>
            {profile && <div className="two"><button onClick={() => { setLayout('sections'); setTool('orbit'); }}>Abrir seções (5)</button><button onClick={() => commit({...doc, alignment: [], grade: []}, 'Eixo e greide removidos.')}>Remover eixo</button></div>}
          </div>
        </Panel>
        <Panel title="Acesso · gabarito no eixo">
          <p className="hint">Seção-tipo da via aplicada ao longo do eixo na cota do greide. Ao arrastar um PVI no perfil, corte, aterro, 3D, seções e volumes acompanham na hora.</p>
          <CorridorCard corridor={corridor} design={designs.find(d => d.kind === 'corridor')} hasAxis={alignment.length > 1} hasGrade={gradeGeo.pvis.length > 1} fmt={fmt}
            onChange={(next, text) => { try { commit({...doc, corridor: validateCorridor(next)}, text || 'Gabarito atualizado: acesso, seções e volumes recalculados.'); } catch (e) { setMessage(e.message); } }}
            onProfile={() => { setLayout('profile'); setTool('orbit'); }} onNotes={() => { setLayout('sections'); setTool('orbit'); setBottomTab('notes'); }}/>
        </Panel>
        <Panel title="Linhas de projeto">
          <button className="full primary" onClick={() => chooseTool('line')}>＋ Desenhar linha de projeto (T)</button>
          <p className="hint">Traçado com PIs e curvas de canto. O talude sai para o lado escolhido até encontrar o terreno, com bermas se quiser.</p>
          {designLines.length === 0 && <p className="muted">Nenhuma linha de projeto.</p>}
          {designLines.map(l => <DesignLineCard key={l.id} line={l} design={designs.find(d => d.kind === 'line' && d.line.id === l.id)} selected={l.id === selectedLine} onSelect={() => setSelectedLine(l.id)} fmt={fmt}
            onChange={(changes, text) => updateLine(l.id, changes, text)} onRemove={() => { commit({...doc, designLines: designLines.filter(x => x.id !== l.id)}, `${l.name} removida.`); if (selectedLine === l.id) setSelectedLine(null); }}/>)}
        </Panel>
        <Panel title="Plataformas e taludes">
          <button className="full primary" onClick={() => chooseTool('platform')}>＋ Desenhar plataforma (G)</button>
          <p className="hint">Polilinha fechada em planta. Taludes partem da borda até encontrar o terreno, com inclinação H:V de corte e de aterro.</p>
          {platforms.length === 0 && <p className="muted">Nenhuma plataforma no projeto.</p>}
          {platforms.map(p => { const d = designs.find(x => x.kind === 'platform' && x.platform.id === p.id), sel = p.id === selectedPlatform; return <div key={p.id} className={`object-card ${sel ? 'selected' : ''}`} data-testid={`platform-${p.name}`} onClick={() => setSelectedPlatform(p.id)}>
            <div className="object-head"><input aria-label="Nome da plataforma" className="name" key={p.name} defaultValue={p.name} onBlur={e => e.target.value.trim() && e.target.value !== p.name && updatePlatform(p.id, {name: e.target.value.trim()}, 'Plataforma renomeada.')} onKeyDown={e => e.key === 'Enter' && e.target.blur()}/>
              <label className="check inline" title="Exibir e calcular"><input type="checkbox" checked={p.visible !== false} onChange={e => updatePlatform(p.id, {visible: e.target.checked}, e.target.checked ? 'Plataforma ativada.' : 'Plataforma ocultada (fora dos cálculos).')}/>ativa</label></div>
            <NumberField label={isRamp(p) ? 'Cota de referência (desloca a rampa)' : 'Cota da plataforma'} aria-label={`Cota da ${p.name}`} value={p.elevation} onCommit={v => setPlatformElevation(p, v)}/>
            <div className="two"><NumberField label="Corte H:V" aria-label={`Talude de corte da ${p.name}`} value={p.cutSlope} min="0.01" digits={2} onCommit={v => updatePlatform(p.id, {cutSlope: v})}/><NumberField label="Aterro H:V" aria-label={`Talude de aterro da ${p.name}`} value={p.fillSlope} min="0.01" digits={2} onCommit={v => updatePlatform(p.id, {fillSlope: v})}/></div>
            <div className="two"><button onClick={e => { e.stopPropagation(); const m = meanTerrainInside(points, mesh.triangles, p.polygon, elevationAt); if (m !== null) setPlatformElevation(p, Math.round(m * 1000) / 1000, 'Cota média do terreno aplicada.'); }}>Cota média</button><button onClick={e => { e.stopPropagation(); balancePlatform(p); }} title="Corte ≈ aterro">Equilíbrio</button></div>
            {(() => { const bn = p.benches || BENCH_DEFAULT, rd = rampDraft[p.id] || {slope: '2', azimuth: '0'}, zs = platformVertexZ(p), setRd = (k, v) => setRampDraft(r => ({...r, [p.id]: {...rd, [k]: v}})); return <>
              <details className="sub" open={openSub[p.id + ':ramp'] ?? isRamp(p)} onToggle={e => { const o = e.currentTarget.open; setOpenSub(x => x[p.id + ':ramp'] === o ? x : {...x, [p.id + ':ramp']: o}); }}><summary>Rampa {isRamp(p) ? `· ${fmt(Math.min(...zs))} → ${fmt(Math.max(...zs))}` : '· plana'}</summary>
                <div className="two"><label>Caimento (%)<input type="number" step="any" aria-label={`Caimento da ${p.name}`} value={rd.slope} onChange={e => setRd('slope', e.target.value)}/></label>
                  <label>Desce para (°)<input type="number" step="any" min="0" max="360" aria-label={`Direção da rampa da ${p.name}`} title="Azimute: 0 = norte, 90 = leste, 180 = sul, 270 = oeste" value={rd.azimuth} onChange={e => setRd('azimuth', e.target.value)}/></label></div>
                <div className="two"><button onClick={() => applyRamp(p)}>Aplicar rampa</button><button disabled={!isRamp(p)} onClick={() => updatePlatform(p.id, flattenPlatform(p), `${p.name}: rampa removida, plataforma plana.`)}>Tornar plana</button></div>
                <p className="hint">A cota de referência vale no centro; o caimento desce na direção do azimute. Cada vértice pode ter cota própria:</p>
                <div className="vertex-z">{p.polygon.map((v, i) => <NumberField key={i} label={`V${i + 1}`} aria-label={`Cota do vértice ${i + 1} da ${p.name}`} value={zs[i]} onCommit={z => updatePlatform(p.id, {polygon: p.polygon.map((q, k) => k === i ? {...q, z} : q)}, `${p.name}: cota do vértice ${i + 1} alterada.`)}/>)}</div>
              </details>
              <SlopeFields label={p.name} benches={bn} end={p.end} baseZ={p.elevation} onChange={(changes, text) => updatePlatform(p.id, changes, text)}/></>; })()}
            {d?.error && <p className="field-error">{d.error}</p>}
            {d?.volume && <div className="volume-card compact"><div><span>Corte</span><b className="cut">{fmt(d.volume.cut, 1)} m³</b><small>h máx {fmt(d.mesh.stats.maxCut)} m</small></div><div><span>Aterro</span><b className="fill">{fmt(d.volume.fill, 1)} m³</b><small>h máx {fmt(d.mesh.stats.maxFill)} m</small></div><div className="net"><span>Saldo · área ocupada</span><b>{fmt(d.volume.net, 1)} m³ · {fmt(d.volume.footprint, 0)} m²</b></div></div>}
            {d?.mesh?.warnings.map(w => <p key={w} className="warn">⚠ {w}</p>)}
            <button className="full danger" onClick={e => { e.stopPropagation(); commit({...doc, platforms: platforms.filter(x => x.id !== p.id)}, `${p.name} removida.`); }}>Excluir plataforma</button>
          </div>; })}
          {validDesigns.length > 0 && <div className="volume-card"><div><span>Corte total</span><b className="cut">{fmt(earthworks.cut, 1)} m³</b></div><div><span>Aterro total</span><b className="fill">{fmt(earthworks.fill, 1)} m³</b></div><div className="net"><span>Saldo total</span><b>{fmt(earthworks.cut - earthworks.fill, 1)} m³</b></div></div>}
          <p className="hint">Volume geométrico (sem empolamento/contração), integrado em grade fina sobre o terreno. Plataformas sobrepostas não são combinadas.</p>
        </Panel>
        <Panel title="Seções transversais">
          <div className="two"><NumberField label="Intervalo (m)" aria-label="Intervalo das seções" value={sectionSettings.interval} min="0.1" digits={2} onCommit={v => v > 0 && setSectionSettings(s => ({...s, interval: v}))}/><NumberField label="Meia largura (m)" aria-label="Meia largura das seções" value={sectionSettings.halfWidth} min="0.1" digits={2} onCommit={v => v > 0 && setSectionSettings(s => ({...s, halfWidth: v}))}/></div>
          <label className="check"><input type="checkbox" checked={layers.sections} onChange={e => setLayers(l => ({...l, sections: e.target.checked}))}/>Mostrar linhas de seção na planta</label>
          <div className="metric"><span>Seções</span><b>{stationList.length || '—'}</b></div>
          <button className="full" disabled={!profile} onClick={() => { setLayout('sections'); setTool('orbit'); }}>Abrir visualizador de seções (5)</button>
        </Panel>
      </>}
      {sideTab === 'display' && <>
        <Panel title="Navegação e atração">
          <label>Sensibilidade do zoom (roda)<input aria-label="Sensibilidade do zoom" type="range" min="0.4" max="2.5" step="0.1" value={zoomSensitivity} onChange={e => setZoomSensitivity(+e.target.value)}/></label>
          <p className="hint">Zoom suave em direção ao cursor, na planta, no 3D e no perfil.</p>
          <label className="check"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)}/>Atração ativa (F3)</label>
          <div className="two">{[['node', '□ Nó'], ['vertex', '◇ Vértice'], ['midpoint', '△ Ponto médio'], ['nearest', '⧖ Mais próximo']].map(([k, label]) => <label className="check" key={k}><input type="checkbox" checked={snapModes[k]} onChange={e => setSnapModes(m => ({...m, [k]: e.target.checked}))}/>{label}</label>)}</div>
          <label>Abertura da atração: {snapAperture}px<input aria-label="Abertura da atração" type="range" min="6" max="40" value={snapAperture} onChange={e => setSnapAperture(+e.target.value)}/></label>
          <label className="check"><input type="checkbox" checked={crosshair} onChange={e => setCrosshair(e.target.checked)}/>Mira completa</label>
        </Panel>
        <Panel title="Curvas de nível">
          <div className="two"><label>Intervalo<input aria-label="Intervalo das curvas" type="number" min="0" step="any" value={contourDraft.interval} onChange={e => applyContourDraft('interval', e.target.value)}/></label><label>Mestra a cada<input aria-label="Curva mestra a cada" type="number" min="1" step="1" value={contourDraft.majorEvery} onChange={e => applyContourDraft('majorEvery', e.target.value)}/></label></div>
          {[['visible2D', 'Exibir na planta'], ['visible3D', 'Exibir no 3D'], ['labels', 'Rótulos nas mestras']].map(([k, label]) => <label className="check" key={k}><input type="checkbox" checked={contourStyle[k]} onChange={e => setContourStyle(s => ({...s, [k]: e.target.checked}))}/>{label}</label>)}
          {contourResult.error ? <p className="field-error" role="alert">{contourResult.error}</p> : contours && <div className="metric"><span>Curvas geradas</span><b>{contours.levels.length} cotas</b></div>}
        </Panel>
        <Panel title="Camadas e estilo">
          {[['points', 'Pontos'], ['edges', 'Arestas triangulares'], ['breaklines', 'Linhas obrigatórias'], ['border', 'Borda da superfície'], ['grid', 'Grade de referência']].map(([k, label]) => <label className="check" key={k}><input type="checkbox" checked={layers[k]} onChange={e => setLayers(l => ({...l, [k]: e.target.checked}))}/>{label}</label>)}
          <label>Estilo do modelo<select aria-label="Estilo do modelo" value={presentation.style} onChange={e => setPresentation(p => ({...p, style: e.target.value}))}><option value="concept">Mata e mineração · Carajás</option><option value="hypso">Hipsométrico · faixas de cota</option><option value="solid">Sólido · iluminação suave</option><option value="wire">Aramado · inspecionar triangulação</option></select></label>
          <label className="check"><input type="checkbox" checked={presentation.grid} onChange={e => setPresentation(p => ({...p, grid: e.target.checked}))}/>Grade no 3D</label>
        </Panel>
        <Panel title="Cores dos grupos" open={false}>{groups.map(g => <label className="group-color" key={g.code}><span>{g.code}</span><input aria-label={`Cor do grupo ${g.code}`} type="color" value={groupColors[g.code] || '#d8eee5'} onChange={e => setGroupColors(c => ({...c, [g.code]: e.target.value}))}/></label>)}</Panel>
        <Panel title="Rótulos na planta" open={false}>
          <label>Estilo de Rótulo do Ponto<select value={preset} onChange={e => { const v = e.target.value; setPreset(v); setStyle(s => ({...s, visible: v !== 'none', id: v === 'all' || v === 'id', elevation: v !== 'id', description: v === 'all' || v === 'zd'})); }}><option value="none">Nenhum rótulo</option><option value="z">Apenas Cota</option><option value="zd">Cota e Descrição</option><option value="all">Ponto, Cota e Descrição</option><option value="id">Apenas identificador</option><option value="custom" disabled>Personalizado</option></select></label>
          {[['visible', 'Exibir rótulos'], ['id', 'Identificador'], ['elevation', 'Cota (Z)'], ['description', 'Descrição']].map(([k, label]) => <label className="check" key={k}><input type="checkbox" checked={style[k]} onChange={e => setLabel(k, e.target.checked)}/>{label}</label>)}
          <div className="two"><label>Cor do rótulo<input type="color" value={style.color} onChange={e => setLabel('color', e.target.value)}/></label><label>Tamanho<input type="number" min="8" max="24" value={style.size} onChange={e => setLabel('size', Math.max(8, Math.min(24, +e.target.value)))}/></label></div>
          <label>Casas decimais<select value={style.precision} onChange={e => setLabel('precision', +e.target.value)}>{[0, 1, 2, 3, 4].map(i => <option key={i}>{i}</option>)}</select></label>
        </Panel>
      </>}
      {sideTab === 'export' && <>
        <Panel title="Exportar para CAD">
          {[['tin', 'Terreno (3DFACE)'], ['points', 'Pontos por grupo'], ['labels', 'Rótulos dos pontos'], ['contours', 'Curvas de nível'], ['design', 'Plataformas, taludes e offset'], ['grade', 'Greide 3D (eixo)'], ['sections', 'Linhas de seção do terreno']].map(([k, label]) => <label className="check" key={k}><input type="checkbox" checked={dxfOptions[k]} onChange={e => setDxfOptions(o => ({...o, [k]: e.target.checked}))}/>{label}</label>)}
          <button className="full primary" onClick={() => exportFile('dxf')}>↓ DXF (AutoCAD / Civil 3D)</button>
          <div className="two"><button onClick={() => exportFile('landxml')}>LandXML</button><button onClick={() => exportFile('csv')}>CSV pontos</button></div>
          <button className="full" disabled={!corridorInfo?.ok} title={corridorInfo?.ok ? 'Estacas no intervalo das seções' : 'Ative o gabarito de acesso no painel Projeto'} onClick={exportNotes}>Nota de serviço do acesso (CSV)</button>
          <p className="hint">LandXML leva a superfície do terreno e, havendo plataformas, a superfície de projeto.</p>
        </Panel>
        <Panel title="Projeto"><div className="two"><button onClick={saveProject}>Salvar JSON</button><button onClick={() => projectFile.current.click()}>Abrir JSON</button></div><p className="hint">O JSON v5 guarda terreno, edições, eixo, greide, plataformas (rampas e bermas) e estilos. Abre também v1 a v4.</p></Panel>
      </>}
    </fieldset></aside>
    <main>
      <LicenseBanner license={license}/>
      {(layout === 'split' || (profile && ['2D', 'split', '3D'].includes(layout))) && <div className="stage-bar">
        {layout === 'split' && <label className="split-control">Divisão<input aria-label="Divisão das duas vistas" type="range" min="30" max="70" value={splitRatio} onChange={e => setSplitRatio(+e.target.value)}/></label>}
        {profile && ['2D', 'split', '3D'].includes(layout) && <label className="check inline"><input type="checkbox" checked={showProfileDock} onChange={e => setShowProfileDock(e.target.checked)}/>Perfil acoplado</label>}</div>}
      {['2D', 'split', '3D'].includes(layout) && <div className={`viewports ${layout === 'split' ? 'split' : ''}`} style={{'--plan-ratio': splitRatio + '%'}} aria-busy={busy}>{layout !== '3D' && panel('2D')}{layout !== '2D' && panel('3D')}{busy && <div className="busy-overlay" role="status">Calculando superfície em segundo plano…</div>}</div>}
      {layout === 'sections' && <div className="viewports sections-plan" aria-busy={busy}>{panel('2D')}</div>}
      {layout !== 'profile' && <div className={`instruction ${picking || tool === 'swap' || tool === 'delete' ? 'tool-active' : ''}`}>{picking ? <><span>{TOOL_NAMES[tool]}: {pickCount} {tool === 'boundary' ? 'pontos' : 'vértices'} · {TOOL_HINTS[tool]}</span>
        <button disabled={busy || pickCount < minPick} onClick={() => finish()}>Concluir (Enter)</button>
        <button disabled={busy || !pickCount} onClick={() => tool === 'boundary' ? setSelected(s => s.slice(0, -1)) : setPickDraft(s => s.slice(0, -1))}>Retirar último</button>
        <button onClick={() => chooseTool('orbit')}>Cancelar (Esc)</button></>
        : <span>{tool === 'swap' ? 'Clique na diagonal interna a inverter na planta.' : tool === 'delete' ? 'Clique na aresta para remover as faces adjacentes.' : 'Roda: zoom no cursor · arraste: mover / orbitar · clique numa plataforma para selecioná-la'}</span>}</div>}
      {layout === 'profile' && editor}
      {['profile', 'sections'].includes(layout) && corridor.enabled && layout === 'sections' && <div className="bottom-tabs" role="tablist"><button role="tab" aria-selected={bottomTab === 'cubage'} className={bottomTab === 'cubage' ? 'active' : ''} onClick={() => setBottomTab('cubage')}>Cubagem</button><button role="tab" aria-selected={bottomTab === 'notes'} className={bottomTab === 'notes' ? 'active' : ''} onClick={() => setBottomTab('notes')}>Nota de serviço</button></div>}
      {['profile', 'sections'].includes(layout) && (layout !== 'sections' || !corridor.enabled || bottomTab === 'cubage') && <CubageTable rows={cubage} current={currentStation} onStation={pickStation}/>}
      {layout === 'sections' && corridor.enabled && bottomTab === 'notes' && <ServiceNotes rows={notes} current={currentStation} onStation={pickStation} onExport={exportNotes}/>}
      {layout === 'sections' && <SectionViewer sections={sections} index={Math.min(sectionIndex, Math.max(0, sections.length - 1))} onIndex={setSectionIndex} totals={sectionTotals} halfWidth={sectionSettings.halfWidth} precision={style.precision} equalScale={equalScale} onEqualScale={setEqualScale}/>}
      {['2D', 'split', '3D'].includes(layout) && showProfileDock && editor}
      {!mesh.triangles.length && <div className="empty-warning">Nenhum triângulo passou pelos filtros. Aumente o limite de aresta ou revise o contorno.</div>}
      {help && <div className="shortcut-help"><b>Atalhos Terra CAD</b><span>Vistas: 2 planta · V duas vistas · 3 modelo · 4 perfil · 5 seções · Z enquadrar · Ferramentas: N navegar · L linha obrigatória · B contorno · P eixo · G plataforma · S inverter · D aparar · C curvas · F3 atração · Enter concluir · Backspace retirar · Esc cancelar · Perfil: Delete remove PVI · Seções: ◀ ▶ · Ctrl+Z/S/O</span></div>}
      {layout !== 'profile' && <><div className="data-title"><button onClick={() => setShowTable(v => !v)} aria-expanded={showTable}><Icon name="table" size={16}/>Pontos do levantamento {showTable ? '▾' : '▸'}</button><span>{visibleIndices.length} no filtro · tabela com até 100 pontos</span></div>
      {showTable && <div className="table-wrap"><table><thead><tr>{['PONTO', 'ESTE (X)', 'NORTE (Y)', 'COTA (Z)', 'DESCRIÇÃO'].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{visibleIndices.slice(0, 100).map(i => points[i]).map(p => <tr key={p.id}><td>{p.id}</td><td>{p.x.toFixed(3)}</td><td>{p.y.toFixed(3)}</td><td>{p.z.toFixed(style.precision)}</td><td>{p.description || '—'}</td></tr>)}</tbody></table></div>}</>}
      {errors.length > 0 && <details className="errors"><summary>{errors.length} linhas rejeitadas</summary>{errors.map((e, i) => <p key={i}>Linha {e.line}: {e.message}</p>)}</details>}
    </main></div>
    {license && <LockScreen license={license} onSave={saveProject}/>}
    {license && adminOpen && <AdminPanel license={license} onClose={() => setAdminOpen(false)} onNotice={setMessage}/>}
    {cadImport && <CadImportDialog data={cadImport} onCancel={() => { setCadImport(null); setMessage('Importação do desenho cancelada.'); }} onConfirm={importCadPoints}/>}
    <footer className="statusbar"><span role="status" className="status-message"><i className={`live ${busy ? 'busy' : ''}`}/>{busy ? 'Calculando…' : message}</span><span className="footer-right">{selPlat && <span>{selPlat.name}</span>}<span className={snap ? 'on' : ''}>Atração {snap ? 'ON' : 'OFF'}</span><span>TIN 2.5D</span><span>v{VERSION}</span></span></footer>
  </div>;
}

function insideXY(x, y, poly) { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[j], b = poly[i]; if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside; } return inside; }
