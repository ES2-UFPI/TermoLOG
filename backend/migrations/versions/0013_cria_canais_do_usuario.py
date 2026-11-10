"""cria os canais de notificação do usuário

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-09 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# US17 (#114): cada usuário escolhe por quais canais recebe os alertas.
def upgrade() -> None:
    op.create_table(
        "canais_do_usuario",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("usuario_id", sa.Integer(), nullable=False),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("destino", sa.String(length=2048), nullable=False),
        sa.Column("chaves_push", sa.JSON(), nullable=True),
        sa.Column("ativo", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "tipo IN ('email', 'push', 'telegram')",
            name=op.f("ck_canais_do_usuario_tipo"),
        ),
        sa.CheckConstraint(
            "(tipo = 'push') = (chaves_push IS NOT NULL)",
            name=op.f("ck_canais_do_usuario_chaves_so_no_push"),
        ),
        sa.ForeignKeyConstraint(
            ["usuario_id"],
            ["usuarios.id"],
            name=op.f("fk_canais_do_usuario_usuario_id_usuarios"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_canais_do_usuario")),
        sa.UniqueConstraint(
            "usuario_id",
            "tipo",
            "destino",
            name=op.f("uq_canais_do_usuario_destino"),
        ),
    )


def downgrade() -> None:
    op.drop_table("canais_do_usuario")
