from datetime import datetime

from pydantic import AliasPath, BaseModel, ConfigDict, Field


class SensorCriar(BaseModel):
    gateway_id: int


class SensorResumo(BaseModel):
    """Sensor dentro do detalhe de uma sala (o nome da sala já está no detalhe)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    gateway_id: int
    ativo: bool
    data_cadastro: datetime


class SensorResposta(SensorResumo):
    """Sensor fora do detalhe da sala: sempre o ID do sensor com o nome da sala."""

    sala_id: int
    sala_nome: str = Field(validation_alias=AliasPath("sala", "nome"))
