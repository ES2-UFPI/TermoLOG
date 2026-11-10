from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from notificacoes.models import CanalDoUsuario
from notificacoes.schemas import (
    EmailDoUsuario,
    PushDoUsuario,
    TelegramDoUsuario,
    chave_do_canal,
)
from usuarios.models import Usuario


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


def canal_como_resposta(canal: CanalDoUsuario) -> dict:
    """O canal no formato do contrato: no push, o destino volta a ser a inscrição."""
    destino = (
        {"endpoint": canal.destino, "keys": canal.chaves_push}
        if canal.tipo == "push"
        else canal.destino
    )
    return {"tipo": canal.tipo, "destino": destino, "ativo": canal.ativo}
