"""Percorre as rotas do app: nenhuma rota do painel pode ficar pública (#111).

Uma rota nova entra aqui sozinha. Se ela tiver que ser pública, precisa ser
acrescentada em ROTAS_PUBLICAS, o que deixa a decisão explícita na revisão.
"""

import re

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute, iter_route_contexts
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from sqlalchemy import text

from auth.router import sessao_autenticada, usuario_logado
from auth.service import AuthService
from database import get_sessao
from main import app

# (método, caminho) das únicas rotas sem login. O envio de leituras não é
# público: exige a chave de API do gateway, conferida em gateway_autenticado.
ROTAS_PUBLICAS = {
    ("GET", "/health"),
    ("POST", "/auth/login"),
    ("POST", "/gateways/{gateway_id}/leituras"),
}

NAO_AUTENTICADO = {"detail": "não autenticado"}


def rotas_da_api():
    # Nesta versão do FastAPI as rotas dos routers incluídos não aparecem soltas
    # em app.routes; iter_route_contexts as desdobra com o caminho final. Pega
    # também as rotas fora do schema OpenAPI (include_in_schema=False). As da
    # documentação (/docs, /openapi.json) não são APIRoute e ficam de fora.
    for contexto in iter_route_contexts(app.routes):
        if isinstance(contexto.original_route, APIRoute):
            for metodo in sorted(contexto.methods):
                yield metodo, contexto.path


ROTAS_DO_PAINEL = sorted(set(rotas_da_api()) - ROTAS_PUBLICAS)


def url(caminho: str) -> str:
    # Qualquer id serve: a credencial é conferida antes de buscar o recurso.
    return re.sub(r"\{[^}]+\}", "1", caminho)


def test_as_rotas_publicas_existem():
    # Evita que uma rota renomeada continue na lista sem proteger nada.
    assert ROTAS_PUBLICAS <= set(rotas_da_api())
    assert ROTAS_DO_PAINEL


@pytest.fixture
def cliente_sem_banco():
    """Sem token, a rota tem que responder 401 antes de usar o banco."""
    app.dependency_overrides[get_sessao] = lambda: None
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.mark.parametrize("metodo, caminho", ROTAS_DO_PAINEL)
def test_rota_do_painel_sem_token_da_401(cliente_sem_banco, metodo, caminho):
    resposta = cliente_sem_banco.request(metodo, url(caminho))

    assert resposta.status_code == 401
    assert resposta.json() == NAO_AUTENTICADO
    assert resposta.headers["WWW-Authenticate"] == "Bearer"


@pytest.mark.parametrize("metodo, caminho", ROTAS_DO_PAINEL)
def test_chave_de_gateway_nao_serve_para_o_painel(
    client, cliente_anonimo, metodo, caminho
):
    chave = client.post("/gateways", json={"nome": "Filial Centro"}).json()["chave_api"]

    resposta = cliente_anonimo.request(
        metodo, url(caminho), headers={"Authorization": f"Bearer {chave}"}
    )

    assert resposta.status_code == 401
    assert resposta.json() == NAO_AUTENTICADO


def test_token_de_usuario_nao_serve_para_enviar_leituras(
    client, cliente_anonimo, token_do_usuario
):
    gateway = client.post("/gateways", json={"nome": "Filial Centro"}).json()

    resposta = cliente_anonimo.post(
        f"/gateways/{gateway['id']}/leituras",
        json={"lote_id": "3f0c6d1e-8a2b-4c55-9b7e-2d1f0a9c4e11", "leituras": []},
        headers={"Authorization": f"Bearer {token_do_usuario}"},
    )

    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "credencial inválida"}


def test_health_responde_sem_token(cliente_sem_banco):
    assert cliente_sem_banco.get("/health").status_code == 200


def test_login_continua_publico(cliente_anonimo, usuario):
    # Sem token, o login chega a conferir as credenciais: a resposta é a de
    # credencial errada, e não o 401 de quem não está logado.
    resposta = cliente_anonimo.post(
        "/auth/login", json={"email": usuario.email, "senha": "senha-errada"}
    )

    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "e-mail ou senha inválidos"}


def test_cliente_anonimo_nao_tem_credencial(client, cliente_anonimo):
    assert "Authorization" in client.headers
    assert "Authorization" not in cliente_anonimo.headers


def test_sessao_expirada_tambem_bloqueia_as_rotas_do_painel(client, sessao):
    assert client.get("/salas").status_code == 200

    sessao.execute(
        text("UPDATE sessoes SET ultimo_uso = now() - interval '30 minutes'")
    )
    sessao.commit()

    resposta = client.get("/salas")
    assert resposta.status_code == 401
    assert resposta.json() == NAO_AUTENTICADO


def test_requisicao_no_painel_renova_a_sessao(client, sessao):
    sessao.execute(
        text("UPDATE sessoes SET ultimo_uso = now() - interval '29 minutes'")
    )
    sessao.commit()

    assert client.get("/salas").status_code == 200

    renovada = sessao.scalar(
        text("SELECT now() - ultimo_uso < interval '1 minute' FROM sessoes")
    )
    assert renovada


# Logout simultâneo


def credenciais(token):
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_sessao_encerrada_depois_da_autenticacao_nao_quebra_a_requisicao(
    sessao, usuario, token_do_usuario
):
    """Ex.: o polling do painel e o logout chegando juntos com o mesmo token."""
    valida = sessao_autenticada(sessao, credenciais(token_do_usuario))
    # Outra requisição faz logout depois que esta já passou pela autenticação.
    sessao.execute(text("DELETE FROM sessoes"))
    sessao.commit()

    assert usuario_logado(sessao, valida).id == usuario.id
    AuthService(sessao).sair(valida.id)


def test_usuario_apagado_depois_da_autenticacao_da_401(
    sessao, usuario, token_do_usuario
):
    valida = sessao_autenticada(sessao, credenciais(token_do_usuario))
    sessao.execute(text("DELETE FROM usuarios"))
    sessao.commit()

    with pytest.raises(HTTPException) as erro:
        usuario_logado(sessao, valida)
    assert erro.value.status_code == 401
