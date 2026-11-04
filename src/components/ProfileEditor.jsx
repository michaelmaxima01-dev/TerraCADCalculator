import React, {useEffect, useMemo, useRef, useState} from 'react';
import {profileSummary} from '../core/profile';
import {gradeGeometry, gradeElevation, sampleGrade, insertPVI, movePVI, sortGrade} from '../core/grade';

export const formatStation = s => `${Math.floor(s / 1000)}+${(((s % 1000) + 1000) % 1000).toFixed(2).padStart(6, '0')}`;
const pct = v => (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%';

function ticks(min, max, count) {
  const span = Math.max(max - min, 1e-9), raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const out = []; for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}
function interp(series, s) {
  if (!series.length || s < series[0].station - 1e-9 || s > series.at(-1).station + 1e-9) return null;
  let lo = 0, hi = series.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (series[m].station <= s) lo = m; else hi = m; }
  const a = series[lo], b = series[hi] || a;
  if (a.z === null || b.z === null) return null;
  return b.station - a.station < 1e-12 ? a.z : a.z + (b.z - a.z) * (s - a.station) / (b.station - a.station);
}

/**
 * Editor do perfil longitudinal: terreno, greide editável (PVIs com curvas verticais),
 * perfil do projeto (plataformas/taludes), cota de referência e marcas das seções.
 */
export default function ProfileEditor({profile, grade, onGradeChange, onGradeDraft, designProfile, referenceZ, precision = 3, height = 260, sectionStations = [], currentStation = null, onStation, onRemove, onNotice, zoomSensitivity = 1, showTable = true}) {
  const host = useRef(), svg = useRef();
  const [width, setWidth] = useState(900), [mode, setMode] = useState('nav'), [view, setView] = useState(null), [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null), [draft, setDraft] = useState(null);
  const drag = useRef(null);
  useEffect(() => { const o = new ResizeObserver(([e]) => setWidth(Math.max(360, e.contentRect.width))); o.observe(host.current); return () => o.disconnect(); }, []);
  const g = draft || grade;
  const geo = useMemo(() => { try { return gradeGeometry(g); } catch { return gradeGeometry([]); } }, [g]);
  const gradeLine = useMemo(() => sampleGrade(geo, Math.max(profile.length / 400, 0.05)), [geo, profile.length]);
  const summary = useMemo(() => profileSummary(profile), [profile]);
  const pad = {l: 64, r: 16, t: 14, b: 30}, W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const auto = useMemo(() => {
    const zs = profile.samples.filter(s => s.z !== null).map(s => s.z).concat(gradeLine.map(p => p.z), (designProfile || []).filter(p => p.z !== null).map(p => p.z));
    if (Number.isFinite(referenceZ)) zs.push(referenceZ);
    if (!zs.length) return {s0: 0, s1: Math.max(profile.length, 1), z0: 0, z1: 1};
    let lo = Math.min(...zs), hi = Math.max(...zs); const m = Math.max((hi - lo) * 0.12, 0.5);
    return {s0: 0, s1: Math.max(profile.length, 1e-6), z0: lo - m, z1: hi + m};
  }, [profile, gradeLine, designProfile, referenceZ]);
  const v = view || auto;
  const sx = s => pad.l + (s - v.s0) / (v.s1 - v.s0) * W, sy = z => pad.t + (v.z1 - z) / (v.z1 - v.z0) * H;
  const ix = x => v.s0 + (x - pad.l) / W * (v.s1 - v.s0), iz = y => v.z1 - (y - pad.t) / H * (v.z1 - v.z0);
  useEffect(() => { setView(null); setSelected(null); }, [profile.length]);

  // ---- geometria desenhada ----
  const paths = useMemo(() => {
    const line = pts => { let d = '', run = []; const flush = () => { if (run.length > 1) d += 'M' + run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L'); run = []; }; for (const p of pts) { if (p.z === null) flush(); else run.push([sx(p.station), sy(p.z)]); } flush(); return d; };
    const terrain = line(profile.samples), grd = line(gradeLine), design = designProfile ? line(designProfile) : '';
    let terrainFill = '', run = [];
    const flush = () => { if (run.length > 1) terrainFill += `M${run[0][0].toFixed(1)},${(pad.t + H).toFixed(1)}L` + run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + `L${run.at(-1)[0].toFixed(1)},${(pad.t + H).toFixed(1)}Z`; run = []; };
    for (const p of profile.samples) { if (p.z === null) flush(); else run.push([sx(p.station), sy(p.z)]); } flush();
    // corte (terreno acima do greide) e aterro (greide acima do terreno)
    let cut = '', fill = '';
    if (gradeLine.length > 1) {
      const st = [...new Set([...profile.samples.map(p => p.station), ...gradeLine.map(p => p.station)])].filter(s => s >= gradeLine[0].station - 1e-9 && s <= gradeLine.at(-1).station + 1e-9).sort((a, b) => a - b);
      const val = s => { const t = interp(profile.samples, s), z = gradeElevation(geo, s); return t === null || z === null ? null : {t, z}; };
      const poly = pts => 'M' + pts.map(([s, z]) => `${sx(s).toFixed(1)},${sy(z).toFixed(1)}`).join('L') + 'Z';
      for (let i = 1; i < st.length; i++) {
        const a = val(st[i - 1]), b = val(st[i]); if (!a || !b) continue;
        const da = a.t - a.z, db = b.t - b.z, sa = st[i - 1], sb = st[i];
        if (da * db >= 0) { const p = poly([[sa, a.z], [sb, b.z], [sb, b.t], [sa, a.t]]); if (da + db > 0) cut += p; else if (da + db < 0) fill += p; }
        else { const sm = sa + (sb - sa) * da / (da - db), zm = a.z + (b.z - a.z) * (sm - sa) / (sb - sa); const p1 = poly([[sa, a.z], [sm, zm], [sa, a.t]]), p2 = poly([[sm, zm], [sb, b.z], [sb, b.t]]); if (da > 0) { cut += p1; fill += p2; } else { fill += p1; cut += p2; } }
      }
    }
    return {terrain, terrainFill, grd, design, cut, fill};
  }, [profile, gradeLine, designProfile, geo, v.s0, v.s1, v.z0, v.z1, width, height]);

  // ---- interação ----
  const local = e => { const r = svg.current.getBoundingClientRect(); return {x: e.clientX - r.left, y: e.clientY - r.top}; };
  const pviAt = (x, y) => { let best = null, d = 10; geo.pvis.forEach((p, i) => { const dd = Math.hypot(sx(p.station) - x, sy(p.z) - y); if (dd < d) { d = dd; best = i; } }); return best; };
  const snapZ = (s, y) => { const t = interp(profile.samples, s); if (t !== null && Math.abs(sy(t) - y) < 9) return {z: t, snapped: true}; return {z: iz(y), snapped: false}; };
  const clampS = s => Math.max(0, Math.min(profile.length, s));
  function onWheel(e) {
    e.preventDefault();
    const {x, y} = local(e), k = Math.exp(Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) * 0.0022 * zoomSensitivity);
    const s = ix(x), z = iz(y);
    const next = e.shiftKey ? {...v, z0: z - (z - v.z0) * k, z1: z + (v.z1 - z) * k} : {s0: s - (s - v.s0) * k, s1: s + (v.s1 - s) * k, z0: z - (z - v.z0) * k, z1: z + (v.z1 - z) * k};
    setView(next);
  }
  useEffect(() => { const el = svg.current; if (!el) return; el.addEventListener('wheel', onWheel, {passive: false}); return () => el.removeEventListener('wheel', onWheel); });
  function down(e) {
    const {x, y} = local(e);
    if (e.button === 2) return;
    const i = pviAt(x, y);
    if (i !== null && e.button === 0) { setSelected(i); drag.current = {type: 'pvi', index: i, start: {x, y}, station: geo.pvis[i].station, moved: false}; svg.current.setPointerCapture(e.pointerId); return; }
    if (e.button === 1 || mode === 'nav') { drag.current = {type: 'pan', start: {x, y}, view: v}; svg.current.setPointerCapture(e.pointerId); return; }
    if (mode === 'grade' && e.button === 0) {
      const s = clampS(ix(x)), {z} = snapZ(s, y);
      if (x < pad.l || x > pad.l + W) return;
      try { const r = insertPVI(grade, {station: Math.round(s * 100) / 100, z: Math.round(z * 1000) / 1000}); onGradeChange(r.grade, 'PVI inserido no greide.'); setSelected(r.index); }
      catch (err) { onNotice?.(err.message); }
    }
  }
  function move(e) {
    const {x, y} = local(e), d = drag.current;
    const s = ix(x), t = interp(profile.samples, s), z = gradeElevation(geo, s);
    setHover(x >= pad.l && x <= pad.l + W ? {x, s, t, z} : null);
    if (!d) return;
    if (d.type === 'pan') { const ds = (x - d.start.x) / W * (d.view.s1 - d.view.s0), dz = (y - d.start.y) / H * (d.view.z1 - d.view.z0); setView({s0: d.view.s0 - ds, s1: d.view.s1 - ds, z0: d.view.z0 + dz, z1: d.view.z1 + dz}); return; }
    if (d.type === 'pvi') {
      if (!d.moved && Math.hypot(x - d.start.x, y - d.start.y) < 3) return;
      d.moved = true;
      const ns = e.shiftKey ? d.station : clampS(ix(x)), {z: nz} = e.altKey ? {z: iz(y)} : snapZ(ns, y);
      const nd = movePVI(grade, d.index, Math.round(ns * 100) / 100, Math.round(nz * 1000) / 1000, {min: 0, max: profile.length}); setDraft(nd); onGradeDraft?.(nd); // taludes em tempo real
    }
  }
  function up(e) {
    const d = drag.current; drag.current = null;
    if (d?.type === 'pan' && e) { const {x, y} = local(e); if (Math.hypot(x - d.start.x, y - d.start.y) < 3 && x >= pad.l && x <= pad.l + W) onStation?.(clampS(ix(x))); }
    if (d?.type === 'pvi' && d.moved && draft) { onGradeChange(draft, 'PVI movido no greide: taludes, seções e volumes recalculados.'); }
    setDraft(null); onGradeDraft?.(null);
  }
  function removeSelected() { if (selected === null || !grade[selected]) return; onGradeChange(grade.filter((_, i) => i !== selected), 'PVI removido.'); setSelected(null); }
  useEffect(() => {
    const k = e => {
      if (e.key !== 'Delete' || selected === null || e.target.closest('input,select,textarea')) return;
      if (hover || host.current?.contains(document.activeElement)) { e.preventDefault(); removeSelected(); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  function contextMenu(e) { e.preventDefault(); const {x, y} = local(e), i = pviAt(x, y); if (i !== null) { onGradeChange(grade.filter((_, k) => k !== i), 'PVI removido.'); setSelected(null); } }
  function gradeFromTerrain() {
    const valid = profile.samples.filter(s => s.z !== null); if (valid.length < 2) return;
    onGradeChange([{station: valid[0].station, z: Math.round(valid[0].z * 1000) / 1000, curve: 0}, {station: valid.at(-1).station, z: Math.round(valid.at(-1).z * 1000) / 1000, curve: 0}], 'Greide criado entre o início e o fim do terreno. Arraste os PVIs ou insira novos.');
    setMode('grade');
  }
  function setField(i, key, raw) {
    const val = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(val) || (key === 'curve' && val < 0)) { onNotice?.('Valor inválido.'); return; }
    try {
      let next = grade.map((p, k) => k === i ? {...p, [key]: val} : p);
      if (key === 'station') { next = sortGrade(next); if (next.some((p, k) => k && p.station - next[k - 1].station < 1e-6)) throw Error('Estacas de PVIs repetidas.'); }
      gradeGeometry(next); onGradeChange(next, 'Greide atualizado.');
    } catch (err) { onNotice?.(err.message); }
  }

  const xt = ticks(v.s0, v.s1, Math.max(3, Math.floor(width / 120))), zt = ticks(v.z0, v.z1, Math.max(3, Math.floor(height / 55)));
  const ve = (W / (v.s1 - v.s0)) / (H / (v.z1 - v.z0));
  const clip = 'pclip';
  return <div className="profile-panel editor" ref={host} data-testid="profile-panel" tabIndex={-1}>
    <div className="profile-head">
      <b>Perfil longitudinal</b>
      <div className="seg">{[['nav', 'Navegar'], ['grade', 'Editar greide']].map(([id, label]) => <button key={id} className={mode === id ? 'active' : ''} aria-pressed={mode === id} onClick={() => setMode(id)}>{label}</button>)}</div>
      {!grade.length && <button className="primary" onClick={gradeFromTerrain}>Criar greide</button>}
      <span>Extensão <em>{profile.length.toFixed(2)}</em></span>
      <span>Terreno <em>{summary.minZ?.toFixed(precision) ?? '—'} – {summary.maxZ?.toFixed(precision) ?? '—'}</em></span>
      <span>Exagero vert. <em>{ve.toFixed(1)}×</em></span>
      <span className="spacer"/>
      <button onClick={() => setView(null)} title="Enquadrar perfil">⤢</button>
      {grade.length > 0 && <button onClick={() => { onGradeChange([], 'Greide removido.'); setSelected(null); }}>Limpar greide</button>}
      <button onClick={onRemove}>Remover traçado</button>
    </div>
    <svg ref={svg} width={width} height={height} className={`profile-chart mode-${mode}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setDraft(null); onGradeDraft?.(null); }} onPointerLeave={() => setHover(null)} onContextMenu={contextMenu} role="img" aria-label="Perfil longitudinal: terreno e greide de projeto">
      <defs><clipPath id={clip}><rect x={pad.l} y={pad.t} width={W} height={H}/></clipPath></defs>
      {zt.map(z => <g key={'y' + z}><line x1={pad.l} x2={pad.l + W} y1={sy(z)} y2={sy(z)} className="grid"/><text x={pad.l - 8} y={sy(z)} className="ylabel">{z.toFixed(Math.max(0, Math.min(precision, 2)))}</text></g>)}
      {xt.map(s => <g key={'x' + s}><line y1={pad.t} y2={pad.t + H} x1={sx(s)} x2={sx(s)} className="grid"/><text x={sx(s)} y={height - 10} className="xlabel">{formatStation(s)}</text></g>)}
      <g clipPath={`url(#${clip})`}>
        <path d={paths.terrainFill} className="terrain-fill"/>
        <path d={paths.cut} className="cut-fill cut"/><path d={paths.fill} className="cut-fill fill"/>
        {sectionStations.map(s => <line key={'s' + s} x1={sx(s)} x2={sx(s)} y1={pad.t + H - 6} y2={pad.t + H} className="sec-tick"/>)}
        {currentStation !== null && <line x1={sx(currentStation)} x2={sx(currentStation)} y1={pad.t} y2={pad.t + H} className="sec-current"/>}
        {Number.isFinite(referenceZ) && <line x1={pad.l} x2={pad.l + W} y1={sy(referenceZ)} y2={sy(referenceZ)} className="reference"/>}
        <path d={paths.design} className="design-line"/>
        <path d={paths.terrain} className="terrain-line"/>
        {geo.curves.map(c => c && <g key={'c' + c.index}><polyline className="tangent" points={`${sx(c.bvc)},${sy(gradeElevation(geo, c.bvc))} ${sx(geo.pvis[c.index].station)},${sy(geo.pvis[c.index].z)} ${sx(c.evc)},${sy(gradeElevation(geo, c.evc))}`}/></g>)}
        <path d={paths.grd} className="grade-line"/>
        {geo.slopes.map((sl, i) => { const a = geo.pvis[i], b = geo.pvis[i + 1], mx = sx((a.station + b.station) / 2), my = sy((a.z + b.z) / 2); return Math.abs(sx(b.station) - sx(a.station)) > 70 && <text key={'g' + i} x={mx} y={my - 8} className="slope-label">{pct(sl)}</text>; })}
        {geo.pvis.map((p, i) => <g key={'p' + i} className={`pvi ${selected === i ? 'selected' : ''}`}><circle cx={sx(p.station)} cy={sy(p.z)} r={selected === i ? 6.5 : 5}/>
          {(selected === i || geo.pvis.length <= 8) && <text x={sx(p.station) + 8} y={sy(p.z) - 10} className="pvi-label">PVI {i + 1} · {formatStation(p.station)} · {p.z.toFixed(precision)}{geo.curves[i] ? ` · L ${geo.curves[i].length.toFixed(1)} K ${geo.curves[i].K.toFixed(1)}` : ''}</text>}</g>)}
        {Number.isFinite(referenceZ) && <text x={pad.l + W - 4} y={sy(referenceZ) - 6} className="reflabel">Ref. {referenceZ.toFixed(precision)}</text>}
      </g>
      {hover && <g pointerEvents="none"><line x1={hover.x} x2={hover.x} y1={pad.t} y2={pad.t + H} className="hover"/>
        {hover.t !== null && <circle cx={hover.x} cy={sy(hover.t)} r="3.5" className="hover-dot"/>}
        {hover.z !== null && <circle cx={hover.x} cy={sy(hover.z)} r="3.5" className="hover-dot grade"/>}
        <text x={Math.min(hover.x + 10, width - 330)} y={pad.t + 14} className="hover-text">{formatStation(hover.s)} · Terreno {hover.t === null ? '—' : hover.t.toFixed(precision)}{hover.z !== null ? ` · Greide ${hover.z.toFixed(precision)}` : ''}{hover.z !== null && hover.t !== null ? ` · ${hover.t > hover.z ? 'Corte' : 'Aterro'} ${Math.abs(hover.t - hover.z).toFixed(precision)}` : ''}</text></g>}
    </svg>
    <div className="profile-legend"><span><i className="lg terrain"/>Terreno</span><span><i className="lg grade"/>Greide</span>{designProfile && <span><i className="lg design"/>Projeto (plataformas)</span>}<span><i className="lg cut"/>Corte</span><span><i className="lg fill"/>Aterro</span>
      <span className="help">{mode === 'grade' ? 'Clique para inserir PVI (atrai ao terreno) · arraste para mover (Shift: só cota, Alt: sem atração) · botão direito ou Delete remove' : 'Arraste para mover · roda: zoom no cursor (Shift: só vertical) · arraste PVIs a qualquer momento'}</span></div>
    {showTable && geo.pvis.length > 0 && <div className="pvi-table"><table><thead><tr><th>PVI</th><th>Estaca</th><th>Cota</th><th>Curva L</th><th>Rampa entrada</th><th>Rampa saída</th><th>K</th><th/></tr></thead><tbody>
      {geo.pvis.map((p, i) => <tr key={`${i}:${p.station}:${p.z}:${p.curve}`} className={selected === i ? 'selected' : ''} onClick={() => setSelected(i)}>
        <td>{i + 1}</td>
        {['station', 'z', 'curve'].map(k => <td key={k}><input aria-label={`${k} do PVI ${i + 1}`} defaultValue={k === 'station' ? p.station.toFixed(2) : k === 'z' ? p.z.toFixed(precision) : p.curve} disabled={k === 'curve' && (i === 0 || i === geo.pvis.length - 1)} onBlur={e => e.target.value !== e.target.defaultValue && setField(i, k, e.target.value)} onKeyDown={e => e.key === 'Enter' && e.target.blur()}/></td>)}
        <td>{i > 0 ? pct(geo.slopes[i - 1]) : '—'}</td><td>{i < geo.slopes.length ? pct(geo.slopes[i]) : '—'}</td><td>{geo.curves[i] ? geo.curves[i].K.toFixed(1) : '—'}</td>
        <td><button aria-label={`Remover PVI ${i + 1}`} onClick={e => { e.stopPropagation(); onGradeChange(grade.filter((_, k) => k !== i), 'PVI removido.'); }}>✕</button></td>
      </tr>)}
    </tbody></table></div>}
  </div>;
}
