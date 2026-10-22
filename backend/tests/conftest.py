"""Fixtures dos testes que precisam de um PostgreSQL (DATABASE_URL)."""

import os
import uuid
from pathlib import Path

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from database import database_url, get_sessao
from gateways.service import GatewayService
from main import app

ALEMBIC_INI = Path(__file__).parent.parent / "alembic.ini"


@pytest.fixture
def alembic_config():
    return Config(str(ALEMBIC_INI))


@pytest.fixture
def banco_vazio(monkeypatch):
    """Cria um banco novo (vazio) só para o teste e o remove no final."""
    if "DATABASE_URL" not in os.environ:
        pytest.skip("DATABASE_URL não definida: sem PostgreSQL para testar o banco")

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


@pytest.fixture
def sessao(banco_vazio, alembic_config):
    """Sessão em um banco novo, com as migrations já aplicadas."""
    command.upgrade(alembic_config, "head")
    engine = create_engine(database_url())
    with Session(engine) as sessao:
        yield sessao
    engine.dispose()


@pytest.fixture
def client(sessao):
    """Cliente HTTP da API usando a sessão do banco de teste."""
    app.dependency_overrides[get_sessao] = lambda: sessao
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def gateway(sessao):
    """Gateway cadastrado, que todo sensor precisa ter."""
    gateway, _ = GatewayService(sessao).cadastrar("Filial Centro")
    return gateway
