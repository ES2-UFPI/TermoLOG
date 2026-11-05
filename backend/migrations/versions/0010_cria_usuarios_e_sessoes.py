"""cria usuários e sessões

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-05 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "usuarios",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nome", sa.String(length=100), nullable=False),
        sa.Column("email", sa.String(length=254), nullable=False),
        sa.Column("senha_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "data_cadastro",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "email = lower(email)", name=op.f("ck_usuarios_email_minusculo")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_usuarios")),
        sa.UniqueConstraint("email", name=op.f("uq_usuarios_email")),
    )
    op.create_table(
        "sessoes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("usuario_id", sa.Integer(), nullable=False),
        sa.Column("criada_em", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ultimo_uso", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["usuario_id"],
            ["usuarios.id"],
            name=op.f("fk_sessoes_usuario_id_usuarios"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sessoes")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_sessoes_token_hash")),
    )
    op.create_index(
        op.f("ix_sessoes_usuario_id"), "sessoes", ["usuario_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_sessoes_usuario_id"), table_name="sessoes")
    op.drop_table("sessoes")
    op.drop_table("usuarios")
