from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, func, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from leituras.models import Leitura
    from salas.models import Sala


class Sensor(Base):
    __tablename__ = "sensores"

    # O ID é gerado pelo banco (sequence) e a chave primária garante que seja único.
    # Uma sequence nunca devolve um valor já usado, nem se o sensor for apagado.
    id: Mapped[int] = mapped_column(primary_key=True)
    # Sem exclusão em cascata: o histórico de leituras de uma sala não pode se perder.
    sala_id: Mapped[int] = mapped_column(
        ForeignKey("salas.id", ondelete="RESTRICT"), index=True
    )
    ativo: Mapped[bool] = mapped_column(default=True, server_default=true())
    data_cadastro: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    sala: Mapped["Sala"] = relationship(back_populates="sensores")
    leituras: Mapped[list["Leitura"]] = relationship(back_populates="sensor")
