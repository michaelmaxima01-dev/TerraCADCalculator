import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Viewport from './components/ViewportV3';
import PointTools from './components/PointTools';
import ProfileChart from './components/ProfileChart';
import {pointGroups, upsertPoint} from './core/points';
import {editEdge} from './core/tin';
import {buildSurface} from './core/surface';
import {buildContours} from './core/contours';
import {surfaceStats, volumeToPlane, balanceElevation} from './core/volumes';
import {sampleProfile, triangleLocator} from './core/profile';
import {toDXF, toLandXML, toCSV} from './core/exporters';

const VERSION = '3.0';
const demo = Array.from({length: 117}, (_, i) => {
  const x = i % 13 * 15, y = Math.floor(i / 13) * 18;
  return {id: `P${String(i + 1).padStart(3, '0')}`, x: 320000 + x, y: 7420000 + y, z: 100 + 20 * Math.sin(x / 70) * Math.cos(y / 100) + y * .06, description: i % 13 === 0 ? 'BE' : i % 13 === 12 ? 'BD' : 'TN'};
});
const initial = {points: demo, breaklines: [], boundary: [], maxEdge: 0, alignment: [], mesh: buildSurface(demo)};
const defaultStyle = {visible: true, id: true, elevation: false, description: false, color: '#d7eade', size: 12, precision: 3};
const defaultContours = {visible2D: true, visible3D: true, labels: true, interval: 1, majorEvery: 5};
const TOOL_NAMES = {orbit: 'Navegar', breakline: 'Linha de ruptura', boundary: 'Contorno', swap: 'Inverter aresta', delete: 'Aparar malha', profile: 'Perfil longitudinal'};
const fmt = (v, d = 2) => Number.isFinite(v) ? v.toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d}) : '—';

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

export default function AppV3() {
  const [doc, setDoc] = useState(initial), [history, setHistory] = useState([]), [splitRatio, setSplitRatio] = useState(50), [layout, setLayout] = useState('split');
  const [tool, setTool] = useState('orbit'), [selected, setSelected] = useState([]), [pathDraft, setPathDraft] = useState([]);
  const [message, setMessage] = useState(`Versão ${VERSION} · Curvas de nível, volumes, perfil e exportação DXF/LandXML.`), [errors, setErrors] = useState([]);
  const [style, setStyle] = useState(defaultStyle), [preset, setPreset] = useState('id');
  const [layers, setLayers] = useState({points: true, edges: true, breaklines: true, border: true, grid: true});
  const [presentation, setPresentation] = useState({style: 'concept', grid: false, referencePlane: true});
  const [groupColors, setGroupColors] = useState({BE: '#80c6ff', BD: '#ffd27b', TN: '#d1efdf'}), [group, setGroup] = useState('');
  const [schema, setSchema] = useState('auto'), [mappingText, setMappingText] = useState('P,E,N,Z,D'), [edgeDraft, setEdgeDraft] = useState('0');
  const [snap, setSnap] = useState(true), [crosshair, setCrosshair] = useState(true), [fitKey, setFitKey] = useState(0);
  const [showTable, setShowTable] = useState(false), [showProfile, setShowProfile] = useState(true), [help, setHelp] = useState(false), [revision, setRevision] = useState(0);
  const [contourStyle, setContourStyle] = useState(defaultContours), [contourDraft, setContourDraft] = useState({interval: '1', majorEvery: '5'});
  const [referenceDraft, setReferenceDraft] = useState(''), [dxfOptions, setDxfOptions] = useState({tin: true, points: true, labels: true, contours: true});
  const {run, busy} = useGeometry(); const pointFile = useRef(), projectFile = useRef();
  const {points, mesh, breaklines, boundary, maxEdge, alignment} = doc;

  const groups = useMemo(() => pointGroups(points), [points]);
  const visibleIndices = useMemo(() => groups.filter(g => !group || g.code === group).flatMap(g => g.indices).sort((a, b) => a - b), [groups, group]);
  const contourResult = useMemo(() => {
    if (!contourStyle.visible2D && !contourStyle.visible3D && !dxfOptions.contours) return {data: null};
    try { return {data: buildContours(points, mesh.triangles, contourStyle)}; } catch (e) { return {data: null, error: e.message}; }
  }, [points, mesh.triangles, contourStyle.interval, contourStyle.majorEvery, contourStyle.visible2D, contourStyle.visible3D, dxfOptions.contours]);
  const contours = contourResult.data;
  const stats = useMemo(() => surfaceStats(points, mesh.triangles), [points, mesh.triangles]);
  const referenceZ = referenceDraft.trim() === '' ? NaN : Number(referenceDraft.replace(',', '.'));
  const volume = useMemo(() => Number.isFinite(referenceZ) && mesh.triangles.length ? volumeToPlane(points, mesh.triangles, referenceZ) : null, [points, mesh.triangles, referenceZ]);
  const profile = useMemo(() => { try { return alignment.length > 1 ? sampleProfile(points, mesh.triangles, alignment) : null; } catch { return null; } }, [points, mesh.triangles, alignment]);
  const elevationAt = useMemo(() => mesh.triangles.length ? triangleLocator(points, mesh.triangles) : null, [points, mesh.triangles]);

  const commit = useCallback((next, text) => { setHistory(h => [...h.slice(-19), doc]); setDoc(next); setSelected([]); setPathDraft([]); setRevision(v => v + 1); setMessage(text); }, [doc]);
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
      if (file.size > 10e6) throw Error('Limite: 10 MB por arquivo.');
      let mapping = null;
      if (schema === 'custom') {
        const names = mappingText.toUpperCase().split(/[,;\s]+/).filter(Boolean);
        if (['E', 'N', 'Z'].some(k => !names.includes(k)) || new Set(names).size !== names.length) throw Error('Mapeamento exige E, N e Z, sem colunas repetidas.');
        mapping = {id: names.indexOf('P'), x: names.indexOf('E'), y: names.indexOf('N'), z: names.indexOf('Z'), description: names.indexOf('D')};
      }
      const result = await run('import', {text: await file.text(), options: {schema, mapping}});
      commit({points: result.points, mesh: result.mesh, breaklines: [], boundary: [], maxEdge: 0, alignment: []}, `${file.name}: ${result.points.length} pontos; ${result.errors.length} linhas rejeitadas. Defina um contorno para recortar o levantamento.`);
      setErrors(result.errors); setGroup(''); setEdgeDraft('0'); setReferenceDraft(''); setFitKey(k => k + 1);
    } catch (e) { setMessage(e.message); }
  }
  function undo() {
    if (busy) return; const previous = history.at(-1); if (!previous) return;
    setDoc(previous); setHistory(history.slice(0, -1)); setGroup(''); setSelected([]); setPathDraft([]); setEdgeDraft(String(previous.maxEdge)); setRevision(v => v + 1); setMessage('Edição desfeita nas duas vistas.');
  }
  async function savePoint(draft, index) { try { const next = upsertPoint(points, draft, index); return await recompute({points: next}, 'Ponto salvo e modelo 3D atualizado.'); } catch (e) { setMessage(e.message); return false; } }
  function chooseTool(next) {
    if (busy) return; setTool(next); setSelected([]); setPathDraft([]);
    if (next !== 'orbit') { if (layout === '3D') setLayout('split'); setLayers(l => ({...l, points: true, edges: ['swap', 'delete'].includes(next) ? true : l.edges})); }
    setMessage(next === 'boundary' ? 'Selecione o contorno na planta, em sequência. Enter fecha e recorta.' : next === 'profile' ? 'Clique os vértices do traçado na planta (com atração aos pontos ou livre). Enter gera o perfil.' : 'Ferramenta: ' + (TOOL_NAMES[next] || next));
  }
  const onPoint = useCallback(i => { if (busy) return; setSelected(s => s.at(-1) === i ? s : [...s, i]); }, [busy]);
  const onPlanPoint = useCallback(p => setPathDraft(d => { const last = d.at(-1); return last && Math.hypot(last.x - p.x, last.y - p.y) < 1e-9 ? d : [...d, p]; }), []);
  const onEdge = useCallback((a, b) => {
    if (busy) return;
    try { const triangles = editEdge(points, mesh.triangles, mesh.constraints, a, b, tool); commit({...doc, mesh: {...mesh, triangles}}, tool === 'swap' ? 'Aresta invertida. Modelo 3D atualizado.' : 'Faces adjacentes removidas. Modelo 3D atualizado.'); }
    catch (e) { setMessage(e.message); }
  }, [busy, points, mesh, doc, tool, commit]);
  async function finish(indices = selected) {
    if (busy) return;
    if (tool === 'profile') {
      if (pathDraft.length < 2) return setMessage('O perfil exige pelo menos dois vértices.');
      commit({...doc, alignment: pathDraft}, `Perfil traçado com ${pathDraft.length} vértices.`); setShowProfile(true); setTool('orbit'); return;
    }
    if (tool === 'boundary') { const ring = indices.at(-1) === indices[0] ? indices.slice(0, -1) : indices; if (await recompute({boundary: ring}, 'Contorno aplicado.')) setTool('orbit'); }
    else await recompute({breaklines: [...breaklines, indices]}, 'Linha de ruptura incorporada ao modelo.');
  }
  function saveProject() {
    const data = {version: 3, points, triangles: mesh.triangles, breaklines, boundary, maxEdge, alignment, labelStyle: style, groupColors, contourStyle, referenceZ: Number.isFinite(referenceZ) ? referenceZ : null};
    downloadText('terra-cad-v3.json', JSON.stringify(data, null, 2), 'application/json');
    setMessage('Projeto exportado. Abra este JSON no outro computador para continuar.');
  }
  async function openProject(e) {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      if (file.size > 30e6) throw Error('Projeto acima do limite de 30 MB.');
      const data = JSON.parse(await file.text()), next = await run('project', data);
      commit(next, 'Projeto aberto com suas linhas, recorte, perfil e edições.'); setGroup(''); setEdgeDraft(String(next.maxEdge)); setErrors([]);
      if (data.labelStyle) { const s = data.labelStyle; setStyle({visible: !!s.visible, id: !!s.id, elevation: !!s.elevation, description: !!s.description, color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : defaultStyle.color, size: Math.max(8, Math.min(24, Number(s.size) || 12)), precision: Math.max(0, Math.min(4, Math.round(Number(s.precision) || 0)))}); setPreset('custom'); }
      if (data.groupColors && typeof data.groupColors === 'object') setGroupColors(Object.fromEntries(Object.entries(data.groupColors).filter(([k, v]) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))));
      const c = data.contourStyle;
      if (c && Number(c.interval) > 0 && Number.isInteger(Number(c.majorEvery)) && Number(c.majorEvery) >= 1) { setContourStyle({visible2D: c.visible2D !== false, visible3D: c.visible3D !== false, labels: c.labels !== false, interval: Number(c.interval), majorEvery: Number(c.majorEvery)}); setContourDraft({interval: String(c.interval), majorEvery: String(c.majorEvery)}); }
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
      if (kind === 'dxf') { downloadText('terra-cad.dxf', toDXF({points, triangles: mesh.triangles, breaklines, boundary, contours: dxfOptions.contours ? contours : null, profile}, {...dxfOptions, contours: dxfOptions.contours && !!contours}), 'application/dxf'); setMessage('DXF exportado (R12): TIN em 3DFACE, pontos, curvas, rupturas, contorno e perfil em camadas TC_*.'); }
      if (kind === 'landxml') { if (!mesh.triangles.length) throw Error('Superfície vazia: nada a exportar.'); downloadText('terra-cad-superficie.xml', toLandXML({points, triangles: mesh.triangles, boundary}, {name: 'TerraCAD'}), 'application/xml'); setMessage('LandXML exportado: importe no Civil 3D como superfície TIN.'); }
      if (kind === 'csv') { downloadText('terra-cad-pontos.csv', toCSV(points), 'text/csv'); setMessage('Pontos exportados em CSV (P;E;N;Z;D).'); }
    } catch (e) { setMessage(e.message); }
  }
  useEffect(() => {
    const handler = e => {
      if (e.target.closest('input,select,textarea') || e.target.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 'f1') { e.preventDefault(); setHelp(v => !v); return; }
      if (k === 'f3') { e.preventDefault(); setSnap(v => !v); return; }
      if (busy) return;
      if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveProject(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'o') { e.preventDefault(); projectFile.current.click(); return; }
      if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); undo(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'escape') { setSelected([]); setPathDraft([]); setTool('orbit'); }
      else if (k === 'enter' && ['breakline', 'boundary', 'profile'].includes(tool)) { e.preventDefault(); finish(); }
      else if (k === 'backspace' && (selected.length || pathDraft.length)) { e.preventDefault(); tool === 'profile' ? setPathDraft(s => s.slice(0, -1)) : setSelected(s => s.slice(0, -1)); }
      else if (k === '2') setLayout('2D');
      else if (k === '3') { setLayout('3D'); setTool('orbit'); }
      else if (k === 'v') setLayout('split');
      else if (k === 'z') setFitKey(v => v + 1);
      else if (k === 'l') chooseTool('breakline');
      else if (k === 'b') chooseTool('boundary');
      else if (k === 's') chooseTool('swap');
      else if (k === 'd') chooseTool('delete');
      else if (k === 'n') chooseTool('orbit');
      else if (k === 'p') chooseTool('profile');
      else if (k === 'c') setContourStyle(s => { const on = !(s.visible2D || s.visible3D); return {...s, visible2D: on, visible3D: on}; });
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  });
  const setLabel = (k, v) => { setPreset('custom'); setStyle(s => ({...s, [k]: v})); };
  const common = {points, triangles: mesh.triangles, constraints: mesh.constraints, style, tool, selected, visibleIndices, layers, presentation, groupColors, boundary, fitKey, snap, crosshair, onPoint, onEdge, onPlanPoint, onNotice: setMessage,
    contours, contourStyle, alignment, pathDraft, profileSamples: profile?.samples, referenceZ, elevationAt};
  const panel = mode => <div key={mode} className={`viewport-panel ${mode === '2D' ? 'plan-panel' : 'model-panel'}`} data-testid={`panel-${mode}`}>
    <div className="panel-heading"><span><i className="live"/> {mode === '2D' ? 'PLANTA · EDIÇÃO' : 'MODELO 3D · INSPEÇÃO'}</span><small>{mode === '2D' ? 'Pontos, linhas e curvas' : 'Superfície limpa'}</small></div>
    <Viewport {...common} mode={mode}/><div className="panel-axis">N ↑<br/>E →</div>
  </div>;
  const picking = ['boundary', 'breakline', 'profile'].includes(tool), pickCount = tool === 'profile' ? pathDraft.length : selected.length;

  return <div className="app v2 v3">
    <header>
      <a className="brand" href="#">◬ <b>TERRA<span>CAD</span></b><em>{VERSION}</em></a>
      <div className="project">Estúdio de superfícies <span>/ Topografia & engenharia</span></div>
      <button disabled={busy} onClick={() => projectFile.current.click()}>Abrir projeto</button>
      <input hidden type="file" accept=".json" ref={projectFile} onChange={openProject}/>
      <button disabled={busy} className="primary" onClick={saveProject}>↓ Salvar projeto</button>
    </header>
    <div className="workspace"><aside><div className="section-title">PAINEL DO PROJETO <span>LOCAL</span></div><h1>Modelo do terreno</h1><p className="muted">Edite em planta. Confira em 3D.</p><fieldset disabled={busy}>
      <section><h2>01 · Nuvem de Pontos</h2>
        <button className="upload full" onClick={() => pointFile.current.click()}>＋ Importar TXT / CSV / XYZ</button>
        <input hidden type="file" ref={pointFile} accept=".txt,.csv,.xyz" onChange={importFile}/>
        <label>Formato das colunas<select value={schema} onChange={e => setSchema(e.target.value)}><option value="auto">Automático / cabeçalho</option><option value="custom">Personalizado P/E/N/Z/D</option><option value="xyz">X Y Z descrição</option><option value="idxyz">P E N Z descrição</option></select></label>
        {schema === 'custom' && <label>Ordem das colunas<input type="text" value={mappingText} onChange={e => setMappingText(e.target.value)}/></label>}
        <div className="dataset"><i/> Levantamento ativo <b>{points.length}</b></div>
      </section>
      <section><h2>02 · Controle da triangulação</h2><p className="muted">Evite ligações que atravessam áreas sem levantamento.</p>
        <button className="full" onClick={() => chooseTool('boundary')}>⌗ Desenhar contorno de recorte</button>
        <div className="metric"><span>Contorno</span><b>{boundary.length ? boundary.length + ' vértices' : 'Não definido'}</b></div>
        {boundary.length > 0 && <button className="full" onClick={() => recompute({boundary: []}, 'Contorno removido.')}>Remover contorno</button>}
        <label>Comprimento máximo da aresta (XY)<input type="number" min="0" step="any" value={edgeDraft} onChange={e => setEdgeDraft(e.target.value)}/></label>
        <p className="hint">Unidades do arquivo · 0 desativa. Pode abrir lacunas.</p>
        <button className="full" onClick={() => recompute({maxEdge: Number(edgeDraft)}, 'Limite de aresta aplicado.')}>Aplicar limite e recalcular</button>
        <div className="metric"><span>Triângulos</span><b>{mesh.triangles.length}</b></div>
        <div className="metric"><span>Linhas de ruptura</span><b>{breaklines.length}</b></div>
        <p className="hint">Contorno e linhas passam pelos pontos escolhidos. Recalcular reinicia inversões e cortes manuais.</p>
      </section>
      <section><h2>03 · Curvas de nível</h2>
        <div className="two">
          <label>Intervalo<input aria-label="Intervalo das curvas" type="number" min="0" step="any" value={contourDraft.interval} onChange={e => applyContourDraft('interval', e.target.value)}/></label>
          <label>Mestra a cada<input aria-label="Curva mestra a cada" type="number" min="1" step="1" value={contourDraft.majorEvery} onChange={e => applyContourDraft('majorEvery', e.target.value)}/></label>
        </div>
        {[['visible2D', 'Exibir na planta'], ['visible3D', 'Exibir no 3D'], ['labels', 'Rótulos nas mestras']].map(([k, label]) => <label className="check" key={k}><input type="checkbox" checked={contourStyle[k]} onChange={e => setContourStyle(s => ({...s, [k]: e.target.checked}))}/>{label}</label>)}
        {contourResult.error ? <p className="field-error" role="alert">{contourResult.error}</p> : contours && <div className="metric"><span>Curvas geradas</span><b>{contours.levels.length} cotas</b></div>}
        <p className="hint">Geradas da TIN atual: acompanham recorte, rupturas e edições. Tecla C liga/desliga.</p>
      </section>
      <section><h2>04 · Volumes e áreas</h2>
        <div className="metric"><span>Área plana</span><b>{fmt(stats.area2D)} m²</b></div>
        <div className="metric"><span>Área superficial</span><b>{fmt(stats.area3D)} m²</b></div>
        <div className="metric"><span>Cota mín / máx</span><b>{fmt(stats.minZ, style.precision)} / {fmt(stats.maxZ, style.precision)}</b></div>
        <label>Cota de referência (plataforma)<input aria-label="Cota de referência" type="number" step="any" placeholder="ex.: 105,000" value={referenceDraft} onChange={e => setReferenceDraft(e.target.value)}/></label>
        <div className="two"><button disabled={!mesh.triangles.length} onClick={() => setReferenceDraft(balanceElevation(points, mesh.triangles).toFixed(3))} title="Cota em que corte ≈ aterro">Equilíbrio</button><button disabled={!referenceDraft} onClick={() => setReferenceDraft('')}>Limpar</button></div>
        {volume && <div className="volume-card" data-testid="volume-card">
          <div><span>Corte</span><b className="cut">{fmt(volume.cut)} m³</b><small>{fmt(volume.areaCut)} m²</small></div>
          <div><span>Aterro</span><b className="fill">{fmt(volume.fill)} m³</b><small>{fmt(volume.areaFill)} m²</small></div>
          <div className="net"><span>Saldo (corte − aterro)</span><b>{fmt(volume.net)} m³</b></div>
        </div>}
        <label className="check"><input type="checkbox" checked={presentation.referencePlane} onChange={e => setPresentation(p => ({...p, referencePlane: e.target.checked}))}/>Mostrar plano no 3D</label>
        <p className="hint">Volume exato da TIN contra um plano horizontal, nas unidades do arquivo. Não considera empolamento nem taludes.</p>
      </section>
      <section><h2>05 · Perfil longitudinal</h2>
        <button className="full" onClick={() => chooseTool('profile')}>⟋ Traçar perfil na planta (P)</button>
        <div className="metric"><span>Traçado</span><b>{alignment.length ? `${alignment.length} vértices · ${fmt(profile?.length ?? 0)} m` : 'Não definido'}</b></div>
        {alignment.length > 0 && <button className="full" onClick={() => { setShowProfile(v => !v); }}>{showProfile ? 'Ocultar gráfico' : 'Mostrar gráfico'}</button>}
      </section>
      <section><h2>06 · Visualização</h2>
        <div className="two">{[['crosshair', 'Mira completa'], ['snap', 'Atração aos pontos']].map(([k, label]) => <label className="check" key={k}><input type="checkbox" checked={k === 'snap' ? snap : crosshair} onChange={e => k === 'snap' ? setSnap(e.target.checked) : setCrosshair(e.target.checked)}/>{label}</label>)}</div>
        <h3>Camadas da planta 2D</h3>
        {[['points', 'Pontos'], ['edges', 'Arestas triangulares'], ['breaklines', 'Linhas de ruptura'], ['border', 'Borda da superfície'], ['grid', 'Grade de referência']].map(([k, label]) => <label className="check" key={k}><input type="checkbox" checked={layers[k]} onChange={e => setLayers(l => ({...l, [k]: e.target.checked}))}/>{label}</label>)}
        <label>Estilo do modelo<select value={presentation.style} onChange={e => setPresentation(p => ({...p, style: e.target.value}))}><option value="concept">Conceitual · cores por elevação</option><option value="hypso">Hipsométrico · faixas de cota</option><option value="solid">Sólido · iluminação suave</option><option value="wire">Aramado · inspecionar triangulação</option></select></label>
        <label className="check"><input type="checkbox" checked={presentation.grid} onChange={e => setPresentation(p => ({...p, grid: e.target.checked}))}/>Grade no 3D</label>
      </section>
      <PointTools key={revision} points={points} groups={groups} group={group} setGroup={g => { setGroup(g); setSelected([]); }} onSave={savePoint} onGroupLine={() => { const g = groups.find(g => g.code === group); if (g) recompute({breaklines: [...breaklines, g.indices]}, 'Grupo interligado na ordem do arquivo.'); }}/>
      <section><h2>07 · Cores dos grupos</h2>{groups.map(g => <label className="group-color" key={g.code}><span>{g.code}</span><input aria-label={`Cor do grupo ${g.code}`} type="color" value={groupColors[g.code] || '#d8eee5'} onChange={e => setGroupColors(c => ({...c, [g.code]: e.target.value}))}/></label>)}</section>
      <section><h2>08 · Rótulos na planta</h2>
        <label>Estilo de Rótulo do Ponto<select value={preset} onChange={e => { const v = e.target.value; setPreset(v); setStyle(s => ({...s, visible: v !== 'none', id: v === 'all' || v === 'id', elevation: v !== 'id', description: v === 'all' || v === 'zd'})); }}><option value="none">Nenhum rótulo</option><option value="z">Apenas Cota</option><option value="zd">Cota e Descrição</option><option value="all">Ponto, Cota e Descrição</option><option value="id">Apenas identificador</option><option value="custom" disabled>Personalizado</option></select></label>
        {[['visible', 'Exibir rótulos'], ['id', 'Identificador'], ['elevation', 'Cota (Z)'], ['description', 'Descrição']].map(([k, label]) => <label className="check" key={k}><input type="checkbox" checked={style[k]} onChange={e => setLabel(k, e.target.checked)}/>{label}</label>)}
        <div className="two"><label>Cor do rótulo<input type="color" value={style.color} onChange={e => setLabel('color', e.target.value)}/></label><label>Tamanho<input type="number" min="8" max="24" value={style.size} onChange={e => setLabel('size', Math.max(8, Math.min(24, +e.target.value)))}/></label></div>
        <label>Casas decimais<select value={style.precision} onChange={e => setLabel('precision', +e.target.value)}>{[0, 1, 2, 3, 4].map(i => <option key={i}>{i}</option>)}</select></label>
        <p className="hint">Até 200 rótulos por vista, com redução de sobreposição. Todos os pontos continuam na malha.</p>
      </section>
      <section><h2>09 · Exportar para CAD</h2>
        {[['tin', 'TIN (3DFACE)'], ['points', 'Pontos por grupo'], ['labels', 'Rótulos dos pontos'], ['contours', 'Curvas de nível']].map(([k, label]) => <label className="check" key={k}><input type="checkbox" checked={dxfOptions[k]} onChange={e => setDxfOptions(o => ({...o, [k]: e.target.checked}))}/>{label}</label>)}
        <button className="full primary" onClick={() => exportFile('dxf')}>↓ DXF (AutoCAD / Civil 3D)</button>
        <div className="two"><button onClick={() => exportFile('landxml')}>LandXML</button><button onClick={() => exportFile('csv')}>CSV pontos</button></div>
        <p className="hint">DXF inclui rupturas, contorno e perfil. LandXML importa a superfície no Civil 3D.</p>
      </section>
    </fieldset></aside>
    <main>
      <div className="toolbar"><div>{[['orbit', '↗ Navegar', 'N'], ['breakline', '⌁ Ruptura', 'L'], ['boundary', '⌗ Contorno', 'B'], ['profile', '⟋ Perfil', 'P'], ['swap', '⇄ Inverter', 'S'], ['delete', '⌫ Aparar', 'D']].map(([id, label, key]) => <button disabled={busy} title={`${label} (${key})`} key={id} className={tool === id ? 'active' : ''} onClick={() => chooseTool(id)}>{label}</button>)}</div>
        <div><button disabled={busy || !history.length} onClick={undo} title="Ctrl+Z">↶ Desfazer</button><button onClick={() => setFitKey(k => k + 1)} title="Z">⤢ Enquadrar</button><button onClick={() => setHelp(v => !v)}>Atalhos</button></div></div>
      <div className="view-layout-bar"><div className="layout-switch">{[['2D', 'Planta 2D'], ['split', 'Duas vistas'], ['3D', 'Modelo 3D']].map(([id, label]) => <button aria-pressed={layout === id} key={id} className={layout === id ? 'active' : ''} onClick={() => { setLayout(id); if (id === '3D') setTool('orbit'); }}>{label}</button>)}</div>
        {layout === 'split' && <label className="split-control">Divisão<input aria-label="Divisão das duas vistas" type="range" min="30" max="70" value={splitRatio} onChange={e => setSplitRatio(+e.target.value)}/></label>}
        <span className="sync-label"><i className="live"/> Modelo compartilhado · atualização automática</span></div>
      <div className={`viewports ${layout === 'split' ? 'split' : ''}`} style={{'--plan-ratio': splitRatio + '%'}} aria-busy={busy}>{layout !== '3D' && panel('2D')}{layout !== '2D' && panel('3D')}{busy && <div className="busy-overlay" role="status">Calculando superfície em segundo plano…</div>}</div>
      <div className="instruction">{picking ? <><span>{TOOL_NAMES[tool]}: {pickCount} {tool === 'profile' ? 'vértices · clique na planta' : 'pontos · selecione em sequência na planta'}</span>
        <button disabled={busy || pickCount < (tool === 'boundary' ? 3 : 2)} onClick={() => finish()}>Concluir (Enter)</button>
        <button disabled={busy} onClick={() => tool === 'profile' ? setPathDraft(s => s.slice(0, -1)) : setSelected(s => s.slice(0, -1))}>Retirar último</button>
        <button onClick={() => chooseTool('orbit')}>Cancelar (Esc)</button></>
        : <span>{tool === 'swap' ? 'Clique na diagonal interna a inverter na planta.' : tool === 'delete' ? 'Clique na aresta para remover as faces adjacentes.' : 'Planta: arraste para mover · 3D: arraste para orbitar · Scroll: zoom · Z: enquadrar · P: perfil · C: curvas'}</span>}</div>
      {!mesh.triangles.length && <div className="empty-warning">Nenhum triângulo passou pelos filtros. Aumente o limite de aresta ou revise o contorno.</div>}
      {help && <div className="shortcut-help"><b>Atalhos Terra CAD</b><span>V: duas vistas · 2: planta · 3: modelo · Z: enquadrar · N: navegar · L: ruptura · B: contorno · P: perfil · C: curvas · S: inverter · D: aparar · F3: atração · Enter: concluir · Backspace: retirar ponto · Esc: cancelar · Ctrl+Z: desfazer · Ctrl+S: salvar · Ctrl+O: abrir</span></div>}
      {profile && showProfile && <ProfileChart profile={profile} referenceZ={referenceZ} precision={style.precision} onRemove={() => commit({...doc, alignment: []}, 'Traçado de perfil removido.')}/>}
      <div className="data-title"><button onClick={() => setShowTable(v => !v)}>{showTable ? '▾' : '▸'} Pontos do levantamento</button><span>{visibleIndices.length} no filtro · tabela com até 100 pontos</span></div>
      {showTable && <div className="table-wrap"><table><thead><tr>{['PONTO', 'ESTE (X)', 'NORTE (Y)', 'COTA (Z)', 'DESCRIÇÃO'].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{visibleIndices.slice(0, 100).map(i => points[i]).map(p => <tr key={p.id}><td>{p.id}</td><td>{p.x.toFixed(3)}</td><td>{p.y.toFixed(3)}</td><td>{p.z.toFixed(style.precision)}</td><td>{p.description || '—'}</td></tr>)}</tbody></table></div>}
      {errors.length > 0 && <details className="errors"><summary>{errors.length} linhas rejeitadas</summary>{errors.map((e, i) => <p key={i}>Linha {e.line}: {e.message}</p>)}</details>}
    </main></div>
    <footer role="status"><i className="live"/>{message}<span className="footer-right">TIN 2.5D · Coordenadas originais · v{VERSION}</span></footer>
  </div>;
}
