from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from auth.router import usuario_logado
from database import get_sessao
from relatorios.service import BRASILIA, SalaNaoEncontrada, montar_relatorio, para_csv
from usuarios.models import Usuario

router = APIRouter(prefix="/relatorios", tags=["relatorios"])

Sessao = Annotated[Session, Depends(get_sessao)]


@router.get("/leituras")
def relatorio_de_leituras(
    sessao: Sessao,
    usuario: Annotated[Usuario, Depends(usuario_logado)],
    # Faixa do INTEGER do PostgreSQL: um id fora dela estouraria a consulta.
    sala_id: Annotated[int, Query(ge=1, le=2**31 - 1)],
    # AwareDatetime recusa com 422 a data sem fuso (#87).
    inicio: AwareDatetime,
    fim: AwareDatetime,
    formato: Literal["pdf", "xlsx", "csv"],
):
    if inicio > fim:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "inicio não pode ser depois de fim"
        )
    if formato != "csv":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"formato {formato} ainda não disponível",
        )
    try:
        relatorio = montar_relatorio(sessao, sala_id, inicio, fim, usuario.nome)
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")
    de = inicio.astimezone(BRASILIA).strftime("%Y%m%d")
    ate = fim.astimezone(BRASILIA).strftime("%Y%m%d")
    nome = f"relatorio-leituras-sala-{sala_id}-{de}-{ate}.csv"
    return Response(
        para_csv(relatorio),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{nome}"'},
    )
