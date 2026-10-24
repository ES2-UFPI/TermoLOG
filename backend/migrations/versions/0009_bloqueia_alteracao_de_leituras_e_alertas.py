"""bloqueia alteração de leituras e alertas

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-24 10:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# O histórico precisa ter validade perante a fiscalização: depois de gravadas,
# leituras e alertas não podem ser alterados nem apagados, nem por fora da API. Do
# alerta, só a situação pode mudar (reconhecimento, US12). O erro é de integridade
# (restrict_violation), como o de uma chave estrangeira com RESTRICT.
def upgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION recusa_alteracao() RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION '% em % não é permitido: o histórico é imutável',
                TG_OP, TG_TABLE_NAME
                USING ERRCODE = 'restrict_violation';
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE FUNCTION recusa_alteracao_do_alerta() RETURNS trigger AS $$
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
    for tabela in ("leituras", "alertas"):
        op.execute(
            f"""
            CREATE TRIGGER {tabela}_recusa_delete BEFORE DELETE ON {tabela}
            FOR EACH ROW EXECUTE FUNCTION recusa_alteracao()
            """
        )
        op.execute(
            f"""
            CREATE TRIGGER {tabela}_recusa_truncate BEFORE TRUNCATE ON {tabela}
            FOR EACH STATEMENT EXECUTE FUNCTION recusa_alteracao()
            """
        )
    op.execute(
        """
        CREATE TRIGGER leituras_recusa_update BEFORE UPDATE ON leituras
        FOR EACH ROW EXECUTE FUNCTION recusa_alteracao()
        """
    )
    op.execute(
        """
        CREATE TRIGGER alertas_recusa_update BEFORE UPDATE ON alertas
        FOR EACH ROW EXECUTE FUNCTION recusa_alteracao_do_alerta()
        """
    )


def downgrade() -> None:
    for tabela in ("leituras", "alertas"):
        for operacao in ("update", "delete", "truncate"):
            op.execute(f"DROP TRIGGER {tabela}_recusa_{operacao} ON {tabela}")
    op.execute("DROP FUNCTION recusa_alteracao_do_alerta()")
    op.execute("DROP FUNCTION recusa_alteracao()")
