# Linha de projeto com PIs, curvas e afastamento em degrau (bancadas)

Data: 04/11/2026 · Estado: **proposta para revisão** · Origem: áudios do engenheiro e do chefe (transcrições em 04/11/2026)

## 1. Objetivo

Permitir que o engenheiro **desenhe uma linha flexível** (PIs editáveis, curvas de canto com raio, cota por rampa, por PI ou relativa ao terreno) e, **a partir dela, desça ou suba taludes com bancadas e bermas**, terminando no terreno ou numa profundidade/cota final. A mesma lógica de bancadas passa a valer na plataforma fechada já existente.

Casos de uso citados:

- **Recorte de morro:** traçar a linha no alto e descer as bancadas até uma cota base.
- **Corte de encosta** e **acessos:** linha aberta com talude para um lado até o terreno.
- **Tanques e cavas:** linha fechada com bancadas para dentro até o fundo.

### O que foi dito (resumo das transcrições)

1. "Gerar um traçado e jogar um offset nele: desce 3 m, afasta 2 ou 3 m, pela cota X."
2. "Incluir bancadas, incluir taludes; a partir de que altura começam (1 m, 2 m, 4 m, 8 m)."
3. "Inclua duas bermas na profundidade de 8 m; três bermas em 16 m"; "rampinhas de 2 por 2".
4. "Offset junto com a rampa, porcentagem de rampa."
5. "O mesmo no quadradinho (plataforma): gerar rampa com as bermas."
6. Chefe: "linha flexível, que ajuste ao terreno, com curvas e PIs que a gente possa manusear; depois o offset descendo as bancadas."
7. Resposta do usuário: o talude pode **terminar no terreno ou numa profundidade final — as duas opções, escolhidas em cada linha**.

### Interpretações a confirmar com o engenheiro

- **"Rampa"** tem dois sentidos: (a) a **face da bancada** ("2 por 2" = 2 m de altura por 2 m na horizontal) e (b) o **caimento longitudinal** da linha (%). A especificação atende os dois.
- **"A partir de X m"**: até a altura X o talude é contínuo; a **primeira berma** fica na altura X; as seguintes a cada altura de bancada.
- **"Desce 3 m pela cota X"**: a linha fica 3 m abaixo da referência (terreno ou cota X) e o afastamento é a distância horizontal da face.

## 2. Abordagem escolhida

**Linha de projeto ligada ao motor atual de taludes** (opção A, aprovada em 04/11/2026). O modelo de distância já validado para plataformas (`z = Zb ± subida(d)`, com Zb = cota da base no ponto mais próximo) é generalizado para uma **base que pode ser aberta ou fechada**. Uma linha fechada com talude para fora é a plataforma atual. Malha, volumes, seções, perfil e exportação reaproveitam o mesmo código.

Descartadas: comando avulso de "stepped offset" (sem recálculo ao editar; volume exigiria superfície × superfície) e corredor com seção-tipo (próprio de estrada e ferrovia; fica para outro ciclo).

## 3. Modelo de dados (projeto JSON v6)

Campo novo `designLines` (lista). Plataformas ganham regras de bancada e término. Versões 1–5 continuam abrindo (`validateProject`); o salvamento passa a `version: 6`.

```js
designLine = {
  id, name, visible: true,
  closed: false,                       // aberta ou fechada
  pis: [{x, y, z?, radius?}],          // z: cota no PI (modo 'pis'); radius: curva de canto (m), PIs internos
  elevation: {
    mode: 'ramp' | 'pis' | 'terrain',  // cota inicial + rampa | cota em cada PI | terreno − desnível
    start: 120.0,                      // 'ramp': cota no 1º PI
    slope: -2.0,                       // 'ramp': rampa longitudinal em %, ao longo da estaca (negativo desce)
    drop: 3.0                          // 'terrain': cota da linha = terreno no PI − drop (m)
  },
  side: 'left' | 'right' | 'both' | 'outside' | 'inside',  // aberta: esq./dir./ambos (no sentido do traçado); fechada: fora/dentro
  cutSlope: 1.0, fillSlope: 1.5,       // H:V das faces de corte e de aterro
  benches: Bench,                      // igual ao da plataforma (abaixo)
  end: {mode: 'terrain' | 'depth', depth: 8.0, floorZ: null}  // 'depth': desce `depth` m a partir da linha, ou até a cota `floorZ` se informada
}

Bench = {
  enabled: false,
  height: 10,          // altura de cada bancada (m)
  width: 5,            // largura da berma (m)
  apply: 'cut'|'fill'|'both',
  startAfter: 0,       // NOVO: talude contínuo até esta altura; 1ª berma nela (0 = 1ª berma em `height`)
  count: null          // NOVO: N bermas; com end.depth, height = depth / (N + 1) (calculado; `height` é ignorado)
}

platform = {..., benches: Bench, end: {mode: 'terrain' | 'depth', depth, floorZ}}  // `end` NOVO (padrão 'terrain')
```

Regras de validação: pelo menos 2 PIs (aberta) ou 3 (fechada) e sem auto-interseção. Raio ≥ 0 e só em PIs internos (ou em todos, se fechada). Altura e largura como hoje. `count` inteiro de 1 a 50, aceito só com `end.mode = 'depth'` (sem profundidade não há como dividir). `depth > 0`. Mensagens em português dizendo o que corrigir.

## 4. Geometria

### 4.1 Linha: curvas, estaqueamento e cotas

- **Curva de canto:** em cada PI com raio R > 0, a curva circular é tangente aos dois segmentos (ponto de curva/tangente à distância T = R·tan(Δ/2) do PI). Se T passar da metade de um segmento vizinho, o raio é **reduzido automaticamente** e o painel avisa ("raio limitado a X m no PI n"), como já acontece com a curva vertical L.
- **Discretização:** o arco vira cordas com erro de flecha ≤ 2 cm (ou passo ≤ 3°), formando a **polilinha de base**.
- **Estaca s** = comprimento 2D acumulado ao longo da polilinha de base, incluindo os arcos.
- **Cota da linha z(s):**
  - `ramp`: `start + slope/100 · s`;
  - `pis`: interpolação linear por estaca entre as cotas dos PIs. Ao longo de um arco, a cota varia linearmente entre os pontos de curva e de tangente, com o PI no meio;
  - `terrain`: cota do terreno em cada PI − `drop`, interpolada como em `pis`. Se o PI estiver fora do terreno, o painel avisa e a linha não é gerada.

### 4.2 Lado e pontas

- O ponto mais próximo na base dá a distância d, a estaca s e o lado (sinal do produto vetorial no segmento).
- **Linha aberta:** só recebe talude o lado escolhido. As **pontas são retas** (o talude termina no plano perpendicular à linha em cada extremidade); sem arredondamento nas pontas.
- **Linha fechada:** `outside` = plataforma atual (interior = superfície da plataforma, na cota dos PIs); `inside` = cava (os taludes descem para dentro e o interior, além do fundo, fica no fundo).

### 4.3 Subida do talude com bancadas (generaliza `slopeRise`)

Para a distância horizontal d a partir da base, a altura vencida é `rise(d)`:

- **Sem bancadas:** `rise = d / H`.
- **Com bancadas** (altura h, berma w, face H:V, início s₀ = `startAfter`):
  - se s₀ > 0: face contínua até a altura s₀, depois berma w e, a partir daí, bancadas de altura h + berma w;
  - se s₀ = 0: bancadas desde o começo (como hoje);
  - **por quantidade:** com `count = N` e profundidade D, `h = D / (N + 1)`. Ficam N bermas e N + 1 faces, e a última face termina exatamente no fundo. Com `floorZ` e linha em rampa, D varia ao longo da linha (D = z_base − floorZ), e h é calculado ponto a ponto. Com `count`, `startAfter` é ignorado.

As funções `slopeRise`, `slopeReach` e `slopeBreaks` passam a receber `startAfter` e o `h` calculado. O comportamento atual é o caso s₀ = 0, sem `count`.

### 4.4 Término

- **`terrain`:** como hoje. Corte quando o terreno está acima da base (sobe até o terreno), aterro quando está abaixo (desce até o terreno). O fim é a linha de offset (*daylight*).
- **`depth`:** o talude **desce** a partir da base até `floorZ` (se informada) ou até `z_base − depth`, com bancadas. Depois segue um **fundo plano** nessa cota até encontrar o terreno. Na cava (`inside`), o fundo ocupa o interior que sobra. Se o fundo não encontrar o terreno dentro da superfície, ele para no limite da TIN e o painel avisa.

O volume é sempre a diferença entre terreno e projeto (corte onde o terreno está acima, aterro onde está abaixo), integrada na mesma grade usada hoje.

### 4.5 Malha, linhas de crista e pé

O lançamento de raios e a costura entre raios de `gradePlatform` são extraídos para uma função comum (`castSlopes(base, {closed, side, rule})`), usada pela plataforma e pela linha. Cada raio guarda vértices em cada quebra (crista e pé de berma, início do fundo, offset).

Saídas:
- `vertices`, `triangles`, `types` (`cut`, `fill`, `bench`, `floor`, `platform`);
- `daylight`;
- `benchLines` (crista e pé);
- `floorOutline`;
- avisos e estatísticas.

## 5. Interface

**Ferramenta nova "Linha de projeto" (tecla `T`)** no trilho de ferramentas:
- clique para lançar PIs, com atração; `Enter` conclui aberta;
- clicar no 1º PI fecha;
- `Backspace` retira o último; `Esc` cancela.

**Edição na planta**, com a linha selecionada:
- PIs viram alças quadradas; **arrastar** move o PI, com atração (Alt desliga);
- clicar num trecho insere um PI;
- botão direito ou `Delete` remove;
- cada arraste concluído é um passo de desfazer;
- vale também para os **vértices das plataformas** (item do backlog).

**Painel Projeto → "Linhas de projeto"**, um cartão por linha:
- **Básico:** nome, aberta ou fechada, lado, ativa.
- **Cota:** modo (rampa / cota nos PIs / terreno − desnível) e seus campos.
- **Tabela de PIs:** estaca, cota (modo `pis`) e raio da curva.
- **Taludes:** H:V de corte e de aterro, com a face mostrada também como "altura × afastamento" (ex.: 2 × 2).
- **Bancadas:** ligar, altura, berma, aplicar em, "a partir de X m" e "por quantidade: N bermas" (este último só no término por profundidade).
- **Término:** até o terreno, ou profundidade / cota final.
- **Resultados:** volumes (corte, aterro, saldo, área), alturas máximas e avisos.

**Plataforma:** ganha "a partir de X m", "por quantidade" e "término por profundidade" nas bancadas.

**Vistas:**
- **Planta:** linha com estacas, curvas destacadas, hachura de corte/aterro, crista/pé em amarelo, offset em verde e contorno do fundo.
- **3D:** faces coloridas por tipo.
- **Perfil e Seções:** consideram linhas e plataformas (a primeira que cobre o ponto vale, como hoje).

**Desempenho no arraste:**
- recálculo com grade reduzida (≤ 30 mil células) a cada quadro, por `requestAnimationFrame`;
- cálculo completo ao soltar;
- meta: < 100 ms por quadro com 10 mil pontos de terreno e 50 PIs;
- se não for atingida, o cálculo vai para o Worker.

## 6. Exportação

- **DXF:**
  - `TC_LP_EIXO` (linha 3D);
  - `TC_LP_CRISTA` e `TC_LP_PE` (bermas);
  - `TC_LP_OFFSET`;
  - `TC_LP_FUNDO`;
  - faces em `TC_TALUDE_CORTE`, `TC_TALUDE_ATERRO`, `TC_BERMA_FACE`, `TC_FUNDO`.
- **LandXML:** as linhas entram na superfície "Projeto".
- **Projeto JSON v6.**

## 7. Testes (resultado analítico)

1. **Arco:** comprimento = R·Δ; pontos de tangente a T = R·tan(Δ/2); raio grande demais é limitado e gera aviso.
2. **Rampa:** linha reta de 100 m com rampa −2% → z(100) = start − 2.
3. **Linha reta aberta sobre terreno plano, lado direito, término no terreno:** volume = área da seção (com e sem bermas, calculada à mão) × comprimento. Erro < 0,5% e pontas retas, sem acréscimo de cone.
4. **"2 bermas em 8 m":** h = 8/3; cristas nas alturas 8/3 e 16/3; fundo exatamente a 8 m.
5. **`startAfter = 4`, h = 5:** 1ª berma a 4 m, a seguinte a 9 m.
6. **Término por profundidade num morro cônico:** o fundo fica na cota pedida e o volume confere com a integração numérica fina do modelo.
7. **Cava (`inside`) quadrada de lado L, término por profundidade D sem bermas, terreno plano na cota da linha:** volume = ∫₀ᴰ A(z) dz, com o lado da seção na altura z igual a L − 2·H·z (A = (L − 2Hz)²). Fórmula fechada, erro < 0,5%.
8. **Mover um PI:** volume e malha mudam e o desfazer restaura exatamente o anterior.
9. **Compatibilidade:** projetos v1–v5 abrem; plataforma sem `end` usa `terrain`; os 65 testes atuais continuam passando.

## 8. Etapas de entrega

1. **Linha de projeto:**
   - traçado, PIs, curvas de canto, estaqueamento e modos de cota;
   - edição por arraste (inclusive vértices de plataforma);
   - talude contínuo até o terreno, para os lados escolhidos;
   - volumes, seções e exportação básica.
2. **Bancadas e término:**
   - "a partir de X m" e "N bermas em D";
   - término por profundidade com fundo e cava (`inside`);
   - as mesmas regras na plataforma;
   - camadas completas de exportação.

Cada etapa é entregue testada (`npm test`, `npm run build`, fluxo no navegador) num branch próprio.

## 9. Fora do escopo

- Clotoides (espirais de transição).
- Seção-tipo com componentes (corredor ferroviário ou rodoviário).
- Dormentes e postes com quantitativos.
- Combinação de linhas e plataformas sobrepostas (vale a primeira).
- Empolamento e contração.
- Linha que acompanha o terreno automaticamente (o modo `terrain` ajusta só a cota nos PIs).
