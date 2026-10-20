from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Gateway(Base):
    """Nó central de uma filial, que envia ao backend as leituras dos seus nós."""

    __tablename__ = "gateways"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(100))
    # Só o hash da chave de API: a chave em si aparece uma única vez, no cadastro.
    # É única para o gateway ser encontrado pela chave que ele envia.
    chave_api_hash: Mapped[str] = mapped_column(String(64), unique=True)
    # Último lote ou heartbeat recebido. Nulo enquanto o gateway nunca enviou nada.
    ultimo_contato: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    data_cadastro: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
