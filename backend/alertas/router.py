from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import AliasPath, BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from alertas.models import Situacao, TipoDoDesvio
from alertas.service import AlertaService
from auth.router import sessao_autenticada
from database import get_sessao
from leituras.schemas import LeituraItem
from notificacoes.service import NotificacaoService, canais_padrao

# As rotas de alertas são do painel: exigem login (contrato, 2.1).
router = APIRouter(tags=["alertas"], dependencies=[Depends(sessao_autenticada)])


class UsuarioDoAlerta(BaseModel):
    id: int
    nome: str


class AlertaResposta(BaseModel):
    """Alerta no formato do contrato (2.7), com os nomes da tabela (#92)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    sala_id: int
    sala_nome: str = Field(validation_alias=AliasPath("sala", "nome"))
    sensor_id: int
    tipo: TipoDoDesvio
    situacao: Situacao
    data_hora: datetime
    # Leitura que abriu o alerta.
    leitura: LeituraItem
    # Quem reconheceu ainda não é gravado no alerta: vem null até existir a coluna.
    reconhecido_por: UsuarioDoAlerta | None = None
    reconhecido_em: datetime | None
    acao_corretiva: str | None
    encerrado_em: datetime | None


def alerta_service(sessao: Annotated[Session, Depends(get_sessao)]) -> AlertaService:
    """Dependência do FastAPI: o AlertaService da requisição.

    Os observadores (notificações, alarme local) são inscritos aqui, para a
    ingestão de leituras não precisar conhecer nenhum deles.
    """
    alertas = AlertaService(sessao)
    alertas.inscrever(NotificacaoService(canais_padrao()))
    return alertas


@router.get("/alertas", response_model=list[AlertaResposta])
def listar_alertas(
    alertas: Annotated[AlertaService, Depends(alerta_service)],
    situacao: Situacao | None = None,
    # O limite do INTEGER do banco: acima dele, a consulta daria 500.
    sala_id: Annotated[int | None, Query(ge=1, le=2**31 - 1)] = None,
):
    return alertas.listar(situacao, sala_id)
