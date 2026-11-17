"""restringe o encerramento à passagem para encerrado

Revision ID: 0020
Revises: 0019
Create Date: 2026-11-12 10:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0020"
down_revision: str | None = "0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

LIBERADAS = (
    "situacao",
    "reconhecido_em",
    "acao_corretiva",
    "encerrado_em",
    "reconhecido_por",
)

# Regra da 0018: quem reconheceu e quando só mudam de pendente para reconhecido.
SO_NO_RECONHECIMENTO = """
            IF (NEW.reconhecido_por, NEW.reconhecido_em)
                    IS DISTINCT FROM (OLD.reconhecido_por, OLD.reconhecido_em)
                AND (OLD.situacao, NEW.situacao) <> ('pendente', 'reconhecido')
            THEN
                RAISE EXCEPTION 'o reconhecimento do alerta só é gravado na passagem '
                    'de pendente para reconhecido'
                    USING ERRCODE = 'restrict_violation';
            END IF;"""

# US12 (#102): a ação corretiva e a hora do encerramento só são gravadas junto com
# a passagem de reconhecido para encerrado. Um UPDATE por fora da API não deixa
# uma ação num alerta que continua aberto.
SO_NO_ENCERRAMENTO = """
            IF (NEW.acao_corretiva, NEW.encerrado_em)
                    IS DISTINCT FROM (OLD.acao_corretiva, OLD.encerrado_em)
                AND (OLD.situacao, NEW.situacao) <> ('reconhecido', 'encerrado')
            THEN
                RAISE EXCEPTION 'o encerramento do alerta só é gravado na passagem '
                    'de reconhecido para encerrado'
                    USING ERRCODE = 'restrict_violation';
            END IF;"""


def _recusa_alteracao_do_alerta(regras: str) -> str:
    """Função do trigger, igual à da 0018 com as regras extras no fim."""
    sem_liberadas = " ".join(f"- '{coluna}'" for coluna in LIBERADAS)
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


def upgrade() -> None:
    op.execute(_recusa_alteracao_do_alerta(SO_NO_RECONHECIMENTO + SO_NO_ENCERRAMENTO))


def downgrade() -> None:
    op.execute(_recusa_alteracao_do_alerta(SO_NO_RECONHECIMENTO))
