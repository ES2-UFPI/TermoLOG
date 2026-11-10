from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth.router import SessaoAtual
from database import get_sessao
from notificacoes.schemas import Canal, ListaDeCanais
from notificacoes.service import CanalService, UsuarioNaoEncontrado, canal_como_resposta

# Só os canais de quem está logado: não há id de usuário na rota, então ninguém
# consulta nem altera os canais de outra pessoa.
router = APIRouter(prefix="/auth/me/canais", tags=["notificacoes"])

Sessao = Annotated[Session, Depends(get_sessao)]


@router.get("", response_model=list[Canal])
def listar_canais(sessao_valida: SessaoAtual, sessao: Sessao):
    canais = CanalService(sessao).listar(sessao_valida.usuario_id)
    return [canal_como_resposta(canal) for canal in canais]


@router.put("", response_model=list[Canal])
def substituir_canais(
    canais: ListaDeCanais, sessao_valida: SessaoAtual, sessao: Sessao
):
    try:
        salvos = CanalService(sessao).substituir(sessao_valida.usuario_id, canais)
    except UsuarioNaoEncontrado:
        # Usuário apagado depois da autenticação: a sessão foi junto (CASCADE).
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "não autenticado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Montada antes do commit: depois dele o SQLAlchemy recarregaria cada canal.
    resposta = [canal_como_resposta(canal) for canal in salvos]
    sessao.commit()
    return resposta
