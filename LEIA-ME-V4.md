# Terra CAD 4 — greide, linhas obrigatórias livres, taludes e navegação CAD

A versão 4 implementa o backlog recebido em 26/10/2026 sobre a base da V3 (curvas, volumes, perfil, DXF/LandXML), que continua inteira. Uso básico e triangulação: **LEIA-ME-V2.md**; curvas/volumes/exportação: **LEIA-ME-V3.md**.

## Novidades da 5.1 · acesso pelo gabarito e nota de serviço

**Gabarito de acesso (seção-tipo da via).** Trace o eixo (tecla P), crie o greide no perfil (tecla 4 → Criar greide) e, no painel **Projeto → Acesso · gabarito no eixo**, marque *Aplicar gabarito no eixo*. Defina largura da pista, caimento (%) abaulado ou para um lado, taludes de corte e aterro (H:V) e, se quiser, bermas, ou escolha um dos modelos prontos (acesso de mina, de serviço, estrada de caminhão fora de estrada). Arrastar um PVI no perfil move o corte e o aterro no 3D, nas seções e nos volumes **enquanto arrasta**.

**Nota de serviço.** Na vista Seções (tecla 5), a aba *Nota de serviço* traz, para cada estaca:
- cota do terreno e do greide no eixo, com a altura de corte (C) ou de aterro (A);
- de cada lado, o bordo da pista (afastamento e cota);
- de cada lado, o offset onde o talude encontra o terreno (afastamento a partir do eixo, cota e altura do talude).

Clique numa linha para ir à estaca. *Exportar CSV* (ou Exportar → Nota de serviço) gera a planilha para a topografia de campo. O intervalo das estacas é o das seções.

**Plataformas à mão livre.** Clique perto do 1º vértice (círculo verde "fechar", com ou sem atração) ou aperte Enter para fechar. A ferramenta continua ativa para desenhar a próxima, sem limite; Esc sai. Cliques repetidos são ignorados, e um vértice que faria o polígono se cruzar é recusado com aviso. Backspace retira o último vértice.

O projeto salvo passa a ser JSON **v8** (guarda o gabarito); continuam abrindo os projetos v1–v7.

## Usar sem instalar dependências
1. Extraia **todo** o `terra-cad-v4-portatil.zip`.
2. Node.js 22.12 ou superior.
3. Windows: `INICIAR-WINDOWS.cmd` · outros: `node serve.mjs`.
4. Abra **http://127.0.0.1:4173/** e mantenha o terminal aberto.

## Organização da tela
- **Abas laterais**: *Terreno* (pontos, malha, linhas obrigatórias, volume contra plano), *Projeto* (eixo/perfil, plataformas, seções), *Exibição* (navegação, atração, curvas, camadas, cores, rótulos), *Exportar*.
- **Abas de vista**: Planta 2D (2) · Duas vistas (V) · Modelo 3D (3) · **Perfil (4)** · **Seções (5)**. Nas vistas de planta, o perfil pode ficar acoplado embaixo (opção “Perfil acoplado”).
- Clique numa plataforma na planta para selecioná-la e abrir seus parâmetros.

## 1 · Edição no perfil longitudinal
- Trace o eixo na planta (**P**), abra o **Perfil (4)** e use **Criar greide** (PVIs no início e no fim do terreno).
- Modo **Editar greide**: clique para inserir PVI (a cota atrai à linha do terreno quando próxima); **arraste** qualquer PVI (Shift: só cota; Alt: sem atração); **botão direito** ou **Delete** remove.
- Tabela de PVIs: estaca, cota e **comprimento de curva vertical L** editáveis; rampas de entrada/saída e **K** calculados. Curvas parabólicas simétricas; L é limitado automaticamente para não invadir os trechos vizinhos.
- O gráfico mostra terreno, greide, tangentes das curvas, rampas (%), áreas de **corte/aterro** entre greide e terreno, perfil das plataformas (tracejado), cota de referência e as marcas das seções.
- Roda do mouse: zoom no cursor (Shift: só vertical). Arraste: mover. Clique sem arrastar: seleciona a seção mais próxima.
- Greide entra no desfazer (Ctrl+Z), é salvo no projeto e exportado como polilinha 3D (camada `TC_GREIDE`).

## 2 · Linhas obrigatórias livres e concordância da malha
- **Linha obrigatória (L)**: clique **nós** do levantamento ou **pontos livres** em qualquer lugar da superfície.
- Cada vértice livre recebe a cota interpolada da TIN atual. Com **“Assentar nos cruzamentos da TIN”** (padrão), também são criados vértices em cada cruzamento com arestas da malha. A retriangulação restrita respeita a linha **sem alterar a forma do terreno ao longo dela** (concordância). Os pontos criados recebem identificadores `RL001…` e descrição `RUPTURA`.
- Desligando o assentamento, só os vértices clicados são inseridos (útil quando a linha deve impor nova geometria).
- Linhas fora da superfície são recusadas com a coordenada do problema. Cruzamentos com outras linhas obrigatórias viram vértice comum automaticamente quando o assentamento está ligado.
- **Seções transversais** (aba Projeto → Seções): intervalo e meia largura configuráveis; linhas desenhadas na planta; visualizador com terreno, projeto, greide no eixo, áreas de corte/aterro por seção, navegação ◀ ▶ / setas e volume por média das áreas extremas. Escala 1:1 opcional.

## 3 · Plataformas com taludes (terraplenagem)
- **Plataforma (G)**: desenhe a polilinha fechada na planta (com atração) e pressione **Enter**. A plataforma nasce na cota média do terreno, com taludes **1:1 em corte** e **1,5:1 em aterro** (H:V).
- Painel *Projeto*: nome, cota, inclinações de corte e aterro, ativar/ocultar, **Cota média**, **Equilíbrio** (corte ≈ aterro), excluir. Volumes de corte, aterro, saldo, área ocupada e alturas máximas são recalculados a cada alteração.
- Modelo geométrico: plataforma horizontal; fora dela a superfície de projeto é `cota ± distância / (H:V)` até encontrar o terreno (linha de **offset**). Cantos convexos ficam arredondados e cantos reentrantes não sobrepõem taludes. Volumes exatos validados por fórmula analítica (inclusive em plataforma em L).
- Planta: plataforma, hachura de talude (laranja = corte, azul = aterro) e linha de offset (verde). 3D: plataforma e taludes coloridos; o terreno sob a terraplenagem é recortado.
- Exportação: DXF com `TC_PLATAFORMA`, `TC_TALUDE_CORTE`, `TC_TALUDE_ATERRO`, `TC_PLAT_BORDA`, `TC_OFFSET`; LandXML com uma segunda superfície **Projeto**.
- Limitações: plataforma plana (sem rampas internas), sem bermas, sem empolamento/contração; plataformas sobrepostas não são combinadas (vale a primeira da lista).

## 4 · Navegação e atração estilo CAD
- **Zoom suave em direção ao cursor** na planta, no 3D e nos gráficos. Cada passo da roda é maior e animado (sensibilidade ajustável em *Exibição*).
- Arraste com inércia leve (planta: mover; 3D: orbitar).
- **Atração (F3)** com modos **□ Nó**, **◇ Vértice**, **△ Ponto médio** e **⧖ Mais próximo**, abertura ajustável em pixels e marcador com o tipo e o identificador do ponto. Prioridade: nó/vértice → ponto médio → mais próximo. Ativa nas ferramentas de desenho (linha, contorno, eixo, plataforma).
- Linha elástica durante o desenho com a distância do segmento; a leitura de coordenadas mostra a cota do terreno e a cota do projeto sob o cursor.

## Atalhos
| Tecla | Ação |
|---|---|
| 2 / V / 3 / 4 / 5 | Planta / Duas vistas / 3D / Perfil / Seções |
| L · B · P · G | Linha obrigatória · Contorno · Eixo · Plataforma |
| S · D · N | Inverter · Aparar · Navegar |
| C · F3 · Z | Curvas · Atração · Enquadrar |
| Enter · Backspace · Esc | Concluir · retirar último · cancelar |
| Delete (perfil) | Remover PVI selecionado |
| ◀ ▶ / setas (seções) | Seção anterior / próxima |
| Ctrl+Z · Ctrl+S · Ctrl+O | Desfazer · salvar · abrir |

## Projeto (JSON versão 4)
Grava terreno e edições, eixo, **greide**, **plataformas**, configuração de seções, curvas, estilos e cota de referência. Abre também v1, v2 e v3.

## Verificação desta versão
- **44 testes automatizados** (`npm test`); os 17 novos incluem resultados analíticos: curva vertical (cota no meio = PVI + A·L/8, continuidade da rampa), volume de aterro em plataforma quadrada = prisma + taludes + cone de canto (erro < 0,3%), espelho em corte, plataforma em L com canto reentrante (diferença < 0,05 m³ da fórmula), linha obrigatória livre preservando exatamente um plano inclinado após a retriangulação, duas linhas livres cruzadas ganhando vértice comum, recorte do terreno sob a terraplenagem, áreas de seção, prioridade da atração e exportação DXF/LandXML com a superfície de projeto.
- Interface testada em navegador (Chromium): zoom ancorado no cursor (planta e 3D), órbita, eixo, plataforma com atração a nó, alteração de cota, **Equilíbrio** (corte 3.612,6 × aterro 3.613,5 m³), linha obrigatória livre (11 pontos assentados), greide criado, PVI inserido, arrastado e com curva vertical, seções navegadas, DXF/LandXML exportados, projeto v4 salvo e reaberto, sem erros no console.
- Medição com 10.000 pontos: malha de talude ≈ 0,09 s; volume da plataforma ≈ 0,12 s; 49 seções ≈ 0,14 s; linha obrigatória livre ≈ 0,07 s; 1.000 consultas de atração ≈ 0,03 s.

## Ainda fora desta etapa
Plataformas com rampa/greide próprio e bermas; corredor (seção-tipo varrida ao longo do eixo); curvas horizontais no eixo; volume entre superfícies quaisquer (terreno × levantamento posterior); edição de vértices da plataforma por arraste; importação DXF.

## Desenvolvimento
Entrada `src/v4.jsx` → `src/AppV4.jsx`; renderer `src/components/ViewportV4.jsx`; `ProfileEditor.jsx`, `SectionViewer.jsx`. Núcleo novo: `src/core/grade.js`, `breaklines.js`, `grading.js`, `sections.js`, `snap.js`. Versões anteriores (V1–V3) preservadas fora da entrada. `npm ci`, `npm run dev`, `npm test`, `npm run build`. Node.js 22.12+.

## Linha de projeto e bancadas (novembro/2026)
- **Linha de projeto (T)**: clique os PIs; Enter conclui aberta, clicar no 1º PI fecha. No painel *Projeto → Linhas de projeto*: traçado aberto/fechado, lado do talude (direita, esquerda, ambos; fechada: para fora ou para dentro/cava), cota da linha (cota inicial + rampa %, cota em cada PI ou terreno − desnível) e a tabela de PIs com estaca, cota e **raio da curva de canto**.
- **Editar arrastando**: selecione a linha (ou uma plataforma) e arraste os quadrados dos PIs/vértices na planta (atração ligada; Alt desliga). Clique num trecho para inserir um PI; botão direito ou Delete remove; Esc cancela; Ctrl+Z desfaz. Arraste que faz a linha se cruzar é recusado.
- **Bermas**: altura da bancada e largura da berma, **a partir de X m** (talude contínuo até essa altura) ou **por quantidade** (N bermas iguais na profundidade, ex.: 2 bermas em 8 m → bancadas de 2,67 m).
- **Término do talude**: até encontrar o terreno, **descer uma profundidade** ou **descer até uma cota final**; depois o fundo segue plano até o terreno (na cava, o fundo ocupa o interior). Vale para linhas e plataformas.
- **Exportação DXF**: `TC_LP_EIXO`, `TC_LP_OFFSET`, `TC_LP_CRISTA`, `TC_LP_PE`, `TC_LP_FUNDO`, faces `TC_FUNDO` e `TC_BERMA_FACE`. Projeto JSON **v6** (abre v1–v5).
