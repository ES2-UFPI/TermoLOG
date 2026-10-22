"""vincula sensor ao gateway

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-20 11:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Obrigatória desde já: só há bancos de desenvolvimento, então uma tabela de
    # sensores com linhas faz esta migration falhar e precisa ser limpa antes.
    op.add_column("sensores", sa.Column("gateway_id", sa.Integer(), nullable=False))
    op.create_foreign_key(
        op.f("fk_sensores_gateway_id_gateways"),
        "sensores",
        "gateways",
        ["gateway_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        op.f("ix_sensores_gateway_id"), "sensores", ["gateway_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_sensores_gateway_id"), table_name="sensores")
    op.drop_constraint(
        op.f("fk_sensores_gateway_id_gateways"), "sensores", type_="foreignkey"
    )
    op.drop_column("sensores", "gateway_id")
