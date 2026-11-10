"""cria os comandos para os nós

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-10 11:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Contrato de API, 1.3 e 2.5: o painel manda o comando (ex.: apitar o buzzer) e o
# backend o entrega ao gateway na resposta do próximo lote. A #160 (US22) deve
# estender esta tabela em outra migration, e não criar uma tabela de comandos nova.
def upgrade() -> None:
    op.create_table(
        "comandos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sensor_id", sa.Integer(), nullable=False),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("duracao_s", sa.Integer(), nullable=False),
        sa.Column("usuario_id", sa.Integer(), nullable=True),
        sa.Column(
            "situacao", sa.String(length=20), server_default="pendente", nullable=False
        ),
        sa.Column(
            "criado_em",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expira_em", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("tipo IN ('apitar')", name=op.f("ck_comandos_tipo")),
        sa.CheckConstraint(
            "situacao IN ('pendente', 'entregue', 'expirado')",
            name=op.f("ck_comandos_situacao"),
        ),
        sa.CheckConstraint(
            "duracao_s BETWEEN 1 AND 60", name=op.f("ck_comandos_duracao")
        ),
        sa.ForeignKeyConstraint(
            ["sensor_id"],
            ["sensores.id"],
            name=op.f("fk_comandos_sensor_id_sensores"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["usuario_id"],
            ["usuarios.id"],
            name=op.f("fk_comandos_usuario_id_usuarios"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_comandos")),
    )
    op.create_index(
        "ix_comandos_situacao_sensor_id", "comandos", ["situacao", "sensor_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_comandos_situacao_sensor_id", table_name="comandos")
    op.drop_table("comandos")
