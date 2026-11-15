import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth.router import SessaoAtual
from database import get_sessao
from notificacoes.canais import BotIndisponivel, nome_do_bot
from notificacoes.schemas import Canal, ListaDeCanais, VinculoTelegramGerado
from notificacoes.service import (
    CanalService,
    UsuarioNaoEncontrado,
    VinculoTelegramService,
    canal_como_resposta,
)

logger = logging.getLogger(__name__)

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


@router.post(
    "/telegram/vinculo",
    response_model=VinculoTelegramGerado,
    status_code=status.HTTP_201_CREATED,
)
def gerar_vinculo_telegram(sessao_valida: SessaoAtual, sessao: Sessao):
    """Código de uso único e link do bot para ligar um chat do Telegram à conta."""
    try:
        bot = nome_do_bot()
    except BotIndisponivel as erro:
        # O contrato tem uma resposta só para o 503, mas a causa difere: sem token, ou
        # token sem resposta do getMe (Telegram fora do ar, token inválido). Fica no
        # log, sem o token, para quem opera o servidor. Nada é gerado em nenhum caso.
        logger.warning("vínculo do Telegram indisponível: %s", erro)
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Telegram não configurado"
        ) from erro
    try:
        codigo, expira_em = VinculoTelegramService(sessao).gerar(
            sessao_valida.usuario_id
        )
    except UsuarioNaoEncontrado:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "não autenticado",
            headers={"WWW-Authenticate": "Bearer"},
        )
    sessao.commit()
    return {
        "codigo": codigo,
        "link": f"https://t.me/{bot}?start={codigo}",
        "expira_em": expira_em,
    }
