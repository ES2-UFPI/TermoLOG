from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StrictFloat,
    StrictInt,
)


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


def _data_em_texto(valor):
    # O contrato pede ISO 8601: número (timestamp) não é aceito como data.
    if not isinstance(valor, str | datetime):
        raise ValueError("data_hora deve ser um texto ISO 8601")
    return valor


class LeituraRecebida(BaseModel):
    """Item do lote. Só os tipos são conferidos aqui, sem conversão de texto para
    número: valores fora do limite físico e datas inválidas (como sem fuso) não
    derrubam o lote, voltam em ``rejeitadas`` (LeituraService).
    """

    sensor_id: StrictInt
    temperatura: StrictFloat
    umidade: StrictFloat
    data_hora: Annotated[datetime, BeforeValidator(_data_em_texto)]


class LoteDeLeituras(BaseModel):
    lote_id: UUID
    versao_config: Annotated[int, Field(ge=0)]
    comandos_concluidos: list[int] = []
    # Lista vazia é o heartbeat do gateway.
    leituras: Annotated[list[LeituraRecebida], Field(max_length=100)]


class Rejeitada(BaseModel):
    indice: int
    sensor_id: int
    motivo: Literal[
        "sensor_nao_cadastrado",
        "sensor_inativo",
        "valor_fora_do_limite",
        "data_hora_invalida",
    ]


class ConfirmacaoDoLote(BaseModel):
    lote_id: UUID
    aceitas: int
    rejeitadas: list[Rejeitada]
    # Ainda não há versão de configuração nem comandos no banco: vão sempre vazios.
    config: None = None
    comandos: list = []
