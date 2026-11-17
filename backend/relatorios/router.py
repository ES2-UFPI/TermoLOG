from collections.abc import Callable, Mapping
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import AwareDatetime
from sqlalchemy.orm import Session

from auth.router import usuario_logado
from database import get_sessao
from relatorios.exportadores import (
    EXPORTADORES,
    EXPORTADORES_DE_ALERTAS,
    Exportador,
    SemVaga,
    formatar_milhar,
)
from relatorios.service import (
    BRASILIA,
    PeriodoGrandeDemais,
    Relatorio,
    SalaNaoEncontrada,
    montar_relatorio,
    montar_relatorio_de_alertas,
)
from usuarios.models import Usuario

router = APIRouter(prefix="/relatorios", tags=["relatorios"])

Sessao = Annotated[Session, Depends(get_sessao)]
Logado = Annotated[Usuario, Depends(usuario_logado)]
# Faixa do INTEGER do PostgreSQL: um id fora dela estouraria a consulta.
SalaId = Annotated[int, Query(ge=1, le=2**31 - 1)]
Formato = Literal["pdf", "xlsx", "csv"]


@router.get("/leituras")
def relatorio_de_leituras(
    sessao: Sessao,
    usuario: Logado,
    sala_id: SalaId,
    # AwareDatetime recusa com 422 a data sem fuso (#87).
    inicio: AwareDatetime,
    fim: AwareDatetime,
    formato: Formato,
):
    return _relatorio(
        sessao,
        usuario,
        "leituras",
        EXPORTADORES,
        formato,
        sala_id,
        inicio,
        fim,
        lambda responsavel, limite: montar_relatorio(
            sessao, sala_id, inicio, fim, responsavel, limite
        ),
    )


@router.get("/alertas")
def relatorio_de_alertas(
    sessao: Sessao,
    usuario: Logado,
    sala_id: SalaId,
    inicio: AwareDatetime,
    fim: AwareDatetime,
    formato: Formato,
):
    return _relatorio(
        sessao,
        usuario,
        "alertas",
        EXPORTADORES_DE_ALERTAS,
        formato,
        sala_id,
        inicio,
        fim,
        lambda responsavel, _limite: montar_relatorio_de_alertas(
            sessao, sala_id, inicio, fim, responsavel
        ),
    )


def _relatorio[R: Relatorio](
    sessao: Session,
    usuario: Usuario,
    nome: str,
    exportadores: Mapping[str, Exportador[R]],
    formato: str,
    sala_id: int,
    inicio: datetime,
    fim: datetime,
    montar: Callable[[str, int | None], R],
) -> Response:
    """O arquivo do relatório no formato pedido. ``montar`` recebe o responsável
    técnico e o limite de leituras do formato."""
    if inicio > fim:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "inicio não pode ser depois de fim"
        )
    exportador = exportadores.get(formato)
    if exportador is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"formato {formato} ainda não disponível",
        )
    responsavel = usuario.nome
    # Encerra a transação aberta ao carregar o usuário (não há nada a gravar):
    # quem espera a vez do PDF não segura uma conexão do pool, que a ingestão dos
    # gateways também usa. A consulta abre outra ao ganhar a vaga.
    sessao.commit()
    # A vaga cobre a consulta e a exportação: as leituras já ocupam a memória
    # antes de o arquivo ser montado.
    try:
        with exportador.vaga():
            conteudo = exportador.exportar(
                _montar(montar, responsavel, exportador.limite_de_leituras, formato)
            )
    except SemVaga:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"muitos relatórios em {formato.upper()} sendo gerados agora: "
            "tente de novo em instantes",
            headers={"Retry-After": "10"},
        )
    de = inicio.astimezone(BRASILIA).strftime("%Y%m%d")
    ate = fim.astimezone(BRASILIA).strftime("%Y%m%d")
    arquivo = f"relatorio-{nome}-sala-{sala_id}-{de}-{ate}.{exportador.extensao}"
    return Response(
        conteudo,
        media_type=exportador.media_type,
        headers={"Content-Disposition": f'attachment; filename="{arquivo}"'},
    )


def _montar[R: Relatorio](
    montar: Callable[[str, int | None], R],
    responsavel: str,
    limite: int | None,
    formato: str,
) -> R:
    try:
        return montar(responsavel, limite)
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")
    except PeriodoGrandeDemais as erro:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"o período tem {formatar_milhar(erro.leituras)} leituras e o "
            f"{formato.upper()} aceita até {formatar_milhar(erro.limite)}: "
            "escolha um período menor ou baixe em CSV",
        )
