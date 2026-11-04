import React, {useState} from 'react';
import {NumberField} from './Fields';
import SlopeFields from './SlopeFields';

const SIDES_OPEN = [['right', 'Direita'], ['left', 'Esquerda'], ['both', 'Os dois lados']], SIDES_CLOSED = [['outside', 'Para fora'], ['inside', 'Para dentro (cava)']];
const station = s => { const km = Math.floor(s / 1000), m = s - km * 1000; return `${km}+${m.toFixed(2).padStart(6, '0')}`; };

/**
 * Cartão de uma linha de projeto no painel Projeto.
 * @param {{line, design, selected:boolean, onSelect:()=>void, onChange:(changes:object, text?:string)=>void, onRemove:()=>void, fmt:(v:number, d?:number)=>string}} props
 */
export default function DesignLineCard({line, design, selected, onSelect, onChange, onRemove, fmt}) {
  const m = design?.mesh, v = design?.volume, e = line.elevation, label = line.name;
  const setElevation = (k, val) => onChange({elevation: {...e, [k]: val}});
  const [openPis, setOpenPis] = useState(selected);
  return <div className={`object-card line-card ${selected ? 'selected' : ''}`} data-testid={`line-${label}`} onClick={onSelect}>
    <div className="object-head"><input aria-label="Nome da linha" className="name" defaultValue={label} key={label} onBlur={ev => ev.target.value.trim() && ev.target.value !== label && onChange({name: ev.target.value.trim()}, 'Linha renomeada.')} onKeyDown={ev => ev.key === 'Enter' && ev.target.blur()}/>
      <label className="check inline" title="Exibir e calcular"><input type="checkbox" checked={line.visible !== false} onChange={ev => onChange({visible: ev.target.checked}, ev.target.checked ? 'Linha ativada.' : 'Linha ocultada (fora dos cálculos).')}/>ativa</label></div>
    <p className="muted small">{line.pis.length} PIs · {fmt(m?.length ?? 0, 2)} m{m?.curves?.length ? ` · ${m.curves.length} curva(s)` : ''}</p>
    <div className="two">
      <label>Traçado<select aria-label={`Traçado da ${label}`} value={line.closed ? 'closed' : 'open'} onChange={ev => { const closed = ev.target.value === 'closed'; onChange({closed, side: closed ? 'outside' : 'right'}, closed ? 'Linha fechada.' : 'Linha aberta.'); }}><option value="open">Aberta</option><option value="closed">Fechada</option></select></label>
      <label>Talude<select aria-label={`Lado do talude da ${label}`} value={line.side} onChange={ev => onChange({side: ev.target.value})}>{(line.closed ? SIDES_CLOSED : SIDES_OPEN).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
    </div>
    <label>Cota da linha<select aria-label={`Modo de cota da ${label}`} value={e.mode} onChange={ev => setElevation('mode', ev.target.value)}><option value="ramp">Cota inicial + rampa</option><option value="pis">Cota em cada PI</option><option value="terrain">Terreno − desnível</option><option value="grade">Seguir o greide do eixo</option></select></label>
    {e.mode === 'ramp' && <div className="two"><NumberField label="Cota inicial" aria-label={`Cota inicial da ${label}`} value={e.start} onCommit={val => setElevation('start', val)}/><NumberField label="Rampa (%)" aria-label={`Rampa da ${label}`} value={e.slope} digits={3} onCommit={val => setElevation('slope', val)}/></div>}
    {e.mode === 'grade' && <NumberField label="Desce em relação ao greide (m)" aria-label={`Desnível do greide da ${label}`} value={e.drop} digits={2} onCommit={val => setElevation('drop', val)}/>}
    {e.mode === 'grade' && <p className="hint">A cota de cada ponto vem do greide do perfil (aba Perfil, tecla 4). Arrastar um PVI recalcula estes taludes em tempo real.</p>}
    {e.mode === 'terrain' && <NumberField label="Desce em relação ao terreno (m)" aria-label={`Desnível da ${label}`} value={e.drop} digits={2} onCommit={val => setElevation('drop', val)}/>}
    <details className="sub" open={openPis} onToggle={ev => setOpenPis(ev.currentTarget.open)}><summary>PIs · estaca, cota e raio</summary>
      <div className="pi-table" role="table">
        <div className="pi-row head" role="row"><span>PI</span><span>Estaca</span><span>Cota</span><span>Raio (m)</span></div>
        {line.pis.map((p, i) => { const interior = line.closed || (i > 0 && i < line.pis.length - 1); return <div key={i} className="pi-row" role="row">
          <span>{i + 1}</span><span className="num">{station(m?.piStations?.[i] ?? 0)}</span>
          {e.mode === 'pis' ? <NumberField label="" aria-label={`Cota do PI ${i + 1} da ${label}`} value={Number.isFinite(p.z) ? p.z : e.start} onCommit={z => onChange({pis: line.pis.map((q, k) => k === i ? {...q, z} : q)}, `Cota do PI ${i + 1} alterada.`)}/> : <span className="num">{Number.isFinite(m?.piZ?.[i]) ? fmt(m.piZ[i], 3) : '—'}</span>}
          {interior ? <NumberField label="" aria-label={`Raio do PI ${i + 1} da ${label}`} value={p.radius || 0} min="0" digits={2} onCommit={r => onChange({pis: line.pis.map((q, k) => k === i ? {...q, radius: r > 0 ? r : undefined} : q)}, r > 0 ? `Curva de raio ${r} m no PI ${i + 1}.` : `Curva removida no PI ${i + 1}.`)}/> : <span className="muted">—</span>}
        </div>; })}
      </div>
    </details>
    <div className="two"><NumberField label="Corte H:V" aria-label={`Talude de corte da ${label}`} value={line.cutSlope} min="0.01" digits={2} onCommit={val => onChange({cutSlope: val})}/><NumberField label="Aterro H:V" aria-label={`Talude de aterro da ${label}`} value={line.fillSlope} min="0.01" digits={2} onCommit={val => onChange({fillSlope: val})}/></div>
    <p className="hint">Face do corte: 1 m de altura × {fmt(line.cutSlope, 2)} m de afastamento · aterro: 1 × {fmt(line.fillSlope, 2)}.</p>
    <SlopeFields label={label} benches={line.benches} end={line.end} onChange={onChange} baseZ={Number.isFinite(m?.piZ?.[0]) ? m.piZ[0] : e.start}/>
    {design?.error && <p className="field-error">{design.error}</p>}
    {v && <div className="volume-card compact"><div><span>Corte</span><b className="cut">{fmt(v.cut, 1)} m³</b><small>h máx {fmt(m.stats.maxCut)} m</small></div><div><span>Aterro</span><b className="fill">{fmt(v.fill, 1)} m³</b><small>h máx {fmt(m.stats.maxFill)} m</small></div><div className="net"><span>Saldo · área ocupada</span><b>{fmt(v.net, 1)} m³ · {fmt(v.footprint, 0)} m²</b></div></div>}
    {m?.warnings?.map(w => <p key={w} className="warn">⚠ {w}</p>)}
    <button className="full danger" onClick={ev => { ev.stopPropagation(); onRemove(); }}>Excluir linha</button>
  </div>;
}
