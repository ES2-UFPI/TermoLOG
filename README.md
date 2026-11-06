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
docker compose run --rm -w /code/backend web alembic upgrade head
```

A API fica em `http://localhost:8000` (documentação em `/docs`). O segundo comando aplica as migrations no banco.

### Migrations (Alembic)

Os comandos rodam dentro da pasta `backend/` do contêiner. Para gerar uma nova migration a partir dos modelos (`salas/models.py`, `sensores/models.py` etc.), monte a pasta local para receber o arquivo gerado:

```bash
docker compose run --rm -v ./backend:/code/backend -w /code/backend web alembic revision --autogenerate -m "descrição da mudança"
docker compose run --rm -w /code/backend web alembic upgrade head    # aplica
docker compose run --rm -w /code/backend web alembic downgrade -1    # desfaz a última
```

Todo modelo novo precisa ser importado em `backend/models.py` para o Alembic enxergá-lo. Revise a migration gerada antes de commitar.

### Testes do backend

Os testes de migration precisam do PostgreSQL do Compose (`DATABASE_URL`). Sem ele, esses testes são ignorados.

```bash
cd backend
uv run pytest
```

### Simulador de gateways

Para testar a ingestão sem a placa, veja [backend/scripts/simulador/README.md](backend/scripts/simulador/README.md).

## Como compilar e gravar o firmware

O firmware fica em `firmware/termolog/`, com um sketch para cada placa:

- `no_borda/`: lê o DHT22 e envia a leitura com o ID do sensor para o nó central por LoRa;
- `no_central/`: recebe e decodifica as leituras dos nós de borda e mostra cada uma na serial.

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
