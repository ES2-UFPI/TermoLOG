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
    assert {"salas", "sensores"} <= set(inspetor.get_table_names())
    (fk,) = inspetor.get_foreign_keys("sensores")
    assert fk["referred_table"] == "salas"
    assert fk["constrained_columns"] == ["sala_id"]

    command.downgrade(alembic_config, "base")

    assert {"salas", "sensores"}.isdisjoint(inspect(engine).get_table_names())
    engine.dispose()
