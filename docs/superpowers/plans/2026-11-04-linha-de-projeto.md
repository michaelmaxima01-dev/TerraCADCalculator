# Linha de projeto com PIs, curvas e bancadas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Linha de projeto editável (PIs, curvas de canto, cota por rampa, PI ou terreno) que gera taludes com bancadas até o terreno ou até uma profundidade/cota com fundo, com as mesmas regras na plataforma.

**Architecture:**
- As regras de talude (subida com bancadas, lançamento de raios, integração em grade) saem de `grading.js` para `slopes.js`. Plataforma e linha usam o mesmo código.
- `designLine.js` cuida só da geometria da linha (curvas, estacas, cotas, ponto mais próximo com lado).
- `lineGrading.js` produz a cota de projeto, a malha e os volumes da linha.
- A interface apenas orquestra: cartão próprio e alças de arraste no viewport.

**Tech Stack:** JavaScript (ESM, sem TypeScript) · React 19 (JSX clássico, `import React` em todo componente) · Three.js 0.180 · `cdt2d` · `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-04-linha-de-projeto-design.md`

## Global Constraints

- Interface e mensagens em português do Brasil, curtas e dizendo o que fazer.
- Lógica de cálculo em `src/core/` como funções puras; componentes só orquestram (AGENTS.md).
- Toda função nova de núcleo tem teste com resultado analítico conhecido.
- Projeto salva `version: 6`; `validateProject` abre v1–v6; plataforma sem `end` ⇒ `{mode: 'terrain'}`; bench sem `startAfter`/`count` ⇒ `startAfter: 0, count: null`.
- Os 65 testes atuais continuam passando (`npm test`), e `tests/v5.test.js` continua importando de `../src/core/grading.js`. Manter as reexportações.
- Sem laço de renderização contínuo: `invalidate()` sob demanda.
- Estilo: tokens do bloco "estação de trabalho" em `src/style.css`, regras novas escopadas em `.tc5`.
- Desempenho no arraste: recálculo com no máximo 30 000 células por quadro (`requestAnimationFrame`), cálculo completo ao soltar; meta < 100 ms por quadro com 10 mil pontos e 50 PIs.
- Arcos com flecha ≤ 0,02 m ou passo ≤ 3°.
- Não versionar desenhos de clientes; usar fixtures sintéticas.
- Etapa 1 (Tasks 1–6) no branch `feat/linha-de-projeto`; etapa 2 (Tasks 7–9) em `feat/bancadas-profundidade`, criado a partir dele.
- Antes de cada entrega: `npm test`, `npm run build` e o fluxo no navegador sem erros no console.

## Review Focus

1. **PI arrastado que faz a linha ou a plataforma se cruzar:** o arraste é recusado com aviso e a geometria anterior fica (Task 6, teste `rejeita arraste que cruza`).
2. **PI fora do terreno no modo `terrain`:** aviso "PI n fora da superfície", sem exceção nem NaN na malha (Task 2, teste `terreno fora`).
3. **Dois cliques no mesmo ponto ou PIs repetidos:** validação recusa "PIs repetidos" ao concluir; durante o traçado, o clique repetido é ignorado (Task 2, teste `PIs repetidos`).
4. **Grampo (ângulo ≈ 180°) ou PIs colineares com raio:** curva omitida ou limitada, sem NaN (Task 2, teste `grampo e colinear`).
5. **Término por profundidade em que o fundo nunca encontra o terreno:** o fundo para no limite da TIN, com aviso e volumes finitos (Task 8, teste `fundo sem terreno`).

---

## Etapa 1 — linha de projeto

### Task 1: Extrair as regras de talude para `slopes.js` (sem mudar comportamento)

**Files:**
- Create: `src/core/slopes.js`
- Modify: `src/core/grading.js`. Mover `BENCH_DEFAULT`, `validateBenches`, `slopeRise`, `slopeReach` e `slopeBreaks`, reexportando-os. `gradePlatform` passa a usar `castSlopes` e `platformVolumes` passa a usar `gridVolumes`.
- Test: `tests/slopes.test.js`

**Interfaces:**
- Produces:
  - `castSlopes(base, opts) → {vertices, triangles, types, daylight, hatch, benchLines, warnings, stats:{maxCut, maxFill, rays}}`
    - `base`: `Array<{x,y,z}>` (para linha aberta, no sentido do traçado);
    - `opts = {closed, side: 'left'|'right'|'outside', terrainAt(x,y)→number|null, nearest(x,y)→{d, z}, ruleFor(mode: 'cut'|'fill')→{H, bench|null}, spacing, maxDistance}`;
    - fechada usa `side: 'outside'` (base em sentido anti-horário, normal à direita do segmento);
    - aberta: raios só do lado pedido; **nas pontas, um único raio perpendicular** (pontas retas); fora isso, os cantos seguem a regra atual (leque no convexo, bissetriz no reentrante).
  - `gridVolumes(designAt(x,y,T)→number|null, terrainAt, bbox:{minX,minY,maxX,maxY}, {cell, maxCells = 250000, inside(x,y)→boolean}) → {cut, fill, net, areaCut, areaFill, footprint, cell, outside}`

- [ ] **Step 1: Escrever o teste**

  `castSlopes` com base quadrada fechada, terreno plano a 130 e `ruleFor` de corte H=1 sem bancada deve gerar `daylight` com todos os z = 130 ± 1e-3. `gridVolumes` com `designAt = () => 100` e terreno 101 num bbox 10×10 deve dar `cut ≈ 100` (±0,5) e `fill = 0`.

- [ ] **Step 2:** `node --test tests/slopes.test.js` → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar `slopes.js` movendo o código de raios, costura e grade de `grading.js`; `gradePlatform` e `platformVolumes` delegam.
- [ ] **Step 4:** `npm test` → todos passam (65 antigos + novos), mesmos números em `tests/v5.test.js`.
- [ ] **Step 5:** Commit `refactor: regras de talude compartilhadas em slopes.js`.

### Task 2: Geometria da linha (`designLine.js`)

**Files:**
- Create: `src/core/designLine.js`
- Test: `tests/linha.test.js`

**Interfaces:**
- Produces:
  - `validateDesignLine(l) → line normalizada`. Padrões:

    ```js
    {name: 'Linha', visible: true, closed: false, side: 'right',
     elevation: {mode: 'ramp', start: 0, slope: 0, drop: 0},
     cutSlope: 1, fillSlope: 1.5, benches: BENCH_DEFAULT,
     end: {mode: 'terrain', depth: 8, floorZ: null}}
    ```

    Lança `Error` em português em três casos: "A linha exige pelo menos 2 PIs" (3 se fechada); "PIs repetidos"; "A linha cruza a si mesma".
  - `buildLineBase(line, terrainAt?) → {base: Array<{x,y,z,s}>, length, curves: Array<{pi, radius, clamped: boolean, T, arcLength}>, warnings: string[]}`
    - `s` = estaca 2D acumulada;
    - arcos discretizados com flecha ≤ 0,02 m ou passo ≤ 3°;
    - raio reduzido quando T > metade de um segmento vizinho (`clamped: true` e aviso "Raio limitado a X m no PI n").
  - `lineNearest(baseInfo, x, y) → {d, z, s, side: 'left'|'right', atEnd: boolean}`. `atEnd` = projeção cai antes do início ou depois do fim (linha aberta).
  - Modos de cota:
    - `ramp`: `z = start + slope/100 · s`;
    - `pis`: linear por estaca entre as cotas dos PIs (no arco, linear entre os pontos de curva e de tangente);
    - `terrain`: `terrainAt(PI) − drop` interpolado como em `pis`. PI fora do terreno ⇒ aviso "PI n fora da superfície" e `base: []`.

- [ ] **Step 1: Testes**
  - `arco`: dois segmentos em L de 100 m com raio 20 no canto ⇒ `T = 20`, `arcLength = 20·π/2 ± 0,01` e `length = 200 − 40 + 10π ± 0,02`.
  - `raio limitado`: segmentos de 30 m com raio 50 ⇒ `clamped: true`, `T = 15`, aviso contendo "Raio limitado".
  - `rampa`: reta de 100 m com `start: 120, slope: -2` ⇒ z no fim = 118.
  - `pis`: PIs z 100 e 110 numa reta de 50 m ⇒ z(25) = 105.
  - `terreno fora`: um PI fora da TIN ⇒ aviso "fora da superfície", sem exceção.
  - `PIs repetidos` e `cruza a si mesma` lançam erros com essas mensagens.
  - `grampo e colinear`: PIs (0,0), (10,0), (0,0.001) com raio 5, e PIs colineares com raio 5 ⇒ nenhum NaN em `base`.
  - `lineNearest`: ponto (50, −3) numa reta (0,0)→(100,0) ⇒ `d = 3`, `side = 'right'`, `atEnd = false`; ponto (−2, −3) ⇒ `atEnd = true`.
- [ ] **Step 2:** `node --test tests/linha.test.js` → FAIL.
- [ ] **Step 3:** Implementar as três funções em `designLine.js`.
- [ ] **Step 4:** `node --test tests/linha.test.js` → PASS.
- [ ] **Step 5:** Commit `feat: geometria da linha de projeto (curvas, estacas, cotas)`.

### Task 3: Taludes, malha e volumes da linha (`lineGrading.js`)

**Files:**
- Create: `src/core/lineGrading.js`
- Test: `tests/linha.test.js` (adicionar)

**Interfaces:**
- Consumes:
  - `buildLineBase` e `lineNearest` (Task 2);
  - `castSlopes`, `gridVolumes`, `slopeRise` e `slopeReach` (Task 1).
- Produces:
  - `lineElevationAt(line, baseInfo, x, y, T) → number|null`
    - fora do lado pedido ou com `atEnd` ⇒ `null`;
    - término `terrain`: mesma regra da plataforma (corte sobe até o terreno, aterro desce);
    - `side: 'both'`: os dois lados.
  - `gradeLine(points, triangles, line, {elevationAt, spacing}) → mesh` (mesmo formato de `castSlopes`, com `base` e `curves` anexados).
  - `lineVolumes(points, triangles, line, {elevationAt, maxCells}) → resultado de gridVolumes`.
  - `compileLine(line, terrainAt) → baseInfo`, com cache em `WeakMap` por objeto `line`.

- [ ] **Step 1: Testes**
  - `reta sobre terreno plano`: linha (0,0)→(100,0) a z 100, lado direito, terreno plano 105, corte H=1, sem bancadas ⇒ `cut = 100 · (5·5/2) = 1250 ± 0,5%` (pontas retas: sem cone).
  - Mesmo caso com bancadas `{enabled, height: 2, width: 1, apply: 'cut'}` ⇒ `cut` = 100 × área da seção em degraus calculada à mão no próprio teste (integral de `5 − slopeRise(d)` em d), ± 0,5%.
  - `both`: o mesmo caso com `side: 'both'` ⇒ o dobro, ± 0,5%.
  - Malha: `daylight.every(v => |v.z − 105| < 1e-3)`, `triangles.length === types.length` e nenhum NaN.
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar `lineGrading.js`.
- [ ] **Step 4:** Rodar → PASS.
- [ ] **Step 5:** Commit `feat: taludes e volumes a partir da linha de projeto`.

### Task 4: Projeto v6, superfície combinada e exportação

**Files:**
- Modify:
  - `src/core/surface.js` (`validateProject`: versões 1–6, `designLines` via `validateDesignLine`);
  - `src/core/grading.js` (`designSurfaceFunction(platforms, terrainAt, lines = [])`: plataformas primeiro, depois linhas; vale a primeira que cobre o ponto);
  - `src/core/exporters.js` (camadas `TC_LP_EIXO` cor 6, `TC_LP_OFFSET` cor 3, `TC_LP_CRISTA` cor 2; faces nas camadas de talude existentes; `toDXF` recebe `designs` incluindo linhas com `kind: 'line'`; `toLandXML` inclui as malhas das linhas na superfície "Projeto").
- Test: `tests/linha.test.js` (adicionar)

**Interfaces:**
- Produces: projeto `{version: 6, ..., designLines: [...]}`; `designSurfaceFunction` com terceiro parâmetro opcional.

- [ ] **Step 1: Testes**
  - `validateProject` com `version: 6` e uma linha mantém PIs e raio;
  - v5 sem `designLines` ⇒ `designLines: []`;
  - `version: 7` lança "Versão";
  - `designSurfaceFunction([], at, [linha])` em (50, −2) do caso da Task 3 dá z entre 100 e 105;
  - `toDXF` com uma linha contém `TC_LP_EIXO` e `TC_LP_OFFSET`; `toLandXML` com uma linha tem 2 elementos `<Surface`.
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: projeto v6 com linhas de projeto e exportação`.

### Task 5: Ferramenta, cartão e desenho da linha

**Files:**
- Create: `src/components/DesignLineCard.jsx` (cartão: nome, aberta/fechada, lado, modo de cota e campos, tabela de PIs com estaca/cota/raio, taludes H:V com "altura × afastamento", bancadas atuais, resultados e avisos)
- Modify:
  - `src/AppV4.jsx`: ferramenta `line` (tecla `T`, ícone novo `line` em `Icons.jsx`); `finish()` cria a linha com `validateDesignLine`; o clique no 1º PI com ≥ 3 PIs fecha; o painel Projeto ganha "Linhas de projeto"; `designs` inclui as linhas (`gradeLine` + `lineVolumes`); `saveProject` grava `version: 6`; o snap inclui os PIs.
  - `src/components/ViewportV4.jsx`: desenhar a linha (amarelo-claro, PIs como quadrados, estacas a cada 20 m), as curvas, a hachura, o offset e as linhas de crista; no 3D, as faces.
  - `src/style.css`: estilo do cartão sob `.tc5`.

- [ ] **Step 1:** Implementar, reaproveitando `NumberField` e `Panel`.
- [ ] **Step 2:** `npm test && npm run build` → sem erros.
- [ ] **Step 3: Verificação no navegador** (Playwright, script no scratchpad)
  - no terreno de exemplo: `T`, 4 cliques, `Enter` ⇒ status "Linha 1 criada";
  - o cartão mostra volumes;
  - raio 15 no PI 2 ⇒ curva visível na planta;
  - salvar e reabrir ⇒ JSON v6 com a linha;
  - nenhum erro no console;
  - capturas da planta e do 3D.
- [ ] **Step 4:** Commit `feat: ferramenta e cartão da linha de projeto`.

### Task 6: Edição por arraste (linhas e plataformas)

**Files:**
- Modify:
  - `src/components/ViewportV4.jsx`. Props novas:
    - `handles: Array<{key, x, y}>`;
    - `segments: Array<{key, a, b}>`;
    - `onHandleDrag(key, {x,y}, phase: 'move'|'end'|'cancel')`;
    - `onSegmentInsert(key, {x,y})`;
    - `onHandleRemove(key)`.

    Comportamento:
    - `pointerdown` a ≤ 8 px de uma alça inicia o arraste e desliga `controls`;
    - o movimento usa `snapAt` (Alt desliga);
    - clique a ≤ 6 px de um segmento sem alça insere;
    - botão direito ou `Delete` sobre a alça selecionada remove.
  - `src/AppV4.jsx`. Estado `dragDraft = {kind: 'line'|'platform', id, geometry}`:
    - durante o arraste, `designs` usa a geometria do rascunho com `maxCells: 30000`;
    - no `end`, valida e faz `commit` (um passo de desfazer);
    - se a validação falhar, descarta o rascunho e mostra a mensagem.
- Test: `tests/linha.test.js` (adicionar teste de núcleo `rejeita arraste que cruza`). Função pura nova em `designLine.js`: `moveVertex(vertices, i, p, {closed}) → vertices` (lança "A linha cruza a si mesma").

- [ ] **Step 1:** Teste `rejeita arraste que cruza`: quadrado (0,0),(10,0),(10,10),(0,10) fechado; mover o vértice 1 para (−5, 15) ⇒ lança "cruza".
- [ ] **Step 2:** Rodar → FAIL; implementar `moveVertex`; rodar → PASS.
- [ ] **Step 3:** Implementar as alças, o arraste, a inserção e a remoção no viewport e no AppV4, para linhas e plataformas (substitui o polígono no `updatePlatform`).
- [ ] **Step 4: Verificação no navegador**
  - arrastar o PI 2 de uma linha: volume muda e `Ctrl+Z` restaura o valor anterior exatamente;
  - inserir e remover PI;
  - arrastar o vértice de uma plataforma;
  - medir o tempo por quadro com 10 mil pontos (gerar CSV sintético no scratchpad) e registrar no commit. Se passar de 100 ms, mover `designs` do arraste para o Worker na mesma task.
- [ ] **Step 5:** `npm test && npm run build`; commit `feat: arrastar, inserir e remover PIs e vértices`; `git push`.

---

## Etapa 2 — bancadas por quantidade, início e término por profundidade

### Task 7: Regras novas de bancada

**Files:**
- Modify:
  - `src/core/slopes.js`: `validateBenches` aceita `startAfter ≥ 0` (padrão 0) e `count` inteiro 1–50 ou `null`;
  - `slopeRise`, `slopeReach` e `slopeBreaks` aceitam `bench.startAfter`;
  - nova `resolveBench(bench, depth) → bench` com `height = depth / (count + 1)` quando `count`, e `startAfter` ignorado nesse caso.
- Test: `tests/slopes.test.js`

- [ ] **Step 1: Testes**
  - `startAfter: 4, height: 5, width: 2`, H=1 ⇒ `slopeBreaks` dá crista na subida 4 (d = 4) e na subida 9 (d = 4 + 2 + 5 = 11);
  - `resolveBench({count: 2, ...}, 8).height === 8/3`;
  - `count: 0` lança "entre 1 e 50".
- [ ] **Step 2:** FAIL → implementar → PASS (`npm test`, 65 antigos intactos).
- [ ] **Step 3:** Commit `feat: bancadas a partir de X m e por quantidade`.

### Task 8: Término por profundidade, fundo e cava

**Files:**
- Modify:
  - `src/core/slopes.js` (`validateEnd(end) → {mode, depth, floorZ}`);
  - `src/core/grading.js` (plataforma: `end.mode = 'depth'` desce a partir da borda até `floorZ ?? z_borda − depth` e depois segue um fundo plano até o terreno);
  - `src/core/lineGrading.js` (o mesmo para a linha; `side: 'inside'` na linha fechada = cava, com o interior além do fundo na cota do fundo);
  - `castSlopes` ganha os tipos de triângulo `floor` (fundo) e `bench` (faixa horizontal da berma) e devolve `floorOutline`.
- Test: `tests/slopes.test.js`, `tests/linha.test.js`

- [ ] **Step 1: Testes**
  - `cava quadrada`: linha fechada L = 40 a z 100, `side: 'inside'`, depth 8, H = 1, sem bancadas, terreno plano 100 ⇒ `cut = ∫₀⁸ (40 − 2z)² dz = (40³ − 24³)/6 = 8362,67 ± 0,5%`;
  - `2 bermas em 8 m`: a mesma cava com `{enabled, count: 2, width: 1}` ⇒ `benchLines` com z únicos {100 − 8/3, 100 − 16/3} (± 1e-3) e fundo a 92;
  - `fundo sem terreno`: plataforma num terreno pequeno com depth 50 ⇒ aviso contendo "limite da superfície" e `Number.isFinite(cut)`;
  - morro cônico (terreno `z = 150 − r/2` em grade), linha fechada no alto, depth 10 ⇒ volume confere com a integração numérica fina de `designElevationAt` (± 0,5%).
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** Commit `feat: término por profundidade com fundo e cava`.

### Task 9: Interface da etapa 2, exportação e documentação

**Files:**
- Modify:
  - `src/components/DesignLineCard.jsx` e o cartão da plataforma em `src/AppV4.jsx`: campos "A partir de (m)", "Por quantidade: N bermas" (habilitado só com término por profundidade) e "Término: até o terreno | profundidade (m) | cota final". O resumo das bancadas mostra a altura calculada.
  - `src/core/exporters.js`: `TC_LP_PE`, `TC_LP_FUNDO`, `TC_FUNDO` e `TC_BERMA_FACE`.
  - `AGENTS.md`: mapa do código, modelo v6, regras do domínio e contagem de testes.
  - `LEIA-ME-V4.md`: seção "Linha de projeto e bancadas".
- [ ] **Step 1:** Implementar; `npm test && npm run build`.
- [ ] **Step 2: Navegador**
  - plataforma no morro de exemplo com "2 bermas, profundidade 8 m": o painel mostra bancadas de 2,67 m e o 3D mostra o fundo;
  - linha aberta com término por cota final;
  - DXF contém `TC_LP_FUNDO`;
  - JSON v6 salvo e reaberto;
  - nenhum erro no console;
  - capturas.
- [ ] **Step 3:** Commit `feat: bancadas avançadas e término na interface`; `git push -u origin feat/bancadas-profundidade`.
