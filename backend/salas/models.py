from typing import TYPE_CHECKING

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from leituras.models import Leitura
    from sensores.models import Sensor


class Sala(Base):
    __tablename__ = "salas"

    id: Mapped[int] = mapped_column(primary_key=True)
    nome: Mapped[str] = mapped_column(String(100))
    descricao: Mapped[str | None] = mapped_column(Text)

    sensores: Mapped[list["Sensor"]] = relationship(back_populates="sala")
    leituras: Mapped[list["Leitura"]] = relationship(back_populates="sala")
