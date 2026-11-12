from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from auth.router import exigir_admin, sessao_autenticada
from climatizacao.schemas import ComandoDeClimatizacao, ComandoDeClimatizacaoCriar
from climatizacao.service import ClimatizacaoService, SalaSemClimatizacao
from database import get_sessao
from salas.service import SalaNaoEncontrada
from usuarios.models import Usuario

# Comandos do ar-condicionado da sala (US22, #160). Exigem login; enviar comando é
# só do administrador. O comando segue pelo gateway na resposta do lote
# (contrato, 1.3).
router = APIRouter(
    prefix="/salas",
    tags=["climatizacao"],
    dependencies=[Depends(sessao_autenticada)],
)

Sessao = Annotated[Session, Depends(get_sessao)]
# O limite do INTEGER do banco: acima dele, a consulta daria 500.
SalaId = Annotated[int, Path(ge=1, le=2**31 - 1)]


@router.post(
    "/{sala_id}/climatizacao",
    response_model=ComandoDeClimatizacao,
    # Aceito, mas ainda não chegou ao nó (contrato, 1.3).
    status_code=status.HTTP_202_ACCEPTED,
)
def enviar_comando_de_climatizacao(
    sala_id: SalaId,
    dados: ComandoDeClimatizacaoCriar,
    sessao: Sessao,
    usuario: Annotated[Usuario, Depends(exigir_admin)],
):
    try:
        comando = ClimatizacaoService(sessao).enviar(
            sala_id, dados.acao, dados.temperatura_c, usuario, datetime.now(UTC)
        )
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")
    except SalaSemClimatizacao:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "sala sem sensor de climatização",
        )
    sessao.commit()
    return comando


@router.get("/{sala_id}/climatizacao", response_model=list[ComandoDeClimatizacao])
def historico_de_climatizacao(sala_id: SalaId, sessao: Sessao):
    try:
        return ClimatizacaoService(sessao).historico(sala_id)
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")
