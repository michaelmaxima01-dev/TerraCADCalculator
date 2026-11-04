import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createAuth, PLANOS, diasRestantes, gerarSenha} from './auth-client.js';

/** Login/licenças só na versão online (build "hostinger"); no uso local o app abre direto. */
export const AUTH_ENABLED = import.meta.env.VITE_TERRACAD_AUTH === '1';
const PLAN_NAME = Object.fromEntries(PLANOS.map(p => [p.key, p.name]));
const dateBR = iso => iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';
const validade = u => u.role === 'owner' || !u.expires ? 'Vitalícia' : `${dateBR(u.expires)} (${u.daysLeft < 0 ? `venceu há ${-u.daysLeft} d` : u.daysLeft === 0 ? 'vence hoje' : `${u.daysLeft} d`})`;

/**
 * Sessão da versão online: revalida ao abrir e a cada 20 min.
 * @returns {null | {sessao, aviso, bloqueio, sair, auth, dispensarAviso}}
 */
export function useLicense() {
  const auth = useMemo(() => AUTH_ENABLED ? createAuth({url: 'api/auth.php'}) : null, []);
  const [sessao, setSessao] = useState(() => auth?.sessao() ?? null), [bloqueio, setBloqueio] = useState(null), [aviso, setAviso] = useState(null);
  useEffect(() => {
    if (!auth) return;
    let vivo = true;
    auth.verificar().then(r => {
      if (!vivo) return;
      if (!r.ok) { location.replace('login.html?motivo=' + encodeURIComponent(r.mensagem)); return; }
      setSessao(r.sessao); setAviso(auth.aviso(7));
    });
    const parar = auth.vigiar(m => setBloqueio(m));
    return () => { vivo = false; parar(); };
  }, [auth]);
  const sair = useCallback(async () => { await auth.sair(); location.replace('login.html'); }, [auth]);
  if (!auth) return null;
  return {auth, sessao, aviso, bloqueio, sair, dispensarAviso: () => setAviso(null)};
}

function Modal({title, onClose, children, wide}) {
  const ref = useRef();
  useEffect(() => { ref.current?.focus(); const k = e => { if (e.key === 'Escape' && onClose) { e.stopPropagation(); onClose(); } }; window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true); }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
    <div className={`modal ${wide ? 'admin-panel' : 'account-modal'}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      <header><h2>{title}</h2>{onClose && <button className="ghost" aria-label="Fechar" onClick={onClose}>✕</button>}</header>
      {children}
    </div>
  </div>;
}

/** Botão da conta na barra superior, com menu. */
export function AccountMenu({license, onAdmin}) {
  const [open, setOpen] = useState(false), ref = useRef();
  useEffect(() => { if (!open) return; const k = e => { if (!ref.current?.contains(e.target)) setOpen(false); }; document.addEventListener('mousedown', k); return () => document.removeEventListener('mousedown', k); }, [open]);
  const s = license.sessao; if (!s) return null;
  const dias = diasRestantes(s.expires), initials = (s.name || s.user).split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return <div className="account" ref={ref}>
    <button className="icon-btn account-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)} title={s.name}><i>{initials}</i><span>{s.name}</span></button>
    {open && <div className="account-menu" role="menu">
      <div className="account-head"><b>{s.name}</b><small>{s.user} · {s.role === 'owner' ? 'proprietário' : dias === null ? 'licença vitalícia' : `licença até ${dateBR(s.expires)}`}</small></div>
      {s.role === 'owner' && <button role="menuitem" onClick={() => { setOpen(false); onAdmin(); }}>Usuários e licenças</button>}
      <button role="menuitem" onClick={license.sair}>Sair</button>
    </div>}
  </div>;
}

export function LicenseBanner({license}) {
  const a = license?.aviso; if (!a) return null;
  return <div className={`license-banner ${a.urgente ? 'urgent' : ''}`} role="status">{a.texto} Fale com o administrador para renovar.<button className="ghost" aria-label="Dispensar aviso" onClick={license.dispensarAviso}>✕</button></div>;
}

/** Sessão encerrada no meio do uso: permite salvar o projeto antes de sair. */
export function LockScreen({license, onSave}) {
  if (!license?.bloqueio) return null;
  return <Modal title="Acesso encerrado">
    <p>{license.bloqueio}</p>
    <p className="muted">Salve o projeto no seu computador antes de sair para não perder o trabalho aberto.</p>
    <footer><button onClick={onSave}>↓ Salvar projeto</button><button className="primary" onClick={license.sair}>Entrar novamente</button></footer>
  </Modal>;
}

/** Painel do proprietário: desbloqueio com a senha, lista, criação, renovação e exclusão de contas. */
export function AdminPanel({license, onClose, onNotice}) {
  const {auth} = license;
  const [token, setToken] = useState(null), [users, setUsers] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [pass, setPass] = useState(''), [novo, setNovo] = useState(() => ({login: '', name: '', pass: gerarSenha(), plan: '1m', notes: ''})), [renew, setRenew] = useState({});
  const run = async (fn, okText) => {
    setBusy(true); setError('');
    try { const r = await fn(); if (Array.isArray(r)) setUsers(r); if (okText) onNotice(okText); return r; }
    catch (e) { setError(e.message); if (e.code === 'admin') setToken(null); return null; }
    finally { setBusy(false); }
  };
  const unlock = async e => { e.preventDefault(); const t = await run(() => auth.desbloquear(pass)); if (t) { setToken(t); setPass(''); await run(() => auth.listar(t)); } };
  const create = async e => { e.preventDefault(); const r = await run(() => auth.criar(token, novo), `Usuário ${novo.login} criado (${PLAN_NAME[novo.plan]}). Senha: ${novo.pass}`); if (r) { navigator.clipboard?.writeText(`Usuário: ${novo.login}\nSenha: ${novo.pass}`).catch(() => {}); setNovo({login: '', name: '', pass: gerarSenha(), plan: '1m', notes: ''}); } };
  return <Modal title="Usuários e licenças" onClose={onClose} wide>
    {error && <p className="warn" role="alert">{error}</p>}
    {!token ? <form className="admin-unlock" onSubmit={unlock}>
      <p className="muted">Por segurança, confirme a senha do proprietário. O painel fica liberado por 20 minutos.</p>
      <label>Senha do proprietário<input type="password" autoComplete="current-password" value={pass} onChange={e => setPass(e.target.value)} autoFocus required/></label>
      <footer><button type="submit" className="primary" disabled={busy || !pass}>Desbloquear</button></footer>
    </form> : <>
      <div className="admin-table" role="table" aria-label="Contas">
        <div className="admin-row head" role="row"><span>Usuário</span><span>Plano · validade</span><span>Último acesso</span><span>Situação</span><span>Ações</span></div>
        {users.map(u => { const r = renew[u.login] || {plan: u.plan === 'vitalicio' ? '1m' : u.plan, fromToday: false}; return <div key={u.login} className={`admin-row ${!u.active || (u.daysLeft !== null && u.daysLeft < 0) ? 'off' : ''}`} role="row">
          <span><b>{u.name}</b><small>{u.login}{u.role === 'owner' && ' · proprietário'}{u.notes && ` · ${u.notes}`}</small></span>
          <span>{PLAN_NAME[u.plan] || u.plan}<small>{validade(u)}</small></span>
          <span><small>{u.lastLogin ? new Date(u.lastLogin).toLocaleString('pt-BR') : 'nunca'}</small></span>
          <span>{u.role === 'owner' ? 'Ativo' : <label className="check"><input type="checkbox" checked={u.active} disabled={busy} onChange={e => run(() => auth.alterar(token, u.login, {active: e.target.checked}), `${u.login} ${e.target.checked ? 'ativado' : 'inativado'}.`)}/>{u.active ? 'Ativo' : 'Inativo'}</label>}</span>
          <span className="admin-actions">{u.role !== 'owner' && <>
            <select aria-label={`Plano de renovação de ${u.login}`} value={r.plan} onChange={e => setRenew(x => ({...x, [u.login]: {...r, plan: e.target.value}}))}>{PLANOS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
            <label className="check" title="Contar a partir de hoje em vez do vencimento atual"><input type="checkbox" checked={r.fromToday} onChange={e => setRenew(x => ({...x, [u.login]: {...r, fromToday: e.target.checked}}))}/>de hoje</label>
            <button disabled={busy} onClick={() => run(() => auth.alterar(token, u.login, {plan: r.plan, fromToday: r.fromToday}), `${u.login}: licença renovada (${PLAN_NAME[r.plan]}).`)}>Renovar</button>
            <button disabled={busy} onClick={() => { const s = gerarSenha(); run(() => auth.alterar(token, u.login, {pass: s}), `${u.login}: nova senha ${s}`).then(x => x && navigator.clipboard?.writeText(s).catch(() => {})); }}>Nova senha</button>
            <button className="danger" disabled={busy} onClick={() => confirm(`Excluir a conta ${u.login}? Esta ação não pode ser desfeita.`) && run(() => auth.excluir(token, u.login), `${u.login} excluído.`)}>Excluir</button></>}
          </span>
        </div>; })}
      </div>
      <form className="admin-create" onSubmit={create}>
        <h3>Nova conta</h3>
        <div className="admin-grid">
          <label>Login<input value={novo.login} onChange={e => setNovo(n => ({...n, login: e.target.value}))} required pattern="[A-Za-z0-9._\-]{3,32}" title="3 a 32 caracteres: letras, números, ponto, hífen ou sublinhado"/></label>
          <label>Nome<input value={novo.name} onChange={e => setNovo(n => ({...n, name: e.target.value}))}/></label>
          <label>Senha<span className="inline-field"><input value={novo.pass} onChange={e => setNovo(n => ({...n, pass: e.target.value}))} required minLength={6}/><button type="button" onClick={() => setNovo(n => ({...n, pass: gerarSenha()}))}>Gerar</button></span></label>
          <label>Plano<select value={novo.plan} onChange={e => setNovo(n => ({...n, plan: e.target.value}))}>{PLANOS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
          <label className="wide">Observações<input value={novo.notes} onChange={e => setNovo(n => ({...n, notes: e.target.value}))} placeholder="ex.: empresa, contrato"/></label>
        </div>
        <footer><span className="muted small">Login e senha são copiados para a área de transferência ao criar.</span><button type="submit" className="primary" disabled={busy}>Criar conta</button></footer>
      </form>
    </>}
  </Modal>;
}
