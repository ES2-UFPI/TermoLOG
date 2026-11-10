from datetime import datetime
from typing import Literal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base

TipoDeComando = Literal["apitar"]
SituacaoDoComando = Literal["pendente", "entregue", "expirado"]


class Comando(Base):
    """Comando do painel para o nó de um sensor (Contrato de API, 1.3).

    Nasce ``pendente`` e vai no campo ``comandos`` da resposta de cada lote do
    gateway até ele informá-lo em ``comandos_concluidos`` (``entregue``) ou passar
    do ``expira_em`` (``expirado``).

    Limitação: a #160 (US22, ar-condicionado) prevê a mesma tabela para os comandos
    de climatização. Ela deve estender esta (novo valor em ``tipo``, colunas do
    comando novo, ajuste dos CHECKs), e não criar outra. Ver o README.
    """

    __tablename__ = "comandos"
    __table_args__ = (
        CheckConstraint("tipo IN ('apitar')", name="tipo"),
        CheckConstraint(
            "situacao IN ('pendente', 'entregue', 'expirado')", name="situacao"
        ),
        CheckConstraint("duracao_s BETWEEN 1 AND 60", name="duracao"),
        # O que o gateway busca a cada lote: os pendentes dos sensores dele.
        Index("ix_comandos_situacao_sensor_id", "situacao", "sensor_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # Sem exclusão em cascata: o sensor nunca é apagado, e o comando é histórico.
    sensor_id: Mapped[int] = mapped_column(
        ForeignKey("sensores.id", ondelete="RESTRICT")
    )
    tipo: Mapped[TipoDeComando] = mapped_column(String(20))
    # Duração do apito, em segundos. Só o tipo ``apitar`` existe por enquanto.
    duracao_s: Mapped[int]
    # Quem mandou. Nulo se o usuário for apagado: o comando continua registrado.
    usuario_id: Mapped[int | None] = mapped_column(
        ForeignKey("usuarios.id", ondelete="SET NULL")
    )
    situacao: Mapped[SituacaoDoComando] = mapped_column(
        String(20), default="pendente", server_default="pendente"
    )
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expira_em: Mapped[datetime] = mapped_column(DateTime(timezone=True))
