import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from gateways.router import router as gateways_router
from leituras.router import router as leituras_router
from salas.router import router as salas_router
from sensores.router import router as sensores_router

app = FastAPI()
# CORS: origens que podem chamar a API pelo navegador. O padrão é o painel web
# (servidor do Expo, porta 8081). Não é a porta da API, que fica na 8000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:8081").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(gateways_router)
app.include_router(leituras_router)
app.include_router(salas_router)
app.include_router(sensores_router)


@app.get("/health")
def health():
    return {"status": "ok"}
