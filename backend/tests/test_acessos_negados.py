"""Registro dos acessos negados às rotas Admin (US24, #98).

Precisam de um PostgreSQL (DATABASE_URL).
"""

from datetime import UTC, datetime, timedelta

import pytest
from alembic import command
from sqlalchemy import create_engine, delete, inspect, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.acessos_negados import registrar_acesso_negado
from auth.models import AcessoNegado
from database import database_url
from tests.test_perfis import ROTAS_ADMIN, url
from tests.test_rotas_protegidas import ROTAS_PUBLICAS, rotas_da_api
from usuarios.models import Usuario


def registros(sessao):
    """Os registros gravados, lidos por uma conexão à parte: só aparece o que foi
    commitado, e não o que a sessão do teste ainda tem aberto."""
    with Session(sessao.get_bind()) as outra:
        return list(outra.scalars(select(AcessoNegado).order_by(AcessoNegado.id)))


# Gravação do 403


@pytest.mark.parametrize("metodo, caminho", ROTAS_ADMIN)
def test_cada_403_gera_um_registro_de_quem_o_que_e_quando(
    visualizador, sessao, metodo, caminho
):
    antes = datetime.now(UTC)
    destino = url(caminho, 7)

    resposta = visualizador.request(metodo, destino, json={"invalido": True})

    assert resposta.status_code == 403
    (registro,) = registros(sessao)
    pessoa = sessao.scalar(select(Usuario).where(Usuario.email == "vera@exemplo.com"))
    assert registro.usuario_id == pessoa.id
    assert registro.metodo == metodo
    assert registro.rota == destino
    assert antes - timedelta(seconds=5) <= registro.data_hora
    assert registro.data_hora <= datetime.now(UTC) + timedelta(seconds=5)


def test_cada_tentativa_gera_o_seu_registro(visualizador, sessao):
    visualizador.post("/salas", json={"nome": "A"})
    visualizador.post("/salas", json={"nome": "B"})
    visualizador.get("/gateways")

    assert [(r.metodo, r.rota) for r in registros(sessao)] == [
        ("POST", "/salas"),
        ("POST", "/salas"),
        ("GET", "/gateways"),
    ]


def test_registro_fica_mesmo_com_o_rollback_da_requisicao(visualizador, sessao):
    visualizador.post("/salas", json={"nome": "Sala"})

    # A requisição recusada termina em erro e a sessão dela é desfeita.
    sessao.rollback()

    assert len(registros(sessao)) == 1


def test_registro_gravado_dentro_de_uma_transacao_sobrevive_ao_rollback(
    sessao, usuario
):
    # O usuário precisa estar commitado: o registro usa outra conexão.
    sessao.commit()
    sessao.add(Usuario(nome="Outro", email="outro@exemplo.com", senha_hash="x"))
    sessao.flush()
    registrar_acesso_negado(sessao, usuario.id, "POST", "/salas")

    sessao.rollback()

    assert len(registros(sessao)) == 1


def test_caminho_com_caractere_nulo_ainda_responde_403_e_registra(visualizador, sessao):
    resposta = visualizador.get("/salas/1%00x/sensores")

    assert resposta.status_code == 403
    (registro,) = registros(sessao)
    assert "\x00" not in registro.rota
    assert registro.rota.startswith("/salas/1")


def test_rota_muito_longa_e_cortada_e_ainda_responde_403(visualizador, sessao):
    resposta = visualizador.get("/salas/" + "a" * 5000 + "/sensores")

    assert resposta.status_code == 403
    (registro,) = registros(sessao)
    assert registro.rota == ("/salas/" + "a" * 5000)[:2048]


def test_solta_a_conexao_da_requisicao_antes_de_gravar(visualizador, monkeypatch):
    # Com a transação da requisição aberta, cada 403 seguraria duas conexões do
    # pool ao mesmo tempo.
    em_transacao = []

    def espia(sessao, *args):
        em_transacao.append(sessao.in_transaction())
        return registrar_acesso_negado(sessao, *args)

    monkeypatch.setattr("auth.router.registrar_acesso_negado", espia)

    visualizador.post("/salas", json={"nome": "Sala"})

    assert em_transacao == [False]


def test_todo_403_do_app_tem_registro(visualizador, sessao):
    """Rota nova que negue o acesso por conta própria, sem exigir_admin, não
    deixaria o registro: o número de 403 recebidos tem que bater com o de registros."""
    # O logout encerraria a sessão do teste e as rotas seguintes dariam 401.
    rotas = set(rotas_da_api()) - ROTAS_PUBLICAS - {("POST", "/auth/logout")}
    negados = 0
    for metodo, caminho in sorted(rotas):
        resposta = visualizador.request(metodo, url(caminho), json={"invalido": True})
        negados += resposta.status_code == 403

    assert negados >= len(ROTAS_ADMIN)
    assert len(registros(sessao)) == negados


def test_o_403_nao_e_dado_se_a_gravacao_falha(visualizador, monkeypatch):
    def falha(*args):
        raise RuntimeError("banco fora do ar")

    monkeypatch.setattr("auth.router.registrar_acesso_negado", falha)

    with pytest.raises(RuntimeError):
        visualizador.post("/salas", json={"nome": "Sala"})


# O que não gera registro


def test_administrador_nao_gera_registro(client, sessao):
    assert client.post("/salas", json={"nome": "Sala"}).status_code == 201

    assert registros(sessao) == []


def test_rotas_de_leitura_do_visualizador_nao_geram_registro(visualizador, sessao):
    assert visualizador.get("/salas").status_code == 200
    assert visualizador.get("/salas/status").status_code == 200

    assert registros(sessao) == []


def test_sem_login_e_401_e_nao_gera_registro(cliente_anonimo, sessao):
    resposta = cliente_anonimo.post("/salas", json={"nome": "Sala"})

    assert resposta.status_code == 401
    assert registros(sessao) == []


# O banco recusa alterar ou apagar


@pytest.fixture
def registro(visualizador, sessao):
    visualizador.post("/salas", json={"nome": "Sala"})
    sessao.rollback()
    return registros(sessao)[0]


@pytest.mark.parametrize(
    "comando",
    [
        update(AcessoNegado).values(rota="/outra"),
        update(AcessoNegado).values(metodo="GET"),
        update(AcessoNegado).values(data_hora=datetime(2026, 1, 1, tzinfo=UTC)),
        update(AcessoNegado).values(usuario_id=AcessoNegado.usuario_id + 1),
        delete(AcessoNegado),
        text("TRUNCATE acessos_negados"),
        text("TRUNCATE usuarios CASCADE"),
    ],
    ids=[
        "update_rota",
        "update_metodo",
        "update_data_hora",
        "update_usuario",
        "delete",
        "truncate",
        "truncate_dos_usuarios",
    ],
)
def test_banco_recusa_alterar_ou_apagar_registro(sessao, registro, comando):
    with pytest.raises(IntegrityError, match="imutável"):
        sessao.execute(comando)


def test_registro_continua_igual_depois_das_recusas(sessao, registro):
    with pytest.raises(IntegrityError):
        sessao.execute(delete(AcessoNegado))
    sessao.rollback()

    (atual,) = registros(sessao)
    assert (atual.id, atual.rota, atual.data_hora) == (
        registro.id,
        registro.rota,
        registro.data_hora,
    )


def test_usuario_com_registro_nao_pode_ser_apagado(sessao, registro):
    with pytest.raises(IntegrityError):
        sessao.execute(delete(Usuario).where(Usuario.id == registro.usuario_id))


# Migration


def test_migration_cria_a_tabela_e_os_triggers_e_desfaz(banco_vazio, alembic_config):
    command.upgrade(alembic_config, "head")
    engine = create_engine(database_url())
    assert "acessos_negados" in inspect(engine).get_table_names()
    with engine.connect() as conexao:
        triggers = set(
            conexao.scalars(
                text(
                    "SELECT tgname FROM pg_trigger "
                    "WHERE tgrelid = 'acessos_negados'::regclass AND NOT tgisinternal"
                )
            )
        )
    assert triggers == {
        "acessos_negados_recusa_update",
        "acessos_negados_recusa_delete",
        "acessos_negados_recusa_truncate",
    }

    command.downgrade(alembic_config, "0016")

    assert "acessos_negados" not in inspect(engine).get_table_names()
    # A função da 0009 é de outra migration e continua lá.
    with engine.connect() as conexao:
        assert conexao.scalar(text("SELECT to_regproc('recusa_alteracao')")) is not None
    engine.dispose()
