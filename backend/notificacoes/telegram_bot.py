"""Bot do Telegram: lê o ``/start <código>`` e liga o chat à conta do usuário (#116).

A API busca as mensagens no Telegram (long polling, ``getUpdates``) em vez de esperar
que ele chame um endereço nosso. Assim o vínculo funciona em qualquer ambiente, até no
``localhost``, sem URL pública, HTTPS nem segredo de webhook.
"""

import logging
import os
import threading
from collections.abc import Callable
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from database import engine
from notificacoes.canais import (
    BotIndisponivel,
    chamar_api_telegram,
    enviar_mensagem_telegram,
    nome_do_bot,
)
from notificacoes.service import ResultadoDoVinculo, VinculoTelegramService

logger = logging.getLogger(__name__)

# Quanto cada getUpdates espera por mensagem nova (o Telegram responde na hora se
# houver) e a espera máxima da requisição, um pouco maior que a do Telegram.
ESPERA_DO_POLLING_S = 25
TIMEOUT_DO_POLLING_S = ESPERA_DO_POLLING_S + 10
# Espera entre as tentativas depois de um erro: dobra até o máximo.
ESPERA_MAXIMA_APOS_ERRO_S = 60
# Espera de quem não conseguiu a vez de buscar as mensagens (outro processo busca).
ESPERA_SEM_A_VEZ_S = 30
# Identifica "este é o processo que busca as mensagens do bot" no PostgreSQL.
CHAVE_DO_LOCK = 20260116

RESPOSTAS = {
    ResultadoDoVinculo.VINCULADO: (
        "Chat vinculado ao TermoLOG. Os alertas vão chegar aqui."
    ),
    ResultadoDoVinculo.CODIGO_INVALIDO: (
        "Código inválido ou expirado. Gere um novo link no painel do TermoLOG."
    ),
    ResultadoDoVinculo.LIMITE_DE_CANAIS: (
        "Você já atingiu o limite de canais. Remova um no painel e abra o link de novo."
    ),
}
SEM_CODIGO = "Para vincular este chat, gere o link no painel do TermoLOG e abra-o."


def _para_este_bot(comando: str) -> bool:
    """``/start`` ou, em grupo, ``/start@nome_do_bot`` (o nosso, se o nome estiver
    configurado: com vários bots no grupo, o comando de outro não é para nós)."""
    nome, _, bot = comando.partition("@")
    if nome != "/start":
        return False
    if not bot:
        return True
    try:
        meu = nome_do_bot()
    except BotIndisponivel:
        # Sem saber o nome, não dá para comparar: o comando é tratado como nosso.
        return True
    return bot.lower() == meu.lower()


def comando_start(atualizacao: Any) -> tuple[str, str | None] | None:
    """(chat_id, código) de uma mensagem ``/start [código]``; None para o resto."""
    try:
        mensagem = atualizacao["message"]
        chat_id = mensagem["chat"]["id"]
        partes = mensagem["text"].split()
    except (KeyError, TypeError, AttributeError):
        return None
    if (
        isinstance(chat_id, bool)
        or not isinstance(chat_id, int)
        or chat_id == 0
        or not partes
        or not _para_este_bot(partes[0])
    ):
        return None
    return str(chat_id), partes[1] if len(partes) > 1 else None


def processar_atualizacao(atualizacao: Any, sessao: Session) -> tuple[str, str] | None:
    """Trata uma atualização do bot. Devolve (chat_id, texto) a responder, se houver.

    O commit é de quem chama: a resposta só deve sair depois dele.
    """
    comando = comando_start(atualizacao)
    if comando is None:
        return None
    chat_id, codigo = comando
    if codigo is None:
        return chat_id, SEM_CODIGO
    return chat_id, RESPOSTAS[VinculoTelegramService(sessao).vincular(codigo, chat_id)]


class BotTelegram:
    """Busca as mensagens do bot e vincula os chats. Roda numa thread (ver iniciar)."""

    def __init__(self, nova_sessao: Callable[[], Session] | None = None):
        self.nova_sessao = nova_sessao or (lambda: Session(engine()))

    def rodada(self, offset: int) -> int:
        """Um getUpdates e o tratamento do que veio. Devolve o próximo offset."""
        resposta = chamar_api_telegram(
            "getUpdates",
            {
                "offset": offset,
                "timeout": ESPERA_DO_POLLING_S,
                "allowed_updates": ["message"],
            },
            timeout=TIMEOUT_DO_POLLING_S,
        )
        atualizacoes = resposta.get("result")
        for atualizacao in atualizacoes if isinstance(atualizacoes, list) else []:
            update_id = (
                atualizacao.get("update_id") if isinstance(atualizacao, dict) else None
            )
            if not isinstance(update_id, int) or isinstance(update_id, bool):
                continue
            # Avança antes de tratar: uma atualização que sempre falha não pode travar
            # a fila. O custo é perder um /start num erro passageiro do banco, e o
            # usuário só gera outro link. O texto não vai para o log: leva o código.
            offset = max(offset, update_id + 1)
            try:
                with self.nova_sessao() as sessao:
                    resposta_ao_chat = processar_atualizacao(atualizacao, sessao)
                    sessao.commit()
                if resposta_ao_chat is not None:
                    enviar_mensagem_telegram(*resposta_ao_chat)
            except Exception:
                logger.exception("falha ao tratar a atualização %s do bot", update_id)
        return offset

    def rodar(self, parar: threading.Event) -> None:
        """Busca mensagens até ``parar``. Só um processo por vez faz isso.

        O Telegram só entrega as mensagens a um consumidor, e a API roda com mais de
        um worker: quem pega o advisory lock do PostgreSQL busca, os outros esperam e
        assumem se ele cair.

        Cada rodada confere a conexão que segura o lock; se ela caiu, o processo larga
        a busca e volta a disputar a vez.
        """
        while not parar.is_set():
            espera = ESPERA_SEM_A_VEZ_S
            try:
                with (
                    engine()
                    .connect()
                    .execution_options(isolation_level="AUTOCOMMIT") as conexao
                ):
                    if conexao.scalar(
                        text("SELECT pg_try_advisory_lock(:chave)"),
                        {"chave": CHAVE_DO_LOCK},
                    ):
                        try:
                            # Conexão que segura o lock: se o banco reiniciou, ela
                            # morreu junto e o lock se perdeu (outro processo pode
                            # tê-lo pego). Consultá-la a cada rodada revela isso.
                            self._buscar(
                                parar, lambda: conexao.execute(text("SELECT 1"))
                            )
                        finally:
                            conexao.execute(
                                text("SELECT pg_advisory_unlock(:chave)"),
                                {"chave": CHAVE_DO_LOCK},
                            )
            except Exception:
                logger.exception("bot do Telegram parou; nova tentativa em seguida")
                espera = ESPERA_MAXIMA_APOS_ERRO_S
            parar.wait(espera)

    def _buscar(
        self, parar: threading.Event, manter_a_vez: Callable[[], Any] = lambda: None
    ) -> None:
        try:
            # getUpdates responde 409 enquanto houver um webhook registrado.
            chamar_api_telegram("deleteWebhook", {})
        except RuntimeError as erro:
            logger.error("bot do Telegram: %s", erro)
            return
        try:
            logger.info("bot do Telegram @%s buscando mensagens", nome_do_bot())
        except BotIndisponivel as erro:
            # Não impede a busca: o nome é descoberto de novo quando for preciso.
            logger.warning("bot do Telegram buscando mensagens (sem o nome: %s)", erro)
        # ponytail: o offset fica em memória. Depois de um reinício, o Telegram reentrega
        # o que ainda não confirmou: um /start já tratado volta como "código inválido".
        offset = 0
        espera = 1
        while not parar.is_set():
            manter_a_vez()
            try:
                offset = self.rodada(offset)
                espera = 1
            except RuntimeError as erro:
                # Falha da API ou da rede (a mensagem não leva o token): sem traceback.
                logger.error("bot do Telegram: %s", erro)
                parar.wait(espera)
                espera = min(espera * 2, ESPERA_MAXIMA_APOS_ERRO_S)


def polling_ligado() -> bool:
    """Liga com TELEGRAM_BOT_TOKEN; TELEGRAM_POLLING=false desliga (réplicas, testes)."""
    return bool((os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()) and os.getenv(
        "TELEGRAM_POLLING", "true"
    ).lower() not in ("0", "false")


def iniciar(parar: threading.Event) -> threading.Thread | None:
    """Sobe a thread do bot, se estiver ligado. A thread é daemon: não segura a saída."""
    if not polling_ligado():
        return None
    thread = threading.Thread(
        target=BotTelegram().rodar, args=(parar,), name="bot-telegram", daemon=True
    )
    thread.start()
    return thread
