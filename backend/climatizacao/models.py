from datetime import datetime
from typing import TYPE_CHECKING, Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from usuarios.models import Usuario

Acao = Literal["ligar", "desligar", "ajustar"]
SituacaoDoComando = Literal["pendente", "entregue", "expirado"]


class ComandoDeClimatizacao(Base):
    """Comando infravermelho do ar-condicionado da sala (US22, #160).

    Fica pendente até o gateway confirmá-lo em comandos_concluidos (entregue) ou
    passar do expira_em (expirado). Contrato de API, 1.3.
    """

    __tablename__ = "comandos_climatizacao"
    __table_args__ = (
        CheckConstraint("acao IN ('ligar', 'desligar', 'ajustar')", name="acao"),
        # A temperatura vai só no ajuste, e lá é obrigatória (16 a 30 °C).
        CheckConstraint(
            "(acao = 'ajustar') = (temperatura_c IS NOT NULL)"
            " AND temperatura_c BETWEEN 16 AND 30",
            name="temperatura_c",
        ),
        CheckConstraint(
            "situacao IN ('pendente', 'entregue', 'expirado')", name="situacao"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # A sala do momento do comando, para o histórico não mudar se o sensor mudar.
    sala_id: Mapped[int] = mapped_column(
        ForeignKey("salas.id", ondelete="RESTRICT"), index=True
    )
    sensor_id: Mapped[int] = mapped_column(
        ForeignKey("sensores.id", ondelete="RESTRICT"), index=True
    )
    acao: Mapped[Acao] = mapped_column(String(10))
    temperatura_c: Mapped[int | None]
    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="RESTRICT")
    )
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expira_em: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    situacao: Mapped[SituacaoDoComando] = mapped_column(
        String(10), default="pendente", server_default="pendente"
    )

    usuario: Mapped["Usuario"] = relationship()
