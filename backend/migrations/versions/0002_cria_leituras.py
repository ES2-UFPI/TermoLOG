"""cria leituras

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-16 13:09:35.777150
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "leituras",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sensor_id", sa.Integer(), nullable=False),
        sa.Column("sala_id", sa.Integer(), nullable=False),
        sa.Column("temperatura", sa.Float(), nullable=False),
        sa.Column("umidade", sa.Float(), nullable=False),
        sa.Column("data_hora", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["sala_id"],
            ["salas.id"],
            name=op.f("fk_leituras_sala_id_salas"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["sensor_id"],
            ["sensores.id"],
            name=op.f("fk_leituras_sensor_id_sensores"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_leituras")),
    )
    op.create_index(
        "ix_leituras_sala_id_data_hora",
        "leituras",
        ["sala_id", "data_hora"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_leituras_sala_id_data_hora", table_name="leituras")
    op.drop_table("leituras")
