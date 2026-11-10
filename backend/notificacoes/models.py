from datetime import datetime
from typing import Literal

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
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


class EnvioDeNotificacao(Base):
    """Registro de uma tentativa de envio de um alerta por um canal (US17, US20).

    Tipo e destino são copiados do canal na hora do envio, e não ligados a ele por
    chave: o ``PUT /auth/me/canais`` apaga e recria os canais, e o registro precisa
    continuar mostrando para onde o alerta foi.
    """

    __tablename__ = "envios_de_notificacao"

    id: Mapped[int] = mapped_column(primary_key=True)
    alerta_id: Mapped[int] = mapped_column(
        ForeignKey("alertas.id", ondelete="RESTRICT"), index=True
    )
    tipo: Mapped[str] = mapped_column(String(20))
    destino: Mapped[str] = mapped_column(String(TAMANHO_MAXIMO_DO_DESTINO))
    sucesso: Mapped[bool] = mapped_column(Boolean)
    # Mensagem do erro quando o envio falhou; nula quando deu certo.
    erro: Mapped[str | None] = mapped_column(Text)
    enviado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
