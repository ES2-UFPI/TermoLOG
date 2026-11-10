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
        "tentativas_de_login",
        "comandos",
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
    (canal_unico,) = inspetor.get_unique_constraints("canais_do_usuario")
    assert canal_unico["column_names"] == ["usuario_id", "tipo", "destino"]
    (fk_canal,) = inspetor.get_foreign_keys("canais_do_usuario")
    assert fk_canal["referred_table"] == "usuarios"
    assert fk_canal["options"]["ondelete"] == "CASCADE"
    indices = {
        indice["name"]: indice["column_names"]
        for indice in inspetor.get_indexes("tentativas_de_login")
    }
    assert indices == {
        "ix_tentativas_de_login_email_hash_data_hora": ["email_hash", "data_hora"],
        "ix_tentativas_de_login_ip_data_hora": ["ip", "data_hora"],
        "ix_tentativas_de_login_data_hora": ["data_hora"],
    }

    command.downgrade(alembic_config, "base")

    assert {
        "salas",
        "sensores",
        "leituras",
        "gateways",
        "usuarios",
        "sessoes",
        "tentativas_de_login",
        "canais_do_usuario",
        "comandos",
    }.isdisjoint(inspect(engine).get_table_names())
    engine.dispose()
