# Terra CAD 5 — Etapa 1 (tempo real, vistas ligadas, cubagem) — plano

> Executado em linha (superpowers:executing-plans), TDD por tarefa. Spec: `docs/superpowers/specs/2026-11-05-v5-tempo-real-documentos-design.md`.

**Goal:** greide do perfil comandando taludes em tempo real, estaca ativa ligando perfil/seções/planta/3D e tabela de cubagem ao vivo.

## Global Constraints
- Mensagens em português; núcleo puro em `src/core/` com teste analítico; 106 testes atuais continuam passando.
- Rótulo do app 5.0 (`package.json` 0.5.0); projeto salva `version: 7` e abre v1–v6.
- Arraste/edição ao vivo: malha a cada quadro, volume amostrado ~0,2 s com ≤ 12 mil células, completo ao soltar.

## Review Focus
1. Linha em modo `grade` sem eixo ou sem greide: aviso "Trace o eixo e crie o greide no perfil" e malha vazia, sem NaN.
2. Ponto da linha que se projeta além do fim do eixo: usa a cota da ponta do greide (sem extrapolar).
3. Estaca ativa fora do comprimento do eixo depois de redesenhar o eixo: é limitada ao comprimento.
4. Cubagem com uma só seção: tabela com a linha e volumes zero.
5. Desfazer logo após arrastar PVI: volta greide e taludes juntos.

### Task 1: `stationAt` e modo de cota `grade`
- `src/core/sections.js`: `stationAt(path, x, y) → {s, d}` (projeção no eixo; s limitado a [0, L]).
- `src/core/designLine.js`: modo `grade` válido; `buildLineBase(line, terrainAt, {path, gradeAt} = {})` usa `gradeAt(stationAt(path, v).s) − drop`; sem eixo/greide ⇒ `base: []` + aviso.
- `src/core/lineGrading.js`: `compileLine(line, terrainAt, gradeCtx)` com cache por (terrainAt, gradeCtx); `gradeLine`/`lineVolumes`/`lineElevationAt` recebem `gradeCtx`; `designSurfaceFunction(platforms, terrainAt, lines, gradeCtx)`.
- Testes: eixo (0,0)→(100,0), greide 100→110 ⇒ linha sobre o eixo z(50)=105; linha paralela em y=5 z(50)=105; ponto além do fim usa 110; sem greide ⇒ aviso.

### Task 2: cubagem por estaca
- `src/core/sections.js`: `cubageTable(sections) → [{station, cutArea, fillArea, cutVol, fillVol, accCut, accFill, balance}]`.
- Testes: áreas constantes (10 corte, 4 aterro) a cada 20 m em 5 seções ⇒ parciais 200/80, saldo final 480; uma seção ⇒ volumes 0.

### Task 3: interface
- `ProfileEditor.jsx`: prop `onGradeDraft(grade|null)` durante o arraste de PVI.
- `AppV4.jsx`: `gradeDraft` como rascunho (mesmo mecanismo do arraste de PIs); `gradeCtx` passado às linhas; estaca ativa `activeStation` compartilhada (perfil, seções, clique na linha de seção na planta), limitada ao comprimento; rótulo 5.0; salvar v7.
- `DesignLineCard.jsx`: opção "Seguir o greide do eixo" + desnível.
- `CubageTable.jsx` (novo): tabela + mini diagrama de massas; na vista Seções e sob o perfil.
- `ViewportV4.jsx`: plano translúcido + contorno ciano da seção ativa no 3D; linha da seção ativa destacada na planta.
- Verificação no navegador: eixo + greide + linha em modo greide; arrastar PVI muda o volume da linha durante o arraste; Ctrl+Z volta; estaca ativa sincroniza; JSON v7 salvo e reaberto; sem erros.
