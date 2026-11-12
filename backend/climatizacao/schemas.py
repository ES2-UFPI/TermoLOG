from datetime import datetime
from typing import Literal

from pydantic import AliasPath, BaseModel, ConfigDict, Field, model_validator

Acao = Literal["ligar", "desligar", "ajustar"]
SituacaoDoComando = Literal["pendente", "entregue", "expirado"]

# Faixa aceita no ajuste do ar-condicionado (issue #160).
TEMPERATURA_MIN_C = 16
TEMPERATURA_MAX_C = 30


class ComandoDeClimatizacaoCriar(BaseModel):
    """Corpo de POST /salas/{id}/climatizacao.

    temperatura_c só vale em "ajustar", e lá é obrigatória.
    """

    acao: Acao
    temperatura_c: int | None = Field(
        default=None, ge=TEMPERATURA_MIN_C, le=TEMPERATURA_MAX_C
    )

    @model_validator(mode="after")
    def temperatura_so_no_ajuste(self):
        if self.acao == "ajustar" and self.temperatura_c is None:
            raise ValueError("temperatura_c é obrigatória em ajustar")
        if self.acao != "ajustar" and self.temperatura_c is not None:
            raise ValueError("temperatura_c só vale em ajustar")
        return self


class UsuarioDoComando(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str


class ComandoDeClimatizacao(BaseModel):
    """Um comando de climatização da sala, na criação e no histórico."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    sala_id: int = Field(validation_alias=AliasPath("sensor", "sala_id"))
    sensor_id: int
    acao: Acao
    temperatura_c: int | None
    usuario: UsuarioDoComando
    criado_em: datetime
    expira_em: datetime
    situacao: SituacaoDoComando
