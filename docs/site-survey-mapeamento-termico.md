# Site survey: mapeamento térmico da sala

Roteiro para medir uma sala antes de instalar os sensores e escolher onde ficam. Cada preenchimento vira um registro de survey da sala (US06, #6), com anexos opcionais (PDF ou imagem). Os campos da última seção são a proposta para o formulário do painel (#130 backend, #131 frontend).

Os valores marcados como "proposta" não vêm de norma nem de medição do time: são sugestões para o time decidir na revisão.

## Checklist

### 1. Identificação

- [ ] Sala (a mesma cadastrada no painel) e finalidade: o que é guardado ou feito nela.
- [ ] Faixa de temperatura e de umidade esperada para a sala (a mesma do cadastro, se já existir).
- [ ] Data do survey e quem executou.

### 2. Dimensões da sala

- [ ] Comprimento, largura e pé-direito (altura do teto), em metros.
- [ ] Croqui da planta com as medidas, anexado (foto ou PDF).
- [ ] Obstáculos que alteram o ar: estantes, armários, divisórias.

### 3. Fontes de calor e de frio

- [ ] Fontes de calor: equipamentos, lâmpadas, janelas com sol direto, paredes externas. Posição de cada uma no croqui.
- [ ] Fontes de frio: ar-condicionado, câmara fria, ventilação. Posição e sentido do sopro.
- [ ] Equipamentos que ligam e desligam em ciclos (anotar horário, se conhecido).

### 4. Portas e aberturas

- [ ] Quantidade e posição de portas e janelas no croqui.
- [ ] Para onde cada porta dá: corredor, área externa, outra sala climatizada.
- [ ] Frequência aproximada de abertura (rara, algumas vezes ao dia, constante).

### 5. Circulação de ar

- [ ] Existe ventilação forçada ou ar-condicionado? Onde ficam as saídas e os retornos.
- [ ] Pontos com ar parado e pontos com corrente de ar direta (observados ou medidos).

### 6. Pontos medidos

- [ ] Lista dos pontos medidos, cada um com identificação, posição no croqui e altura.
- [ ] Equipamento usado nas medições e, se houver, data da última calibração.
- [ ] Ao menos um ponto perto de cada fonte de calor ou frio e um no centro da sala (proposta).

### 7. Duração das medições

- [ ] Data e hora de início e de fim.
- [ ] Intervalo entre leituras.
- [ ] A janela cobre a rotina da sala (horário de uso, noite, fim de semana, se aplicável). Duração mínima: proposta para o time decidir.

### 8. Ponto representativo

- [ ] Critério usado para escolher o ponto, escrito em texto livre. Exemplos de critério: ponto mais crítico (pior caso), ponto mais próximo da média da sala, ponto onde fica o produto guardado.
- [ ] Ponto escolhido e posição sugerida para o sensor (croqui, altura, distância de paredes e fontes).
- [ ] Justificativa: o que os dados medidos mostram sobre esse ponto em relação aos demais.
- [ ] Resultado do mapeamento anexado (planilha exportada, PDF ou imagem).

## Proposta de campos do formulário

Nomes em snake_case, no padrão de `backend/salas/models.py` (`sala_id`, `temperatura_min`, `temperatura_max`). Data e usuário que registrou são preenchidos pelo sistema (#130), assim como o histórico só de inclusão.

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `sala_id` | inteiro (FK `salas.id`) | sim | Vem da sala aberta no painel. |
| `executado_por` | texto curto | sim | Quem mediu. Pode diferir do usuário que registrou. |
| `comprimento_m` | decimal | sim | Metros, maior que 0. |
| `largura_m` | decimal | sim | Metros, maior que 0. |
| `pe_direito_m` | decimal | não | Metros, maior que 0. |
| `fontes_calor` | texto longo | não | Descrição e posição. |
| `fontes_frio` | texto longo | não | Descrição e posição. |
| `portas_aberturas` | texto longo | não | Quantidade, destino e frequência de abertura. |
| `circulacao_ar` | texto longo | não | Ventilação, ar parado, correntes. |
| `pontos_medidos` | lista de objetos | sim | Ao menos 1 item. Item: `identificacao` (texto, obrigatório), `posicao` (texto, obrigatório), `altura_m` (decimal, opcional), `temperatura_media` e `umidade_media` (decimais, opcionais). |
| `equipamento_medicao` | texto curto | não | Modelo e calibração, se houver. |
| `medicao_inicio` | data e hora | sim | |
| `medicao_fim` | data e hora | sim | Depois de `medicao_inicio`. |
| `intervalo_leitura_s` | inteiro | não | Segundos entre leituras. |
| `criterio_ponto_representativo` | texto longo | sim | Critério usado para escolher o ponto. |
| `ponto_representativo` | texto curto | sim | Deve ser a `identificacao` de um item de `pontos_medidos`. |
| `posicionamento_sugerido` | texto longo | sim | Onde instalar o sensor (posição, altura, distâncias). Aparece no histórico da sala. |
| `observacoes` | texto longo | não | |
| anexos | arquivos (PDF ou imagem) | não | Croqui e resultado do mapeamento. Tipos e limite de tamanho: definir na #130. |

### Para o time decidir

- Se `pontos_medidos` é lista estruturada (acima) ou texto livre. A lista permite validar `ponto_representativo`, mas dá mais trabalho no formulário.
- Duração mínima da medição e número mínimo de pontos: sem valor de referência adotado ainda.
- Se `executado_por` é necessário ou basta o usuário que registrou.
- Se o survey deve atualizar a faixa de temperatura e umidade da sala. Nesta proposta não atualiza: é só registro.
