import React, {useEffect, useMemo, useRef, useState} from 'react';
import {formatStation} from './ProfileEditor';

function ticks(min, max, count) {
  const span = Math.max(max - min, 1e-9), raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const out = []; for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Visualizador de seções transversais com navegação por estaca. */
export default function SectionViewer({sections, index, onIndex, totals, halfWidth, precision = 3, height = 300, equalScale, onEqualScale}) {
  const host = useRef(), [width, setWidth] = useState(900), [hover, setHover] = useState(null);
  useEffect(() => { const o = new ResizeObserver(([e]) => setWidth(Math.max(360, e.contentRect.width))); o.observe(host.current); return () => o.disconnect(); }, []);
  const sec = sections[Math.min(index, sections.length - 1)];
  const pad = {l: 64, r: 30, t: 14, b: 30}, W = width - pad.l - pad.r, H = height - pad.t - pad.b;
  const view = useMemo(() => {
    if (!sec) return null;
    const zs = [...sec.terrain, ...sec.design].filter(p => p.z !== null).map(p => p.z);
    if (sec.gradeZ !== null) zs.push(sec.gradeZ);
    if (!zs.length) return null;
    let z0 = Math.min(...zs), z1 = Math.max(...zs); const m = Math.max((z1 - z0) * 0.15, 0.5); z0 -= m; z1 += m;
    if (equalScale) { const zr = 2 * halfWidth * H / W, mid = (z0 + z1) / 2; if (zr > z1 - z0) { z0 = mid - zr / 2; z1 = mid + zr / 2; } }
    return {o0: -halfWidth, o1: halfWidth, z0, z1};
  }, [sec, halfWidth, equalScale, width, height]);
  useEffect(() => {
    const k = e => { if (e.target.closest('input,select,textarea')) return; if (!host.current?.matches(':hover') && !host.current?.contains(document.activeElement)) return; if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); onIndex(Math.min(sections.length - 1, index + 1)); } if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); onIndex(Math.max(0, index - 1)); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  if (!sec) return <div className="section-panel" ref={host}><p className="hint">Defina um traçado (P) para gerar seções.</p></div>;
  const ox = o => pad.l + (o - view.o0) / (view.o1 - view.o0) * W, oy = z => pad.t + (view.z1 - z) / (view.z1 - view.z0) * H;
  const line = pts => { let d = '', run = []; const flush = () => { if (run.length > 1) d += 'M' + run.join('L'); run = []; }; for (const p of pts) { if (p.z === null) flush(); else run.push(`${ox(p.offset).toFixed(1)},${oy(p.z).toFixed(1)}`); } flush(); return d; };
  const interp = (series, o) => { for (let i = 1; i < series.length; i++) { const a = series[i - 1], b = series[i]; if (o >= a.offset - 1e-9 && o <= b.offset + 1e-9) { if (a.z === null || b.z === null) return null; return a.z + (b.z - a.z) * (o - a.offset) / Math.max(b.offset - a.offset, 1e-12); } } return null; };
  let cut = '', fill = '';
  for (let i = 1; i < sec.design.length; i++) {
    const a = sec.design[i - 1], b = sec.design[i]; if (a.z === null || b.z === null) continue;
    const ta = interp(sec.terrain, a.offset), tb = interp(sec.terrain, b.offset); if (ta === null || tb === null) continue;
    const p = `M${ox(a.offset)},${oy(a.z)}L${ox(b.offset)},${oy(b.z)}L${ox(b.offset)},${oy(tb)}L${ox(a.offset)},${oy(ta)}Z`;
    if (ta - a.z + tb - b.z > 0) cut += p; else fill += p;
  }
  const xt = ticks(view.o0, view.o1, Math.max(4, Math.floor(width / 110))), zt = ticks(view.z0, view.z1, 5);
  const move = e => { const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left, o = view.o0 + (x - pad.l) / W * (view.o1 - view.o0); setHover(o >= view.o0 && o <= view.o1 ? {x, o, t: interp(sec.terrain, o), d: interp(sec.design, o)} : null); };
  return <div className="section-panel" ref={host} data-testid="section-panel" tabIndex={-1}>
    <div className="profile-head">
      <b>Seção transversal</b>
      <button aria-label="Seção anterior" disabled={index <= 0} onClick={() => onIndex(index - 1)}>◀</button>
      <input aria-label="Seção" type="range" min="0" max={sections.length - 1} value={index} onChange={e => onIndex(+e.target.value)}/>
      <button aria-label="Próxima seção" disabled={index >= sections.length - 1} onClick={() => onIndex(index + 1)}>▶</button>
      <span>Estaca <em>{formatStation(sec.station)}</em></span>
      <span>{index + 1}/{sections.length}</span>
      <span>Corte <em className="cut">{sec.cutArea.toFixed(2)} m²</em></span>
      <span>Aterro <em className="fill">{sec.fillArea.toFixed(2)} m²</em></span>
      {sec.gradeZ !== null && <span>Greide <em>{sec.gradeZ.toFixed(precision)}</em></span>}
      <span className="spacer"/>
      {totals && <span title="Média das áreas extremas entre seções">Volumes (seções) <em className="cut">{totals.cut.toFixed(1)}</em> / <em className="fill">{totals.fill.toFixed(1)} m³</em></span>}
      <label className="check inline"><input type="checkbox" checked={equalScale} onChange={e => onEqualScale(e.target.checked)}/>Escala 1:1</label>
    </div>
    <svg width={width} height={height} className="profile-chart section-chart" onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label={`Seção na estaca ${formatStation(sec.station)}`}>
      {zt.map(z => <g key={'y' + z}><line x1={pad.l} x2={pad.l + W} y1={oy(z)} y2={oy(z)} className="grid"/><text x={pad.l - 8} y={oy(z)} className="ylabel">{z.toFixed(Math.max(0, Math.min(precision, 2)))}</text></g>)}
      {xt.map(o => <g key={'x' + o}><line y1={pad.t} y2={pad.t + H} x1={ox(o)} x2={ox(o)} className="grid"/><text x={ox(o)} y={height - 10} className="xlabel">{o === 0 ? 'EIXO' : (o > 0 ? 'D ' : 'E ') + Math.abs(o).toFixed(1)}</text></g>)}
      <line x1={ox(0)} x2={ox(0)} y1={pad.t} y2={pad.t + H} className="axis-line"/>
      <path d={cut} className="cut-fill cut"/><path d={fill} className="cut-fill fill"/>
      <path d={line(sec.terrain)} className="terrain-line"/>
      <path d={line(sec.design)} className="design-line solid"/>
      {sec.gradeZ !== null && <g><circle cx={ox(0)} cy={oy(sec.gradeZ)} r="5" className="grade-point"/><text x={ox(0) + 8} y={oy(sec.gradeZ) - 8} className="pvi-label">Greide {sec.gradeZ.toFixed(precision)}</text></g>}
      {hover && <g pointerEvents="none"><line x1={hover.x} x2={hover.x} y1={pad.t} y2={pad.t + H} className="hover"/><text x={Math.min(hover.x + 10, width - 280)} y={pad.t + 14} className="hover-text">{hover.o >= 0 ? 'D' : 'E'} {Math.abs(hover.o).toFixed(2)} · Terreno {hover.t === null ? '—' : hover.t.toFixed(precision)}{hover.d !== null ? ` · Projeto ${hover.d.toFixed(precision)}` : ''}</text></g>}
    </svg>
    <div className="profile-legend"><span><i className="lg terrain"/>Terreno</span><span><i className="lg design"/>Projeto (plataforma/talude)</span><span><i className="lg grade"/>Greide no eixo</span><span><i className="lg cut"/>Corte</span><span><i className="lg fill"/>Aterro</span><span className="help">◀ ▶ ou setas do teclado navegam entre estacas · E = esquerda, D = direita do sentido do traçado</span></div>
  </div>;
}
