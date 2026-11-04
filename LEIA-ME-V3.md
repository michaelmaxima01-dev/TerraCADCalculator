# Terra CAD 3 — curvas, volumes, perfil e exportação para CAD

A versão 3 mantém todo o fluxo da versão 2 (planta + 3D, contorno, rupturas, inverter/aparar, estilos, atalhos) e acrescenta os primeiros módulos de projeto. Instruções de uso básico, limites da triangulação e correção do “efeito leque/aranha” continuam em **LEIA-ME-V2.md**.

## Usar sem instalar dependências

1. Extraia **todo** o `terra-cad-v3-portatil.zip` em uma pasta.
2. Instale Node.js 22.12 ou superior, se ainda não houver.
3. No Windows, abra `INICIAR-WINDOWS.cmd`. Em qualquer sistema: `node serve.mjs`.
4. Abra **http://127.0.0.1:4173/** e mantenha o terminal aberto.

## Novidades

### 03 · Curvas de nível
- Geradas automaticamente da TIN atual: acompanham contorno, rupturas, limite de aresta, inversões e cortes manuais.
- **Intervalo** (unidades do arquivo) e **Mestra a cada** N curvas. Mestras mais escuras na planta, com rótulo de cota.
- Visíveis na planta e/ou no 3D. Tecla **C** liga/desliga.
- Convenção: a curva na cota mínima exata da superfície não é desenhada (coincide com vértices); a curva na cota máxima aparece sobre a borda. Limite de 2.000 cotas por geração — intervalos menores mostram aviso.

### 04 · Volumes e áreas
- Área plana (2D), área superficial (3D), cota mínima e máxima da superfície.
- **Cota de referência (plataforma)**: calcula **corte** (terreno acima da cota) e **aterro** (vazio abaixo da cota), áreas de cada um e o saldo.
- **Equilíbrio** sugere a cota em que corte ≈ aterro.
- O cálculo é exato para a TIN (integração por triângulo recortado na cota). Não considera empolamento, compactação, taludes nem camadas.
- No 3D, o plano de referência aparece translúcido, limitado à área da superfície.

### 05 · Perfil longitudinal
- Ferramenta **Perfil (P)**: clique os vértices do traçado na planta (com atração aos pontos, ou livre com F3 desligado) e pressione **Enter**.
- Gráfico com estacas no formato `km+metros`, cotas, rampa máxima, exagero vertical, linha da cota de referência e leitura ao passar o mouse.
- O perfil é amostrado em cada cruzamento com arestas da TIN; trechos fora da superfície aparecem como interrupção.
- No 3D, o traçado é desenhado sobre o terreno. O traçado é salvo no projeto e entra no desfazer.

### 06 · Visualização
- Novo estilo **Hipsométrico** (faixas de cor por cota).
- A leitura de coordenadas na planta mostra também a **cota interpolada da TIN** sob a mira.

### 09 · Exportar para CAD
- **DXF R12** (AutoCAD, Civil 3D, BricsCAD, QGIS): TIN em 3DFACE, pontos por grupo (camadas `TC_PT_<descrição>`), rótulos, curvas mestras/intermediárias como polilinhas 3D na cota, linhas de ruptura, contorno e traçado do perfil. Camadas prefixadas `TC_`.
- **LandXML 1.2**: superfície TIN com contorno, para importar no Civil 3D (Prospector › Superfícies › Importar LandXML).
- **CSV** `P;E;N;Z;D` dos pontos, reimportável no Terra CAD.

## Projeto (JSON versão 3)
Salvar projeto passa a gravar também: traçado do perfil, configuração das curvas e cota de referência. Abrir projeto aceita as versões 1, 2 e 3.

## Atalhos novos
| Tecla | Ação |
|---|---|
| P | Traçar perfil |
| C | Curvas de nível liga/desliga |
| Enter | Concluir perfil (além de linha e contorno) |
| Backspace | Retirar último vértice do perfil |

## Verificação desta versão
- 27 testes automatizados do núcleo (`npm test`), incluindo resultados analíticos: curvas de um plano inclinado nas abscissas exatas, laço fechado em torno de um pico, corte/aterro de 12.500 m³ em superfície linear conhecida, perfil com interpolação exata e lacunas, DXF bem formado, LandXML e CSV de ida e volta.
- Interface testada em navegador (Chromium): equilíbrio de volumes, traçado e leitura do perfil, exportações DXF/LandXML/CSV, salvar e reabrir projeto v3, abrir projeto v2 de exemplo, importar o CSV côncavo e recortar o contorno em L (área 700 m², corte+aterro somando a mesma área).
- Medição local com 10.000 pontos: curvas ≈ 0,1 s; volume ≈ 0,04 s; perfil ≈ 0,2 s; DXF ≈ 0,3 s (6,9 MB). A triangulação continua sendo a etapa mais lenta (≈ 3 s), como na versão 2.
- O DXF foi validado estruturalmente (códigos de grupo, entidades e EOF). Recomenda-se uma abertura de conferência no AutoCAD/Civil 3D com um levantamento real.

## Ainda fora desta etapa
Volume entre duas superfícies (terreno × projeto), taludes e plataformas com offset, seções transversais, alinhamentos com curvas horizontais e greide, importação DXF/DWG, reprojeção de coordenadas, ilhas no contorno, desempenho da triangulação acima de dezenas de milhares de pontos.

## Desenvolvimento
Entrada: `src/v3.jsx` → `src/AppV3.jsx`; renderer `src/components/ViewportV3.jsx`; gráfico `src/components/ProfileChart.jsx`. Núcleo novo em `src/core/contours.js`, `volumes.js`, `profile.js`, `exporters.js`. As versões 2 (`AppV2.jsx`, `ViewportV2.jsx`) e 1 ficam preservadas como referência, fora da entrada atual.
`npm ci`, `npm run dev`, `npm test`, `npm run build`. Node.js 22.12+.
