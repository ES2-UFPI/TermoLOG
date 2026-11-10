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

A senha (mínimo de 8 caracteres) é pedida no terminal e só o hash dela é gravado. Para rodar sem terminal (ex.: num script), o comando lê a senha da variável de ambiente `SENHA`. Passe a variável sem valor no `-e`, para a senha não ficar no histórico do shell nem na linha de comando do processo:

```bash
read -rs SENHA && export SENHA   # digita a senha sem mostrar na tela
docker compose run --rm -e SENHA -w /code/backend backend python -m usuarios.criar_usuario --nome "Ana" --email ana@exemplo.com
unset SENHA
```

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

### Testes do backend

Os testes que usam o banco precisam de um PostgreSQL em `DATABASE_URL`. Sem a variável, esses testes são ignorados. Com o Compose no ar, o `docker-compose.override.yml` publica o banco em `localhost:5433` (só na máquina local). Use o usuário, a senha e o nome do banco do seu `.env`:

```bash
cd backend
export DATABASE_URL=postgresql://termolog:termolog@localhost:5433/termolog
uv run pytest
```

Cada teste cria um banco temporário (`termolog_test_*`) e o apaga no final, então os dados do banco de desenvolvimento não são alterados.

### Simulador de gateways

Para testar a ingestão sem a placa, veja [backend/scripts/simulador/README.md](backend/scripts/simulador/README.md).

## Como compilar e gravar o firmware

O firmware fica em `firmware/termolog/`, com um sketch para cada placa:

- `no_borda/`: lê o DHT22 várias vezes em cada janela de envio e manda a média, com o ID do sensor, para o nó central por LoRa;
- `no_central/`: recebe as leituras dos nós de borda, guarda na flash e, a cada ciclo, envia em lote para a API por HTTP(S).

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
