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
| Frontend | React Native + TypeScript (web e mobile) |
| Ambiente | Docker e Docker Compose |

Os motivos de cada escolha estão na wiki: [Arquitetura — Definição Tecnológica](https://github.com/ES2-UFPI/TermoLOG/wiki/Arquitetura-Definição-Tecnológica).

## Como rodar o backend e o banco

```bash
cp .env.example .env
docker compose up -d --build
docker compose run --rm -w /code/backend web alembic upgrade head
```

A API fica em `http://localhost:8081` (documentação em `/docs`). O segundo comando aplica as migrations no banco.

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

## Como rodar o frontend

```bash
cd frontend
cp .env.example .env
npm install
npm start
```

O painel abre no navegador. A URL da API fica na variável `EXPO_PUBLIC_API_URL` do `.env`.
