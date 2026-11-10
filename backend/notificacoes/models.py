from typing import Literal

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from database import Base

TipoDeCanal = Literal["email", "push", "telegram"]

# O endpoint de push é a URL do serviço do navegador e pode passar de 500 caracteres.
TAMANHO_MAXIMO_DO_DESTINO = 2048


class CanalDoUsuario(Base):
    """Canal por onde o usuário quer receber os alertas (US17).

    O ``destino`` depende do tipo: o endereço no e-mail, o chat_id no Telegram e o
    endpoint da inscrição no push. As chaves da inscrição de push ficam em
    ``chaves_push``, que só o push tem.
    """

    __tablename__ = "canais_do_usuario"
    __table_args__ = (
        CheckConstraint("tipo IN ('email', 'push', 'telegram')", name="tipo"),
        CheckConstraint(
            "(tipo = 'push') = (chaves_push IS NOT NULL)", name="chaves_so_no_push"
        ),
        # O mesmo destino não aparece duas vezes para a mesma pessoa. Outra pessoa
        # pode usar o mesmo (um grupo do Telegram ou um e-mail da equipe).
        UniqueConstraint(
            "usuario_id", "tipo", "destino", name="uq_canais_do_usuario_destino"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE")
    )
    tipo: Mapped[TipoDeCanal] = mapped_column(String(20))
    destino: Mapped[str] = mapped_column(String(TAMANHO_MAXIMO_DO_DESTINO))
    # none_as_null: sem ele, None vira o JSON 'null' em vez de NULL e quebra o CHECK.
    chaves_push: Mapped[dict[str, str] | None] = mapped_column(JSON(none_as_null=True))
    ativo: Mapped[bool] = mapped_column(Boolean, default=True)
