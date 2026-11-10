"""cria o registro dos envios de notificação

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-10 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# US17 (#115): cada envio de alerta por um canal fica registrado, com o resultado.
def upgrade() -> None:
    op.create_table(
        "envios_de_notificacao",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("alerta_id", sa.Integer(), nullable=False),
        sa.Column("tipo", sa.String(length=20), nullable=False),
        sa.Column("destino", sa.String(length=2048), nullable=False),
        sa.Column("sucesso", sa.Boolean(), nullable=False),
        sa.Column("erro", sa.Text(), nullable=True),
        sa.Column(
            "enviado_em",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["alerta_id"],
            ["alertas.id"],
            name=op.f("fk_envios_de_notificacao_alerta_id_alertas"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_envios_de_notificacao")),
    )
    op.create_index(
        op.f("ix_envios_de_notificacao_alerta_id"),
        "envios_de_notificacao",
        ["alerta_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_envios_de_notificacao_alerta_id"), table_name="envios_de_notificacao"
    )
    op.drop_table("envios_de_notificacao")
