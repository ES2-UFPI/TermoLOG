"""cria os acessos negados

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


# US24 (#98): cada 403 de rota Admin fica registrado. É trilha de auditoria, então,
# como as leituras e os alertas (0009), o registro não pode ser alterado nem
# apagado, nem por fora da API. Reaproveita a função recusa_alteracao() da 0009.
def upgrade() -> None:
    op.create_table(
        "acessos_negados",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("usuario_id", sa.Integer(), nullable=False),
        sa.Column("metodo", sa.String(length=16), nullable=False),
        sa.Column("rota", sa.String(length=2048), nullable=False),
        sa.Column(
            "data_hora",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["usuario_id"],
            ["usuarios.id"],
            name=op.f("fk_acessos_negados_usuario_id_usuarios"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_acessos_negados")),
    )
    op.create_index(
        op.f("ix_acessos_negados_usuario_id"),
        "acessos_negados",
        ["usuario_id"],
        unique=False,
    )
    for operacao in ("update", "delete"):
        op.execute(
            f"""
            CREATE TRIGGER acessos_negados_recusa_{operacao}
            BEFORE {operacao.upper()} ON acessos_negados
            FOR EACH ROW EXECUTE FUNCTION recusa_alteracao()
            """
        )
    op.execute(
        """
        CREATE TRIGGER acessos_negados_recusa_truncate
        BEFORE TRUNCATE ON acessos_negados
        FOR EACH STATEMENT EXECUTE FUNCTION recusa_alteracao()
        """
    )


def downgrade() -> None:
    # Os triggers saem junto com a tabela; o DROP TABLE não dispara o de DELETE.
    op.drop_index(op.f("ix_acessos_negados_usuario_id"), table_name="acessos_negados")
    op.drop_table("acessos_negados")
