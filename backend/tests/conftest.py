"""Fixtures dos testes que precisam de um PostgreSQL (DATABASE_URL)."""

import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import psycopg
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from psycopg import sql
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from alertas.models import Alerta
from auth.service import AuthService
from database import database_url, get_sessao
from gateways.service import GatewayService
from leituras.models import Leitura
from main import app
from salas.models import Sala
from sensores.service import SensorService
from usuarios.admin_padrao import EMAIL_ADMIN_PADRAO, NOME_ADMIN_PADRAO
from usuarios.models import Usuario

ALEMBIC_INI = Path(__file__).parent.parent / "alembic.ini"

# Hora em que os alertas de criar_alerta são abertos.
ABERTO_EM = datetime(2026, 10, 16, 17, 30, tzinfo=UTC)


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
def cliente_anonimo(sessao):
    """Cliente HTTP da API usando a sessão do banco de teste, sem credencial."""
    app.dependency_overrides[get_sessao] = lambda: sessao
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def usuario(sessao):
    """O administrador padrão (termolog@exemplo.com).

    Não entra por senha (o hash é inválido): a sessão dele é aberta direto, para os
    testes não pagarem o custo do argon2.
    """
    usuario = Usuario(
        nome=NOME_ADMIN_PADRAO,
        email=EMAIL_ADMIN_PADRAO,
        senha_hash="sem-senha",
        perfil="administrador",
    )
    sessao.add(usuario)
    sessao.flush()
    return usuario


@pytest.fixture
def token_do_usuario(sessao, usuario):
    _, token = AuthService(sessao).abrir_sessao(usuario)
    sessao.commit()
    return token


@pytest.fixture
def client(cliente_anonimo, token_do_usuario):
    """Cliente do painel, com um usuário logado (Authorization: Bearer <token>).

    É outro objeto, e não o cliente_anonimo com o token: assim um teste que usa os
    dois continua tendo um cliente realmente sem credencial.
    """
    return TestClient(app, headers={"Authorization": f"Bearer {token_do_usuario}"})


@pytest.fixture
def visualizador(cliente_anonimo, sessao):
    """Cliente de um visualizador logado: lê o painel, mas não usa as rotas Admin."""
    pessoa = Usuario(
        nome="Vera",
        email="vera@exemplo.com",
        senha_hash="sem-senha",
        perfil="visualizador",
    )
    sessao.add(pessoa)
    sessao.flush()
    _, token = AuthService(sessao).abrir_sessao(pessoa)
    sessao.commit()
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


@pytest.fixture
def gateway(sessao):
    """Gateway cadastrado, que todo sensor precisa ter."""
    gateway, _ = GatewayService(sessao).cadastrar("Filial Centro")
    return gateway


@pytest.fixture
def criar_alerta(sessao, gateway):
    """Cria um alerta na situação pedida, aberto pela leitura medida 5 s antes."""
    sala = Sala(nome="Câmara fria 1", temperatura_max=8)
    sessao.add(sala)
    sessao.flush()
    sensor = SensorService(sessao).cadastrar(sala.id, gateway.id)

    def criar(situacao="pendente", **atendimento):
        leitura = Leitura(
            sensor_id=sensor.id,
            sala_id=sala.id,
            temperatura=9.1,
            umidade=61.0,
            data_hora=ABERTO_EM - timedelta(seconds=5),
        )
        sessao.add(leitura)
        sessao.flush()
        alerta = Alerta(
            sala_id=sala.id,
            sensor_id=sensor.id,
            leitura_id=leitura.id,
            tipo="temperatura_acima",
            data_hora=ABERTO_EM,
            situacao=situacao,
            **atendimento,
        )
        sessao.add(alerta)
        sessao.commit()
        return alerta

    return criar
