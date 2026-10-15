"""cria salas e sensores

Revision ID: 0001
Revises:
Create Date: 2026-10-15 13:16:17.331931
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "salas",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nome", sa.String(length=100), nullable=False),
        sa.Column("descricao", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_salas")),
    )
    op.create_table(
        "sensores",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("sala_id", sa.Integer(), nullable=False),
        sa.Column(
            "ativo", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "data_cadastro",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["sala_id"],
            ["salas.id"],
            name=op.f("fk_sensores_sala_id_salas"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sensores")),
    )
    op.create_index(op.f("ix_sensores_sala_id"), "sensores", ["sala_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_sensores_sala_id"), table_name="sensores")
    op.drop_table("sensores")
    op.drop_table("salas")
