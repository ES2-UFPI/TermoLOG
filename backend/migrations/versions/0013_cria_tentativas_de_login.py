"""cria tentativas de login

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


def upgrade() -> None:
    op.create_table(
        "tentativas_de_login",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("email_hash", sa.String(length=64), nullable=False),
        sa.Column("ip", sa.String(), nullable=True),
        sa.Column("data_hora", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_tentativas_de_login")),
    )
    op.create_index(
        "ix_tentativas_de_login_email_hash_data_hora",
        "tentativas_de_login",
        ["email_hash", "data_hora"],
        unique=False,
    )
    op.create_index(
        "ix_tentativas_de_login_ip_data_hora",
        "tentativas_de_login",
        ["ip", "data_hora"],
        unique=False,
    )
    op.create_index(
        op.f("ix_tentativas_de_login_data_hora"),
        "tentativas_de_login",
        ["data_hora"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_tentativas_de_login_data_hora"), table_name="tentativas_de_login"
    )
    op.drop_index(
        "ix_tentativas_de_login_ip_data_hora", table_name="tentativas_de_login"
    )
    op.drop_index(
        "ix_tentativas_de_login_email_hash_data_hora", table_name="tentativas_de_login"
    )
    op.drop_table("tentativas_de_login")
