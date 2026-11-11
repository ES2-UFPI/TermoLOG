"""registra quem reconheceu o alerta

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-11 10:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _sem_colunas(colunas: Sequence[str]) -> str:
    return " ".join(f"- '{coluna}'" for coluna in colunas)


def _recusa_alteracao_do_alerta(liberadas: Sequence[str], regras: str = "") -> str:
    """Função do trigger: só as colunas liberadas mudam, e só no fluxo da 0012."""
    sem_liberadas = _sem_colunas(liberadas)
    return f"""
        CREATE OR REPLACE FUNCTION recusa_alteracao_do_alerta() RETURNS trigger AS $$
        BEGIN
            IF to_jsonb(NEW) {sem_liberadas}
                IS DISTINCT FROM to_jsonb(OLD) {sem_liberadas}
            THEN
                RAISE EXCEPTION 'só a situação, o reconhecimento e o encerramento '
                    'do alerta podem ser alterados'
                    USING ERRCODE = 'restrict_violation';
            END IF;
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
            END IF;{regras}
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """


LIBERADAS_ANTES = ("situacao", "reconhecido_em", "acao_corretiva", "encerrado_em")

# Quem reconheceu e quando só são gravados junto com a passagem de pendente para
# reconhecido: depois disso, nem a API nem um UPDATE por fora trocam a autoria.
SO_NO_RECONHECIMENTO = """
            IF (NEW.reconhecido_por, NEW.reconhecido_em)
                    IS DISTINCT FROM (OLD.reconhecido_por, OLD.reconhecido_em)
                AND (OLD.situacao, NEW.situacao) <> ('pendente', 'reconhecido')
            THEN
                RAISE EXCEPTION 'o reconhecimento do alerta só é gravado na passagem '
                    'de pendente para reconhecido'
                    USING ERRCODE = 'restrict_violation';
            END IF;"""


# US12 (#101): o alerta guarda o usuário da sessão que o reconheceu. RESTRICT, como
# as outras chaves do histórico: o usuário que reconheceu um alerta não é apagado.
def upgrade() -> None:
    op.add_column(
        "alertas",
        sa.Column(
            "reconhecido_por",
            sa.Integer(),
            sa.ForeignKey(
                "usuarios.id",
                name=op.f("fk_alertas_reconhecido_por_usuarios"),
                ondelete="RESTRICT",
            ),
        ),
    )
    op.execute(
        _recusa_alteracao_do_alerta(
            (*LIBERADAS_ANTES, "reconhecido_por"), SO_NO_RECONHECIMENTO
        )
    )


def downgrade() -> None:
    # A função volta antes da coluna sair: a da 0018 cita reconhecido_por.
    op.execute(_recusa_alteracao_do_alerta(LIBERADAS_ANTES))
    op.drop_column("alertas", "reconhecido_por")
