# TermoLOG — Priorização do Backlog: Must Have (MVP)

**Projeto:** [TermoLOG - Product Backlog](https://github.com/orgs/ES2-UFPI/projects/118)
**Data:** 13/10/2026

## Critério de priorização

Prioridade por **valor entregue ao cliente**. O cliente (farmácia, restaurante, infraestrutura de TI) adota o TermoLOG para resolver duas dores:

1. **Evitar perdas** de estoque ou de equipamento causadas por desvios de temperatura/umidade que ninguém percebeu a tempo.
2. **Conformidade regulatória**: ter registros confiáveis para apresentar à vigilância sanitária.

Cada história foi avaliada em três pontos: impacto direto nessas dores, quantas personas atende e quantas outras histórias dependem dela. As histórias **Must Have** formam o MVP, porque sem elas o produto não entrega valor.

## Histórias Must Have

| Ordem | Issue | História | Persona | Justificativa |
|:---:|:---:|---|---|---|
| 1 | [#1](https://github.com/ES2-UFPI/TermoLOG/issues/1) | Coleta automática de temperatura e umidade | Farmacêutica RT | Base de todo o sistema. Nenhuma outra funcionalidade existe sem dados coletados |
| 2 | [#4](https://github.com/ES2-UFPI/TermoLOG/issues/4) | ID único por sensor/sala | Gerente de TI | Habilitador técnico de baixo custo usado por alertas, painel e relatórios |
| 3 | [#11](https://github.com/ES2-UFPI/TermoLOG/issues/11) | Faixas de referência de temperatura e umidade | Farmacêutica RT | Define o que é "desvio". Sem ela não existem alertas nem indicação de conformidade |
| 4 | [#25](https://github.com/ES2-UFPI/TermoLOG/issues/25) | Registros de auditoria imutáveis | Farmacêutica RT | Garante validade dos dados perante a fiscalização. É mais barato fazer desde o início do que adaptar depois |
| 5 | [#9](https://github.com/ES2-UFPI/TermoLOG/issues/9) | Painel central de todas as salas | Farmacêutica RT | Valor visível imediato, útil para todas as personas |
| 6 | [#17](https://github.com/ES2-UFPI/TermoLOG/issues/17) | Notificação de desvios por e-mail, push ou Telegram | Gerente de TI | Ataca diretamente a dor nº 1 (evitar perdas). Sugestão: começar com um canal e expandir depois |
| 7 | [#10](https://github.com/ES2-UFPI/TermoLOG/issues/10) | Relatório de leituras para a vigilância sanitária (PDF, Excel ou CSV) | Farmacêutica RT | Exigência legal. Sem ela, a farmácia não pode adotar o produto |

> A ordem segue as dependências técnicas: coleta → identificação → faixas → persistência imutável → visualização → alerta → relatório.

## Critérios de aceite

### #1 — US01 · Coleta automática
- [ ] Sensor envia leitura de temperatura e umidade em intervalo configurável, sem intervenção humana.
- [ ] Cada leitura é gravada com data, hora e identificação da sala.
- [ ] Painel exibe a última leitura recebida de cada sala em tempo real.
- [ ] Sistema indica quando uma sala está sem leitura há mais tempo que o esperado.

### #4 — US04 · ID único por sensor
- [ ] Todo sensor cadastrado recebe um identificador único, não reutilizável.
- [ ] Alertas e relatórios sempre exibem o ID do sensor junto com o nome da sala.
- [ ] É possível buscar o histórico de um sensor pelo seu ID.

### #11 — US11 · Faixas de referência
- [ ] É possível definir faixa mínima e máxima de temperatura e umidade por sala.
- [ ] Qualquer leitura fora da faixa definida dispara o fluxo de alerta.
- [ ] A faixa configurada fica visível no painel e nos relatórios da sala.

### #25 — US25 · Registros imutáveis
- [ ] Registros de leitura e de alerta não possuem opção de edição ou exclusão na interface.
- [ ] Qualquer tentativa de alteração de um registro histórico é bloqueada pelo sistema.
- [ ] Registros podem apenas ser consultados e exportados, nunca modificados.

### #9 — US09 · Painel central
- [ ] Painel lista todas as salas cadastradas com temperatura, umidade e status atual.
- [ ] Salas fora da faixa ideal ficam visualmente destacadas (cor diferente).
- [ ] Painel atualiza automaticamente sem precisar recarregar a página.

### #17 — US17 · Canais de alerta
- [ ] Usuário pode selecionar um ou mais canais de notificação no seu perfil.
- [ ] Alerta é enviado pelo(s) canal(is) configurado(s) assim que o desvio é detectado.
- [ ] Falha no envio por um canal não impede o envio pelos demais canais configurados.

### #10 — US10 · Relatório PDF
- [ ] Relatório em PDF inclui nome da farmácia, sala, período selecionado e responsável técnico.
- [ ] Relatório traz a tabela de leituras do período com data e hora.
- [ ] Relatório pode ser gerado a partir de um intervalo de datas escolhido pelo usuário.

## Próximo incremento (Should Have)

Para referência: #12 + #26 (reconhecimento de alerta e ação corretiva, que se sobrepõem e devem ser unificadas), #16 (gráfico histórico), #14 (acesso mobile), #24 (perfis de acesso) e #7 (detecção de queda de energia).
