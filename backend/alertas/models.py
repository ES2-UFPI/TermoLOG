from datetime import datetime
from typing import TYPE_CHECKING, Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from leituras.models import Leitura
    from salas.models import Sala
    from sensores.models import Sensor


TipoDoDesvio = Literal[
    "temperatura_abaixo", "temperatura_acima", "umidade_abaixo", "umidade_acima"
]
Situacao = Literal["pendente", "reconhecido", "encerrado"]


class Alerta(Base):
    """Leitura fora da faixa da sala, a ser notificada (US17)."""

    __tablename__ = "alertas"
    # Um só alerta pendente por desvio na sala: as leituras seguintes com o mesmo
    # desvio mantêm o que já está aberto em vez de abrir outro.
    __table_args__ = (
        Index(
            "uq_alertas_pendente_por_sala_e_tipo",
            "sala_id",
            "tipo",
            unique=True,
            postgresql_where=text("situacao = 'pendente'"),
        ),
        CheckConstraint(
            "tipo IN ('temperatura_abaixo', 'temperatura_acima', "
            "'umidade_abaixo', 'umidade_acima')",
            name="tipo",
        ),
        CheckConstraint(
            "situacao IN ('pendente', 'reconhecido', 'encerrado')", name="situacao"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sala_id: Mapped[int] = mapped_column(ForeignKey("salas.id", ondelete="RESTRICT"))
    sensor_id: Mapped[int] = mapped_column(
        ForeignKey("sensores.id", ondelete="RESTRICT")
    )
    # Leitura que abriu o alerta.
    leitura_id: Mapped[int] = mapped_column(
        ForeignKey("leituras.id", ondelete="RESTRICT")
    )
    tipo: Mapped[TipoDoDesvio] = mapped_column(String(20))
    # Hora em que a API abriu o alerta; a da medição é a da leitura.
    data_hora: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    situacao: Mapped[Situacao] = mapped_column(
        String(20), default="pendente", server_default="pendente"
    )

    sala: Mapped["Sala"] = relationship()
    sensor: Mapped["Sensor"] = relationship()
    leitura: Mapped["Leitura"] = relationship()
