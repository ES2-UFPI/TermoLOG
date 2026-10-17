from fastapi import FastAPI

from leituras.router import router as leituras_router
from salas.router import router as salas_router
from sensores.router import router as sensores_router

app = FastAPI()
app.include_router(leituras_router)
app.include_router(salas_router)
app.include_router(sensores_router)


@app.get("/hello")
async def root():
    return {"message": "Hello World"}
