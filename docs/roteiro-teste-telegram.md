# Roteiro de testes: bot do Telegram (#116)

Teste de ponta a ponta com a aplicação rodando e um bot de verdade: vincular um chat por link, receber o alerta e conferir o que a API registra. Baseado no código do bot (#116, já na `dev`), na configuração do bot (nome descoberto pelo token e comando `configurar_bot`) e no README (seção "Alertas pelo Telegram").

Critérios de aceite cobertos (`docs/priorizacao-must-have.md`, US17):

- Usuário seleciona um ou mais canais de notificação no seu perfil.
- O alerta é enviado pelo(s) canal(is) configurado(s) assim que o desvio é detectado.
- Falha no envio por um canal não impede o envio pelos demais.

**Todos os comandos usam `localhost:8000`.** As rotas seguem o Contrato de API da wiki (seção 2.2: `GET` e `PUT /auth/me/canais` e `POST /auth/me/canais/telegram/vinculo`). Em caso de dúvida sobre um campo, vale `/docs` (OpenAPI). O contrato prevê um único 503 no vínculo, `{"detail": "Telegram não configurado"}`; a causa real fica no log.

---

## 0. Preparação (uma vez)

### 0.1 Criar o bot

1. No Telegram, abra o [@BotFather](https://t.me/BotFather) e envie `/newbot`.
2. Escolha um nome e um username terminado em `bot` (ex.: `termolog_teste_bot`).
3. Anote o **token** (`123456:ABC...`). O username a API descobre sozinha pelo token.

> O token vale para **um** ambiente só. Se o mesmo bot estiver rodando em outro lugar (servidor, colega, outra máquina), cada um rouba as mensagens do outro (`getUpdates`). Use um bot só seu para este teste.

### 0.2 Configurar o `.env`

```bash
cp .env.example .env        # se ainda não existir
```

Acrescente:

```env
TELEGRAM_BOT_TOKEN=<token do BotFather>
TELEGRAM_POLLING=true
```

Sem espaços ao redor do `=`. `TELEGRAM_BOT_USERNAME` é opcional: só preencha para forçar um nome (e, se preencher, tem de ser o do bot do token).

### 0.3 Subir a aplicação

```bash
docker compose up -d --build
docker compose run --rm -w /code/backend backend alembic upgrade head
docker compose run --rm -w /code/backend backend alembic heads    # deve listar UMA head (a mais recente, hoje 0020)
```

No Git Bash do Windows, acrescente `MSYS_NO_PATHCONV=1` antes do `docker compose run ... -w /code/backend` (ele converte o caminho). No PowerShell não precisa.

### 0.3b Configurar o bot (`configurar_bot`)

```bash
docker compose run --rm -w /code/backend backend python -m notificacoes.configurar_bot --nome "TermoLOG - Teste" --descricao "Alertas do TermoLOG."
```

| # | Verificação | Esperado |
|---|---|---|
| 0.3b.1 | Saída do comando | `Token válido. Bot: @<seu_bot>`, `Feito: comando /start`, `Feito: nome`, `Feito: descrição`, `Link do bot: https://t.me/<seu_bot>`. Código de saída 0. O token **não** aparece. |
| 0.3b.2 | No Telegram, abra o bot e digite `/` | O menu mostra `/start`. |
| 0.3b.3 | Rode de novo com `--nome` | Se o Telegram recusar por limite de trocas, sai `Falhou: nome (...)`, os outros passos rodam e o código de saída é 1. |
| 0.3b.4 | Sem `TELEGRAM_BOT_TOKEN` no ambiente | `erro: TELEGRAM_BOT_TOKEN não configurado...` e código 2, sem chamar o Telegram. |
| 0.3b.5 | Token inválido | `erro: ... 401 ...` e código 1, sem o token na mensagem. |
| 0.3b.6 | Com `TELEGRAM_BOT_USERNAME` de outro bot | Aviso `TELEGRAM_BOT_USERNAME é @x, mas o token é do bot @y`. |
| 0.3b.7 | Texto acima do limite (`--nome` com 65 caracteres) | `erro: o nome passa de 64 caracteres` e código 2. |

### 0.4 Dados mínimos

Um usuário, uma sala com faixa, um gateway e um sensor.

```bash
# Usuário (pede a senha)
docker compose run --rm -w /code/backend backend python -m usuarios.criar_usuario --nome "Teste" --email teste@exemplo.com
# Administrador (necessário para criar gateways)
docker compose run --rm -w /code/backend backend python -m usuarios.admin_padrao      # termolog@exemplo.com
```

Atalho: `docker compose -f backend/scripts/simulador/compose.yaml run --rm simulador python3 seed.py` cadastra 2 gateways, 3 salas e 6 sensores.

Pelo `/docs` (botão **Authorize**) ou `curl`, faça login e guarde o token:

```bash
TOKEN=$(curl -s localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"teste@exemplo.com","senha":"<senha>"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")
```

> Confira o nome do campo do token na resposta em `/docs` (`SessaoAberta`). Ajuste o `python -c` se for diferente.

Depois cadastre (como administrador) e anote os ids: **sala** com faixa de temperatura (ex.: `temperatura_min: 2`, `temperatura_max: 8`), **gateway** (guarde a `chave_api`, só aparece uma vez) e **sensor** na sala.

Variáveis usadas nos passos abaixo: `TOKEN`, `GW_ID`, `GW_KEY`, `SENSOR_ID`.

### 0.5 Atalho para consultar o banco

```bash
alias psql_t='docker compose exec db psql -U termolog -d termolog'
```

---

## 1. Subida do bot

| # | Passo | Resultado esperado |
|---|---|---|
| 1.1 | `docker compose logs backend \| grep -i telegram` | Aparece `bot do Telegram buscando mensagens`. Nenhum traceback, e o token **não** aparece nos logs. |
| 1.2 | `curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo` | `"url": ""`. A API remove o webhook ao iniciar (sem isso o `getUpdates` dá 409). |
| 1.3 | Com **2 workers**, confira `docker compose logs backend` | Só **um** processo diz "buscando mensagens" (lock do PostgreSQL). |

---

## 2. Gerar o vínculo (`POST /auth/me/canais/telegram/vinculo`)

| # | Passo | Resultado esperado |
|---|---|---|
| 2.1 | Sem login: `curl -X POST localhost:8000/auth/me/canais/telegram/vinculo` | **401**. |
| 2.2 | Logado: `curl -X POST localhost:8000/auth/me/canais/telegram/vinculo -H "Authorization: Bearer $TOKEN"` | **201** com `codigo`, `link` (`https://t.me/<bot>?start=<codigo>`) e `expira_em` (~10 min à frente). |
| 2.3 | `psql_t -c "SELECT usuario_id, codigo_hash, expira_em FROM vinculos_telegram"` | 1 linha. O que fica no banco é o **hash**; o código em texto puro não aparece. |
| 2.4 | Peça um **segundo** vínculo | Continua 1 linha só (o anterior é invalidado) e o código novo é outro. |
| 2.5 | Sem `TELEGRAM_BOT_USERNAME` no `.env` (o normal), repita 2.2 | **201**, e o `link` usa o nome descoberto pelo token (`getMe`). |
| 2.6 | Remova `TELEGRAM_BOT_TOKEN`, recrie o backend e repita 2.2 | **503** `{"detail": "Telegram não configurado"}`, sem gerar código. Restaure depois. |
| 2.7 | Com um token **inválido** e sem username, repita 2.2 | O **mesmo** 503. O log do backend diz o motivo (`401 Unauthorized`) sem o token. Um segundo pedido em até 30 s nem consulta o Telegram de novo. |

---

## 3. Vincular o chat (fluxo principal)

Use sempre o código **mais recente** (2.4).

| # | Passo | Resultado esperado |
|---|---|---|
| 3.1 | Abra o `link` no Telegram e toque em **Iniciar** (ou envie `/start <codigo>`) | Em até ~25 s o bot responde: **"Chat vinculado ao TermoLOG. Os alertas vão chegar aqui."** |
| 3.2 | `curl localhost:8000/auth/me/canais -H "Authorization: Bearer $TOKEN"` | Lista com `{"tipo":"telegram","destino":"<chat_id>","ativo":true}`. |
| 3.3 | `psql_t -c "SELECT * FROM vinculos_telegram"` | **0 linhas**: o código foi consumido (uso único). |
| 3.4 | Reenvie o **mesmo** `/start <codigo>` | Bot responde **"Código inválido ou expirado. Gere um novo link no painel do TermoLOG."** O canal não duplica. |

### 3A. Casos de borda do vínculo

| # | Passo | Resultado esperado |
|---|---|---|
| 3A.1 | Envie `/start` sem código | **"Para vincular este chat, gere o link no painel do TermoLOG e abra-o."** |
| 3A.2 | Envie `/start codigo-inventado` | "Código inválido ou expirado…". |
| 3A.3 | Envie `/start` + texto fora do formato (`/start a b c`, `/start ../x`) | Resposta de código inválido (só o primeiro argumento conta) e **nenhum erro** no log. |
| 3A.4 | Envie texto comum ("oi") | O bot **não responde** (só `/start` é tratado). |
| 3A.5 | Gere um código, espere **mais de 10 min** e use | "Código inválido ou expirado…". |
| 3A.6 | Gere um código novo e use no **mesmo chat já vinculado** | "Chat vinculado…" e o canal continua **um só** (reativa, não duplica). |
| 3A.7 | Desative o canal (`ativo:false` no PUT, passo 4.2) e vincule de novo | Canal volta a `ativo:true`. |
| 3A.8 | Adicione o bot a um **grupo** e envie `/start@<bot> <codigo>` | Vincula com `chat_id` **negativo**. Um `/start@outro_bot` **não** é tratado. |
| 3A.9 | Com 10 canais cadastrados, tente vincular um chat novo | "Você já atingiu o limite de canais. Remova um no painel e abra o link de novo." O código **não** é consumido: remova um canal e use o mesmo link. |
| 3A.10 | Vincule o chat B com o código de **outro** usuário | O canal aparece só na conta dona do código, e nunca na do chat. |

---

## 4. Gerenciar canais manualmente (`PUT /auth/me/canais`)

O PUT **substitui a lista inteira**: sempre envie os canais que quiser manter.

| # | Passo | Resultado esperado |
|---|---|---|
| 4.1 | `PUT` com `[{"tipo":"telegram","destino":"<chat_id>"}]` | 200, canal ativo. |
| 4.2 | `PUT` com `"ativo": false` | 200. Nenhuma mensagem chegará (passo 5.5). |
| 4.3 | `destino: "@canal"`, `"abc"`, `"0"` | **422** (só número inteiro ≠ 0). |
| 4.4 | O mesmo telegram duas vezes na lista | **422** (`canal repetido`). |
| 4.5 | Telegram + e-mail na mesma lista | 200, os dois canais salvos. |
| 4.6 | Sem login | **401**. |

---

## 5. Alerta chegando no Telegram

Regra do sistema: o alerta abre quando uma leitura sai da faixa, e há **no máximo um alerta `pendente` por sala e tipo**. A segunda leitura fora da faixa, com o alerta ainda pendente, **não** gera mensagem nova. Para repetir o teste, reconheça o alerta (passo 5.6).

Leitura fora da faixa (ajuste `data_hora` para o horário atual, em ISO 8601 com fuso):

```bash
curl -s -X POST localhost:8000/gateways/$GW_ID/leituras \
  -H "Authorization: Bearer $GW_KEY" -H 'Content-Type: application/json' \
  -d '{
    "lote_id": "'$(python -c "import uuid;print(uuid.uuid4())")'",
    "versao_config": 0,
    "leituras": [{"sensor_id": '$SENSOR_ID', "temperatura": 15.0, "umidade": 50.0,
                  "data_hora": "2026-11-12T10:00:00-03:00"}]
  }'
```

O simulador (`backend/scripts/simulador`, README próprio) faz o mesmo por interface gráfica.

| # | Passo | Resultado esperado |
|---|---|---|
| 5.1 | Envie a leitura acima (temperatura acima da faixa) | **201** com `"aceitas": 1`. A resposta **não demora** (o aviso sai depois). |
| 5.2 | Olhe o Telegram | Mensagem: `TermoLOG: Temperatura acima da faixa em <sala>`, com sala, sensor, "Leitura: 15.0 °C e 50.0 % de umidade" e "Medida em: … (horário de Brasília)". |
| 5.3 | `psql_t -c "SELECT alerta_id, tipo, destino, sucesso, erro FROM envios_de_notificacao ORDER BY id DESC LIMIT 5"` | Linha `telegram`, `sucesso = t`, `erro` nulo. |
| 5.4 | Envie **outra** leitura fora da faixa na mesma sala | **Nenhuma** mensagem nova (alerta já pendente). |
| 5.5 | Com o canal `ativo:false` (4.2), reconheça o alerta, gere um novo | Nada chega; nenhuma linha nova em `envios_de_notificacao` para esse canal. |
| 5.6 | `POST /alertas/{id}/reconhecer` (com login) e envie nova leitura fora da faixa | Alerta novo e **nova mensagem**. |
| 5.7 | Leitura **abaixo** do mínimo / umidade fora (se a sala tiver faixa) | Títulos "Temperatura abaixo…", "Umidade acima/abaixo…". |
| 5.8 | Leitura **dentro** da faixa | Nenhuma mensagem. |
| 5.9 | Dois usuários com canais ativos diferentes | **Os dois** recebem o alerta no próprio chat. |

---

## 6. Falhas (não podem derrubar nada)

| # | Passo | Resultado esperado |
|---|---|---|
| 6.1 | Canal Telegram com **chat_id inexistente** (ex.: `123456789012`) e canal e-mail ativo; dispare um alerta | O lote responde **201**. Em `envios_de_notificacao`: telegram `sucesso=f` com `erro` descritivo (ex.: `chat not found`), e o **e-mail sai normalmente**. |
| 6.2 | **Bloqueie o bot** no Telegram e dispare um alerta | `sucesso=f`, erro tipo `Forbidden: bot was blocked by the user`. Desbloqueie depois. |
| 6.3 | Token errado no `.env` + recrie o backend | O log mostra o erro **sem o token**; nada de traceback com URL. Alerta: `sucesso=f` e erro **sem** o token. |
| 6.4 | Remova `TELEGRAM_BOT_TOKEN` | O bot **não sobe** (sem thread); o alerta registra `TELEGRAM_BOT_TOKEN não configurado`. |
| 6.5 | `TELEGRAM_POLLING=false` | Backend sobe sem buscar mensagens; o vínculo não responde, mas o **envio de alertas continua** funcionando. |
| 6.6 | Sem internet (desligue a rede ou bloqueie `api.telegram.org`) | O backend continua respondendo; o bot tenta de novo com espera crescente (1 s, 2 s, 4 s… até 60 s). Ao voltar, ele retoma sozinho. |
| 6.7 | Reinicie o backend com um `/start` já tratado ainda na fila do Telegram | Possível "código inválido" repetido (o offset fica só em memória; é limitação **conhecida**, comentário `ponytail` no código). Não é bug novo. |

---

## 7. Segurança e privacidade

| # | Verificação | Esperado |
|---|---|---|
| 7.1 | `docker compose logs backend \| grep -F "<TOKEN>"` | Nenhuma ocorrência. |
| 7.2 | `grep` do código de vínculo nos logs | Nenhuma ocorrência (o texto do `/start` não vai para o log). |
| 7.3 | Em `/auth/me/canais`, outra conta não vê seus canais | Só os do usuário logado (não há id de usuário na rota). |
| 7.4 | Conta com perfil **visualizador** | Consegue gerar vínculo e gerenciar **os próprios** canais. |

---

## 8. Regressão rápida

- `GET /auth/me/canais` continua listando e-mail e Telegram juntos.
- O alerta por **e-mail** (Mailpit em `localhost:8025`) continua saindo ao mesmo tempo que o do Telegram.
- Rode os testes automatizados do backend com o Postgres do Compose (`README`, "Testes do backend"): `test_vinculo_telegram.py`, `test_canais_api.py`, `test_notificacoes.py`, `test_migrations.py`.

---

## 9. Checklist para fechar (DoD)

- [ ] Fluxo 3 completo (link → vínculo → resposta do bot) demonstrado.
- [ ] Alerta real recebido no Telegram (5.2) e registrado em `envios_de_notificacao` (5.3).
- [ ] Falha de um canal não afeta o outro (6.1).
- [ ] Token e código ausentes dos logs (7.1, 7.2).
- [ ] `alembic upgrade head` e `downgrade -1` rodam em banco vazio (migration `0019`).
- [ ] CI do PR verde (backend, ruff, biome, commits).
- [ ] README atualizado, se algo mudou na configuração.
- [ ] Contrato da API (wiki, seção 2.2) conferido contra as respostas reais de `POST /auth/me/canais/telegram/vinculo`, `GET` e `PUT /auth/me/canais`. A wiki ainda diz que o 503 vem de o servidor estar "sem o nome do bot (`TELEGRAM_BOT_USERNAME`)": hoje a causa é a falta do token, ou o token sem resposta do Telegram. Atualizar essa frase.
- [ ] `configurar_bot` (0.3b) rodado contra o bot de verdade.

## Registro de resultados

| Passo | OK? | Observações |
|---|---|---|
| | | |
