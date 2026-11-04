/**
 * Terra CAD — camada de login/licenças no navegador (ES module, sem dependências).
 * Baseada na camada do Planta3D. Fala com api/auth.php.
 *   const auth = createAuth({ url: 'api/auth.php' });
 *   await auth.status();                          // { needsSetup }
 *   await auth.instalar(codigo, login, nome, senha); // primeiro acesso (proprietário)
 *   await auth.login(user, pass, true);           // lança AuthError: invalid | inactive | expired | locked
 *   const r = await auth.verificar();             // { ok, sessao } | { ok:false, motivo, mensagem }
 *   const aviso = auth.aviso(7);                  // { dias, data, texto, urgente } | null
 *   auth.vigiar(msg => bloquearTela(msg));        // revalida a cada 20 min
 *   await auth.sair();
 *   // admin (role === 'owner'):
 *   const t = await auth.desbloquear(senhaDoProprietario);
 *   await auth.criar(t, { login, name, pass, plan: '1m', notes });
 */
export const PLANOS = [
  {key: '1d', name: '1 dia'},
  {key: '1s', name: '1 semana'},
  {key: '1m', name: '1 mês'},
  {key: '3m', name: 'Trimestral'},
  {key: '6m', name: 'Semestral'},
  {key: '12m', name: 'Anual'},
  {key: 'vitalicio', name: 'Vitalícia'},
];

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Dias até vencer (null = vitalícia; negativo = vencida). */
export function diasRestantes(expires) {
  if (!expires) return null;
  const ms = new Date(expires).getTime() - Date.now();
  return ms < 0 ? Math.floor(ms / 86400000) : Math.ceil(ms / 86400000);
}

export function gerarSenha(n = 10) {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...crypto.getRandomValues(new Uint32Array(n))].map((x) => abc[x % abc.length]).join('');
}

export function createAuth({url = 'api/auth.php', storageKey = 'terracad.sessao'} = {}) {
  async function call(action, body = {}) {
    let res;
    try {
      res = await fetch(url, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, ...body})});
    } catch {
      throw new AuthError('offline', 'Servidor indisponível. Verifique a conexão.');
    }
    const data = await res.json().catch(() => ({ok: false, error: 'offline', message: 'O servidor não respondeu como esperado (PHP desativado?).'}));
    if (!data.ok) throw new AuthError(data.error ?? 'erro', data.message ?? 'Erro no servidor.');
    return data;
  }

  const sessao = () => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) ?? localStorage.getItem(storageKey) ?? 'null');
    } catch {
      return null;
    }
  };
  const lembrado = () => !!localStorage.getItem(storageKey);
  const salvar = (s, lembrar = lembrado()) => {
    sessionStorage.removeItem(storageKey);
    localStorage.removeItem(storageKey);
    (lembrar ? localStorage : sessionStorage).setItem(storageKey, JSON.stringify(s));
  };
  const limpar = () => {
    sessionStorage.removeItem(storageKey);
    localStorage.removeItem(storageKey);
  };

  return {
    call,
    sessao,
    limpar,

    status: () => call('status'),

    async instalar(code, login, name, pass) {
      const r = await call('setup', {code, login, name, pass});
      salvar(r.session, true);
      return r.session;
    },

    async login(user, pass, lembrar = false) {
      const r = await call('login', {user, pass});
      salvar(r.session, lembrar);
      return r.session;
    },

    async sair() {
      limpar();
      try { await call('logout'); } catch { /* sem servidor: a sessão local já foi apagada */ }
    },

    async verificar() {
      const s = sessao();
      try {
        const r = await call('me', s?.token ? {token: s.token} : {});
        salvar(r.session);
        return {ok: true, sessao: r.session};
      } catch (e) {
        if (e.code !== 'offline') {
          limpar();
          return {ok: false, motivo: e.code, mensagem: e.message};
        }
        if (!s?.token) return {ok: false, motivo: 'sem-sessao', mensagem: 'Entre para continuar.'};
        const d = diasRestantes(s.expires); // servidor fora do ar: respeita a validade conhecida
        if (d !== null && d < 0) {
          limpar();
          return {ok: false, motivo: 'expired', mensagem: 'Sua licença venceu. Fale com o administrador.'};
        }
        return {ok: true, sessao: s, offline: true};
      }
    },

    vigiar(onBloqueio, intervaloMs = 20 * 60 * 1000) {
      const t = setInterval(async () => {
        const r = await this.verificar();
        if (!r.ok) onBloqueio(r.mensagem);
      }, intervaloMs);
      return () => clearInterval(t);
    },

    aviso(limiteDias = 7) {
      const s = sessao();
      if (!s || s.role === 'owner') return null;
      const dias = diasRestantes(s.expires);
      if (dias === null || dias > limiteDias) return null;
      const data = new Date(s.expires).toLocaleDateString('pt-BR');
      const texto = dias < 0 ? `Sua licença venceu em ${data}.` : dias === 0 ? `Sua licença vence hoje (${data}).` : dias === 1 ? `Sua licença vence amanhã (${data}).` : `Sua licença vence em ${dias} dias (${data}).`;
      return {dias, data, texto, urgente: dias <= 1};
    },

    // ----- proprietário -----
    desbloquear: (senha) => call('unlock', {token: sessao()?.token, pass: senha}).then((r) => r.adminToken),
    listar: (adminToken) => call('list', {adminToken}).then((r) => r.users),
    criar: (adminToken, u) => call('create', {adminToken, ...u}).then((r) => r.users),
    alterar: (adminToken, login, patch) => call('update', {adminToken, login, ...patch}).then((r) => r.users), // { active, pass, plan, name, notes, fromToday }
    excluir: (adminToken, login) => call('delete', {adminToken, login}).then((r) => r.users),
  };
}
