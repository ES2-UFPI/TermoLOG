from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from leituras.models import Leitura
    from sensores.models import Sensor


class Sala(Base):
    __tablename__ = "salas"
    # Mínimo menor que o máximo. Com limite nulo a comparação não falha: sala sem
    # faixa (ou com um limite só) é válida.
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
