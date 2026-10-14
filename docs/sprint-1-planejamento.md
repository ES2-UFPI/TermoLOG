# TermoLOG — Planejamento das Iterações

> Cópia da página [Planejamento das Iterações](https://github.com/ES2-UFPI/TermoLOG/wiki/Planejamento-das-Itera%C3%A7%C3%B5es) da wiki. A wiki é a versão oficial.

## Atalhos

* [Critério de estimativa](https://github.com/ES2-UFPI/TermoLOG/wiki/Planejamento-das-Itera%C3%A7%C3%B5es#crit%C3%A9rio-de-estimativa)
* [Sprint I](https://github.com/ES2-UFPI/TermoLOG/wiki/Planejamento-das-Itera%C3%A7%C3%B5es#sprint---1a-itera%C3%A7%C3%A3o)
* [Sprint II (previsão)](https://github.com/ES2-UFPI/TermoLOG/wiki/Planejamento-das-Itera%C3%A7%C3%B5es#sprint---2a-itera%C3%A7%C3%A3o-previs%C3%A3o)

## Histórico de revisões deste documento

| Data | Versão | Descrição | Autor |
|---|---|---|---|
| 04/10/2026 | 1.0 | Criação do planejamento da Sprint I | Victor Kauan |
| 14/10/2026 | 1.1 | Detalhamento da Sprint I em issues, atualização dos títulos das histórias e da pontuação conforme o Product Backlog | Victor Kauan |
| 14/10/2026 | 1.2 | Datas alinhadas ao calendário da disciplina; estimativa de cada atividade em Fibonacci (Planning Poker); ajuste do escopo da Sprint I à capacidade do time; inclusão da US25 e das issues #53 e #54; Product Owner e meta da sprint | Victor Kauan |

## Visão geral

As histórias do [Product Backlog](https://github.com/orgs/ES2-UFPI/projects/118) foram priorizadas pelo valor entregue ao cliente: evitar perdas por desvios de temperatura e umidade e manter a conformidade perante a vigilância sanitária. A ordem de prioridade das histórias Must Have é **US01 → US04 → US11 → US25 → US09 → US17 → US10**, que também segue as dependências técnicas (coleta → identificação → faixas → registros imutáveis → painel → alerta → relatório).

A disciplina prevê duas iterações de desenvolvimento:

| Sprint | Período | Histórias |
|---|---|---|
| I | 15/10 a 27/10 | US01 (parcial), US04, US11, US25, US09 |
| II | 05/11 a 17/11 | US01 (restante), US17, US10, US12, US26 (previsão) |

As demais histórias continuam priorizadas no Product Backlog. As histórias US06, US22 e US23 ficaram fora deste semestre. A US15 foi incorporada à US10 (exportação em PDF, Excel ou CSV), e as histórias US02 e US08 foram retiradas do backlog.

## Critério de estimativa

As atividades de cada história foram estimadas em **story points**, com Planning Poker e escala de **Fibonacci (1, 2, 3, 5, 8, 13)**. Um story point junta três fatores:

| Fator | O que avaliamos |
|---|---|
| **Complexidade** | Quantas partes a atividade toca (banco, API, firmware, tela) e quão difícil é a lógica |
| **Incerteza (risco)** | Se o time já domina a tecnologia, se há decisão em aberto ou hardware envolvido |
| **Esforço** | Volume de trabalho: quantidade de código, testes e documentação |

Cada fator recebe **B** (baixo), **M** (médio) ou **A** (alto), e a combinação vira a carta:

| Pontos | Combinação típica | Exemplo no TermoLOG |
|:---:|---|---|
| **1** | B / B / B: mudança pequena e conhecida | Recusar leituras de sensor inativo (#38) — **atividade de referência** |
| **2** | Um fator M | Criar modelo e migration da tabela de leituras (#29) |
| **3** | Dois fatores M | Endpoints de cadastro de salas e sensores (#37) |
| **5** | Três fatores M, ou um A | Docker Compose com FastAPI, PostgreSQL e migrations (#27) |
| **8** | Complexidade e incerteza A | Comunicação LoRa entre nó de borda e nó central (#32) |
| **13** | Tudo A | Grande demais: a atividade deve ser quebrada antes de entrar na sprint |

Seguindo o processo dos slides, a atividade de **menor esforço (#38) recebeu 1 ponto como base**, e as outras foram comparadas a ela. Regras para quando não há consenso:

1. Se só uma pessoa jogou uma carta diferente, usa-se a média, arredondada para a carta de Fibonacci mais próxima.
2. Depois de 3 rodadas sem consenso, vale a carta escolhida por mais de 70% do time.
3. Se não houver maioria de 70%, a atividade é quebrada em atividades menores.

Os pontos de cada história são a **soma dos pontos das suas atividades**. As estimativas também estão no campo *Estimate* de cada issue no [quadro do projeto](https://github.com/orgs/ES2-UFPI/projects/118).

# Sprint - 1a Iteração

## Informações da Sprint

| Descrição | Valor |
|---|---|
| Data de início | 15/10/2026 |
| Data de término | 27/10/2026 |
| Duração (prevista) | 13 dias |
| Líder da Sprint | [Victor Kauan](https://github.com/victor-kauan-coder) |
| Total de pontos planejados | 61 |
| Quadro | [TermoLOG - Product Backlog](https://github.com/orgs/ES2-UFPI/projects/118) |

## Meta da Sprint

Ao fim da sprint é possível **cadastrar salas e sensores, definir a faixa de cada sala, receber leituras e ver no painel, sem recarregar a página, a temperatura e a umidade de todas as salas, com destaque para as que estão fora da faixa**. Os registros de leitura e de alerta já nascem imutáveis.

## Papéis

| Papel | Nome |
|---|---|
| Product Owner | [Victor Kauan](https://github.com/victor-kauan-coder) |
| Scrum Master / Líder da Sprint | [Victor Kauan](https://github.com/victor-kauan-coder) |
| Desenvolvedor e Revisor | [Davi Sousa](https://github.com/SoaresDavidson) |
| Desenvolvedor e Revisor | [João Pedro](https://github.com/AthomicalGD) |
| Desenvolvedor e Revisor | [Luanderson Carvalho](https://github.com/luan-crvlh) |
| Desenvolvedor e Revisor | [Victor Kauan](https://github.com/victor-kauan-coder) |

### Planejamento da Sprint I

| História de Usuário | Atividades planejadas na Sprint | Issue(s) | Pontos | Responsável(is) | Finalizada? |
|---|---|---|---:|---|:---:|
| Tarefas técnicas de base (não é história de usuário) | Definir a stack e registrar no README; criar a estrutura do repositório e o padrão de branches; configurar CI com build e testes a cada pull request; definir a Definition of Done do time. | [#49](https://github.com/ES2-UFPI/TermoLOG/issues/49), [#50](https://github.com/ES2-UFPI/TermoLOG/issues/50), [#51](https://github.com/ES2-UFPI/TermoLOG/issues/51), [#52](https://github.com/ES2-UFPI/TermoLOG/issues/52) | 6 | Equipe | ⏳ |
| Coleta automática de temperatura e umidade por sala [#1](https://github.com/ES2-UFPI/TermoLOG/issues/1) | Configurar o ambiente com Docker Compose (API FastAPI + PostgreSQL); definir o contrato de envio de leituras do nó central para a API; criar o modelo e a migration da tabela de leituras; criar o endpoint de ingestão de leituras em lote; ler temperatura e umidade do DHT22 no nó de borda; criar um simulador de nó central para testes sem hardware. | [#27](https://github.com/ES2-UFPI/TermoLOG/issues/27), [#28](https://github.com/ES2-UFPI/TermoLOG/issues/28), [#29](https://github.com/ES2-UFPI/TermoLOG/issues/29), [#30](https://github.com/ES2-UFPI/TermoLOG/issues/30), [#31](https://github.com/ES2-UFPI/TermoLOG/issues/31), [#34](https://github.com/ES2-UFPI/TermoLOG/issues/34) | 21 | Davi Sousa, João Pedro, Luanderson Carvalho | ⏳ |
| Identificador único de sensor por sala [#4](https://github.com/ES2-UFPI/TermoLOG/issues/4) | Criar os modelos e a migration de sala e sensor; gerar um identificador único e não reutilizável para cada sensor; criar os endpoints de cadastro e consulta de salas e sensores; recusar leituras de sensores não cadastrados ou inativos; criar o endpoint de histórico de leituras por ID do sensor. | [#35](https://github.com/ES2-UFPI/TermoLOG/issues/35), [#36](https://github.com/ES2-UFPI/TermoLOG/issues/36), [#37](https://github.com/ES2-UFPI/TermoLOG/issues/37), [#38](https://github.com/ES2-UFPI/TermoLOG/issues/38), [#39](https://github.com/ES2-UFPI/TermoLOG/issues/39) | 11 | Luanderson Carvalho | ⏳ |
| Faixas mínima e máxima de temperatura e umidade por sala [#11](https://github.com/ES2-UFPI/TermoLOG/issues/11) | Adicionar as faixas de temperatura e umidade ao cadastro de salas; criar os endpoints para definir e consultar a faixa de cada sala; verificar se cada leitura recebida está dentro da faixa; abrir um alerta pendente quando a leitura sair da faixa; exibir a faixa configurada no card da sala no painel. | [#40](https://github.com/ES2-UFPI/TermoLOG/issues/40), [#41](https://github.com/ES2-UFPI/TermoLOG/issues/41), [#42](https://github.com/ES2-UFPI/TermoLOG/issues/42), [#43](https://github.com/ES2-UFPI/TermoLOG/issues/43), [#44](https://github.com/ES2-UFPI/TermoLOG/issues/44) | 8 | João Pedro | ⏳ |
| Registros históricos somente leitura [#25](https://github.com/ES2-UFPI/TermoLOG/issues/25) | Bloquear alteração e exclusão de leituras e alertas direto no banco e não expor rotas de edição ou exclusão na API. | [#54](https://github.com/ES2-UFPI/TermoLOG/issues/54) | 2 | João Pedro | ⏳ |
| Painel central com status de todas as salas [#9](https://github.com/ES2-UFPI/TermoLOG/issues/9) | Criar o projeto do frontend (React Native + TypeScript, web); criar o endpoint com o status atual de todas as salas; criar a tela do painel com um card por sala; destacar visualmente as salas fora da faixa; atualizar o painel automaticamente sem recarregar a página. | [#53](https://github.com/ES2-UFPI/TermoLOG/issues/53), [#45](https://github.com/ES2-UFPI/TermoLOG/issues/45), [#46](https://github.com/ES2-UFPI/TermoLOG/issues/46), [#47](https://github.com/ES2-UFPI/TermoLOG/issues/47), [#48](https://github.com/ES2-UFPI/TermoLOG/issues/48) | 13 | Victor Kauan | ⏳ |
| **Total** | | | **61** | | |

### Estimativa de cada atividade

C = complexidade, I = incerteza, E = esforço (B = baixo, M = médio, A = alto).

| Issue | Atividade | C | I | E | Pontos | Justificativa |
|:---:|---|:---:|:---:|:---:|:---:|---|
| [#49](https://github.com/ES2-UFPI/TermoLOG/issues/49) | Definir a stack e registrar no README | B | B | B | 1 | Decisão já tomada na arquitetura; falta só registrar (concluída) |
| [#50](https://github.com/ES2-UFPI/TermoLOG/issues/50) | Estrutura do repositório e padrão de branches | B | B | B | 1 | Pastas, `.gitignore` e um texto no README |
| [#51](https://github.com/ES2-UFPI/TermoLOG/issues/51) | CI com build e testes a cada PR | M | M | B | 3 | Workflow do GitHub Actions e proteção da `main`; primeira vez do time com Actions neste projeto |
| [#52](https://github.com/ES2-UFPI/TermoLOG/issues/52) | Definition of Done | B | B | B | 1 | Lista curta, discutida e registrada |
| [#27](https://github.com/ES2-UFPI/TermoLOG/issues/27) | Docker Compose (FastAPI + PostgreSQL) e migrations | M | M | M | 5 | Junta três ferramentas (Docker, FastAPI, Alembic) e precisa funcionar na máquina de todos |
| [#28](https://github.com/ES2-UFPI/TermoLOG/issues/28) | Contrato de envio de leituras | B | M | B | 2 | Pouco código, mas exige acordo entre firmware e backend |
| [#29](https://github.com/ES2-UFPI/TermoLOG/issues/29) | Modelo e migration da tabela de leituras | B | B | M | 2 | Tabela simples com índice por sala e data/hora |
| [#30](https://github.com/ES2-UFPI/TermoLOG/issues/30) | Endpoint de ingestão em lote | M | M | M | 5 | Validação do lote, confirmação para o nó central limpar a fila e testes de sucesso e erro |
| [#31](https://github.com/ES2-UFPI/TermoLOG/issues/31) | Ler o DHT22 no nó de borda | M | A | B | 5 | Hardware físico, leituras com falha e deep sleep no ESP32 |
| [#34](https://github.com/ES2-UFPI/TermoLOG/issues/34) | Simulador de nó central | B | B | M | 2 | Script que gera leituras e força valores fora da faixa |
| [#35](https://github.com/ES2-UFPI/TermoLOG/issues/35) | Modelos e migration de Sala e Sensor | B | B | M | 2 | Duas entidades com relacionamento simples |
| [#36](https://github.com/ES2-UFPI/TermoLOG/issues/36) | ID único e não reutilizável do sensor | M | B | B | 2 | Constraint `UNIQUE` e desativação no lugar da exclusão, com testes |
| [#37](https://github.com/ES2-UFPI/TermoLOG/issues/37) | Endpoints de cadastro e consulta de salas e sensores | M | B | M | 3 | Dois recursos, várias rotas e validações |
| [#38](https://github.com/ES2-UFPI/TermoLOG/issues/38) | Recusar leituras de sensor não cadastrado ou inativo | B | B | B | 1 | **Referência**: uma verificação na ingestão e dois testes |
| [#39](https://github.com/ES2-UFPI/TermoLOG/issues/39) | Histórico de leituras por ID do sensor | M | B | M | 3 | Filtro por período e paginação |
| [#40](https://github.com/ES2-UFPI/TermoLOG/issues/40) | Faixas no cadastro de salas | B | B | B | 1 | Quatro campos, uma validação e uma migration |
| [#41](https://github.com/ES2-UFPI/TermoLOG/issues/41) | Endpoints de faixa da sala | B | B | B | 1 | Reaproveita as rotas de sala da #37 |
| [#42](https://github.com/ES2-UFPI/TermoLOG/issues/42) | Verificar se a leitura está na faixa | M | B | B | 2 | Lógica simples, mas com casos de borda e sala sem faixa |
| [#43](https://github.com/ES2-UFPI/TermoLOG/issues/43) | Abrir alerta pendente fora da faixa | M | M | B | 3 | Nova entidade e regra para não duplicar alertas do mesmo desvio |
| [#44](https://github.com/ES2-UFPI/TermoLOG/issues/44) | Exibir a faixa no card da sala | B | B | B | 1 | Só exibição, sobre o card da #46 |
| [#54](https://github.com/ES2-UFPI/TermoLOG/issues/54) | Bloquear alteração e exclusão de leituras e alertas | M | B | B | 2 | Trigger ou permissão no banco, com teste da tentativa de alteração |
| [#53](https://github.com/ES2-UFPI/TermoLOG/issues/53) | Criar o projeto do frontend | M | M | B | 3 | React Native com suporte web, configuração do cliente HTTP e do lint |
| [#45](https://github.com/ES2-UFPI/TermoLOG/issues/45) | Endpoint com o status de todas as salas | M | B | M | 3 | Consulta da última leitura de cada sala, junto com a faixa e o status |
| [#46](https://github.com/ES2-UFPI/TermoLOG/issues/46) | Tela do painel com um card por sala | M | M | B | 3 | Primeira tela do app, com estados de carregamento, erro e vazio |
| [#47](https://github.com/ES2-UFPI/TermoLOG/issues/47) | Destacar salas fora da faixa | B | B | M | 2 | Cores de status e indicador além da cor (acessibilidade) |
| [#48](https://github.com/ES2-UFPI/TermoLOG/issues/48) | Atualização automática do painel | B | M | B | 2 | Polling sem perder a posição da tela |

### Escopo e capacidade

Com todas as atividades da US01, a Sprint I somaria **77 pontos**. Isso fica acima do que equipes de tamanho parecido da disciplina planejaram para sprints de duas semanas (entre 52 e 63 pontos). Por isso, as duas atividades de maior incerteza da US01 passaram para a Sprint II:

| Issue | Atividade | C | I | E | Pontos | Por que saiu da Sprint I |
|:---:|---|:---:|:---:|:---:|:---:|---|
| [#32](https://github.com/ES2-UFPI/TermoLOG/issues/32) | Enviar leituras do nó de borda para o nó central via LoRa | A | A | M | 8 | Depende do hardware de rádio e da definição do nó central, que ainda está em aberto ([Pontos em Aberto](https://github.com/ES2-UFPI/TermoLOG/wiki/Arquitetura-Pontos-em-Aberto)) |
| [#33](https://github.com/ES2-UFPI/TermoLOG/issues/33) | Encaminhar leituras do nó central para a API via HTTPS | A | A | M | 8 | Depende da #32, de HTTPS no microcontrolador e de uma fila que não perde dados |

Assim, a Sprint I entrega uma **fatia vertical completa** (leitura → API → faixa → alerta pendente → painel), que pode ser demonstrada com o simulador (#34). A leitura real do DHT22 (#31) continua na Sprint I para reduzir cedo o risco do hardware. A US01 só é dada como concluída na Sprint II, quando o caminho físico até a API estiver pronto.

A US25 entrou porque vem antes da US09 na ordem de prioridade e custa pouco agora: fazer as tabelas nascerem imutáveis é bem mais barato do que adaptá-las depois. O critério de exportação da US25 será atendido junto com a US10.

## Avaliação do Desempenho

| Membro | Desempenho | Avaliação |
|---|---|---|
| Davi Sousa Soares | A preencher no fechamento da sprint | |
| João Pedro Saleh de Sousa | A preencher no fechamento da sprint | |
| Luanderson Oliveira de Carvalho | A preencher no fechamento da sprint | |
| Victor Kauan Da Silva Miranda | A preencher no fechamento da sprint | |

## Sprint Review

A preencher no fechamento da sprint.

## Retrospectiva da Sprint

A preencher no fechamento da sprint.

# Sprint - 2a Iteração (previsão)

Período: **05/11/2026 a 17/11/2026**. O planejamento detalhado e as estimativas serão feitos no Sprint Planning II. Previsão, na ordem de prioridade:

| História de Usuário | Observação |
|---|---|
| Coleta automática de temperatura e umidade por sala [#1](https://github.com/ES2-UFPI/TermoLOG/issues/1) | Restante da história: [#32](https://github.com/ES2-UFPI/TermoLOG/issues/32) e [#33](https://github.com/ES2-UFPI/TermoLOG/issues/33) (16 pontos) |
| Notificação de desvios por e-mail, push ou Telegram [#17](https://github.com/ES2-UFPI/TermoLOG/issues/17) | Consome os alertas pendentes criados na #43; começar por um canal |
| Relatório de leituras para a vigilância sanitária [#10](https://github.com/ES2-UFPI/TermoLOG/issues/10) | Também atende à exportação pedida na US25 |
| Reconhecimento de alertas com trilha de auditoria [#12](https://github.com/ES2-UFPI/TermoLOG/issues/12) | Se houver capacidade |
| Relatório de ações corretivas após alertas [#26](https://github.com/ES2-UFPI/TermoLOG/issues/26) | Se houver capacidade; pode ser feita junto com a US12 |
