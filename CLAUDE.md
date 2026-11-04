# Terra CAD — instruções para o Claude Code

As regras do projeto estão em **AGENTS.md** (mesmo conteúdo usado pelo OpenCode) e valem integralmente aqui:

@AGENTS.md

## Ambiente
- Repositório: https://github.com/michaelmaxima01-dev/TerraCADCalculator (projeto na raiz).
- Pasta do usuário no Windows: `C:\Users\Codex SEG\Documents\TerraCADCalculator` (clone do repositório; a pasta antiga `TerraCAD\terra-cad-v4` é a cópia original do ZIP).
- Uso local agora: `npm run dev` (desenvolvimento) ou `npm run build` + `node serve.mjs` / `INICIAR-WINDOWS.cmd` (http://127.0.0.1:4173).
- Linha de base verificada em 04/11/2026: `npm ci` ok, `npm test` 44/44, `npm run build` ok, app abre no Chromium sem erros no console.
- Importação DWG/DXF (04/11/2026): `npm test` 56/56; DWG real da Mina Cutia (AutoCAD 2018, 4,9 MB) lido em ~3 s no navegador.

## Futuro: publicação na Hostinger
O app é 100% estático (sem backend): o que vai para o servidor é só o conteúdo de `dist/`.
- Hospedagem compartilhada: enviar `dist/*` para `public_html/` (ou subdomínio). `serve.mjs` não é usado lá.
- Se publicar numa **subpasta** (ex.: `dominio.com/terracad/`), definir `base` no `vite.config.js` (`'./'` ou `'/terracad/'`); hoje os assets usam caminho absoluto `/assets/`.
- Conferir que o servidor entrega `.js` como `text/javascript` (o Web Worker depende disso) e `.wasm` como `application/wasm` (leitor de DWG); usar HTTPS. Na Hostinger (Apache/LiteSpeed), se preciso: `.htaccess` com `AddType application/wasm .wasm`.
- Licença GPL-3.0-or-later: ao publicar, disponibilizar o código-fonte (ex.: link para o repositório na interface).
- Não introduzir dependência de servidor (APIs, banco, login) sem decisão explícita do usuário; se vier, planejar à parte (Hostinger VPS/Node).
- Arquivos do usuário (CSV/JSON) são processados apenas no navegador — manter assim.

## Fluxo de trabalho
- Antes de mudar comportamento: entender o pedido (skill de brainstorming) e, para mudanças grandes, escrever plano.
- Núcleo em `src/core/` com teste em `tests/` (TDD, resultado analítico conhecido).
- Antes de entregar: `npm test`, `npm run build` e teste no navegador (ver "Verificação antes de entregar" no AGENTS.md).
