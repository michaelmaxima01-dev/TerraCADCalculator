# Terra CAD 2 — duas vistas, um modelo

## Usar em outro computador, sem instalar dependências

1. Extraia **todo** o ZIP `terra-cad-v2-portatil.zip` em uma pasta. Não execute dentro do ZIP.
2. Instale Node.js 22.12 ou superior, se ainda não houver Node.js.
3. No Windows, abra `INICIAR-WINDOWS.cmd`. Em qualquer sistema, execute `node serve.mjs` nessa pasta.
4. Abra **http://127.0.0.1:4173/** no navegador. Mantenha o terminal aberto.

O pacote contém `dist/` já compilado. Não precisa de `npm install`, nem de internet para baixar bibliotecas durante o uso. Não abra `index.html` com duplo clique. O endereço local só funciona no computador em que o servidor está rodando. Se a porta estiver ocupada, feche a outra instância ou configure a variável `PORT` antes de iniciar. Os dados são processados no navegador.

## Novo fluxo de trabalho

- **Duas vistas**: planta 2D e superfície 3D lado a lado, com dados compartilhados e câmeras independentes. Em telas muito pequenas, os painéis são empilhados. Não são duas janelas independentes nem sincronização entre computadores.
- **3D limpo**: sem marcadores, rótulos ou arestas aparentes por padrão. Escolha Conceitual (cores por elevação), Sólido (sombreamento) ou Aramado (inspeção da triangulação). A grade 3D é opcional.
- **Planta 2D**: mira de largura/altura completas e caixa de seleção. Atração aos pontos exibe identificação e coordenadas. Ative/desative pontos, arestas, borda, linhas de ruptura e grade de referência.
- **Cor por grupo**: altere a cor dos marcadores de cada descrição. Os rótulos têm sua própria cor, tamanho e conteúdo.
- **Modelo automático**: alterações de pontos, linhas de ruptura e recorte recalculam o modelo, refletindo nas duas vistas.

## Corrigir o aspecto de leque/aranha

Não basta esconder as arestas. Delaunay sem restrições preenche o envoltório convexo dos pontos e pode atravessar áreas não levantadas.

1. Importe TXT/CSV/XYZ e confira as coordenadas e descrições.
2. Escolha **Contorno** e clique nos pontos do perímetro na ordem correta, inclusive reentrâncias. Pressione **Enter** para fechar e recortar. Não é necessário repetir o primeiro ponto.
3. Use **Ruptura** para ligar, em sequência, os pontos de uma feição real (BD, BE, crista, pé). Pontos já existentes sobre um segmento são incorporados à restrição. Um grupo pode ser interligado na ordem do arquivo, mas essa ordem precisa representar a feição; códigos iguais não determinam sozinhos a topologia.
4. Quando necessário, defina **Comprimento máximo da aresta**. O comprimento é planimétrico XY, nas unidades do arquivo. Zero desativa. Triângulos com qualquer lado maior que esse valor são removidos, podendo criar lacunas; isso não interpola novos dados nem descobre sozinho o contorno real.
5. Use **Inverter** para trocar uma diagonal interna válida, e **Aparar** para remover faces adjacentes a uma aresta.

O contorno é um único polígono simples, sem ilhas internas. Contornos cruzados são rejeitados. Linhas de ruptura e contorno não podem se cruzar sem vértice comum. Para cruzamentos, acrescente antes um ponto de interseção com cota adequada. Arestas de restrição são protegidas das edições manuais. O filtro de comprimento pode remover faces adjacentes às restrições; as linhas continuam salvas para o próximo recálculo.

## Salvar e continuar

**Salvar projeto** exporta JSON com pontos, triângulos editados, linhas de ruptura, contorno, limite de aresta e estilos/cores. **Abrir projeto** restaura o JSON, inclusive cortes e inversões. Aceita também o JSON exportado na versão 1. Exportar não grava automaticamente no disco original: guarde o arquivo baixado. Não há salvamento automático ao fechar/recarregar a página. Configurações de câmeras e layout não são persistidas.

**Desfazer** restaura até 20 operações da sessão. Alterar pontos ou recalcular refaz a triangulação, descartando inversões e cortes manuais anteriores; o contorno e as linhas de ruptura são preservados.

## Atalhos

| Tecla | Ação |
|---|---|
| V | Duas vistas |
| 2 / 3 | Planta / modelo 3D |
| Z | Enquadrar levantamento |
| N | Navegar |
| L | Linha de ruptura |
| B | Contorno |
| S | Inverter aresta |
| D | Aparar malha |
| F3 | Alternar atração aos pontos |
| Enter | Concluir linha ou contorno |
| Backspace | Retirar último ponto da seleção |
| Esc | Cancelar seleção e voltar à navegação |
| Ctrl+Z | Desfazer |
| Ctrl+S / Ctrl+O | Salvar / abrir projeto |

Os atalhos são desta aplicação e não representam compatibilidade integral com comandos do Civil 3D. Enquanto se edita um campo de texto ou número, os atalhos do projeto não interferem na digitação. Na planta, arraste para mover; no 3D, arraste para orbitar; scroll aproxima/afasta. Enquadrar restaura a câmera.

## Desempenho e limites

Importação e triangulação são executadas em Web Worker. Cada viewport mantém o próprio contexto WebGL; pontos e linhas usam buffers compartilhados por camada, em vez de um objeto por ponto. A superfície usa geometria indexada e normais suaves. A renderização acontece quando há interação ou alteração, sem laço gráfico contínuo em repouso. Rótulos são desenhados em uma camada Canvas, com limite de 200 e supressão de sobreposição; dar zoom permite consultar outros rótulos. Isso não elimina pontos nem modifica a geometria.

Um teste local do núcleo triangulou 10.000 pontos de uma grade em aproximadamente 3 segundos, com 19.602 triângulos. É uma medição nesta máquina, sem comparação formal com a versão anterior, sem medir o tempo total de renderização e sem garantia de resultado semelhante em outros equipamentos. Arquivos: até 10 MB para pontos, 30 MB para projetos. A validação de muitas restrições ainda pode ser custosa. O histórico consome memória; não há virtualização completa dos seletores de pontos. Grandes levantamentos exigem avaliação adicional.

Esta versão trata os módulos 1 e 2 e a visualização solicitada. Não entrega equivalência integral ao Civil 3D: curvas de nível, perfis, corredores, volumes, mineração paramétrica, hidrologia, DWG/DXF e reprojeção continuam fora desta etapa. O núcleo usa JavaScript; TypeScript/WebAssembly permanece pendente. As cores conceituais representam elevação, sem interpretação geológica ou materiais BIM. A captura do levantamento do usuário não incluía os dados de pontos: a correção da topologia desse caso específico depende de importar seu arquivo e definir suas restrições reais.

## Desenvolvimento

Na pasta de fontes: `npm ci`, `npm run dev`, `npm test`, `npm run build`. Node.js 22.12+. O servidor de uso (`serve.mjs`) utiliza somente módulos nativos do Node e serve a pasta `dist/`; não recebe uploads nem grava dados. O ZIP portátil contém também as fontes para continuidade do desenvolvimento. A versão anterior foi preservada em um backup separado.
