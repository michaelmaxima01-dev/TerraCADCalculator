# Terra CAD — instruções para o Claude Code

As regras do projeto estão em **AGENTS.md** (mesmo conteúdo usado pelo OpenCode) e valem integralmente aqui:

@AGENTS.md

## Ambiente
- Repositório: https://github.com/michaelmaxima01-dev/TerraCADCalculator (projeto na raiz).
- Pasta do usuário no Windows: `C:\Users\Codex SEG\Documents\TerraCADCalculator` (clone do repositório; a pasta antiga `TerraCAD\terra-cad-v4` é a cópia original do ZIP).
- Uso local agora: `npm run dev` (desenvolvimento) ou `npm run build` + `node serve.mjs` / `INICIAR-WINDOWS.cmd` (http://127.0.0.1:4173).
- Linha de base verificada em 04/11/2026: `npm ci` ok, `npm test` 44/44, `npm run build` ok, app abre no Chromium sem erros no console.
- Importação DWG/DXF (04/11/2026): `npm test` 56/56; DWG real da Mina Cutia (AutoCAD 2018, 4,9 MB) lido em ~3 s no navegador.

## Publicação na Hostinger (online, sem banco de dados)
Guia completo em `PUBLICAR-HOSTINGER.md`. `npm run build:hostinger` gera `pacote-hostinger/terracad-hostinger.zip` (extrair em `public_html`).
- O app continua rodando no navegador; projetos ficam no PC do usuário (Salvar/Abrir JSON). O servidor só tem PHP de contas/licenças (`hostinger/api/auth.php`, dados em `api/data/*.json`) e o porteiro `gate.php`.
- Sem senha padrão: o primeiro acesso usa o código de `api/data/codigo-instalacao.txt`. Nunca versionar `api/data/`.
- `base: './'` no build online: funciona na raiz ou em subpasta.
- Conferir que o servidor entrega `.js` como `text/javascript` (o Web Worker depende disso) e `.wasm` como `application/wasm` (leitor de DWG); usar HTTPS. Na Hostinger (Apache/LiteSpeed), se preciso: `.htaccess` com `AddType application/wasm .wasm`.
- Licença GPL-3.0-or-later: ao publicar, disponibilizar o código-fonte (ex.: link para o repositório na interface).
- Não introduzir banco de dados nem guardar projetos no servidor (decisão do usuário em 04/11/2026). Login/licenças: só pela camada PHP existente.
- Arquivos do usuário (CSV/JSON) são processados apenas no navegador — manter assim.

## Fluxo de trabalho
- Antes de mudar comportamento: entender o pedido (skill de brainstorming) e, para mudanças grandes, escrever plano.
- Núcleo em `src/core/` com teste em `tests/` (TDD, resultado analítico conhecido).
- Antes de entregar: `npm test`, `npm run build` e teste no navegador (ver "Verificação antes de entregar" no AGENTS.md).
