"""restringe as transições de situação do alerta

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-07 10:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEM_COLUNAS_LIBERADAS = (
    "- 'situacao' - 'reconhecido_em' - 'acao_corretiva' - 'encerrado_em'"
)

ERRO_DE_COLUNA = f"""
            IF to_jsonb(NEW) {SEM_COLUNAS_LIBERADAS}
                IS DISTINCT FROM to_jsonb(OLD) {SEM_COLUNAS_LIBERADAS}
            THEN
                RAISE EXCEPTION 'só a situação, o reconhecimento e o encerramento '
                    'do alerta podem ser alterados'
                    USING ERRCODE = 'restrict_violation';
            END IF;"""


def _recusa_alteracao_do_alerta(regras: str) -> str:
    return f"""
        CREATE OR REPLACE FUNCTION recusa_alteracao_do_alerta() RETURNS trigger AS $$
        BEGIN{regras}
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """


# Contrato de API, 2.7 (US25): o alerta só anda para a frente, pendente →
# reconhecido → encerrado, e depois de encerrado não muda mais.
def upgrade() -> None:
    op.execute(
        _recusa_alteracao_do_alerta(
            ERRO_DE_COLUNA
            + """
            IF OLD.situacao = 'encerrado' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
            THEN
                RAISE EXCEPTION 'alerta encerrado não pode mais ser alterado'
                    USING ERRCODE = 'restrict_violation';
            END IF;
            IF NEW.situacao IS DISTINCT FROM OLD.situacao
                AND (OLD.situacao, NEW.situacao) NOT IN (
                    ('pendente', 'reconhecido'), ('reconhecido', 'encerrado')
                )
            THEN
                RAISE EXCEPTION 'a situação do alerta não pode passar de % para %',
                    OLD.situacao, NEW.situacao
                    USING ERRCODE = 'restrict_violation';
            END IF;"""
        )
    )


def downgrade() -> None:
    op.execute(_recusa_alteracao_do_alerta(ERRO_DE_COLUNA))
