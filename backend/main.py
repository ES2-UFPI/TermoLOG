import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from leituras.router import router as leituras_router
from salas.router import router as salas_router
from sensores.router import router as sensores_router

app = FastAPI()
# O painel web roda em outra origem (Expo, porta 8081), então o navegador só deixa
# ele chamar a API se ela liberar essa origem.
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "http://localhost:8081").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(leituras_router)
app.include_router(salas_router)
app.include_router(sensores_router)


@app.get("/health")
def health():
    return {"status": "ok"}
