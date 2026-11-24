# TermoLOG
TermoLOG é uma solução digital para monitoramento e controle de ambientes críticos, com sensores e atuadores conectados, alertas automáticos e relatórios em tempo real.

## Stack

| Camada | Tecnologia |
|---|---|
| Nó de borda | ESP32 + sensor DHT22 |
| Comunicação nó de borda → nó central | LoRa |
| Comunicação nó central → servidor | HTTPS (API REST) |
| Backend | FastAPI (Python) |
| Banco de dados | PostgreSQL |
| Frontend | React Native + TypeScript (web) |
| Ambiente | Docker e Docker Compose |

Os motivos de cada escolha estão na wiki: [Arquitetura — Definição Tecnológica](https://github.com/ES2-UFPI/TermoLOG/wiki/Arquitetura-Definição-Tecnológica).

## Definition of Done

O que o time considera "pronto" para uma tarefa ou história está em [docs/definition-of-done.md](docs/definition-of-done.md).

## Como usar o painel

Com o sistema no ar ([backend](#como-rodar-o-backend-e-o-banco) e [frontend](#como-rodar-o-frontend) rodando, ou um gateway/placa real enviando leituras), o fluxo de quem usa o painel no dia a dia:

### 1. Entre

Faça login com e-mail e senha, na tela de login.

<p align="center"><img src="docs/imagens/uso-01-login.png" width="700" alt="Tela de login do TermoLOG, com os campos de e-mail e senha"></p>

### 2. Veja o Painel

A aba inicial mostra um card por sala, com a última temperatura e umidade. A sala fora da faixa vai para o topo, em destaque, com quanto passou do limite. O painel se atualiza sozinho a cada 30 s.

<p align="center"><img src="docs/imagens/uso-02-painel.png" width="700" alt="Painel do TermoLOG com os cards das salas, uma delas fora da faixa em destaque no topo"></p>

### 3. Abra uma sala

Clique no card para ver a última leitura, o histórico e o gráfico de temperatura e umidade (dia, semana ou mês, com a faixa ideal marcada). Se a sala tiver um sensor de climatização, os botões **Ligar**, **Desligar** e **Ajustar** controlam o ar-condicionado por infravermelho; cada comando aparece registrado com quem mandou e a situação (pendente, entregue ou expirado).

<p align="center"><img src="docs/imagens/uso-03-sala.png" width="700" alt="Tela de uma sala, com o gráfico de temperatura e umidade e o controle do ar-condicionado"></p>

### 4. Vá em Alertas

Veja os pendentes, reconhecidos e encerrados. Em um alerta pendente, **Reconhecer** assume o caso; depois, **Encerrar alerta** pede a ação corretiva tomada.

<p align="center"><img src="docs/imagens/uso-04-alertas.png" width="700" alt="Tela de Alertas, com alertas pendentes, reconhecidos e encerrados"></p>

### 5. Vá em Relatórios

Escolha a sala, o período e o formato (PDF ou CSV), confira a prévia na tela e clique em **Baixar relatório**. O mesmo lugar gera o relatório de alertas e ações corretivas de uma sala.

<p align="center"><img src="docs/imagens/uso-05-relatorios.png" width="700" alt="Tela de Relatórios, com a prévia do relatório antes de baixar"></p>

### 6. Abra Meu perfil

No menu da conta (canto superior direito), vincule o Telegram ou ative a notificação no navegador, e escolha por quais canais quer receber os alertas.

<p align="center"><img src="docs/imagens/uso-06-perfil.png" width="700" alt="Tela de Meu perfil, com os canais de notificação: e-mail, Telegram e navegador"></p>

### 7. Administrador

A aba **Gateways** cadastra um gateway e mostra a chave de API dele; na tela da sala, **Editar sala** muda nome, faixa e o sensor de climatização, e **Adicionar sensor**/**Desativar** cadastra ou desativa sensores. Um visualizador não vê esses botões.

<p align="center"><img src="docs/imagens/uso-07-gateways.png" width="700" alt="Tela de Gateways, só para administrador, com o cadastro e a chave de API"></p>

### 8. Pelo celular

As mesmas telas funcionam no navegador do celular, sem instalar nada.

<p align="center"><img src="docs/imagens/uso-08-celular.png" width="320" alt="Painel do TermoLOG aberto no navegador do celular"></p>

## Como rodar o backend e o banco

```bash
cp .env.example .env
docker compose up -d --build
docker compose run --rm -w /code/backend backend alembic upgrade head
```

A API fica em `http://localhost:8000` (documentação em `/docs`). O segundo comando aplica as migrations no banco.

As rotas do painel exigem login. Crie um usuário ([abaixo](#criar-um-usuário-do-painel)), faça `POST /auth/login` e mande o token recebido no cabeçalho `Authorization: Bearer <token>`. Em `/docs`, cole o token no botão **Authorize**. O envio de leituras (`POST /gateways/{id}/leituras`) usa a chave de API do gateway, não o login.

### Migrations (Alembic)

Os comandos rodam dentro da pasta `backend/` do contêiner. Para gerar uma nova migration a partir dos modelos (`salas/models.py`, `sensores/models.py` etc.), monte a pasta local para receber o arquivo gerado:

```bash
docker compose run --rm -v ./backend:/code/backend -w /code/backend backend alembic revision --autogenerate -m "descrição da mudança"
docker compose run --rm -w /code/backend backend alembic upgrade head    # aplica
docker compose run --rm -w /code/backend backend alembic downgrade -1    # desfaz a última
```

Todo modelo novo precisa ser importado em `backend/models.py` para o Alembic enxergá-lo. Revise a migration gerada antes de commitar.

### Criar um usuário do painel

O cadastro de usuários pelo painel ainda não existe. Para entrar no painel (`POST /auth/login`), crie o usuário pelo terminal, com as migrations já aplicadas:

```bash
docker compose run --rm -w /code/backend backend python -m usuarios.criar_usuario --nome "Ana" --email ana@exemplo.com
```

O usuário nasce **visualizador**: usa as rotas de leitura e as dos alertas, e recebe 403 nas rotas marcadas como Admin no Contrato de API (2.1). Para criá-lo já como administrador, acrescente `--perfil administrador`.

A senha (mínimo de 8 caracteres) é pedida no terminal e só o hash dela é gravado. Para rodar sem terminal (ex.: num script), o comando lê a senha da variável de ambiente `SENHA`. Passe a variável sem valor no `-e`, para a senha não ficar no histórico do shell nem na linha de comando do processo:

```bash
read -rs SENHA && export SENHA   # digita a senha sem mostrar na tela
docker compose run --rm -e SENHA -w /code/backend backend python -m usuarios.criar_usuario --nome "Ana" --email ana@exemplo.com
unset SENHA
```

### Administradores

Depois da migration `0016`, todos os usuários que já existiam são visualizadores, e ninguém vira administrador sozinho. O primeiro administrador sai de um destes comandos, que também servem para o ambiente de desenvolvimento e de teste:

```bash
# Administrador padrão: termolog@exemplo.com (cria, ou promove se já existir). Pede a senha.
docker compose run --rm -w /code/backend backend python -m usuarios.admin_padrao

# Conceder ou retirar o perfil de quem já existe
docker compose run --rm -w /code/backend backend python -m usuarios.definir_perfil --email ana@exemplo.com --perfil administrador
```

O administrador padrão não é criado pela migration de propósito: uma migration com e-mail e senha fixos criaria uma conta de administrador conhecida em qualquer ambiente, inclusive em produção. A mudança de perfil vale na próxima requisição da pessoa, sem ela entrar de novo, e o comando não tira o perfil do último administrador.

### Limite de tentativas de login e proxy

O `POST /auth/login` recusa com 429 depois de 5 senhas erradas no mesmo e-mail ou 20 vindas do mesmo IP em 15 minutos. O IP é o de quem abriu a conexão com a API.

Se a API ficar atrás de um proxy reverso (Nginx, Traefik, Caddy etc., por exemplo para o HTTPS), quem abre a conexão é o proxy. Aí todas as pessoas aparecem com o IP dele, e 20 erros de qualquer uma bloqueiam o login de todas. Para evitar isso, o proxy precisa mandar o IP real no cabeçalho `X-Forwarded-For`, e a API precisa confiar nesse proxy. Coloque o IP do proxy no `.env` (vários separados por vírgula). Também vale uma rede, útil quando o proxy é um contêiner cujo IP muda ao ser recriado:

```bash
FORWARDED_ALLOW_IPS=172.18.0.5        # ou a rede: 172.18.0.0/16
```

Só os IPs da lista podem informar o `X-Forwarded-For`. Vindo de qualquer outro endereço, o cabeçalho é ignorado, para ninguém fugir do limite inventando um IP. Não use `*` se a porta da API também puder ser acessada sem passar pelo proxy. Sem a variável, a API só confia em `127.0.0.1`, o que serve quando não há proxy.

No Docker Desktop (Windows e macOS) todas as conexões chegam ao contêiner com o mesmo IP, mesmo sem proxy. Para testar o limite por IP, use o Linux ou rode a API fora do Docker.

Efeitos do limite que vale conhecer:

- **Bloqueio de propósito.** Quem sabe o e-mail de alguém consegue bloquear o login dessa pessoa por 15 minutos errando a senha 5 vezes, e pode repetir a cada janela. É o preço do limite por e-mail. Se alguém reclamar que não consegue entrar, espere a janela passar ou apague as falhas daquele e-mail no banco:

  ```bash
  docker compose exec db psql -U termolog -d termolog -c \
    "DELETE FROM tentativas_de_login WHERE email_hash = encode(sha256(convert_to(lower('ana@exemplo.com'), 'UTF8')), 'hex')"
  ```

- **Tentativas simultâneas.** Enquanto a senha é conferida, a tentativa já conta como falha para as outras que chegam ao mesmo tempo. Com 4 falhas no e-mail e 2 tentativas juntas, as duas podem receber 429, mesmo a que tinha a senha certa. Ninguém passa do limite; basta tentar de novo depois do `Retry-After`.
- **Sem IP.** Se o servidor não informar o IP de quem conectou, vale só o limite por e-mail.

### Alertas por e-mail

Quando um alerta novo é aberto, a API envia um e-mail para cada usuário que ativou o canal e-mail em `/auth/me/canais`. O envio acontece depois da resposta do lote, então um servidor de e-mail lento não atrasa o gateway. Cada tentativa (alerta, canal, destino, sucesso ou erro e horário) fica na tabela `envios_de_notificacao`, e um canal que falha não impede os outros.

O servidor SMTP vem de variáveis no `.env`:

| Variável | Padrão | O que é |
|---|---|---|
| `SMTP_HOST` | (vazio) | Servidor SMTP. Sem ele, o envio falha e o erro fica no registro. |
| `SMTP_PORT` | 587 | Porta. |
| `SMTP_USUARIO` e `SMTP_SENHA` | (vazio) | Login. Sem usuário, não há login. |
| `SMTP_REMETENTE` | o usuário, ou `termolog@localhost` | Endereço do campo "De". |
| `SMTP_STARTTLS` | `true` | `false` desliga o STARTTLS. |

O STARTTLS confere o certificado do servidor. Com `SMTP_STARTTLS=false` e `SMTP_USUARIO` definido, a senha viaja em texto puro: só use isso no Mailpit local. O SSL implícito (porta 465) não é suportado; em produção use a porta 587 com STARTTLS. `SMTP_REMETENTE` só precisa ser informado se o usuário do login não for um endereço de e-mail.

No desenvolvimento, o `docker-compose.override.yml` sobe o [Mailpit](https://mailpit.axllent.org/) e já aponta a API para ele (`mailpit:1025`, sem TLS). Os e-mails enviados aparecem em `http://localhost:8025`. Para testar: faça login, ative o canal com `PUT /auth/me/canais` (`[{"tipo": "email", "destino": "ana@exemplo.com"}]`) e envie um lote com uma leitura fora da faixa da sala.

### Alertas pelo Telegram

Quem ativou o canal `telegram` em `/auth/me/canais` recebe o alerta no chat, com sala, sensor, leitura e horário. É o mesmo fluxo do e-mail: o envio acontece depois da resposta do lote, cada tentativa fica em `envios_de_notificacao` e uma falha da API do Telegram (token errado, chat inexistente, bot bloqueado, rede fora) é registrada sem afetar os outros canais.

O bot e o vínculo vêm de variáveis no `.env`:

| Variável | Padrão | O que é |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | (vazio) | Token do bot, criado no [@BotFather](https://t.me/BotFather). Sem ele, o envio falha e o erro fica no registro, e o vínculo por link não funciona. |
| `TELEGRAM_BOT_USERNAME` | (vazio) | Opcional. Nome do bot, sem o `@`. Se ficar vazio, a API descobre o nome pelo token (`getMe`) e o guarda na memória; uma falha dessa consulta é lembrada por 30 s. Só serve para forçar um nome ou para não depender da rede. Sem nome e sem token, ou com token mas sem resposta do Telegram, `POST /auth/me/canais/telegram/vinculo` responde 503 `Telegram não configurado` (a causa vai para o log). |
| `TELEGRAM_POLLING` | `true` | `false` desliga a busca das mensagens do bot (ver abaixo), por exemplo em uma réplica da API. |

**Criar o bot de uma instalação.** Cada instalação precisa do **seu próprio bot**: o Telegram entrega as mensagens a um consumidor só, e o mesmo token em duas instalações faz uma roubar as mensagens da outra (o vínculo quebra). Criar o bot é manual, porque o Telegram não tem API para isso. O resto é automático:

1. No Telegram, abra o [@BotFather](https://t.me/BotFather), envie `/newbot` e escolha o nome e o username. O username é único no Telegram inteiro e termina em `bot`; vale padronizar um por cliente (ex.: `termolog_<cliente>_bot`).
2. Coloque o token no `.env` do servidor (`TELEGRAM_BOT_TOKEN=...`). O token não vai para o git, para issue ou PR. Se vazar, gere outro com `/revoke` no BotFather.
3. Suba a API e rode o comando de configuração. Ele confere o token, mostra o `@` do bot, cadastra o comando `/start` e, se pedido, muda o nome e as descrições:

   ```bash
   docker compose up -d --build
   docker compose run --rm -w /code/backend backend python -m notificacoes.configurar_bot \
     --nome "TermoLOG - Cliente" --descricao "Alertas de temperatura e umidade do TermoLOG."
   ```

   O comando lê o token só do ambiente (nunca de argumento, que ficaria no histórico do shell). Sem `--nome` e sem descrições, só confere o token e cadastra o `/start`. Limites: nome até 64 caracteres, descrição até 512, descrição curta (`--descricao-curta`) até 120. Cada passo é independente: o Telegram limita quantas vezes o nome e as descrições mudam, então, se um falhar, os outros ainda rodam, o comando diz qual não foi aplicado e sai com erro. Também avisa se `TELEGRAM_BOT_USERNAME` for de outro bot que não o do token.
4. Não precisa preencher `TELEGRAM_BOT_USERNAME`: a API descobre o nome sozinha. O painel mostra o botão de vincular, e o usuário só abre o link.

**Vincular um chat (link com código).** O usuário não precisa saber o `chat_id`:

1. Logado, ele chama `POST /auth/me/canais/telegram/vinculo` e recebe um `link` (`https://t.me/<bot>?start=<código>`) válido por 10 minutos. O código é de uso único; pedir outro invalida o anterior.
2. Abre o link no Telegram e toca em **Iniciar**. O Telegram manda `/start <código>` ao bot.
3. A API, que busca as mensagens do bot no Telegram a cada poucos segundos, liga o chat à conta (`canais_do_usuario`, tipo `telegram`) e responde no chat que o vínculo foi feito. O canal aparece em `GET /auth/me/canais`.

A API busca as mensagens por *long polling* (`getUpdates`) em uma thread própria, iniciada com a aplicação quando há `TELEGRAM_BOT_TOKEN`. Por isso o vínculo funciona em qualquer ambiente, inclusive no `localhost` e no Docker da sua máquina, sem URL pública, HTTPS nem túnel. Como o Telegram entrega as mensagens a um consumidor só, a API (que roda com mais de um worker) usa um lock do PostgreSQL: um processo busca e os outros esperam. Não registre um webhook (`setWebhook`) para o mesmo bot: a API o remove ao iniciar, porque o Telegram não entrega `getUpdates` enquanto houver um. Pelo mesmo motivo, não use o mesmo token em dois ambientes (por exemplo, o do servidor no seu `.env` local): cada um tomaria as mensagens do outro.

Para testar: coloque `TELEGRAM_BOT_TOKEN` no `.env` (o nome do bot a API descobre sozinha), suba o Compose, faça login, chame `POST /auth/me/canais/telegram/vinculo` e abra o `link` no Telegram. Também dá para informar o `chat_id` como texto em `PUT /auth/me/canais` (`[{"tipo": "telegram", "destino": "123456789"}]`), depois de enviar `/start` ao bot; o número aparece em `https://api.telegram.org/bot<TOKEN>/getUpdates` se o polling estiver desligado.

### Testes do backend

Os testes que usam o banco precisam de um PostgreSQL em `DATABASE_URL`. Sem a variável, esses testes são ignorados. Com o Compose no ar, o `docker-compose.override.yml` publica o banco em `localhost:5433` (só na máquina local). Use o usuário, a senha e o nome do banco do seu `.env`:

```bash
cd backend
export DATABASE_URL=postgresql://termolog:termolog@localhost:5433/termolog
uv run pytest
```

Cada teste cria um banco temporário (`termolog_test_*`) e o apaga no final, então os dados do banco de desenvolvimento não são alterados.

No Windows com o Docker Desktop, troque `localhost` por `127.0.0.1` no `DATABASE_URL` (`postgresql://termolog:termolog@127.0.0.1:5433/termolog`). Com `localhost`, cada conexão espera cerca de 45 segundos pelo IPv6 antes de cair no IPv4, e a suíte, que abre várias conexões por teste, parece travada.

### Simulador de gateways

Para testar a ingestão sem a placa, veja [backend/scripts/simulador/README.md](backend/scripts/simulador/README.md).

## Como compilar e gravar o firmware

O firmware fica em `firmware/termolog/`, com um sketch para cada placa:

- `no_borda/`: lê o DHT22 várias vezes em cada janela de envio e manda a média, com o ID do sensor, para o nó central por LoRa. Na sala com ar-condicionado, também emite por infravermelho os comandos do painel;
- `no_central/`: recebe as leituras dos nós de borda, guarda na flash e, a cada ciclo, envia em lote para a API por HTTP(S). Entrega aos nós de borda os comandos de climatização que vêm na resposta da API.

### Parâmetros de tempo

| Parâmetro | Onde | Padrão | O que faz |
|---|---|---|---|
| `JANELA_ENVIO_S` | `no_borda` | 60 | A cada janela o nó envia uma média ao nó central. É o intervalo das leituras que chegam ao backend. |
| `LEITURAS_POR_JANELA` | `no_borda` | 5 | Leituras por janela, espaçadas por igual (60 s e 5 leituras: uma a cada 12 s, dormindo entre elas). Precisa sobrar pelo menos 2 s entre leituras, senão a compilação falha. |
| `CICLO_ENVIO_S` | `no_central` | 30 | A cada ciclo, o nó central envia à API os lotes pendentes e o lote atual. Acima de 60 s, o envio deixa de cumprir o heartbeat do contrato, e o painel passa a mostrar o gateway offline (sem contato há mais de 3 min). |

Os três podem ser trocados no build, sem mexer no código: `build_flags = -D SENSOR_ID=1 -D JANELA_ENVIO_S=120` no `platformio.ini`, ou o mesmo `-D` no `compiler.cpp.extra_flags` do arduino-cli.

### Fila do nó central

Cada leitura recebida vai para a flash (LittleFS), em `/lotes/atual.bin`. A cada ciclo, o nó central reenvia os lotes pendentes, do mais antigo para o mais novo, e depois fecha o lote atual (que vira um lote pendente numerado, com o seu `lote_id` gravado junto) e o envia. Cada lote só sai da flash quando a API responde 201.

Se um envio falhar (sem Wi-Fi, sem resposta, 5xx ou qualquer 4xx que não seja 422), os pendentes ficam na flash com o mesmo `lote_id` e vão no próximo ciclo. Enquanto isso, o lote atual continua recebendo leituras até chegar a 100 (o máximo do contrato), em vez de virar um lote pequeno a cada ciclo: cada arquivo ocupa pelo menos um bloco de 4 KB da flash, e lotes pequenos a cada 30 s encheriam a fila em pouco mais de uma hora. Só o lote recusado com 422 (malformado) é descartado, porque reenviar daria o mesmo erro. Os outros 4xx (401, 403, 404, 413...) indicam configuração errada no `segredos.h` ou no proxy, e descartar apagaria a fila inteira: os lotes ficam na flash, a serial pede para conferir `API_URL`, `GATEWAY_ID` e a chave, e o nó central entra em backoff (Contrato de API, 1.1): a espera entre tentativas dobra a cada recusa (30 s, 1, 2, 4 min) até 5 min e volta ao normal na primeira resposta aceita. Se a flash passar de 85% de uso, os lotes pendentes mais antigos são descartados e o descarte aparece na serial.

Sem leituras para enviar por 60 s, o nó central manda um heartbeat (lote com `leituras: []`), como pede o contrato.

O nó central só manda o ack ao nó de borda depois de guardar a leitura. Se a gravação falhar, o nó de borda não recebe o ack e reenvia. Para não gravar duas vezes a leitura reenviada quando o ack se perde, o nó central guarda a última sequência de até 64 sensores. Acima disso, o sensor visto há mais tempo sai do controle e a serial avisa.

A hora de cada leitura é a do recebimento no nó central, acertada por NTP. Se ele ligar sem internet, as leituras esperam na memória e são gravadas com a hora corrigida quando o NTP responder.

### Configuração do nó central

Wi-Fi, URL da API e credenciais do gateway ficam em `no_central/segredos.h`, que não vai para o git. Copie o modelo e preencha:

```bash
cd firmware/termolog/no_central
cp segredos.exemplo.h segredos.h
```

`GATEWAY_ID` e `CHAVE_API_GATEWAY` vêm de `POST /gateways` (a chave só aparece nessa resposta). Com `https://` na `API_URL`, preencha também `API_CA_CERT` com o certificado raiz da API. O nó central não se conecta sem verificar o certificado.

O nó central usa o esquema de partições `huge_app` (3 MB para o programa e 896 KB para a fila, sem atualização pelo ar), já configurado no `sketch.yaml` e no `platformio.ini`.

As duas placas usam um módulo LoRa SX1276/RFM95 em 915 MHz ligado ao SPI do ESP32 (SCK 18, MISO 19, MOSI 23, NSS 5, RST 4, DIO0 2). No nó de borda, o DHT22 fica no GPIO 22. Os pinos, a frequência e o formato dos pacotes ficam em constantes no topo dos dois arquivos e precisam ser iguais nas duas placas.

### Ar-condicionado (infravermelho)

O nó de borda escolhido como sensor de climatização da sala (no painel, na edição da sala) emite os comandos do ar-condicionado por um LED infravermelho. Os pinos usados ficam todos do lado do GPIO 19 da placa:

| Peça | Ligação |
|---|---|
| LED IR de 940 nm | ânodo (perna longa) num resistor de 220 Ω, que vai ao GPIO 17 (TX2); cátodo (perna curta) no GND |

A ligação direta (cerca de 9 mA) alcança de 50 cm a 1 m, o suficiente para a bancada. Para a sala, use um transistor NPN: 3V3 → resistor de 33 Ω → LED → coletor; GPIO 17 → resistor de 1 kΩ → base (470 Ω com um transistor de potência como o E13003); emissor no GND. O pino fica em nível alto com o LED aceso nas duas montagens. Para conferir se o LED emite, olhe-o pela câmera do celular (a frontal costuma mostrar o infravermelho como um brilho roxo).

O protocolo do ar-condicionado vem do build, como o `SENSOR_ID`: `-D AC_PROTOCOLO=COOLIX`, com o nome de um protocolo da [IRremoteESP8266](https://github.com/crankyoldgit/IRremoteESP8266/blob/master/SupportedProtocols.md) (`COOLIX`, `GREE`, `MIDEA`, `SAMSUNG_AC`, `LG`...). Alguns protocolos têm variantes por modelo, escolhidas com `-D AC_MODELO=1` (ver `IRac.h`). Sem `AC_PROTOCOLO`, a placa ignora os comandos, e o backend os expira em 15 minutos.

Aparelhos testados (o `[env:sensor_1]` do `platformio.ini` já vem com o da sala de testes):

| Marca | Controle remoto | `AC_PROTOCOLO` | `AC_MODELO` | `AC_VENTILADOR` | `AC_LUZ` | Resultado |
|---|---|---|---|---|---|---|
| Carrier | RG10B(B2)/BGEF | `COOLIX` | padrão (-1) | `kAuto` (padrão) | `0` (padrão) | Liga, desliga e muda a temperatura de 17 a 30 °C (#222). É o ar configurado no `[env:sensor_1]`. Protocolo identificado capturando o controle original com um receptor de 38 kHz e o `IRrecvDumpV2`. |
| Electrolux | YAW1F | `GREE` | `1` (YAW1F) | `kLow` | `1` | Liga, desliga e muda a temperatura de 16 a 30 °C (#222). A linha dele fica comentada no `platformio.ini`: para usá-lo, comente a do COOLIX e descomente a dele. Sem `AC_LUZ=1`, cada comando apagava o display do aparelho. |

A velocidade do ventilador vem do build, como o protocolo (`-D AC_VENTILADOR=kLow`, com o nome de um `stdAc::fanspeed_t`); sem ela, vai `kAuto`. A luz do painel também: `-D AC_LUZ=1` a liga em todo comando, para protocolos como o GREE, em que ela faz parte do estado. No COOLIX, a luz é um comando que alterna o display, então fica sem `AC_LUZ`. O painel aceita de 16 a 30 °C, mas o COOLIX vai só de 17 a 30 °C: com ele, um ajuste para 16 °C é emitido como 17 °C, e a serial avisa.

O nó não decide nada sozinho. Ele sempre manda o estado completo, como o controle remoto: refrigeração, a velocidade do ventilador do build e a temperatura. No `ligar` e no `desligar`, vai a última temperatura ajustada, guardada na flash (22 °C até o primeiro ajuste).

O caminho do comando (Contrato de API, 1.3):

1. O nó central recebe os comandos pendentes na resposta de cada lote e os guarda na memória. Depois de reiniciar, recebe tudo de novo no primeiro contato, porque a API repete o comando até ele ser confirmado.
2. Quando o nó de borda envia uma leitura, o nó central responde com o ack e, logo depois, com o comando mais antigo daquele sensor. O nó de borda ouve o rádio por 500 ms depois do ack, emite o código e confirma com um pacote próprio. Aí o nó central manda o próximo comando, até 4 por contato. O comando chega, portanto, no fim da janela de envio seguinte do nó (até 60 s com o padrão).
3. O id confirmado vai em `comandos_concluidos` no envio seguinte do nó central, sem esperar o heartbeat, e o painel passa a mostrar o comando como entregue.

Se a confirmação do nó de borda se perder, o nó central entrega o mesmo comando de novo. O nó de borda guarda o id do último comando aplicado, e aí só confirma, sem emitir outra vez. O comando que passa do `expira_em` é descartado pelo nó central. Entregue quer dizer emitido pelo LED: o infravermelho não confirma o efeito no aparelho.

#### Modo de demonstração (só para apresentar)

No uso normal, o comando leva até uma janela de envio do nó de borda para chegar (60 s com o padrão). Para mostrar o controle funcionando ao vivo, as duas placas têm um modo de demonstração. Ele é ligado só pelos ambientes próprios do PlatformIO (`-D MODO_DEMONSTRACAO=1`): o código é o mesmo, e `pio run -t upload` sem `-e` continua gravando o modo normal.

Como rodar a demonstração:

1. Suba o banco, a API e o painel ([Como rodar o backend e o banco](#como-rodar-o-backend-e-o-banco) e [Como rodar o frontend](#como-rodar-o-frontend)).
2. Confira o `no_central/segredos.h`: Wi-Fi de **2,4 GHz** (o ESP32 não conecta em 5 GHz) e `API_URL` com o IP do computador da API na rede local (ex.: `http://192.168.0.54:8000`).
3. Grave as duas placas, uma de cada vez e com o monitor serial fechado. Com as duas na USB, indique a porta com `--upload-port COM4` (`pio device list` mostra as portas):

   ```bash
   cd firmware/termolog/no_central && pio run -e demonstracao -t upload
   cd ../no_borda && pio run -e sensor_1_demonstracao -t upload
   ```

4. Na edição da sala, no painel, escolha como sensor de climatização o sensor com o ID gravado no nó de borda (`SENSOR_ID=1` no `sensor_1`).
5. Confira a serial (`pio device monitor`, de dentro da pasta da placa). As duas placas mostram `MODO DE DEMONSTRAÇÃO` ao ligar. O nó central mostra `Heartbeat confirmado pela API` a cada 2 s, e o nó de borda mostra `Média N enviada ao nó central` uma vez por minuto.
6. Mande `ligar`, `ajustar` e `desligar` pelo painel, um de cada vez, esperando cada um aparecer como entregue.

O que muda nesse modo:

- **Nó central:** ciclo de 2 s, com contato com a API em todo ciclo (heartbeat sem esperar 60 s). O comando pendente sai para o nó de borda assim que chega, sem esperar uma leitura dele. Sem confirmação, sai de novo a cada 3 s, até 3 vezes. Depois disso, fica para o caminho normal, logo depois do ack da próxima leitura.
- **Nó de borda:** não entra em deep sleep e deixa o rádio ouvindo o tempo todo. As leituras e as médias seguem os mesmos intervalos.
- **As duas placas:** potência de transmissão LoRa de 2 dBm, que basta para placas na mesma sala.

Assim, o comando do painel chega ao ar-condicionado em poucos segundos. **Não use na sala:** o nó de borda acordado gasta a bateria em horas, e o nó central passa a fazer um POST a cada 2 s, o que não é a premissa da arquitetura (Contrato de API, 1.2 e 1.3). Para voltar ao uso normal, grave de novo com `pio run -t upload`.

Se a serial do nó de borda mostrar `Rádio LoRa não terminou de transmitir (modo 0x80 ...)`, o rádio não saiu do sleep: é mau contato ou alimentação do módulo LoRa, não o firmware. Aperte ou refaça as ligações do módulo (SPI, RST, DIO0, 3V3 e GND) e tire da placa o que puxa corrente do mesmo 3V3: na bancada, um receptor infravermelho ligado junto derrubava a tensão do módulo. O nó de borda não trava nesse caso (reinicia o rádio e segue), em qualquer modo.

Cada nó de borda é gravado com o ID que o backend gerou para o sensor dele (`POST /salas/{id}/sensores`). O ID não fica no código: ele é passado na compilação como `SENSOR_ID`, e o `no_borda` não compila sem ele, para nenhuma placa sair com um ID repetido por esquecimento.

Os sketches usam o [arduino-cli](https://arduino.github.io/arduino-cli/). O `sketch.yaml` de cada um fixa a placa (ESP32), a versão do core e as bibliotecas, que são instaladas automaticamente na primeira compilação.

```bash
cd firmware/termolog/no_borda                              # ou no_central
arduino-cli compile --build-property "compiler.cpp.extra_flags=-DSENSOR_ID=12"   # compila (só o no_borda leva o ID)
arduino-cli upload -p /dev/ttyUSB0                         # grava na placa (ajuste a porta)
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200     # mostra as leituras na serial
```

Para descobrir a porta da placa, use `arduino-cli board list`.

### Com o PlatformIO

Cada pasta de sketch também tem um `platformio.ini`, com as mesmas versões do `sketch.yaml`. Para usar o `pio` no terminal sem instalá-lo no sistema, crie o ambiente do firmware uma vez:

```bash
cd firmware
python -m venv .venv
.venv\Scripts\activate                                     # Windows (Linux/macOS: source .venv/bin/activate)
pip install -r requirements.txt
```

No VS Code, abra a pasta `no_borda` ou `no_central` (File > Open Folder) e use os botões da barra inferior: ✓ compila, → grava e 🔌 abre o monitor serial. Pelo terminal:

```bash
cd firmware/termolog/no_borda                              # ou no_central
pio run                                                    # compila
pio run -t upload                                          # grava (a porta é detectada sozinha)
pio device monitor                                         # mostra a serial a 115200
```

No `platformio.ini` do `no_borda`, cada placa é um ambiente com o ID do seu sensor (`[env:sensor_1]` com `build_flags = -D SENSOR_ID=1`). Para uma placa nova, copie o bloco, troque o ID e grave com `pio run -e sensor_12 -t upload`. No VS Code, o ambiente é escolhido na barra inferior (`env:sensor_1`). Sem `-e`, vale o `default_envs`.

Com as duas placas ligadas ao mesmo computador, informe a porta: `pio run -t upload --upload-port COM5` e `pio device monitor -p COM5`. Para ver as portas, use `pio device list`.

## Como rodar o frontend

```bash
cd frontend
cp .env.example .env
npm install
npm start
```

O painel abre no navegador. A URL da API fica na variável `EXPO_PUBLIC_API_URL` do `.env`.

O painel pede login: crie o primeiro usuário com o comando da seção da API.

### Testes do frontend

```bash
cd frontend
npm test                            # regras, sessão e tratamento do 401
npx playwright install chromium     # só na primeira vez
npm run test:e2e                    # login, tela da sala e 401 no navegador (E2E_PORTA troca a 8081)
```

Os testes de navegador simulam a API e sobem o painel sozinhos, então não precisam do Compose no ar.
