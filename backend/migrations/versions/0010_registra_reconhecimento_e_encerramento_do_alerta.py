"""registra reconhecimento e encerramento do alerta

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

COLUNAS_DO_ATENDIMENTO = ("reconhecido_em", "acao_corretiva", "encerrado_em")


def _recusa_alteracao_do_alerta(liberadas: Sequence[str]) -> str:
    """Função do trigger que só deixa mudar as colunas liberadas."""
    sem_liberadas = " - ".join(f"'{coluna}'" for coluna in liberadas)
    return f"""
        CREATE OR REPLACE FUNCTION recusa_alteracao_do_alerta() RETURNS trigger AS $$
        BEGIN
            IF to_jsonb(NEW) - {sem_liberadas}
                IS DISTINCT FROM to_jsonb(OLD) - {sem_liberadas}
            THEN
                RAISE EXCEPTION 'só a situação, o reconhecimento e o encerramento '
                    'do alerta podem ser alterados'
                    USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """


# O reconhecimento (US12) e o encerramento (US26) gravam a hora e a ação corretiva
# no alerta, então o trigger da 0009 passa a liberar essas colunas além da situação.
def upgrade() -> None:
    op.add_column("alertas", sa.Column("reconhecido_em", sa.DateTime(timezone=True)))
    op.add_column("alertas", sa.Column("acao_corretiva", sa.Text()))
    op.add_column("alertas", sa.Column("encerrado_em", sa.DateTime(timezone=True)))
    op.execute(_recusa_alteracao_do_alerta(("situacao", *COLUNAS_DO_ATENDIMENTO)))


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION recusa_alteracao_do_alerta() RETURNS trigger AS $$
        BEGIN
            IF to_jsonb(NEW) - 'situacao' IS DISTINCT FROM to_jsonb(OLD) - 'situacao'
            THEN
                RAISE EXCEPTION 'só a situação do alerta pode ser alterada'
                    USING ERRCODE = 'restrict_violation';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    for coluna in reversed(COLUNAS_DO_ATENDIMENTO):
        op.drop_column("alertas", coluna)
