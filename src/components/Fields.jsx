import React from 'react';

/** Campo numérico que confirma ao sair do campo ou com Enter (evita recalcular a cada tecla). */
export function NumberField({label, value, onCommit, step = 'any', min, digits = 3, ...rest}) {
  return <label>{label}<input type="number" step={step} min={min} defaultValue={Number.isFinite(value) ? Number(value.toFixed(digits)) : ''} key={value}
    onBlur={e => { const v = Number(e.target.value); if (e.target.value !== '' && Number.isFinite(v) && v !== value) onCommit(v); }} onKeyDown={e => e.key === 'Enter' && e.target.blur()} {...rest}/></label>;
}
