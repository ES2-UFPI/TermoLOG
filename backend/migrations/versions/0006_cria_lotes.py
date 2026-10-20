"""cria lotes

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-20 11:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "lotes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("gateway_id", sa.Integer(), nullable=False),
        sa.Column("lote_id", sa.Uuid(), nullable=False),
        sa.Column("aceitas", sa.Integer(), nullable=False),
        sa.Column("rejeitadas", sa.JSON(), nullable=False),
        sa.Column(
            "recebido_em",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["gateway_id"],
            ["gateways.id"],
            name=op.f("fk_lotes_gateway_id_gateways"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_lotes")),
        sa.UniqueConstraint("gateway_id", "lote_id", name=op.f("uq_lotes_gateway_id")),
    )


def downgrade() -> None:
    op.drop_table("lotes")
