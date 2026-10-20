"""adiciona faixas na sala

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-17 15:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("salas", sa.Column("temperatura_min", sa.Float(), nullable=True))
    op.add_column("salas", sa.Column("temperatura_max", sa.Float(), nullable=True))
    op.add_column("salas", sa.Column("umidade_min", sa.Float(), nullable=True))
    op.add_column("salas", sa.Column("umidade_max", sa.Float(), nullable=True))
    op.create_check_constraint(
        op.f("ck_salas_faixa_temperatura"),
        "salas",
        "temperatura_min < temperatura_max",
    )
    op.create_check_constraint(
        op.f("ck_salas_faixa_umidade"), "salas", "umidade_min < umidade_max"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_salas_faixa_umidade"), "salas", type_="check")
    op.drop_constraint(op.f("ck_salas_faixa_temperatura"), "salas", type_="check")
    op.drop_column("salas", "umidade_max")
    op.drop_column("salas", "umidade_min")
    op.drop_column("salas", "temperatura_max")
    op.drop_column("salas", "temperatura_min")
