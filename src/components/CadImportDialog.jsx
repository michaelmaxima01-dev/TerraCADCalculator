import React, {useEffect, useMemo, useRef, useState} from 'react';
import {buildCadPoints, separateRegions, suggestSpacing} from '../core/cad.js';

const KIND = {points: 'Pontos', lines: 'Linhas 3D', faces: 'Faces 3D'};
const MAX_POINTS = 60000, SLOW_POINTS = 15000;
const fmt = (v, d = 2) => Number(v).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});
const int = v => Number(v).toLocaleString('pt-BR');

/**
 * Escolha das fontes de um DWG/DXF antes de importar.
 * @param {{data:{fileName:string, format:string, sources:object[]}, onCancel:()=>void, onConfirm:(points:object[], text:string)=>void}} props
 */
export default function CadImportDialog({data, onCancel, onConfirm}) {
  const {fileName, format, sources} = data;
  const withZ = useMemo(() => sources.filter(s => !s.flat), [sources]);
  const flatCount = sources.length - withZ.length;
  const [selected, setSelected] = useState(() => new Set(withZ.filter(s => s.defaultOn).map(s => s.key)));
  const chosen = useMemo(() => withZ.filter(s => selected.has(s.key)), [withZ, selected]);
  const hasLines = chosen.some(s => s.kind === 'lines');
  const [spacing, setSpacing] = useState(() => suggestSpacing(withZ.filter(s => s.defaultOn)));
  const suggested = useMemo(() => suggestSpacing(chosen), [chosen]);
  const preview = useMemo(() => buildCadPoints(chosen, {spacing}), [chosen, spacing]);
  const regions = useMemo(() => separateRegions(chosen), [chosen]);
  const n = preview.points.length;
  const problem = !chosen.length ? 'Marque pelo menos uma fonte com cota.'
    : regions ? `As fontes marcadas estão em ${regions.regions} regiões distantes (≈ ${fmt(regions.distance / 1000, 1)} km). Desmarque as de outra região para não distorcer a malha.`
    : n < 3 ? 'São necessários pelo menos três pontos com coordenadas diferentes.'
    : n > MAX_POINTS ? `${int(n)} pontos é demais para o navegador. Aumente o espaçamento ou desmarque fontes (limite ${int(MAX_POINTS)}).`
    : null;
  const ref = useRef();
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => { const k = e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, [onCancel]);
  const toggle = key => setSelected(s => { const next = new Set(s); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const confirm = () => {
    if (problem) return;
    const {stats} = preview, parts = [stats.points && `${int(stats.points)} de pontos`, stats.lines && `${int(stats.lines)} de linhas`, stats.faces && `${int(stats.faces)} de faces`].filter(Boolean).join(', ');
    onConfirm(preview.points, `${fileName}: ${int(n)} pontos importados (${parts})${stats.duplicates ? `; ${int(stats.duplicates)} duplicados ignorados` : ''}. Defina um contorno para recortar o levantamento.`);
  };
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onCancel()}>
    <div className="modal cad-import" role="dialog" aria-modal="true" aria-labelledby="cad-title" tabIndex={-1} ref={ref}>
      <header><div><h2 id="cad-title">Importar desenho CAD</h2><p className="muted">{fileName} · {format}</p></div><button className="ghost" aria-label="Fechar" onClick={onCancel}>✕</button></header>
      <p className="muted">Escolha o que vira terreno. Vêm marcadas as fontes com cota da região principal do desenho. Blocos “não inseridos” existem no arquivo, mas não aparecem no desenho (ex.: levantamentos guardados como bloco).</p>
      {withZ.length === 0 ? <p className="warn">O desenho não tem geometria com cota (tudo em Z = 0). Exporte do Civil 3D os pontos ou a superfície com elevação.</p> :
        <div className="cad-sources" role="group" aria-label="Fontes com cota">
          <div className="cad-row head"><span/><span>Origem</span><span>Tipo · camada</span><span>Qtde</span><span>Cotas (m)</span></div>
          {withZ.map(s => <label key={s.key} className={`cad-row ${selected.has(s.key) ? 'on' : ''}`}>
            <input type="checkbox" checked={selected.has(s.key)} onChange={() => toggle(s.key)}/>
            <span title={s.inserted ? s.container : `${s.container} — definido no arquivo, mas não inserido no desenho`}>{!s.inserted && <i className="tag">não inserido</i>}{s.container}</span>
            <span title={s.layer}><b>{KIND[s.kind]}</b> · {s.layer}</span>
            <span className="num">{int(s.count)}{s.kind !== 'points' && <small> / {int(s.vertexCount)} vért.</small>}</span>
            <span className="num">{fmt(s.zMin)} → {fmt(s.zMax)}</span>
          </label>)}
        </div>}
      {flatCount > 0 && <p className="muted small">{int(flatCount)} fontes sem cota (planimetria em Z = 0) foram ignoradas.</p>}
      {hasLines && <div className="cad-spacing">
        <label>Espaçamento mínimo entre vértices das linhas (m)
          <input type="number" min="0" step="0.25" value={spacing} onChange={e => setSpacing(Math.max(0, Number(e.target.value) || 0))}/></label>
        <button type="button" disabled={spacing === suggested} onClick={() => setSpacing(suggested)}>Usar sugerido ({fmt(suggested)} m)</button>
        <p className="muted small">Curvas de nível costumam ter vértices muito próximos. 0 mantém todos.</p>
      </div>}
      <div className={`cad-summary ${problem ? 'bad' : n > SLOW_POINTS ? 'slow' : ''}`} aria-live="polite">
        {problem || <><b>{int(n)} pontos</b> serão importados{preview.stats.duplicates ? ` · ${int(preview.stats.duplicates)} duplicados ignorados` : ''}.{n > SLOW_POINTS && ' A triangulação pode levar alguns segundos.'}</>}
      </div>
      <footer><button onClick={onCancel}>Cancelar</button><button className="primary" disabled={!!problem} onClick={confirm}>Importar {problem ? '' : int(n) + ' pontos'}</button></footer>
    </div>
  </div>;
}
