"""cria alertas

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-22 14:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "alertas",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sala_id", sa.Integer(), nullable=False),
        sa.Column("sensor_id", sa.Integer(), nullable=False),
        sa.Column("leitura_id", sa.Integer(), nullable=False),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("data_hora", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "situacao",
            sa.String(length=20),
            server_default="pendente",
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["leitura_id"],
            ["leituras.id"],
            name=op.f("fk_alertas_leitura_id_leituras"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sala_id"],
            ["salas.id"],
            name=op.f("fk_alertas_sala_id_salas"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sensor_id"],
            ["sensores.id"],
            name=op.f("fk_alertas_sensor_id_sensores"),
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "tipo IN ('temperatura_abaixo', 'temperatura_acima', "
            "'umidade_abaixo', 'umidade_acima')",
            name=op.f("ck_alertas_tipo"),
        ),
        sa.CheckConstraint(
            "situacao IN ('pendente', 'reconhecido', 'encerrado')",
            name=op.f("ck_alertas_situacao"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_alertas")),
    )
    op.create_index(
        "uq_alertas_pendente_por_sala_e_tipo",
        "alertas",
        ["sala_id", "tipo"],
        unique=True,
        postgresql_where=sa.text("situacao = 'pendente'"),
    )


def downgrade() -> None:
    op.drop_index("uq_alertas_pendente_por_sala_e_tipo", table_name="alertas")
    op.drop_table("alertas")
