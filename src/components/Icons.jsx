import React from 'react';

// Ícones de traço (24×24), herdam a cor do texto. Sem dependências externas.
const PATHS = {
  orbit: <><path d="M5 3.5l13 6.2-5.6 1.9-2 5.9z"/><path d="M12.6 11.8l5 5"/></>,
  breakline: <><path d="M3 18l5.5-8 4.5 4.5L21 5"/><circle cx="3" cy="18" r="1.4"/><circle cx="8.5" cy="10" r="1.4"/><circle cx="13" cy="14.5" r="1.4"/><circle cx="21" cy="5" r="1.4"/></>,
  boundary: <><path d="M4.5 8.5L10 4l9.5 3-1.8 11.5L5.5 20z" strokeDasharray="3 2.2"/></>,
  profile: <><path d="M3 20L21 4"/><path d="M6.2 14.6l2.2 2.2M10.4 10.8l2.2 2.2M14.6 7l2.2 2.2"/></>,
  line: <><path d="M3 17c4-1 5-8 9-8s4 6 9 5"/><rect x="1.5" y="15.5" width="3" height="3" rx=".5"/><rect x="10.5" y="7.5" width="3" height="3" rx=".5"/><rect x="19.5" y="12.5" width="3" height="3" rx=".5"/></>,
  platform: <><path d="M7 9.5h10l4 8.5H3z"/><path d="M9.5 9.5L8.5 6h7l-1 3.5"/></>,
  swap: <><path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5"/></>,
  trim: <><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.7L18 4M15.7 15.7L6 4"/></>,
  undo: <><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></>,
  fit: <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="8.5" y="8.5" width="7" height="7" rx="1"/></>,
  snap: <><path d="M6 4v7a6 6 0 0012 0V4"/><path d="M6 8h3.5M14.5 8H18"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 114 2c-.9.6-1.6 1.1-1.6 2.2"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/></>,
  open: <><path d="M3 7.5V18a1.5 1.5 0 001.5 1.5h15A1.5 1.5 0 0021 18V9.5A1.5 1.5 0 0019.5 8H12l-2-2.5H4.5A1.5 1.5 0 003 7z"/></>,
  save: <><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 16.5v2A1.5 1.5 0 006 20h12a1.5 1.5 0 001.5-1.5v-2"/></>,
  panel: <><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M14.5 4.5v15"/></>,
  table: <><rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M3.5 10h17M3.5 14.5h17M9.5 10v9"/></>,
  terrain: <><path d="M2.5 18.5l6-9 4 5.5 3-4 6 7.5z"/><circle cx="17" cy="6" r="1.8"/></>,
  design: <><path d="M3 19h18"/><path d="M5 19l4-7h6l4 7"/><path d="M9 12V7h6v5"/></>,
  display: <><path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/></>,
  export: <><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4.5 13.5v5A1.5 1.5 0 006 20h12a1.5 1.5 0 001.5-1.5v-5"/></>,
  close: <><path d="M6 6l12 12M18 6L6 18"/></>,
};

export default function Icon({name, size = 18, title, ...rest}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} focusable="false" {...rest}>{title && <title>{title}</title>}{PATHS[name]}</svg>;
}
