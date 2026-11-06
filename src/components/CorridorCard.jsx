import React from 'react';
import {NumberField} from './Fields';
import SlopeFields from './SlopeFields';

const FALLS = [['crown', 'Abaulada (cai para os dois bordos)'], ['left', 'Cai para a esquerda'], ['right', 'Cai para a direita']];
const PRESETS = [
  ['Acesso de mina (2 faixas)', {width: 10, crossfall: 2, fall: 'crown', cutSlope: 1, fillSlope: 1.5}],
  ['Acesso de serviço (1 faixa)', {width: 6, crossfall: 3, fall: 'crown', cutSlope: 1, fillSlope: 1.5}],
  ['Estrada de caminhão fora de estrada', {width: 25, crossfall: 2, fall: 'crown', cutSlope: 0.75, fillSlope: 1.5}],
];

/** Mini seção-tipo desenhada com os valores atuais (pista, caimento e taludes de corte e aterro). */
function TemplateSketch({c}) {
  const W = 260, H = 84, cx = W / 2, half = Math.min(70, 18 + c.width * 2.4), y0 = 40, ex = (c.crossfall / 100) * 140;
  const yl = c.fall === 'crown' ? y0 + ex : c.fall === 'left' ? y0 + ex : y0 - ex, yr = c.fall === 'crown' ? y0 + ex : c.fall === 'left' ? y0 - ex : y0 + ex;
  const cutRun = 26 * c.cutSlope, fillRun = 26 * c.fillSlope;
  return <svg className="template-sketch" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Seção-tipo do acesso">
    <polyline className="cut" points={`${cx - half - cutRun},${yl - 26} ${cx - half},${yl}`}/>
    <polyline className="fill" points={`${cx + half},${yr} ${cx + half + fillRun},${yr + 26}`}/>
    <polyline className="road" points={`${cx - half},${yl} ${c.fall === 'crown' ? `${cx},${y0} ` : ''}${cx + half},${yr}`}/>
    <line className="axis" x1={cx} x2={cx} y1="6" y2={H - 18}/>
    <text x={cx} y={H - 2} textAnchor="middle">{c.width.toLocaleString('pt-BR')} m · {c.crossfall.toLocaleString('pt-BR')} %</text>
    <text x={8} y={14}>corte {c.cutSlope.toLocaleString('pt-BR')}:1</text>
    <text x={W - 8} y={14} textAnchor="end">aterro {c.fillSlope.toLocaleString('pt-BR')}:1</text>
  </svg>;
}

/**
 * Gabarito de acesso: seção-tipo aplicada ao longo do eixo na cota do greide. Corte, aterro, seções e volumes
 * acompanham o greide em tempo real.
 */
export default function CorridorCard({corridor: c, design, hasAxis, hasGrade, onChange, onNotes, onProfile, fmt}) {
  const v = design?.volume, m = design?.mesh, set = (changes, text) => onChange({...c, ...changes}, text);
  const ready = hasAxis && hasGrade;
  return <div className={`object-card corridor-card ${c.enabled ? 'selected' : ''}`} data-testid="corridor-card">
    <label className="check"><input type="checkbox" aria-label="Aplicar gabarito de acesso no eixo" checked={c.enabled} disabled={!ready && !c.enabled} onChange={e => set({enabled: e.target.checked}, e.target.checked ? `Gabarito aplicado: pista de ${fmt(c.width, 2)} m seguindo o greide. Arraste os PVIs no perfil e veja o corte no 3D.` : 'Gabarito de acesso desligado.')}/>Aplicar gabarito no eixo</label>
    {!ready && <p className="warn">{!hasAxis ? 'Trace o eixo (P) e crie o greide no perfil (4) para aplicar o gabarito.' : 'Crie o greide no perfil (tecla 4 → Criar greide) para aplicar o gabarito.'}</p>}
    <TemplateSketch c={c}/>
    <label>Modelo<select aria-label="Modelo de seção-tipo" value="" onChange={e => { const p = PRESETS[Number(e.target.value)]; if (p) set(p[1], `Seção-tipo "${p[0]}" aplicada: ajuste as medidas se precisar.`); }}>
      <option value="">— escolher um modelo pronto</option>{PRESETS.map(([name], i) => <option key={name} value={i}>{name}</option>)}</select></label>
    <div className="two">
      <NumberField label="Largura da pista (m)" aria-label="Largura da pista" value={c.width} min="0.5" digits={2} onCommit={w => set({width: w})}/>
      <NumberField label="Caimento (%)" aria-label="Caimento transversal" value={c.crossfall} min="0" digits={2} onCommit={i => set({crossfall: i})}/>
    </div>
    <label>Caimento da pista<select aria-label="Sentido do caimento" value={c.fall} onChange={e => set({fall: e.target.value})}>{FALLS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
    <div className="two">
      <NumberField label="Corte H:V" aria-label="Talude de corte do acesso" value={c.cutSlope} min="0.01" digits={2} onCommit={h => set({cutSlope: h})}/>
      <NumberField label="Aterro H:V" aria-label="Talude de aterro do acesso" value={c.fillSlope} min="0.01" digits={2} onCommit={h => set({fillSlope: h})}/>
    </div>
    <SlopeFields label="Acesso" benches={c.benches} end={null} noEnd onChange={(changes, text) => set(changes, text)}/>
    {design?.error && c.enabled && <p className="warn">{design.error}</p>}
    {m?.warnings?.length > 0 && <p className="warn">{m.warnings[0]}</p>}
    {c.enabled && v && <div className="volume-card"><div><span>Corte</span><b className="cut">{fmt(v.cut, 1)} m³</b></div><div><span>Aterro</span><b className="fill">{fmt(v.fill, 1)} m³</b></div><div className="net"><span>Saldo</span><b>{fmt(v.cut - v.fill, 1)} m³</b></div></div>}
    {c.enabled && m && <p className="muted small">Corte máx. {fmt(m.stats.maxCut, 2)} m · aterro máx. {fmt(m.stats.maxFill, 2)} m</p>}
    <div className="two"><button disabled={!ready} onClick={onProfile}>Editar greide (4)</button><button disabled={!c.enabled || !ready} onClick={onNotes}>Nota de serviço</button></div>
  </div>;
}
