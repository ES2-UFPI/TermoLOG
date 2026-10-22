from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, StringConstraints

NomeDoGateway = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
]


class GatewayCriar(BaseModel):
    nome: NomeDoGateway


class GatewayCriado(BaseModel):
    """Resposta do cadastro: a única vez em que a chave de API aparece."""

    id: int
    nome: str
    chave_api: str


class GatewayResumo(BaseModel):
    id: int
    nome: str
    online: bool
    ultimo_contato: datetime | None
