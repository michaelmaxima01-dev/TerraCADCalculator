# Terra CAD 5 — tempo real, vistas ligadas, 3D com contraste e documentos

Data: 05/11/2026 · Estado: aprovado pelo usuário ("sim, só seguir a ideia que o script pede") · Origem: `Script_para_a_proxima_atualização.txt` (especificação V5 de outra IA) + conversa.

## Objetivo
Editar o projeto manualmente (greide no perfil, PIs, plataformas) e ver **em tempo real** os taludes, o 3D, as seções e a cubagem mudarem; ligar as vistas pela estaca; dar contraste ao 3D; e exportar documentos bonitos: **relatório PDF** e **pranchas DXF**.

## Decisões
- O greide comanda os taludes por um **modo de cota novo da linha de projeto**: `elevation.mode = 'grade'` — cota = greide do eixo na estaca do ponto projetado sobre o eixo − `drop`. Outras linhas e plataformas não mudam.
- Do documento de origem, o efeito é o que vale; schema "5.0-alpha" e shader GLSL próprio não são copiados (o projeto segue o JSON versionado; o visual sai dos materiais Three.js atuais).
- Relatório PDF = página de impressão vetorial (A4/A3, paisagem) com "Salvar como PDF" do navegador: sem dependências, offline e na Hostinger.
- Rótulo do app passa a **5.0**; projeto JSON **v7** (abre v1–v6), com `reportInfo` (dados da capa) e `plotSettings`.

## Etapa 1 — tempo real e vistas ligadas
1. **Cascata greide → taludes**: arrastar um PVI no perfil envia o greide-rascunho ao app; linhas em modo `grade` recalculam malha a cada quadro e volume amostrado (~0,2 s, grade reduzida), cálculo completo ao soltar (mesmo mecanismo do arraste de PIs).
2. **Estaca ativa compartilhada**: perfil (clique/arraste), seções (◀ ▶) e planta (clique numa linha de seção) mudam a mesma estaca; a planta destaca a linha da seção ativa; o 3D mostra um **plano translúcido vertical com contorno ciano** na estaca ativa, perpendicular ao eixo.
3. **Cubagem por estaca**: tabela com área de corte/aterro, volume parcial de corte/aterro (média das áreas entre estacas), acumulados e **saldo acumulado**, mais mini diagrama de massas; na vista Seções e embaixo do perfil; atualiza durante a edição.

## Etapa 2 — 3D com contraste e cálculo em segundo plano
4. Faces do projeto coloridas pela inclinação: planas (berma, fundo, plataforma) em cinza-gelo; rampas de corte laranja e de aterro azul, com **hachura técnica** (linhas finas no plano da face) e cristas/pés mais marcados; luz rasante.
5. Volumes da edição ao vivo calculados no **Worker** (terreno enviado uma vez por revisão; o arraste envia só a geometria editada); a tela não trava com nuvens grandes.

## Etapa 3 — documentos
6. **Relatório PDF** (botão em Exportar): capa (logo opcional, obra, cliente, local, responsável/CREA, data, revisão), resumo de volumes, planta da terraplenagem (SVG), perfil (SVG), seções em grade (SVG), tabela de cubagem e diagrama de massas, quadro de objetos (linhas/plataformas com parâmetros), notas de método e limites, cabeçalho/rodapé com número de página. Dados da capa editados numa janela e salvos no projeto.
7. **Pranchas DXF**: moldura A1 (841 × 594 mm) com carimbo (mesmos dados da capa), escala horizontal e vertical configuráveis (padrão 1:200 / 1:100). Prancha de **seções** em matriz (grade, régua, terreno, projeto, eixo, estaca, áreas C/A) e prancha do **perfil** (terreno, greide, PVIs, rampas, estacas, faixa de corte/aterro). Camadas `TC_PLOTA_MOLDURA`, `TC_PLOTA_TEXTO`, `TC_PLOTA_GRADE`, `TC_PLOTA_TERRENO`, `TC_PLOTA_PROJETO`, `TC_PLOTA_SECAO`.

## Testes (analíticos)
- Linha em modo `grade` sobre um eixo reto com greide linear: cota = greide; linha paralela deslocada usa a mesma estaca.
- Cubagem: áreas constantes A ⇒ parcial = A·Δs; saldo acumulado = Σ(corte − aterro).
- Prancha DXF: entidades dentro da moldura; coordenada de papel = (offset·1000/escala) conferida num ponto conhecido.
- Relatório: função pura que monta o HTML contém as seções e os números da cubagem.
- Projeto v7 abre v1–v6.

## Fora do escopo
Corredor com seção-tipo, clotoides, emissão de PDF binário próprio (usa a impressão do navegador), assinatura digital.
