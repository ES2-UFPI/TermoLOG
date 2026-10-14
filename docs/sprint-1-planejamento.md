# TermoLOG — Planejamento das Iterações

> Cópia da página [Planejamento das Iterações](https://github.com/ES2-UFPI/TermoLOG/wiki/Planejamento-das-Itera%C3%A7%C3%B5es) da wiki. A wiki é a versão oficial.

## Atalhos

* [Sprint I](https://github.com/ES2-UFPI/TermoLOG/wiki/Planejamento-das-Itera%C3%A7%C3%B5es#sprint---1a-itera%C3%A7%C3%A3o)
* [Sprint II](https://github.com/ES2-UFPI/TermoLOG/wiki/Planejamento-das-Itera%C3%A7%C3%B5es#sprint---2a-itera%C3%A7%C3%A3o)

## Histórico de revisões deste documento

| Data | Versão | Descrição | Autor |
|---|---|---|---|
| 04/10/2026 | 1.0 | Criação do planejamento da Sprint I | Victor Kauan |
| 14/10/2026 | 1.1 | Detalhamento da Sprint I em issues | Victor Kauan |
| 14/10/2026 | 1.2 | Datas da disciplina, estimativa por atividade e pontos das histórias como soma das atividades | Victor Kauan |

## Estimativas

As atividades foram estimadas em story points na escala de Fibonacci (1, 2, 3, 5, 8, 13), considerando **complexidade**, **incerteza** e **esforço**. A atividade de referência, com 1 ponto, é a [#38](https://github.com/ES2-UFPI/TermoLOG/issues/38). Os pontos de cada história são a soma das suas atividades, e o valor de cada atividade aparece entre parênteses ao lado da issue. O responsável por cada atividade está atribuído na própria issue.

# Sprint - 1a Iteração

## Informações da Sprint

| Descrição | Valor |
|---|---|
| Data de início | 15/10/2026 |
| Data de término | 27/10/2026 |
| Duração (prevista) | 13 dias |
| Líder da Sprint | [Victor Kauan](https://github.com/victor-kauan-coder) |
| Total de pontos planejados | 55 |

**Meta:** cadastrar salas e sensores, definir a faixa de cada sala e acompanhar no painel, em tempo real, a temperatura e a umidade de todas as salas, com destaque para as que estão fora da faixa.

## Papéis

| Papel | Nome |
|---|---|
| Product Owner | [Victor Kauan](https://github.com/victor-kauan-coder) |
| Scrum Master / Líder da Sprint | [Victor Kauan](https://github.com/victor-kauan-coder) |
| Desenvolvedor/Revisor | [Davi Sousa](https://github.com/SoaresDavidson) |
| Desenvolvedor/Revisor | [João Pedro](https://github.com/AthomicalGD) |
| Desenvolvedor/Revisor | [Luanderson Carvalho](https://github.com/luan-crvlh) |
| Desenvolvedor/Revisor | [Victor Kauan](https://github.com/victor-kauan-coder) |

### Planejamento da Sprint I

| História de Usuário | Atividades planejadas na Sprint | Issue(s) | Pontos | Responsável(is) | Finalizada? |
|---|---|---|---:|---|:---:|
| Tarefas técnicas de base | Definir a stack; criar a estrutura do repositório e o padrão de branches; configurar o CI; definir a Definition of Done. | [#49](https://github.com/ES2-UFPI/TermoLOG/issues/49) (1), [#50](https://github.com/ES2-UFPI/TermoLOG/issues/50) (1), [#51](https://github.com/ES2-UFPI/TermoLOG/issues/51) (3), [#52](https://github.com/ES2-UFPI/TermoLOG/issues/52) (1) | 6 | [Davi Sousa](https://github.com/SoaresDavidson), [João Pedro](https://github.com/AthomicalGD), [Victor Kauan](https://github.com/victor-kauan-coder) | ⏳ |
| Coleta automática de temperatura e umidade por sala [#1](https://github.com/ES2-UFPI/TermoLOG/issues/1) | Configurar o Docker Compose (FastAPI + PostgreSQL); definir o contrato de envio de leituras; criar a tabela de leituras; criar o endpoint de ingestão em lote; ler o DHT22 no nó de borda; criar o simulador de nó central. | [#27](https://github.com/ES2-UFPI/TermoLOG/issues/27) (5), [#28](https://github.com/ES2-UFPI/TermoLOG/issues/28) (2), [#29](https://github.com/ES2-UFPI/TermoLOG/issues/29) (1), [#30](https://github.com/ES2-UFPI/TermoLOG/issues/30) (3), [#31](https://github.com/ES2-UFPI/TermoLOG/issues/31) (3), [#34](https://github.com/ES2-UFPI/TermoLOG/issues/34) (2) | 16 | [Davi Sousa](https://github.com/SoaresDavidson), [João Pedro](https://github.com/AthomicalGD), [Luanderson Carvalho](https://github.com/luan-crvlh) | ⏳ |
| Identificador único de sensor por sala [#4](https://github.com/ES2-UFPI/TermoLOG/issues/4) | Criar as tabelas de sala e sensor; gerar ID único e não reutilizável; criar os endpoints de salas e sensores; recusar leituras de sensores inválidos; criar o histórico por ID do sensor. | [#35](https://github.com/ES2-UFPI/TermoLOG/issues/35) (2), [#36](https://github.com/ES2-UFPI/TermoLOG/issues/36) (2), [#37](https://github.com/ES2-UFPI/TermoLOG/issues/37) (3), [#38](https://github.com/ES2-UFPI/TermoLOG/issues/38) (1), [#39](https://github.com/ES2-UFPI/TermoLOG/issues/39) (2) | 10 | [Luanderson Carvalho](https://github.com/luan-crvlh) | ⏳ |
| Faixas mínima e máxima de temperatura e umidade por sala [#11](https://github.com/ES2-UFPI/TermoLOG/issues/11) | Adicionar as faixas à sala; criar os endpoints de faixa; verificar se a leitura está na faixa; abrir alerta pendente fora da faixa; exibir a faixa no card da sala. | [#40](https://github.com/ES2-UFPI/TermoLOG/issues/40) (1), [#41](https://github.com/ES2-UFPI/TermoLOG/issues/41) (1), [#42](https://github.com/ES2-UFPI/TermoLOG/issues/42) (2), [#43](https://github.com/ES2-UFPI/TermoLOG/issues/43) (3), [#44](https://github.com/ES2-UFPI/TermoLOG/issues/44) (1) | 8 | [João Pedro](https://github.com/AthomicalGD) | ⏳ |
| Registros históricos somente leitura [#25](https://github.com/ES2-UFPI/TermoLOG/issues/25) | Bloquear alteração e exclusão de leituras e alertas no banco. | [#54](https://github.com/ES2-UFPI/TermoLOG/issues/54) (2) | 2 | [João Pedro](https://github.com/AthomicalGD) | ⏳ |
| Painel central com status de todas as salas [#9](https://github.com/ES2-UFPI/TermoLOG/issues/9) | Criar o projeto do frontend; criar o endpoint de status das salas; criar a tela do painel com um card por sala; destacar as salas fora da faixa; atualizar o painel automaticamente. | [#53](https://github.com/ES2-UFPI/TermoLOG/issues/53) (3), [#45](https://github.com/ES2-UFPI/TermoLOG/issues/45) (3), [#46](https://github.com/ES2-UFPI/TermoLOG/issues/46) (3), [#47](https://github.com/ES2-UFPI/TermoLOG/issues/47) (2), [#48](https://github.com/ES2-UFPI/TermoLOG/issues/48) (2) | 13 | [Victor Kauan](https://github.com/victor-kauan-coder) | ⏳ |

O envio das leituras por LoRa ([#32](https://github.com/ES2-UFPI/TermoLOG/issues/32)) e do nó central para a API ([#33](https://github.com/ES2-UFPI/TermoLOG/issues/33)), com 8 pontos cada, ficou para a Sprint II: são as atividades de maior risco e dependem da definição do nó central. Nesta sprint, o simulador ([#34](https://github.com/ES2-UFPI/TermoLOG/issues/34)) faz esse papel.

## Sprint Review

A preencher no fechamento da sprint.

## Retrospectiva da Sprint

A preencher no fechamento da sprint.

## Avaliação de Desempenho

A preencher no fechamento da sprint.

# Sprint - 2a Iteração

**Período previsto:** 05/11/2026 a 17/11/2026. Histórias previstas: restante da US01 ([#32](https://github.com/ES2-UFPI/TermoLOG/issues/32), [#33](https://github.com/ES2-UFPI/TermoLOG/issues/33)), [US17](https://github.com/ES2-UFPI/TermoLOG/issues/17), [US10](https://github.com/ES2-UFPI/TermoLOG/issues/10), [US12](https://github.com/ES2-UFPI/TermoLOG/issues/12) e [US26](https://github.com/ES2-UFPI/TermoLOG/issues/26). O planejamento detalhado será feito no Sprint Planning II.
