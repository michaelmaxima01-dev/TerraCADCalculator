import React from 'react';

const st = s => `${Math.floor(s / 1000)}+${(s % 1000).toFixed(2).padStart(6, '0')}`;
const n = (v, d = 1) => Number(v).toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});

/** Tabela de cubagem por estaca (média das áreas) com mini diagrama de massas do saldo acumulado. */
export default function CubageTable({rows, current = null, onStation}) {
  if (!rows?.length) return null;
  const W = 260, H = 70, s0 = rows[0].station, s1 = rows.at(-1).station || 1, b = rows.map(r => r.balance), lo = Math.min(0, ...b), hi = Math.max(0, ...b), span = hi - lo || 1;
  const x = s => 4 + (s - s0) / Math.max(s1 - s0, 1e-9) * (W - 8), y = v => 6 + (hi - v) / span * (H - 12);
  const last = rows.at(-1);
  return <div className="cubage" aria-label="Cubagem por estaca">
    <div className="cubage-head">
      <b>Cubagem por estaca</b>
      <span>Corte <b className="cut">{n(last.accCut)} m³</b> · Aterro <b className="fill">{n(last.accFill)} m³</b> · Saldo <b>{n(last.balance)} m³</b></span>
      <svg width={W} height={H} className="mass-diagram" role="img" aria-label="Diagrama de massas (saldo acumulado)">
        <line x1="4" x2={W - 4} y1={y(0)} y2={y(0)} className="zero"/>
        <polyline points={rows.map(r => `${x(r.station)},${y(r.balance)}`).join(' ')} className="mass"/>
        {current !== null && <line x1={x(current)} x2={x(current)} y1="2" y2={H - 2} className="now"/>}
      </svg>
    </div>
    <div className="cubage-scroll"><table>
      <thead><tr><th>Estaca</th><th>Área corte m²</th><th>Área aterro m²</th><th>Corte parcial m³</th><th>Aterro parcial m³</th><th>Corte acum. m³</th><th>Aterro acum. m³</th><th>Saldo acum. m³</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.station} className={current !== null && Math.abs(r.station - current) < 1e-6 ? 'now' : ''} onClick={() => onStation?.(r.station)}>
        <td>{st(r.station)}</td><td>{n(r.cutArea, 2)}</td><td>{n(r.fillArea, 2)}</td><td className="cut">{n(r.cutVol)}</td><td className="fill">{n(r.fillVol)}</td><td>{n(r.accCut)}</td><td>{n(r.accFill)}</td><td className={r.balance < 0 ? 'fill' : 'cut'}>{n(r.balance)}</td></tr>)}</tbody>
    </table></div>
  </div>;
}
