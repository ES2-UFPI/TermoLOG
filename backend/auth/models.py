from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base
from usuarios.models import Usuario


class SessaoDeLogin(Base):
    """Sessão aberta no login. Vale até 30 minutos depois do último uso (US27)."""

    __tablename__ = "sessoes"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Só o hash do token: o token em si aparece uma única vez, na resposta do login.
    # É único para a sessão ser encontrada pelo token que o painel envia.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE"), index=True
    )
    criada_em: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ultimo_uso: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    usuario: Mapped[Usuario] = relationship()


class TentativaDeLogin(Base):
    """Login que errou o e-mail ou a senha, contado para o limite de tentativas.

    A linha é gravada antes de a senha ser conferida (ver auth.tentativas) e fica
    só se o login falhar. Linhas mais velhas que a janela do limite são apagadas.
    """

    __tablename__ = "tentativas_de_login"
    __table_args__ = (
        Index("ix_tentativas_de_login_email_hash_data_hora", "email_hash", "data_hora"),
        Index("ix_tentativas_de_login_ip_data_hora", "ip", "data_hora"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # SHA-256 do e-mail normalizado, e não o texto digitado (ver hash_do_email).
    email_hash: Mapped[str] = mapped_column(String(64))
    # O IP (no IPv6, a rede /64). Sem tamanho: vem do servidor ou do proxy, não de
    # um formulário.
    ip: Mapped[str] = mapped_column(String)
    # Índice próprio para a limpeza das tentativas fora da janela.
    data_hora: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
