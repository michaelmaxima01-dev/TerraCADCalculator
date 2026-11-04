import React, {useState} from 'react';
import {NumberField} from './Fields';
import {BENCH_DEFAULT} from '../core/slopes';

const fmt2 = v => Number(v).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});

/**
 * Bermas/bancadas e término do talude (mesmos campos para linha de projeto e plataforma).
 * @param {{label:string, benches:object, end:object, onChange:(changes:{benches?:object, end?:object}, text?:string)=>void}} props
 */
export default function SlopeFields({label, benches, end, onChange}) {
  const bn = {...BENCH_DEFAULT, startAfter: 0, count: null, ...benches}, en = end || {mode: 'terrain', depth: 8, floorZ: null};
  const [openBench, setOpenBench] = useState(bn.enabled), [openEnd, setOpenEnd] = useState(en.mode === 'depth');
  const depthMode = en.mode === 'depth', byCount = depthMode && bn.count > 0;
  const setB = (k, v, text) => onChange({benches: {...bn, [k]: v}}, text);
  const resolved = byCount ? (en.floorZ === null ? `${fmt2(en.depth / (bn.count + 1))} m cada` : 'calculadas ponto a ponto até a cota final') : null;
  return <>
    <details className="sub" open={openBench} onToggle={e => setOpenBench(e.currentTarget.open)}><summary>Bermas / bancadas {bn.enabled ? `· ${byCount ? `${bn.count} bermas (${resolved})` : `${fmt2(bn.height)} m / ${fmt2(bn.width)} m`}` : '· desligadas'}</summary>
      <label className="check"><input type="checkbox" checked={bn.enabled} onChange={e => setB('enabled', e.target.checked, e.target.checked ? `${label}: bermas ativadas.` : `${label}: bermas desativadas.`)}/>Inserir bermas no talude</label>
      <div className="two">
        <NumberField label="Altura da bancada (m)" aria-label={`Altura da bancada da ${label}`} value={bn.height} min="0.1" digits={2} disabled={byCount} title={byCount ? 'Calculada pela quantidade de bermas' : undefined} onCommit={v => setB('height', v)}/>
        <NumberField label="Largura da berma (m)" aria-label={`Largura da berma da ${label}`} value={bn.width} min="0" digits={2} onCommit={v => setB('width', v)}/>
      </div>
      <div className="two">
        <NumberField label="A partir de (m de altura)" aria-label={`Bermas a partir de da ${label}`} value={bn.startAfter} min="0" digits={2} disabled={byCount} title="Talude contínuo até esta altura; a 1ª berma fica nela. 0 = desde a 1ª bancada." onCommit={v => setB('startAfter', v, v > 0 ? `${label}: 1ª berma a ${fmt2(v)} m de altura.` : undefined)}/>
        <label>Por quantidade<select aria-label={`Quantidade de bermas da ${label}`} value={bn.count || ''} disabled={!depthMode} title={depthMode ? 'N bermas divididas igualmente na profundidade' : 'Disponível com término por profundidade'} onChange={e => setB('count', e.target.value ? Number(e.target.value) : null, e.target.value ? `${label}: ${e.target.value} bermas na profundidade.` : undefined)}>
          <option value="">— pela altura</option>{Array.from({length: 10}, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} berma{n > 1 ? 's' : ''}</option>)}</select></label>
      </div>
      <label>Aplicar em<select aria-label={`Bermas da ${label} em`} value={bn.apply} onChange={e => setB('apply', e.target.value)}><option value="cut">Corte</option><option value="fill">Aterro</option><option value="both">Corte e aterro</option></select></label>
      <p className="hint">{byCount ? `Bancadas iguais: ${resolved}. A última face termina no fundo.` : 'A cada altura de bancada o talude ganha uma berma horizontal antes de seguir na inclinação H:V.'}</p>
    </details>
    <details className="sub" open={openEnd} onToggle={e => setOpenEnd(e.currentTarget.open)}><summary>Término do talude · {depthMode ? (en.floorZ !== null ? `cota final ${fmt2(en.floorZ)}` : `desce ${fmt2(en.depth)} m`) : 'até o terreno'}</summary>
      <label>Terminar<select aria-label={`Término do talude da ${label}`} value={depthMode ? (en.floorZ !== null ? 'floor' : 'depth') : 'terrain'} onChange={e => {
        const v = e.target.value;
        if (v === 'terrain') onChange({end: {...en, mode: 'terrain'}, benches: {...bn, count: null}}, `${label}: talude até o terreno.`);
        else if (v === 'depth') onChange({end: {...en, mode: 'depth', floorZ: null}}, `${label}: desce ${fmt2(en.depth)} m e segue num fundo plano.`);
        else onChange({end: {...en, mode: 'depth', floorZ: Number.isFinite(en.floorZ) ? en.floorZ : 0}}, `${label}: desce até a cota final; informe a cota.`);
      }}><option value="terrain">Até encontrar o terreno</option><option value="depth">Descer uma profundidade</option><option value="floor">Descer até uma cota final</option></select></label>
      {depthMode && en.floorZ === null && <NumberField label="Profundidade (m)" aria-label={`Profundidade da ${label}`} value={en.depth} min="0.1" digits={2} onCommit={v => onChange({end: {...en, depth: v}})}/>}
      {depthMode && en.floorZ !== null && <NumberField label="Cota final (fundo)" aria-label={`Cota final da ${label}`} value={en.floorZ} digits={3} onCommit={v => onChange({end: {...en, floorZ: v}})}/>}
      <p className="hint">{depthMode ? 'O talude desce da linha com a inclinação e as bermas de corte; depois o fundo segue plano até encontrar o terreno (na cava, ocupa o interior).' : 'Corte sobe e aterro desce até encontrar o terreno (linha de offset).'}</p>
    </details>
  </>;
}
