from datetime import datetime

from pydantic import BaseModel, ConfigDict


class LeituraItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    temperatura: float
    umidade: float
    data_hora: datetime


class LeituraDoSensor(LeituraItem):
    sensor_id: int


class HistoricoDoSensor(BaseModel):
    sensor_id: int
    sala_nome: str
    total: int
    pagina: int
    itens: list[LeituraItem]
