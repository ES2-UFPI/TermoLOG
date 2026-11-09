from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from auth.router import usuario_logado
from database import get_sessao
from relatorios.exportadores import EXPORTADORES
from relatorios.service import (
    BRASILIA,
    PeriodoGrandeDemais,
    SalaNaoEncontrada,
    montar_relatorio,
)
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
    exportador = EXPORTADORES.get(formato)
    if exportador is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"formato {formato} ainda não disponível",
        )
    try:
        relatorio = montar_relatorio(
            sessao, sala_id, inicio, fim, usuario.nome, exportador.limite_de_leituras
        )
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")
    except PeriodoGrandeDemais as erro:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"o período tem {_milhar(erro.leituras)} leituras e o "
            f"{formato.upper()} aceita até {_milhar(erro.limite)}: escolha um "
            "período menor ou baixe em CSV",
        )
    de = inicio.astimezone(BRASILIA).strftime("%Y%m%d")
    ate = fim.astimezone(BRASILIA).strftime("%Y%m%d")
    nome = f"relatorio-leituras-sala-{sala_id}-{de}-{ate}.{exportador.extensao}"
    return Response(
        exportador.exportar(relatorio),
        media_type=exportador.media_type,
        headers={"Content-Disposition": f'attachment; filename="{nome}"'},
    )


def _milhar(numero: int) -> str:
    return f"{numero:,}".replace(",", ".")
