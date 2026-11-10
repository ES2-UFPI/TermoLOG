import logging
from collections.abc import Mapping

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from alertas.models import Alerta
from notificacoes.canais import CanalEmail, CanalNotificacao
from notificacoes.models import CanalDoUsuario, EnvioDeNotificacao
from notificacoes.schemas import (
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


def canais_padrao() -> dict[str, CanalNotificacao]:
    """Os canais com envio implementado. Telegram e push entram aqui (#116, #117)."""
    return {"email": CanalEmail()}


class NotificacaoService:
    """Avisa os usuários de um alerta novo pelos canais que eles escolheram.

    É observador do AlertaService (arquitetura 4.3) e usa os canais como estratégias
    (4.1): para um canal novo, basta uma classe nova em ``canais`` e nenhuma mudança
    aqui. A sessão do aviso é a do AlertaService.avisar(), que faz o commit.

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
        for canal in ativos:
            erro = None
            # Um try por canal: a falha de um não impede o envio pelos outros.
            try:
                estrategia = self.canais.get(canal.tipo)
                if estrategia is None:
                    raise LookupError(f"canal {canal.tipo} sem envio implementado")
                estrategia.enviar(canal, alerta)
            except Exception as falha:
                logger.exception(
                    "falha ao enviar o alerta %s por %s", alerta.id, canal.tipo
                )
                erro = f"{type(falha).__name__}: {falha}"[:TAMANHO_MAXIMO_DO_ERRO]
            sessao.add(
                EnvioDeNotificacao(
                    alerta_id=alerta.id,
                    tipo=canal.tipo,
                    destino=canal.destino,
                    sucesso=erro is None,
                    erro=erro,
                )
            )


def canal_como_resposta(canal: CanalDoUsuario) -> dict:
    """O canal no formato do contrato: no push, o destino volta a ser a inscrição."""
    destino = (
        {"endpoint": canal.destino, "keys": canal.chaves_push}
        if canal.tipo == "push"
        else canal.destino
    )
    return {"tipo": canal.tipo, "destino": destino, "ativo": canal.ativo}
