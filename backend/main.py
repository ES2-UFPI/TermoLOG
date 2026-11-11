import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from auth.router import router as auth_router
from gateways.router import router as gateways_router
from leituras.router import router as leituras_router
from notificacoes import telegram_bot
from notificacoes.router import router as notificacoes_router
from relatorios.router import router as relatorios_router
from salas.router import router as salas_router
from sensores.router import router as sensores_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Bot do Telegram (vínculo do chat por link): busca as mensagens em segundo plano.
    parar = threading.Event()
    telegram_bot.iniciar(parar)
    yield
    parar.set()


app = FastAPI(lifespan=lifespan)
# CORS: origens que podem chamar a API pelo navegador. O padrão é o painel web
# (servidor do Expo, porta 8081). Não é a porta da API, que fica na 8000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:8081").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
    # Sem isto o navegador esconde do painel o nome do arquivo do relatório e a
    # espera do login bloqueado (429).
    expose_headers=["Content-Disposition", "Retry-After"],
)
app.include_router(auth_router)
app.include_router(gateways_router)
app.include_router(leituras_router)
app.include_router(notificacoes_router)
app.include_router(relatorios_router)
app.include_router(salas_router)
app.include_router(sensores_router)


@app.get("/health")
def health():
    return {"status": "ok"}
