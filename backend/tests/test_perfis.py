"""Perfis (US24, #97): o visualizador recebe 403 nas rotas Admin do contrato.

Precisam de um PostgreSQL (DATABASE_URL).
"""

import logging
import re

import pytest
from alembic import command
from sqlalchemy import create_engine, inspect, text

from database import database_url
from tests.test_rotas_protegidas import ROTAS_PUBLICAS, rotas_da_api

SEM_PERMISSAO = {"detail": "permissão insuficiente"}
INICIO = "2026-01-01T00:00:00Z"
FIM = "2026-01-02T00:00:00Z"

# (método, caminho) das rotas Admin do contrato (2.4 a 2.6) que existem. O
# POST /sensores/{id}/comandos, que o contrato também marca como Admin, não foi
# implementado de propósito: o buzzer era só um exemplo e não será usado.
ROTAS_ADMIN = [
    ("POST", "/salas"),
    ("PATCH", "/salas/{id}"),
    ("GET", "/salas/{id}/sensores"),
    ("POST", "/salas/{id}/sensores"),
    ("POST", "/sensores/{id}/desativar"),
    ("GET", "/gateways"),
    ("POST", "/gateways"),
]


def url(caminho: str, id: int = 1) -> str:
    return re.sub(r"\{[^}]+\}", str(id), caminho)


def caminho_do_app(caminho: str) -> str:
    # O app nomeia o parâmetro de cada rota ({sala_id}, {sensor_id}); aqui
    # basta o nome genérico.
    return re.sub(r"\{[^}]+\}", "{id}", caminho)


@pytest.fixture
def dados(client, gateway):
    """Uma sala com um sensor, para as rotas Admin terem o que achar."""
    sala = client.post("/salas", json={"nome": "Sala 1"}).json()
    sensor = client.post(
        f"/salas/{sala['id']}/sensores", json={"gateway_id": gateway.id}
    ).json()
    return {"sala": sala["id"], "sensor": sensor["id"], "gateway": gateway.id}


def pedido(metodo, caminho, dados):
    """O método, a URL e o corpo válidos de cada rota Admin, em nome da sala de teste."""
    if caminho.startswith("/sensores/"):
        sensor = f"/sensores/{dados['sensor']}"
        return metodo, f"{sensor}/desativar", None
    corpo = {
        ("POST", "/salas"): {"nome": "Sala 2"},
        ("PATCH", "/salas/{id}"): {"nome": "Sala renomeada"},
        ("POST", "/salas/{id}/sensores"): {"gateway_id": dados["gateway"]},
        ("POST", "/gateways"): {"nome": "Filial Norte"},
    }.get((metodo, caminho))
    return metodo, url(caminho, dados["sala"]), corpo


def test_as_rotas_admin_existem():
    assert set(ROTAS_ADMIN) <= {
        (metodo, caminho_do_app(caminho)) for metodo, caminho in rotas_da_api()
    }


# Visualizador


@pytest.mark.parametrize("metodo, caminho", ROTAS_ADMIN)
def test_visualizador_recebe_403_nas_rotas_admin(visualizador, dados, metodo, caminho):
    metodo, destino, corpo = pedido(metodo, caminho, dados)

    resposta = visualizador.request(metodo, destino, json=corpo)

    assert resposta.status_code == 403
    assert resposta.json() == SEM_PERMISSAO


@pytest.mark.parametrize("metodo, caminho", ROTAS_ADMIN)
def test_visualizador_recebe_403_mesmo_com_corpo_invalido(
    visualizador, metodo, caminho
):
    # O perfil é conferido antes do corpo: não dá para sondar a rota com um 422.
    resposta = visualizador.request(metodo, url(caminho), json={"invalido": True})

    assert resposta.status_code == 403
    assert resposta.json() == SEM_PERMISSAO


def test_403_nao_altera_nada(visualizador, client, dados, sessao):
    visualizador.post("/salas", json={"nome": "Sala do visualizador"})
    visualizador.patch(f"/salas/{dados['sala']}", json={"nome": "Trocada"})
    visualizador.post(f"/sensores/{dados['sensor']}/desativar")
    visualizador.post("/gateways", json={"nome": "Gateway do visualizador"})

    assert [sala["nome"] for sala in client.get("/salas").json()] == ["Sala 1"]
    sensores = client.get(f"/salas/{dados['sala']}/sensores").json()
    assert [sensor["ativo"] for sensor in sensores] == [True]
    assert len(client.get("/gateways").json()) == 1


def test_visualizador_usa_as_rotas_de_leitura(visualizador, dados):
    for caminho in (
        "/salas",
        f"/salas/{dados['sala']}",
        "/salas/status",
        "/salas/indicadores",
        f"/sensores/{dados['sensor']}/leituras?inicio={INICIO}&fim={FIM}",
    ):
        resposta = visualizador.get(caminho)
        assert resposta.status_code != 403, caminho
        assert resposta.status_code == 200, (caminho, resposta.text)


def test_visualizador_continua_logado_e_sem_token_continua_401(
    visualizador, cliente_anonimo
):
    assert visualizador.post("/auth/logout").status_code == 204
    # Sem login é 401, e não 403: o perfil só é conferido depois do login.
    resposta = cliente_anonimo.post("/salas", json={"nome": "Sala"})
    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "não autenticado"}


def test_so_as_rotas_admin_negam_o_visualizador(visualizador, dados):
    """Rota nova do painel entra aqui sozinha: ou é Admin e está em ROTAS_ADMIN,
    ou o visualizador não pode levar 403 nela."""
    admin = {(m, caminho_do_app(c)) for m, c in ROTAS_ADMIN}
    # O logout encerraria a sessão do teste e as rotas seguintes dariam 401.
    rotas = set(rotas_da_api()) - ROTAS_PUBLICAS - {("POST", "/auth/logout")}
    for metodo, caminho in sorted(rotas):
        resposta = visualizador.request(
            metodo, url(caminho, dados["sala"]), json={"invalido": True}
        )
        if (metodo, caminho_do_app(caminho)) in admin:
            assert resposta.status_code == 403, (metodo, caminho)
        else:
            assert resposta.status_code != 403, (metodo, caminho)


def test_tentativa_negada_fica_registrada(visualizador, caplog):
    with caplog.at_level(logging.WARNING, logger="auth.router"):
        visualizador.post("/salas", json={"nome": "Sala"})

    (registro,) = [r for r in caplog.records if r.name == "auth.router"]
    mensagem = registro.getMessage()
    assert "acesso negado" in mensagem
    assert "visualizador" in mensagem
    assert "POST" in mensagem
    assert "/salas" in mensagem


def test_caminho_com_quebra_de_linha_nao_quebra_o_registro(visualizador, caplog):
    with caplog.at_level(logging.WARNING, logger="auth.router"):
        visualizador.get("/salas/1%0Afalso/sensores")

    (registro,) = [r for r in caplog.records if r.name == "auth.router"]
    assert "\n" not in registro.getMessage()


# Administrador


def test_administrador_usa_todas_as_rotas_admin(client, dados):
    for metodo, caminho in ROTAS_ADMIN:
        metodo, destino, corpo = pedido(metodo, caminho, dados)

        resposta = client.request(metodo, destino, json=corpo)

        assert resposta.status_code in (200, 201, 202), (
            metodo,
            caminho,
            resposta.text,
        )


# /auth/me e login


def test_me_devolve_o_perfil(client, visualizador):
    assert client.get("/auth/me").json()["perfil"] == "administrador"
    assert visualizador.get("/auth/me").json()["perfil"] == "visualizador"


# Migration


def test_migration_deixa_os_usuarios_existentes_como_visualizadores(
    banco_vazio, alembic_config
):
    command.upgrade(alembic_config, "0015")
    engine = create_engine(database_url())
    with engine.begin() as conexao:
        conexao.execute(
            text(
                "INSERT INTO usuarios (nome, email, senha_hash) "
                "VALUES ('Ana', 'ana@exemplo.com', 'x')"
            )
        )

    command.upgrade(alembic_config, "0016")

    with engine.begin() as conexao:
        assert conexao.scalar(text("SELECT perfil FROM usuarios")) == "visualizador"

    command.downgrade(alembic_config, "0015")
    colunas = {coluna["name"] for coluna in inspect(engine).get_columns("usuarios")}
    assert "perfil" not in colunas
    engine.dispose()
