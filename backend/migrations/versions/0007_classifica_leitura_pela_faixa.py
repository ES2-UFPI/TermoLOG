"""classifica leitura pela faixa

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-22 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("leituras", sa.Column("dentro_da_faixa", sa.Boolean(), nullable=True))
    # Leituras já gravadas são classificadas pela faixa atual da sala, com a mesma
    # regra de salas.service.dentro_da_faixa (limite nulo não conta, igual é dentro).
    op.execute(
        """
        UPDATE leituras SET dentro_da_faixa =
            (salas.temperatura_min IS NULL OR temperatura >= salas.temperatura_min)
            AND (salas.temperatura_max IS NULL OR temperatura <= salas.temperatura_max)
            AND (salas.umidade_min IS NULL OR umidade >= salas.umidade_min)
            AND (salas.umidade_max IS NULL OR umidade <= salas.umidade_max)
        FROM salas
        WHERE salas.id = leituras.sala_id
        """
    )


def downgrade() -> None:
    op.drop_column("leituras", "dentro_da_faixa")
