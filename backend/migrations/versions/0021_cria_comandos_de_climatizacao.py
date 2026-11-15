"""cria os comandos de climatização da sala

Revision ID: 0021
Revises: 0020
Create Date: 2026-11-15 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0021"
down_revision: str | None = "0020"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# US22 (#160): a sala aponta o nó com o emissor infravermelho, e os comandos do
# ar-condicionado ficam pendentes até o gateway entregá-los (contrato, 1.3).
def upgrade() -> None:
    op.add_column(
        "salas",
        sa.Column(
            "sensor_climatizacao_id",
            sa.Integer(),
            sa.ForeignKey(
                "sensores.id",
                name=op.f("fk_salas_sensor_climatizacao_id_sensores"),
                ondelete="RESTRICT",
            ),
        ),
    )
    op.create_table(
        "comandos_climatizacao",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sala_id", sa.Integer(), nullable=False),
        sa.Column("sensor_id", sa.Integer(), nullable=False),
        sa.Column("acao", sa.String(length=10), nullable=False),
        sa.Column("temperatura_c", sa.Integer(), nullable=True),
        sa.Column("usuario_id", sa.Integer(), nullable=False),
        sa.Column(
            "criado_em",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expira_em", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "situacao",
            sa.String(length=10),
            server_default="pendente",
            nullable=False,
        ),
        sa.CheckConstraint(
            "acao IN ('ligar', 'desligar', 'ajustar')",
            name=op.f("ck_comandos_climatizacao_acao"),
        ),
        sa.CheckConstraint(
            "(acao = 'ajustar') = (temperatura_c IS NOT NULL)"
            " AND temperatura_c BETWEEN 16 AND 30",
            name=op.f("ck_comandos_climatizacao_temperatura_c"),
        ),
        sa.CheckConstraint(
            "situacao IN ('pendente', 'entregue', 'expirado')",
            name=op.f("ck_comandos_climatizacao_situacao"),
        ),
        sa.ForeignKeyConstraint(
            ["sala_id"],
            ["salas.id"],
            name=op.f("fk_comandos_climatizacao_sala_id_salas"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sensor_id"],
            ["sensores.id"],
            name=op.f("fk_comandos_climatizacao_sensor_id_sensores"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["usuario_id"],
            ["usuarios.id"],
            name=op.f("fk_comandos_climatizacao_usuario_id_usuarios"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_comandos_climatizacao")),
    )
    op.create_index(
        op.f("ix_comandos_climatizacao_sala_id"),
        "comandos_climatizacao",
        ["sala_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_comandos_climatizacao_sensor_id"),
        "comandos_climatizacao",
        ["sensor_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_comandos_climatizacao_sensor_id"), table_name="comandos_climatizacao"
    )
    op.drop_index(
        op.f("ix_comandos_climatizacao_sala_id"), table_name="comandos_climatizacao"
    )
    op.drop_table("comandos_climatizacao")
    op.drop_column("salas", "sensor_climatizacao_id")
