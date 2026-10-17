from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from salas.models import Sala
    from sensores.models import Sensor


class Leitura(Base):
    __tablename__ = "leituras"
    # Consultas do painel e do histórico: leituras de uma sala em um período.
    __table_args__ = (Index("ix_leituras_sala_id_data_hora", "sala_id", "data_hora"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    # Sem exclusão em cascata: o histórico de leituras não pode se perder.
    sensor_id: Mapped[int] = mapped_column(
        ForeignKey("sensores.id", ondelete="RESTRICT")
    )
    # A sala é gravada junto com a leitura para o histórico não mudar se o sensor
    # for movido para outra sala.
    sala_id: Mapped[int] = mapped_column(ForeignKey("salas.id", ondelete="RESTRICT"))
    temperatura: Mapped[float] = mapped_column(Float)
    umidade: Mapped[float] = mapped_column(Float)
    # Hora em que o nó mediu, e não em que a API recebeu: o nó central pode enviar
    # leituras atrasadas se a internet cair. Por isso não tem valor padrão.
    data_hora: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    sensor: Mapped["Sensor"] = relationship(back_populates="leituras")
    sala: Mapped["Sala"] = relationship(back_populates="leituras")
