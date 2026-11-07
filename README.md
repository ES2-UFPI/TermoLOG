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

## Como compilar e gravar o firmware do nó de borda

O firmware fica em `firmware/termolog/` e usa o [arduino-cli](https://arduino.github.io/arduino-cli/). O arquivo `sketch.yaml` fixa a placa (ESP32), a versão do core e as bibliotecas, que são instaladas automaticamente na primeira compilação.

```bash
cd firmware/termolog
arduino-cli compile                                        # compila
arduino-cli upload -p /dev/ttyUSB0                         # grava na placa (ajuste a porta)
arduino-cli monitor -p /dev/ttyUSB0 -c baudrate=115200     # mostra as leituras na serial
```

Para descobrir a porta da placa, use `arduino-cli board list`.

## Como rodar o frontend

```bash
cd frontend
cp .env.example .env
npm install
npm start
```

O painel abre no navegador. A URL da API fica na variável `EXPO_PUBLIC_API_URL` do `.env`.
