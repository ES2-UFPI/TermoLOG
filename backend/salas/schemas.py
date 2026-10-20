from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints, field_validator

from leituras.schemas import LeituraItem
from sensores.schemas import SensorResumo

NomeDaSala = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]


class SalaCriar(BaseModel):
    nome: NomeDaSala
    descricao: str | None = None


class SalaEditar(BaseModel):
    """Qualquer subconjunto dos campos; só os enviados mudam."""

    nome: NomeDaSala | None = None
    descricao: str | None = None

    @field_validator("nome")
    @classmethod
    def nome_nao_pode_ser_nulo(cls, valor):
        # Omitir o nome mantém o atual, mas enviá-lo como null não faz sentido.
        if valor is None:
            raise ValueError("nome não pode ser nulo")
        return valor


class SalaResumo(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str
    descricao: str | None


class SalaDetalhe(SalaResumo):
    sensores: list[SensorResumo]

    @field_validator("sensores")
    @classmethod
    def sensores_por_id(cls, sensores):
        return sorted(sensores, key=lambda sensor: sensor.id)


class UltimaLeitura(LeituraItem):
    sensor_id: int


class StatusDaSala(BaseModel):
    """Situação atual da sala no painel. Sem leitura, ultima_leitura é null.

    dentro_da_faixa já faz parte do contrato, mas fica null até a classificação da
    leitura pela faixa (#42) existir.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str
    temperatura_min: float | None
    temperatura_max: float | None
    umidade_min: float | None
    umidade_max: float | None
    ultima_leitura: UltimaLeitura | None = None
    dentro_da_faixa: bool | None = None
