from fastapi import FastAPI

from leituras.router import router as leituras_router

app = FastAPI()
app.include_router(leituras_router)


@app.get("/hello")
async def root():
    return {"message": "Hello World"}
