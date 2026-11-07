from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Usuario(Base):
    """Pessoa que entra no painel com e-mail e senha (US27)."""

    __tablename__ = "usuarios"
    __table_args__ = (
        # O e-mail é guardado em minúsculas, para a unicidade e o login não
        # dependerem de como a pessoa digitou.
        CheckConstraint("email = lower(email)", name="email_minusculo"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    # Só o hash (argon2id) da senha: a senha em si nunca é gravada.
    senha_hash: Mapped[str] = mapped_column(String(255))
    data_cadastro: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
