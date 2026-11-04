# Observações recebidas — próxima versão

Registrado em 26/10/2026. O usuário posteriormente autorizou a nova versão, incluindo duas vistas simultâneas. A versão 2 implementa os controles de visualização, mira, contorno, limite de aresta, cores, atalhos e melhorias de desempenho descritos em LEIA-ME-V2.md. A equivalência integral ao Civil 3D continua como direção de produto, não como funcionalidade entregue.

## Visualização e geometria

- Na imagem enviada, a triangulação apresenta arestas longas atravessando áreas vazias e convergindo para pontos distantes, com aspecto de leque/aranha.
- O técnico solicita que as linhas acompanhem os pontos e as feições do levantamento, em vez de se prolongarem diretamente até pontos finais distantes.
- Análise preliminar: a imagem sugere triangulação sobre o envoltório convexo, possivelmente sem contorno de recorte e restrições suficientes. A causa precisa ser confirmada com o arquivo de pontos e as linhas de ruptura; esconder arestas não corrige a geometria.
- Vista 3D: apresentar a superfície limpa por padrão, sem marcadores, rótulos e arestas da triangulação aparentes.
- Vista 2D: mostrar pontos e linhas para inspeção e edição, com controles de visibilidade e estilo independentes da vista 3D.
- Melhorar a apresentação visual do projeto e disponibilizar representação conceitual com detalhes.
- Expressão “modelo aranha”: significado pendente de confirmação; pode se referir ao problema de arestas em leque ou a um modo de representação desejado. Não presumir equivalência com um recurso específico.

## Direção do produto

- Referência funcional desejada: Civil 3D, incluindo ferramentas, atalhos, estilos e alteração de cores dos pontos.
- Objetivo declarado: funcionalidades equivalentes, acrescidas de automação, praticidade e maior mobilidade na operação.
- Automatizar a geração e atualização dos modelos 3D.
- Melhorar desempenho, navegação e fluidez da aplicação.
- Transformar a referência ampla ao Civil 3D em um inventário verificável de funções e prioridades quando chegar a etapa de planejar a nova versão. Não tratar equivalência integral como entregue pela base atual.

## Material de referência

- Observação adicional literal: “Um curso que mostre as milhas, igual no CIVIL 3D, linha vertical, horizontal”. Interpretação provisória: cursor em mira com linhas vertical e horizontal, semelhante ao Civil 3D. Confirmar se “curso” significa cursor e se “milhas” significa mira ou malha/grade antes de implementar.

- Captura enviada nesta conversa: superfície verde com pontos e rótulos visíveis em 3D, arestas longas e triangulação em leque.
- A especificação completa anterior continua sendo referência para os módulos 1 a 8.

Histórico: estas observações foram inicialmente armazenadas sem alteração no código. Depois, o usuário pediu explicitamente o desenvolvimento da nova versão e acrescentou o modo de duas vistas.
