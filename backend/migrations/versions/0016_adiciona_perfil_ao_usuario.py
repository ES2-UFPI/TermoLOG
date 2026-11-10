"""adiciona o perfil ao usuário

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-10 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# US24 (#97): administrador ou visualizador. O padrão é sempre visualizador, tanto
# para os usuários que já existem quanto para os novos: ninguém ganha acesso de
# administrador sem alguém conceder. Depois da migration, o primeiro administrador
# sai de `python -m usuarios.admin_padrao` (ou `usuarios.definir_perfil`).
def upgrade() -> None:
    op.add_column(
        "usuarios",
        sa.Column(
            "perfil",
            sa.String(length=20),
            nullable=False,
            server_default="visualizador",
        ),
    )
    op.create_check_constraint(
        op.f("ck_usuarios_perfil_valido"),
        "usuarios",
        "perfil IN ('administrador', 'visualizador')",
    )


def downgrade() -> None:
    op.drop_constraint(op.f("ck_usuarios_perfil_valido"), "usuarios", type_="check")
    op.drop_column("usuarios", "perfil")
