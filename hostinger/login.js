import {createAuth} from './auth-client.js';

const auth = createAuth({url: 'api/auth.php'});
const $ = (id) => document.getElementById(id);
const msg = $('msg'), formLogin = $('form-login'), formSetup = $('form-setup');
const show = (text, ok = false) => { msg.hidden = !text; msg.textContent = text || ''; msg.classList.toggle('ok', ok); };
const entrarNoApp = () => location.replace('./');

function busy(form, on) { form.querySelectorAll('button, input').forEach(el => { el.disabled = on; }); }

async function iniciar() {
  const motivo = new URLSearchParams(location.search).get('motivo');
  try {
    const {needsSetup} = await auth.status();
    $('carregando').hidden = true;
    if (needsSetup) {
      $('titulo').textContent = 'Instalação'; $('subtitulo').textContent = 'Crie a conta do proprietário do Terra CAD.';
      formSetup.hidden = false; formSetup.elements.code.focus();
      return;
    }
    const r = await auth.verificar();
    if (r.ok && !r.offline) return entrarNoApp();
    formLogin.hidden = false;
    if (motivo && !/Sessão expirada/.test(motivo)) show(motivo); else if (!r.ok && r.motivo && !['sem-sessao', 'session'].includes(r.motivo)) show(r.mensagem);
    formLogin.elements.user.focus();
  } catch (e) {
    $('carregando').hidden = true;
    show(e.message + ' Confira se a pasta api/ foi enviada e se o PHP está ativo na hospedagem.');
  }
}

formLogin.addEventListener('submit', async (e) => {
  e.preventDefault(); show('');
  const f = formLogin.elements; busy(formLogin, true);
  try { await auth.login(f.user.value.trim(), f.pass.value, f.lembrar.checked); entrarNoApp(); }
  catch (err) { show(err.message); f.pass.select(); }
  finally { busy(formLogin, false); }
});

formSetup.addEventListener('submit', async (e) => {
  e.preventDefault(); show('');
  const f = formSetup.elements;
  if (f.pass.value !== f.pass2.value) { show('As senhas não conferem.'); f.pass2.focus(); return; }
  busy(formSetup, true);
  try { await auth.instalar(f.code.value.trim(), f.login.value.trim(), f.name.value.trim(), f.pass.value); show('Conta criada. Abrindo o Terra CAD…', true); setTimeout(entrarNoApp, 600); }
  catch (err) { show(err.message); }
  finally { busy(formSetup, false); }
});

iniciar();
