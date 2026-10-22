"""cria gateways

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-20 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "gateways",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nome", sa.String(length=100), nullable=False),
        sa.Column("chave_api_hash", sa.String(length=64), nullable=False),
        sa.Column("ultimo_contato", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "data_cadastro",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_gateways")),
        sa.UniqueConstraint("chave_api_hash", name=op.f("uq_gateways_chave_api_hash")),
    )


def downgrade() -> None:
    op.drop_table("gateways")
