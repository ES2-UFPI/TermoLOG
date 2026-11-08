"""Login, logout, /auth/me e expiração da sessão. Precisam de um PostgreSQL."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text

from auth.models import SessaoDeLogin
from auth.service import (
    TEMPO_DE_INATIVIDADE,
    AuthService,
    NaoAutenticado,
    hash_do_token,
)
from usuarios.service import UsuarioService

EMAIL = "ana@exemplo.com"
SENHA = "senha-forte-123"


@pytest.fixture
def usuario(sessao):
    """Usuário com senha de verdade, para o login passar pelo argon2."""
    usuario = UsuarioService(sessao).cadastrar("Ana", EMAIL, SENHA)
    sessao.commit()
    return usuario


@pytest.fixture
def client(cliente_anonimo):
    """Aqui o cliente começa sem login: cada teste entra e sai pela API."""
    return cliente_anonimo


def entrar(client, email=EMAIL, senha=SENHA):
    return client.post("/auth/login", json={"email": email, "senha": senha})


def token_de(client):
    return entrar(client).json()["token"]


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def sessao_do_token(sessao, token) -> SessaoDeLogin:
    return sessao.scalar(
        select(SessaoDeLogin).where(SessaoDeLogin.token_hash == hash_do_token(token))
    )


# Login


def test_login_devolve_token_expiracao_e_usuario(client, usuario):
    antes = datetime.now(UTC)
    resposta = entrar(client)

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert set(corpo) == {"token", "expira_em", "usuario"}
    assert len(corpo["token"]) >= 32
    assert corpo["usuario"] == {
        "id": usuario.id,
        "nome": "Ana",
        "email": EMAIL,
    }
    # Contrato: respostas em UTC.
    assert corpo["expira_em"].endswith("Z")
    expira_em = datetime.fromisoformat(corpo["expira_em"])
    assert antes + TEMPO_DE_INATIVIDADE <= expira_em
    assert expira_em <= datetime.now(UTC) + TEMPO_DE_INATIVIDADE


def test_login_ignora_maiusculas_e_espacos_no_email(client, usuario):
    assert entrar(client, email="  Ana@Exemplo.COM ").status_code == 200


def test_cada_login_abre_uma_sessao_com_token_diferente(client, usuario):
    tokens = {token_de(client) for _ in range(3)}

    assert len(tokens) == 3
    for token in tokens:
        assert client.get("/auth/me", headers=bearer(token)).status_code == 200


@pytest.mark.parametrize(
    "email, senha",
    [
        (EMAIL, "senha-errada"),
        ("ninguem@exemplo.com", SENHA),
        ("nao-e-email", SENHA),
        (EMAIL, ""),
    ],
)
def test_login_com_credencial_errada_tem_sempre_a_mesma_resposta(
    client, usuario, email, senha
):
    resposta = entrar(client, email, senha)

    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "e-mail ou senha inválidos"}


def test_login_sem_campos_da_422(client):
    assert client.post("/auth/login", json={"email": EMAIL}).status_code == 422


def test_email_com_caractere_nulo_da_401_e_nao_500(client, usuario):
    resposta = entrar(client, email="ana\u0000@exemplo.com")

    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "e-mail ou senha inválidos"}


@pytest.mark.parametrize(
    "email, senha",
    [("a" * 250 + "@x.com", SENHA), (EMAIL, "s" * 1025)],
    ids=["e-mail maior que a coluna", "senha absurda"],
)
def test_login_com_campo_grande_demais_da_422(client, email, senha):
    assert entrar(client, email, senha).status_code == 422


def test_expira_em_vem_em_utc_mesmo_com_o_banco_em_outro_fuso(client, sessao, usuario):
    sessao.execute(text("SET TIME ZONE 'America/Fortaleza'"))

    expira_em = entrar(client).json()["expira_em"]

    assert expira_em.endswith("Z")


# Senha e token nunca em texto


def test_senha_e_guardada_so_como_hash(sessao, usuario):
    senha_hash = sessao.scalar(
        text("SELECT senha_hash FROM usuarios WHERE id = :id"), {"id": usuario.id}
    )

    assert SENHA not in senha_hash
    assert senha_hash.startswith("$argon2id$")


def test_mesma_senha_gera_hashes_diferentes(sessao, usuario):
    outro = UsuarioService(sessao).cadastrar("Bia", "bia@exemplo.com", SENHA)

    assert outro.senha_hash != usuario.senha_hash


def test_nenhuma_resposta_devolve_a_senha_ou_o_hash(client, usuario):
    login = entrar(client)
    me = client.get("/auth/me", headers=bearer(login.json()["token"]))

    for resposta in (login, me):
        assert SENHA not in resposta.text
        assert usuario.senha_hash not in resposta.text
        assert "senha" not in resposta.text


def test_sessao_guarda_so_o_hash_do_token(client, sessao, usuario):
    token = token_de(client)

    (token_hash,) = sessao.scalars(text("SELECT token_hash FROM sessoes"))
    assert token_hash == hash_do_token(token)
    assert token_hash != token


# /auth/me


def test_me_devolve_o_usuario_da_sessao(client, usuario):
    resposta = client.get("/auth/me", headers=bearer(token_de(client)))

    assert resposta.status_code == 200
    assert resposta.json() == {
        "id": usuario.id,
        "nome": "Ana",
        "email": EMAIL,
    }


@pytest.mark.parametrize(
    "cabecalhos",
    [{}, {"Authorization": "Bearer token-inventado"}, {"Authorization": "Basic abc"}],
    ids=["sem token", "token desconhecido", "outro esquema"],
)
def test_me_sem_sessao_valida_da_401(client, usuario, cabecalhos):
    resposta = client.get("/auth/me", headers=cabecalhos)

    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "não autenticado"}


# Logout


def test_logout_encerra_a_sessao(client, sessao, usuario):
    token = token_de(client)

    resposta = client.post("/auth/logout", headers=bearer(token))

    assert resposta.status_code == 204
    assert resposta.content == b""
    assert sessao_do_token(sessao, token) is None
    depois = client.get("/auth/me", headers=bearer(token))
    assert depois.status_code == 401
    assert depois.json() == {"detail": "não autenticado"}


def test_logout_de_sessao_ja_encerrada_da_401(client, usuario):
    token = token_de(client)
    client.post("/auth/logout", headers=bearer(token))

    assert client.post("/auth/logout", headers=bearer(token)).status_code == 401


def test_logout_sem_token_da_401(client):
    assert client.post("/auth/logout").status_code == 401


def test_logout_nao_encerra_as_outras_sessoes(client, usuario):
    token_saindo, token_ficando = token_de(client), token_de(client)

    client.post("/auth/logout", headers=bearer(token_saindo))

    assert client.get("/auth/me", headers=bearer(token_ficando)).status_code == 200


# Expiração


def parar_sessao(sessao, token, tempo_parado):
    sessao_de_login = sessao_do_token(sessao, token)
    sessao_de_login.ultimo_uso = datetime.now(UTC) - tempo_parado
    sessao.commit()


def test_sessao_parada_ha_30_minutos_expira(client, sessao, usuario):
    token = token_de(client)
    parar_sessao(sessao, token, TEMPO_DE_INATIVIDADE)

    resposta = client.get("/auth/me", headers=bearer(token))

    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "não autenticado"}
    # A sessão expirada é apagada: o token não volta a valer.
    assert sessao_do_token(sessao, token) is None


def test_logout_com_sessao_expirada_da_401(client, sessao, usuario):
    token = token_de(client)
    parar_sessao(sessao, token, timedelta(minutes=31))

    assert client.post("/auth/logout", headers=bearer(token)).status_code == 401


def test_cada_requisicao_renova_o_ultimo_uso(client, sessao, usuario):
    token = token_de(client)
    parar_sessao(sessao, token, timedelta(minutes=29))

    assert client.get("/auth/me", headers=bearer(token)).status_code == 200

    sessao.expire_all()
    ultimo_uso = sessao_do_token(sessao, token).ultimo_uso
    assert datetime.now(UTC) - ultimo_uso < timedelta(minutes=1)
    # Mais 29 minutos parada: ainda vale, porque o relógio voltou a contar.
    parar_sessao(sessao, token, timedelta(minutes=29))
    assert client.get("/auth/me", headers=bearer(token)).status_code == 200


def test_login_apaga_as_sessoes_expiradas(client, sessao, usuario):
    expirada = token_de(client)
    parar_sessao(sessao, expirada, timedelta(hours=2))

    token_de(client)

    sessao.expire_all()
    assert sessao_do_token(sessao, expirada) is None
    assert sessao.scalar(text("SELECT count(*) FROM sessoes")) == 1


# Requisições simultâneas


def test_sessao_encerrada_entre_a_busca_e_a_renovacao_da_nao_autenticado(
    client, sessao, usuario, monkeypatch
):
    """Ex.: o polling do painel e o logout chegando juntos com o mesmo token."""
    token = token_de(client)
    servico = AuthService(sessao)
    encontrada = servico._buscar(token)
    # Outra requisição encerra a sessão depois que esta já a encontrou.
    sessao.execute(text("DELETE FROM sessoes"))
    monkeypatch.setattr(servico, "_buscar", lambda token: encontrada)

    with pytest.raises(NaoAutenticado):
        servico.autenticar(token)


def test_logout_repetido_da_mesma_sessao_nao_da_erro(client, sessao, usuario):
    token = token_de(client)
    servico = AuthService(sessao)
    sessao_de_login = servico.autenticar(token)

    servico.sair(sessao_de_login.id)
    servico.sair(sessao_de_login.id)

    assert sessao_do_token(sessao, token) is None


def test_conferir_a_sessao_sem_renovar_mantem_o_ultimo_uso(client, sessao, usuario):
    token = token_de(client)
    parar_sessao(sessao, token, timedelta(minutes=10))
    antes = sessao_do_token(sessao, token).ultimo_uso

    AuthService(sessao).autenticar(token, renovar=False)

    sessao.expire_all()
    assert sessao_do_token(sessao, token).ultimo_uso == antes
