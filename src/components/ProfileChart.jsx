import React, {useEffect, useMemo, useRef, useState} from 'react';
import {profileSummary} from '../core/profile';

export const formatStation = s => `${Math.floor(s / 1000)}+${(s % 1000).toFixed(2).padStart(6, '0')}`;

function ticks(min, max, count) {
  const span = Math.max(max - min, 1e-9), raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || raw;
  const out = []; for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export default function ProfileChart({profile, referenceZ, precision = 3, onRemove}) {
  const host = useRef(), [width, setWidth] = useState(800), [hover, setHover] = useState(null);
  useEffect(() => { const o = new ResizeObserver(([e]) => setWidth(Math.max(320, e.contentRect.width))); o.observe(host.current); return () => o.disconnect(); }, []);
  const height = 230, pad = {l: 62, r: 18, t: 16, b: 30};
  const summary = useMemo(() => profileSummary(profile), [profile]);
  const view = useMemo(() => {
    if (summary.minZ === null) return null;
    let lo = summary.minZ, hi = summary.maxZ;
    if (Number.isFinite(referenceZ)) { lo = Math.min(lo, referenceZ); hi = Math.max(hi, referenceZ); }
    const margin = Math.max((hi - lo) * 0.12, 0.5); lo -= margin; hi += margin;
    const sx = s => pad.l + s / Math.max(profile.length, 1e-9) * (width - pad.l - pad.r);
    const sy = z => pad.t + (hi - z) / (hi - lo) * (height - pad.t - pad.b);
    let d = '', area = '', run = [];
    const flush = () => { if (run.length > 1) { d += 'M' + run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L'); area += `M${run[0][0].toFixed(1)},${height - pad.b}L` + run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join('L') + `L${run.at(-1)[0].toFixed(1)},${height - pad.b}Z`; } run = []; };
    for (const s of profile.samples) { if (s.z === null) flush(); else run.push([sx(s.station), sy(s.z)]); }
    flush();
    const ve = ((width - pad.l - pad.r) / Math.max(profile.length, 1e-9)) / ((height - pad.t - pad.b) / (hi - lo));
    return {lo, hi, sx, sy, d, area, ve, xt: ticks(0, profile.length, Math.max(3, Math.floor(width / 110))), yt: ticks(lo, hi, 5)};
  }, [profile, summary, referenceZ, width]);

  function move(e) {
    if (!view) return;
    const r = e.currentTarget.getBoundingClientRect(), x = e.clientX - r.left;
    const station = (x - pad.l) / (width - pad.l - pad.r) * profile.length;
    if (station < 0 || station > profile.length) return setHover(null);
    const s = profile.samples; let i = s.findIndex(p => p.station >= station); if (i <= 0) i = 1;
    const a = s[i - 1], b = s[i] || a;
    const z = a.z === null || b.z === null ? null : a.z + (b.z - a.z) * ((station - a.station) / Math.max(b.station - a.station, 1e-12));
    setHover({x, station, z});
  }

  return <div className="profile-panel" ref={host} data-testid="profile-panel">
    <div className="profile-head">
      <b>Perfil longitudinal</b>
      <span>Extensão <em>{profile.length.toFixed(2)}</em></span>
      <span>Z mín <em>{summary.minZ?.toFixed(precision) ?? '—'}</em></span>
      <span>Z máx <em>{summary.maxZ?.toFixed(precision) ?? '—'}</em></span>
      <span>Rampa máx <em>{summary.maxGrade === null ? '—' : summary.maxGrade.toFixed(2) + '%'}</em></span>
      {view && <span>Exagero vertical <em>{view.ve.toFixed(1)}×</em></span>}
      <button onClick={onRemove}>Remover traçado</button>
    </div>
    {!view ? <p className="hint">O traçado não cruza a superfície.</p> :
    <svg width={width} height={height} className="profile-chart" onPointerMove={move} onPointerLeave={() => setHover(null)} role="img" aria-label="Gráfico do perfil longitudinal: estaca por cota">
      {view.yt.map(z => <g key={'y' + z}><line x1={pad.l} x2={width - pad.r} y1={view.sy(z)} y2={view.sy(z)} className="grid"/><text x={pad.l - 8} y={view.sy(z)} className="ylabel">{z.toFixed(Math.max(0, Math.min(precision, 2)))}</text></g>)}
      {view.xt.map(s => <g key={'x' + s}><line y1={pad.t} y2={height - pad.b} x1={view.sx(s)} x2={view.sx(s)} className="grid"/><text x={view.sx(s)} y={height - 10} className="xlabel">{formatStation(s)}</text></g>)}
      <path d={view.area} className="terrain-fill"/>
      <path d={view.d} className="terrain-line"/>
      {Number.isFinite(referenceZ) && <g><line x1={pad.l} x2={width - pad.r} y1={view.sy(referenceZ)} y2={view.sy(referenceZ)} className="reference"/><text x={width - pad.r - 4} y={view.sy(referenceZ) - 6} className="reflabel">Ref. {referenceZ.toFixed(precision)}</text></g>}
      {profile.samples.filter(s => s.vertex && s.z !== null).map((s, i) => <circle key={i} cx={view.sx(s.station)} cy={view.sy(s.z)} r="3.5" className="pi"/>)}
      {hover && <g><line x1={hover.x} x2={hover.x} y1={pad.t} y2={height - pad.b} className="hover"/>{hover.z !== null && <circle cx={hover.x} cy={view.sy(hover.z)} r="4" className="hover-dot"/>}<text x={Math.min(hover.x + 8, width - 190)} y={pad.t + 12} className="hover-text">{formatStation(hover.station)} · {hover.z === null ? 'fora da superfície' : 'Z ' + hover.z.toFixed(precision)}</text></g>}
    </svg>}
  </div>;
}
