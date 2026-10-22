from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    FiniteFloat,
    StringConstraints,
    field_validator,
    model_validator,
)

from leituras.schemas import LeituraDoSensor
from salas.service import Status
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


class Faixa(BaseModel):
    """Objeto faixa do contrato. Limite null = sem limite daquele lado.

    Também é o corpo de PUT /salas/{id}/faixa: limite omitido fica null, então a
    sala pode ter faixa, só máximo ou só mínimo de cada grandeza.
    """

    model_config = ConfigDict(from_attributes=True)

    temperatura_min: FiniteFloat | None = None
    temperatura_max: FiniteFloat | None = None
    umidade_min: FiniteFloat | None = None
    umidade_max: FiniteFloat | None = None

    @model_validator(mode="after")
    def minimo_menor_que_maximo(self):
        # A mesma regra das CHECK do banco, para responder 422 em vez de erro 500.
        for grandeza in ("temperatura", "umidade"):
            minimo = getattr(self, f"{grandeza}_min")
            maximo = getattr(self, f"{grandeza}_max")
            if minimo is not None and maximo is not None and minimo >= maximo:
                raise ValueError(f"{grandeza}_min deve ser menor que {grandeza}_max")
        return self


class SalaDetalhe(SalaResumo):
    faixa: Faixa
    sensores: list[SensorResumo]

    @model_validator(mode="before")
    @classmethod
    def faixa_da_sala(cls, sala):
        # A faixa fica em colunas da própria sala; aqui vira o objeto do contrato.
        if isinstance(sala, dict):
            return sala
        return {
            "id": sala.id,
            "nome": sala.nome,
            "descricao": sala.descricao,
            "faixa": Faixa.model_validate(sala),
            "sensores": sala.sensores,
        }

    @field_validator("sensores")
    @classmethod
    def sensores_por_id(cls, sensores):
        return sorted(sensores, key=lambda sensor: sensor.id)


class StatusDaSala(BaseModel):
    """Uma sala em GET /salas/status (Contrato de API, 2.3)."""

    sala_id: int
    nome: str
    faixa: Faixa
    # US03 (frequência de leitura) está fora da Sprint I.
    intervalo_leitura_s: int | None = None
    status: Status
    leituras: list[LeituraDoSensor]
