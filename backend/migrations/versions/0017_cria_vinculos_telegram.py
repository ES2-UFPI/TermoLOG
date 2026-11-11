"""cria os vínculos pendentes do Telegram

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-11 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# US17 (#116): código de uso único que liga um chat do Telegram ao usuário.
def upgrade() -> None:
    op.create_table(
        "vinculos_telegram",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("usuario_id", sa.Integer(), nullable=False),
        sa.Column("codigo_hash", sa.String(length=64), nullable=False),
        sa.Column("expira_em", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["usuario_id"],
            ["usuarios.id"],
            name=op.f("fk_vinculos_telegram_usuario_id_usuarios"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_vinculos_telegram")),
        sa.UniqueConstraint(
            "codigo_hash", name=op.f("uq_vinculos_telegram_codigo_hash")
        ),
        sa.UniqueConstraint("usuario_id", name=op.f("uq_vinculos_telegram_usuario_id")),
    )


def downgrade() -> None:
    op.drop_table("vinculos_telegram")
