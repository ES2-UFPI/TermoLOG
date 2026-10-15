"""Roda as migrations em um banco vazio. Precisa de um PostgreSQL (DATABASE_URL)."""

import os
import uuid
from pathlib import Path

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from psycopg import sql
from sqlalchemy import create_engine, inspect

from database import database_url

pytestmark = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="DATABASE_URL não definida: sem PostgreSQL para testar as migrations",
)

ALEMBIC_INI = Path(__file__).parent.parent / "alembic.ini"


@pytest.fixture
def banco_vazio(monkeypatch):
    """Cria um banco novo (vazio) só para o teste e o remove no final."""
    url_original = database_url()
    nome = f"termolog_test_{uuid.uuid4().hex[:8]}"
    admin = psycopg.connect(url_original.replace("+psycopg", ""), autocommit=True)
    admin.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(nome)))

    url_teste = create_engine(url_original).url.set(database=nome)
    monkeypatch.setenv("DATABASE_URL", url_teste.render_as_string(hide_password=False))
    try:
        yield
    finally:
        admin.execute(
            sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(nome))
        )
        admin.close()


def test_migrations_rodam_em_banco_vazio_e_podem_ser_desfeitas(banco_vazio):
    config = Config(str(ALEMBIC_INI))

    command.upgrade(config, "head")

    engine = create_engine(database_url())
    inspetor = inspect(engine)
    assert {"salas", "sensores"} <= set(inspetor.get_table_names())
    (fk,) = inspetor.get_foreign_keys("sensores")
    assert fk["referred_table"] == "salas"
    assert fk["constrained_columns"] == ["sala_id"]

    command.downgrade(config, "base")

    assert {"salas", "sensores"}.isdisjoint(inspect(engine).get_table_names())
    engine.dispose()
