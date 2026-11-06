import React from 'react';
import {stationLabel} from '../core/corridor';

const n = (v, d = 3) => v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});
const ca = h => h === null || h === undefined ? '—' : `${h >= 0 ? 'C' : 'A'} ${n(Math.abs(h), 2)}`;
const cls = h => h === null || h === undefined ? '' : h >= 0 ? 'cut' : 'fill';

/** Nota de serviço do acesso por estaca: o que a topografia leva ao campo para locar offsets e bordos. */
export default function ServiceNotes({rows, current = null, onStation, onExport}) {
  if (!rows?.length) return <div className="cubage notes" aria-label="Nota de serviço"><div className="cubage-head"><b>Nota de serviço</b><span className="muted">Ative o gabarito de acesso no painel Projeto para gerar a nota.</span></div></div>;
  const side = (s, left) => left
    ? [<td key="o" className="num">{n(s.offset, 2)}</td>, <td key="z">{n(s.offsetZ)}</td>, <td key="h" className={cls(s.h)}>{s.kind === '—' ? '—' : ca(s.h)}</td>, <td key="bo">{n(s.edgeOffset, 2)}</td>, <td key="bz">{n(s.edgeZ)}</td>]
    : [<td key="bz">{n(s.edgeZ)}</td>, <td key="bo">{n(s.edgeOffset, 2)}</td>, <td key="h" className={cls(s.h)}>{s.kind === '—' ? '—' : ca(s.h)}</td>, <td key="z">{n(s.offsetZ)}</td>, <td key="o" className="num">{n(s.offset, 2)}</td>];
  const missing = rows.filter(r => r.left.offset === null || r.right.offset === null).length;
  return <div className="cubage notes" aria-label="Nota de serviço">
    <div className="cubage-head">
      <b>Nota de serviço · acesso</b>
      <span>{rows.length} estacas · afastamentos a partir do eixo · C = corte, A = aterro{missing ? ` · ${missing} estaca(s) com offset fora do levantamento` : ''}</span>
      <button onClick={onExport}>Exportar CSV</button>
    </div>
    <div className="cubage-scroll"><table>
      <thead>
        <tr><th rowSpan="2">Estaca</th><th colSpan="5">Lado esquerdo</th><th colSpan="3">Eixo</th><th colSpan="5">Lado direito</th></tr>
        <tr><th>Offset m</th><th>Cota offset</th><th>Talude</th><th>Bordo m</th><th>Cota bordo</th><th>Terreno</th><th>Greide</th><th>C/A</th><th>Cota bordo</th><th>Bordo m</th><th>Talude</th><th>Cota offset</th><th>Offset m</th></tr>
      </thead>
      <tbody>{rows.map(r => <tr key={r.station} className={current !== null && Math.abs(r.station - current) < 1e-6 ? 'now' : ''} onClick={() => onStation?.(r.station)}>
        <td>{stationLabel(r.station)}</td>{side(r.left, true)}<td>{n(r.terrainZ)}</td><td>{n(r.gradeZ)}</td><td className={cls(r.axisH)}>{ca(r.axisH)}</td>{side(r.right, false)}
      </tr>)}</tbody>
    </table></div>
  </div>;
}
