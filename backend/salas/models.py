from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from leituras.models import Leitura
    from sensores.models import Sensor


class Sala(Base):
    __tablename__ = "salas"
    # Cada limite é opcional e nulo quer dizer "sem limite desse lado": a sala pode
    # ter faixa (mínimo e máximo), só máximo (ex.: câmara fria), só mínimo ou
    # nenhum. Com os dois preenchidos, o mínimo tem que ser menor que o máximo;
    # com um nulo a comparação não falha.
    __table_args__ = (
        CheckConstraint("temperatura_min < temperatura_max", name="faixa_temperatura"),
        CheckConstraint("umidade_min < umidade_max", name="faixa_umidade"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(100))
    descricao: Mapped[str | None] = mapped_column(Text)
    temperatura_min: Mapped[float | None] = mapped_column(Float)
    temperatura_max: Mapped[float | None] = mapped_column(Float)
    umidade_min: Mapped[float | None] = mapped_column(Float)
    umidade_max: Mapped[float | None] = mapped_column(Float)

    sensores: Mapped[list["Sensor"]] = relationship(back_populates="sala")
    leituras: Mapped[list["Leitura"]] = relationship(back_populates="sala")
