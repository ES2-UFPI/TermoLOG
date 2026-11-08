"""Roda as migrations em um banco vazio. Precisa de um PostgreSQL (DATABASE_URL)."""

from alembic import command
from sqlalchemy import create_engine, inspect

from database import database_url


def test_migrations_rodam_em_banco_vazio_e_podem_ser_desfeitas(
    banco_vazio, alembic_config
):
    command.upgrade(alembic_config, "head")

    engine = create_engine(database_url())
    inspetor = inspect(engine)
    assert {
        "salas",
        "sensores",
        "leituras",
        "gateways",
        "lotes",
        "usuarios",
        "sessoes",
    } <= set(inspetor.get_table_names())
    chaves = {
        fk["referred_table"]: fk["constrained_columns"]
        for fk in inspetor.get_foreign_keys("sensores")
    }
    assert chaves == {"salas": ["sala_id"], "gateways": ["gateway_id"]}
    (unica,) = inspetor.get_unique_constraints("lotes")
    assert unica["column_names"] == ["gateway_id", "lote_id"]
    (indice,) = inspetor.get_indexes("leituras")
    assert indice["name"] == "ix_leituras_sala_id_data_hora"
    assert indice["column_names"] == ["sala_id", "data_hora"]
    (email_unico,) = inspetor.get_unique_constraints("usuarios")
    assert email_unico["column_names"] == ["email"]
    (fk_sessao,) = inspetor.get_foreign_keys("sessoes")
    assert fk_sessao["referred_table"] == "usuarios"
    assert fk_sessao["options"]["ondelete"] == "CASCADE"

    command.downgrade(alembic_config, "base")

    assert {
        "salas",
        "sensores",
        "leituras",
        "gateways",
        "usuarios",
        "sessoes",
    }.isdisjoint(inspect(engine).get_table_names())
    engine.dispose()
