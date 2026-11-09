from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from alertas.service import AlertaService
from database import get_sessao


def alerta_service(sessao: Annotated[Session, Depends(get_sessao)]) -> AlertaService:
    """Dependência do FastAPI: o AlertaService da requisição.

    Os observadores (notificações, alarme local) são inscritos aqui, para a
    ingestão de leituras não precisar conhecer nenhum deles.
    """
    return AlertaService(sessao)
