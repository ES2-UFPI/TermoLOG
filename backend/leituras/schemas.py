from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class LeituraItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    temperatura: float
    umidade: float
    data_hora: datetime


class HistoricoDoSensor(BaseModel):
    sensor_id: int
    sala_nome: str
    total: int
    pagina: int
    itens: list[LeituraItem]


class LeituraRecebida(BaseModel):
    """Item do lote. Só os tipos são conferidos aqui: valores fora do limite físico
    e datas inválidas não derrubam o lote, voltam em ``rejeitadas`` (LeituraService).
    """

    sensor_id: int
    temperatura: float
    umidade: float
    data_hora: datetime


class LoteDeLeituras(BaseModel):
    lote_id: UUID
    versao_config: Annotated[int, Field(ge=0)]
    comandos_concluidos: list[int] = []
    # Lista vazia é o heartbeat do gateway.
    leituras: Annotated[list[LeituraRecebida], Field(max_length=100)]


class Rejeitada(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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
