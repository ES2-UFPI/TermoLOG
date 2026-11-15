import hashlib
import logging
import re
import secrets
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from enum import Enum

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from alertas.models import Alerta
from notificacoes.canais import CanalEmail, CanalNotificacao, CanalTelegram
from notificacoes.models import (
    CanalDoUsuario,
    EnvioDeNotificacao,
    VinculoTelegram,
)
from notificacoes.schemas import (
    MAXIMO_DE_CANAIS,
    EmailDoUsuario,
    PushDoUsuario,
    TelegramDoUsuario,
    chave_do_canal,
)
from usuarios.models import Usuario

logger = logging.getLogger(__name__)

# O erro vai para o registro de envios: um limite evita guardar uma resposta enorme.
TAMANHO_MAXIMO_DO_ERRO = 500


class UsuarioNaoEncontrado(Exception):
    pass


class CanalService:
    """Canais de notificação de cada usuário (US17). A transação é de quem chama."""

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def listar(self, usuario_id: int) -> list[CanalDoUsuario]:
        """Na ordem em que foram enviados no último PUT."""
        return list(
            self.sessao.scalars(
                select(CanalDoUsuario)
                .where(CanalDoUsuario.usuario_id == usuario_id)
                .order_by(CanalDoUsuario.id)
            )
        )

    def substituir(
        self,
        usuario_id: int,
        canais: list[EmailDoUsuario | TelegramDoUsuario | PushDoUsuario],
    ) -> list[CanalDoUsuario]:
        """Troca a lista inteira de canais do usuário pela recebida."""
        # Trava a linha do usuário: dois PUTs ao mesmo tempo da mesma pessoa
        # esperam a vez, em vez de um apagar no meio do outro e estourar a
        # unicidade com erro 500. O key_share basta para isso e não bloqueia o
        # resto (como um login do mesmo usuário).
        usuario = self.sessao.scalar(
            select(Usuario)
            .where(Usuario.id == usuario_id)
            .with_for_update(key_share=True)
        )
        if usuario is None:
            raise UsuarioNaoEncontrado(usuario_id)
        self.sessao.execute(
            delete(CanalDoUsuario).where(CanalDoUsuario.usuario_id == usuario_id)
        )
        novos = []
        for canal in canais:
            tipo, destino = chave_do_canal(canal)
            novos.append(
                CanalDoUsuario(
                    usuario_id=usuario_id,
                    tipo=tipo,
                    destino=destino,
                    chaves_push=(
                        canal.destino.keys.model_dump()
                        if isinstance(canal, PushDoUsuario)
                        else None
                    ),
                    ativo=canal.ativo,
                )
            )
        self.sessao.add_all(novos)
        self.sessao.flush()
        return novos


# O que o Telegram aceita no parâmetro ?start= (e o que token_urlsafe gera).
FORMATO_DO_CODIGO = re.compile(r"[A-Za-z0-9_-]{1,64}")

# Quanto tempo o link do bot vale depois de gerado.
VALIDADE_DO_VINCULO = timedelta(minutes=10)


class ResultadoDoVinculo(Enum):
    VINCULADO = "vinculado"
    CODIGO_INVALIDO = "codigo_invalido"
    LIMITE_DE_CANAIS = "limite_de_canais"


def _hash_do_codigo(codigo: str) -> str:
    return hashlib.sha256(codigo.encode()).hexdigest()


class VinculoTelegramService:
    """Liga um chat do Telegram à conta do usuário por um código de uso único (#116).

    A transação é de quem chama.
    """

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def gerar(
        self, usuario_id: int, agora: datetime | None = None
    ) -> tuple[str, datetime]:
        """Código novo (só aparece aqui; o banco guarda o hash) e quando expira.

        Invalida o vínculo pendente anterior do usuário e limpa os vencidos.
        """
        agora = agora or datetime.now(UTC)
        # Mesma trava do CanalService.substituir: dois pedidos juntos do mesmo
        # usuário esperam a vez em vez de estourar a unicidade com erro 500.
        usuario = self.sessao.scalar(
            select(Usuario)
            .where(Usuario.id == usuario_id)
            .with_for_update(key_share=True)
        )
        if usuario is None:
            raise UsuarioNaoEncontrado(usuario_id)
        self.sessao.execute(
            delete(VinculoTelegram).where(
                (VinculoTelegram.usuario_id == usuario_id)
                | (VinculoTelegram.expira_em <= agora)
            )
        )
        codigo = secrets.token_urlsafe(16)
        expira_em = agora + VALIDADE_DO_VINCULO
        self.sessao.add(
            VinculoTelegram(
                usuario_id=usuario_id,
                codigo_hash=_hash_do_codigo(codigo),
                expira_em=expira_em,
            )
        )
        self.sessao.flush()
        return codigo, expira_em

    def vincular(
        self, codigo: str, chat_id: str, agora: datetime | None = None
    ) -> ResultadoDoVinculo:
        """Usa o código: cria (ou reativa) o canal Telegram do dono dele.

        Mesma ordem de travas do ``gerar`` (primeiro o usuário, depois o vínculo): ao
        contrário, os dois se esperariam um ao outro e o banco derrubaria um deles.
        """
        agora = agora or datetime.now(UTC)
        if not FORMATO_DO_CODIGO.fullmatch(codigo):
            return ResultadoDoVinculo.CODIGO_INVALIDO
        hash_do_codigo = _hash_do_codigo(codigo)
        # Só descobre o dono: quem consome o código é o DELETE mais abaixo.
        usuario_id = self.sessao.scalar(
            select(VinculoTelegram.usuario_id).where(
                VinculoTelegram.codigo_hash == hash_do_codigo,
                VinculoTelegram.expira_em > agora,
            )
        )
        if usuario_id is None:
            return ResultadoDoVinculo.CODIGO_INVALIDO
        # Serializa com o PUT /auth/me/canais e com o gerar() do mesmo usuário.
        usuario = self.sessao.scalar(
            select(Usuario.id)
            .where(Usuario.id == usuario_id)
            .with_for_update(key_share=True)
        )
        if usuario is None:
            return ResultadoDoVinculo.CODIGO_INVALIDO
        canais = CanalService(self.sessao).listar(usuario_id)
        existente = next(
            (c for c in canais if c.tipo == "telegram" and c.destino == chat_id), None
        )
        if existente is None and len(canais) >= MAXIMO_DE_CANAIS:
            # O código não é consumido: o usuário remove um canal e usa o mesmo link.
            return ResultadoDoVinculo.LIMITE_DE_CANAIS
        # O DELETE ... RETURNING consome o código de uma vez. Com o usuário travado, uma
        # segunda mensagem com o mesmo código (ou um gerar() que o trocou) já espera
        # aqui e não o encontra mais.
        consumido = self.sessao.scalar(
            delete(VinculoTelegram)
            .where(
                VinculoTelegram.codigo_hash == hash_do_codigo,
                VinculoTelegram.expira_em > agora,
            )
            .returning(VinculoTelegram.id)
        )
        if consumido is None:
            return ResultadoDoVinculo.CODIGO_INVALIDO
        if existente is not None:
            existente.ativo = True
        else:
            self.sessao.add(
                CanalDoUsuario(
                    usuario_id=usuario_id, tipo="telegram", destino=chat_id, ativo=True
                )
            )
        self.sessao.flush()
        return ResultadoDoVinculo.VINCULADO


def canais_padrao() -> dict[str, CanalNotificacao]:
    """Os canais com envio implementado. O push entra aqui (#117)."""
    return {"email": CanalEmail(), "telegram": CanalTelegram()}


class NotificacaoService:
    """Avisa os usuários de um alerta novo pelos canais que eles escolheram.

    É observador do AlertaService (arquitetura 4.3) e usa os canais como estratégias
    (4.1): para um canal novo, basta uma classe nova em ``canais`` e nenhuma mudança
    aqui. A sessão do aviso é a do AlertaService.avisar(), que faz o commit.

    Cada envio é registrado e commitado na hora, então um e-mail que já saiu não perde o
    registro se o processo cair no canal seguinte.

    ponytail: os usuários são avisados em sequência e, se o processo cair entre o
    commit do lote e o aviso, o alerta não é enviado. Fila persistente se isso doer.
    """

    def __init__(self, canais: Mapping[str, CanalNotificacao]):
        self.canais = canais

    def alerta_aberto(self, alerta: Alerta, sessao: Session) -> None:
        ativos = sessao.scalars(
            select(CanalDoUsuario)
            .where(CanalDoUsuario.ativo)
            .order_by(CanalDoUsuario.id)
        ).all()
        alerta_id = alerta.id
        for canal in ativos:
            tipo, destino = canal.tipo, canal.destino
            erro = None
            estrategia = self.canais.get(tipo)
            if estrategia is None:
                # O push ainda não tem classe (#117): é esperado, e um
                # traceback por alerta só poluiria o log.
                logger.warning(
                    "alerta %s: canal %s sem envio implementado", alerta_id, tipo
                )
                erro = f"canal {tipo} sem envio implementado"
            else:
                # Um try por canal: a falha de um não impede o envio pelos outros.
                try:
                    estrategia.enviar(canal, alerta)
                except Exception as falha:
                    logger.exception(
                        "falha ao enviar o alerta %s por %s", alerta_id, tipo
                    )
                    erro = f"{type(falha).__name__}: {falha}"[:TAMANHO_MAXIMO_DO_ERRO]
            sessao.add(
                EnvioDeNotificacao(
                    alerta_id=alerta_id,
                    tipo=tipo,
                    destino=destino,
                    sucesso=erro is None,
                    erro=erro,
                )
            )
            # Commit a cada canal: o que já foi enviado fica registrado mesmo que o
            # processo caia no canal seguinte.
            sessao.commit()


def canal_como_resposta(canal: CanalDoUsuario) -> dict:
    """O canal no formato do contrato: no push, o destino volta a ser a inscrição."""
    destino = (
        {"endpoint": canal.destino, "keys": canal.chaves_push}
        if canal.tipo == "push"
        else canal.destino
    )
    return {"tipo": canal.tipo, "destino": destino, "ativo": canal.ativo}
