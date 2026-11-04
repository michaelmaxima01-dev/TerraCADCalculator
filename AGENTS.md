# Terra CAD — instruções para agentes (OpenCode)

Aplicação web local de topografia e terraplenagem: nuvem de pontos → TIN restrita (Delaunay com restrições) → planta 2D + 3D, curvas de nível, perfil com greide editável, seções transversais, plataformas com taludes, volumes e exportação DXF/LandXML/CSV. Direção do produto: equivalência funcional progressiva ao Civil 3D, com mais automação. Interface e mensagens em **português do Brasil**.

Versão atual: **4.0** (`package.json` 0.4.0). Guias do usuário: `LEIA-ME-V4.md` (novidades), `LEIA-ME-V3.md`, `LEIA-ME-V2.md`.

## Comandos
- `npm ci` — instalar (Node.js 22.12+)
- `npm run dev` — Vite em 127.0.0.1
- `npm test` — `node --test` (56 testes do núcleo; devem continuar passando)
- `npm run build` — gera `dist/`
- `node serve.mjs` — servidor de uso (somente módulos nativos), serve `dist/` em http://127.0.0.1:4173

## Stack
React 19 · Vite 7 · Tailwind 4 (só preflight; o estilo real está em `src/style.css`) · Three.js 0.180 (`three/addons/controls/OrbitControls.js`) · `cdt2d` · `@mlightcad/libredwg-web` 0.8.3 (LibreDWG em WebAssembly, leitura de DWG) · Web Worker em módulo ES (`worker.format: 'es'`) para importação/triangulação. JavaScript (sem TypeScript). JSX clássico: todo componente precisa de `import React`.

**Licença: GPL-3.0-or-later** (decisão do usuário em 04/11/2026 para ler DWG com a LibreDWG). Ao publicar, o código-fonte deve ficar disponível aos usuários.

## Mapa do código
| Caminho | Papel |
|---|---|
| `index.html` → `src/v4.jsx` → `src/AppV4.jsx` | App atual: estado do documento, histórico (20 passos), ferramentas, atalhos, abas laterais (Terreno/Projeto/Exibição/Exportar) e de vista (2D/Duas vistas/3D/Perfil/Seções), JSON v4 |
| `src/components/ViewportV4.jsx` | Renderer 2D (ortográfica) e 3D: zoom suave ao cursor (roda própria; OrbitControls com `enableZoom=false` + damping), atração com marcadores, linha elástica no canvas, plataformas/taludes, seções, terreno recortado no 3D |
| `src/components/ProfileEditor.jsx` | Perfil: PVIs inserir/arrastar/remover, curvas verticais, corte/aterro, tabela, zoom/pan |
| `src/components/SectionViewer.jsx` | Seções transversais, áreas, média das áreas extremas |
| `src/components/PointTools.jsx` | Grupos e edição de pontos |
| `src/core/parser.js` | Importação P/E/N/Z/D, `;` com vírgula decimal, mapeamento |
| `src/core/dxf.js` | Leitor DXF ASCII próprio (POINT, LINE, LWPOLYLINE, POLYLINE/VERTEX, 3DFACE, INSERT+ATTRIB, BLOCK) → modelo CAD normalizado |
| `src/core/cad.js` | `normalizeLibreDwg`, `extractSources` (expande blocos com transformação; bloco com atributo de cota/nº vira ponto; blocos nunca inseridos viram fontes), `buildCadPoints` (espaçamento, duplicados, IDs), `separateRegions`, `suggestSpacing` |
| `src/core/cadReader.js` | Só no Worker: detecta DWG/DXF, carrega a LibreDWG sob demanda (`.wasm` ~11 MB), mensagens de erro |
| `src/components/CadImportDialog.jsx` | Janela de escolha das fontes do desenho, espaçamento e avisos antes de importar |
| `src/core/tin.js` | `triangulate`, `constraintsFor`, `editEdge` (swap/delete), `edgesOf` |
| `src/core/surface.js` | `buildSurface` (CDT + contorno + maxEdge), `validateProject` (v1–v4) |
| `src/core/contours.js` | Curvas de nível (marching triangles) |
| `src/core/volumes.js` | Áreas, volume contra plano, cota de equilíbrio |
| `src/core/profile.js` | `sampleProfile`, `profileContext` (reutilizável), `triangleLocator` |
| `src/core/grade.js` | Greide: PVIs, curvas verticais parabólicas, inserir/mover |
| `src/core/breaklines.js` | `drapeBreakline`: linha obrigatória livre assentada na TIN (pontos `RL###`) |
| `src/core/grading.js` | Plataformas: modelo de distância `z = Zp ± d/(H:V)`, malha de taludes, volumes em grade, `clipTerrainMesh` |
| `src/core/sections.js` | Estacas, seções, média das áreas extremas |
| `src/core/snap.js` | Índice de atração: nó/vértice > ponto médio > mais próximo |
| `src/core/exporters.js` | DXF R12 (camadas `TC_*`), LandXML 1.2 (multi-superfície), CSV |
| `src/core/geometry.worker.js` | Worker: import, superfície, validação de projeto, leitura CAD (`cad`) |
| `tests/*.test.js` | `core`, `surface`, `v3`, `v4`, `cad` (fixture `tests/fixtures/blocos.dxf`) |
| `AppV2/V3`, `ViewportV2/V3`, `ProfileChart`, `main.jsx`, `Viewport.jsx` | Versões anteriores preservadas como referência, **fora da entrada** — não editar sem pedido |

## Modelo de dados (projeto JSON v4)
`{version:4, points:[{id,x,y,z,description}], triangles:[[i,j,k]], breaklines:[[idx...]], boundary:[idx...], maxEdge, alignment:[{x,y}], grade:[{station,z,curve}], platforms:[{id,name,polygon:[{x,y}],elevation,cutSlope,fillSlope,visible}], labelStyle, groupColors, contourStyle, referenceZ, sectionSettings:{interval,halfWidth}}`. Índices referem-se ao array `points`. Novas versões devem continuar abrindo v1–v4.

## Regras do domínio
- Recalcular a TIN descarta inversões/cortes manuais; contorno, linhas obrigatórias, eixo, greide e plataformas persistem.
- Contorno: polígono simples, sem ilhas. Restrições não podem cruzar sem vértice comum.
- Coordenadas UTM grandes: centralizar antes de triangular/renderizar (já feito em `tin.js` e nos viewports).
- Curvas: convenção `z >= nível` (a cota mínima exata não gera linha).
- Plataforma é plana; taludes pelo modelo de distância; plataformas sobrepostas não são combinadas.
- Volumes são geométricos (sem empolamento/contração).

## Convenções
- Lógica de cálculo em `src/core/` como funções puras e testáveis com `node --test`; componentes só orquestram.
- Toda função nova de núcleo ganha teste, de preferência com **resultado analítico conhecido** (ex.: plano inclinado, plataforma quadrada).
- Mensagens ao usuário em português, curtas e específicas (dizer o que fazer).
- Não fazer laço de renderização contínuo: renderizar sob demanda (`invalidate`).
- Preservar o estilo visual escuro existente; tokens de cor em `src/style.css`.
- Ao mudar o formato do projeto, subir `version` e manter a leitura das anteriores em `validateProject`.

## Verificação antes de entregar
1. `npm test` sem falhas.
2. `npm run build` sem erros.
3. Testar no navegador o fluxo afetado (importar `exemplos/levantamento-concavo.csv`, desenhar, salvar e reabrir o JSON) sem erros no console.
4. Não versionar desenhos de clientes (DWG/DXF reais); usar fixtures sintéticas.

## Backlog sugerido
Plataformas com rampa e bermas · corredor (seção-tipo ao longo do eixo) · curvas horizontais no eixo · volume superfície × superfície (ex.: levantamentos jan × mar/2022 da Mina Cutia) · arrastar vértices de plataforma · curvas importadas como linhas obrigatórias · planimetria do DWG como fundo · textos de cota (TEXT) como pontos · triangulação mais rápida (≈3 s para 10 mil pontos) · reduzir estado do `AppV4` (reducer/store) · `constraintsFor` O(n²).

## Pendências com o usuário
Confirmar o significado de "modelo aranha" e de "curso que mostre as milhas" (provavelmente cursor em mira).
