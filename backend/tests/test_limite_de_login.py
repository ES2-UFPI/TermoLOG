"""Limite de logins errados por e-mail e por IP (#173). Precisam de um PostgreSQL."""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select, text, update
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from auth.models import TentativaDeLogin
from auth.tentativas import (
    JANELA,
    LIMITE_POR_EMAIL,
    LIMITE_POR_IP,
    chave_do_ip,
    hash_do_email,
)
from database import database_url
from main import app
from usuarios.service import UsuarioService

EMAIL = "ana@exemplo.com"
SENHA = "senha-forte-123"
BLOQUEIO = {"detail": "muitas tentativas, tente mais tarde"}


@pytest.fixture
def usuario(sessao):
    """Usuário com senha de verdade, para o login passar pelo argon2."""
    usuario = UsuarioService(sessao).cadastrar("Ana", EMAIL, SENHA)
    sessao.commit()
    return usuario


@pytest.fixture
def client(cliente_anonimo):
    return cliente_anonimo


def cliente_do_ip(ip: str) -> TestClient:
    return TestClient(app, client=(ip, 50000))


def entrar(client, email=EMAIL, senha=SENHA):
    return client.post("/auth/login", json={"email": email, "senha": senha})


def errar(client, vezes, email=EMAIL):
    for _ in range(vezes):
        assert entrar(client, email, "senha-errada").status_code == 401


def falhas_gravadas(sessao) -> int:
    sessao.expire_all()
    return sessao.scalar(select(func.count()).select_from(TentativaDeLogin))


def envelhecer_falhas(sessao, tempo):
    """Faz as falhas gravadas parecerem ter acontecido ``tempo`` atrás."""
    sessao.execute(update(TentativaDeLogin).values(data_hora=datetime.now(UTC) - tempo))
    sessao.commit()


def assert_bloqueado(resposta):
    assert resposta.status_code == 429
    assert resposta.json() == BLOQUEIO
    assert 0 < int(resposta.headers["Retry-After"]) <= JANELA.total_seconds()


# Por e-mail


def test_falhas_no_mesmo_email_bloqueiam_mesmo_com_a_senha_certa(client, usuario):
    errar(client, LIMITE_POR_EMAIL)

    assert_bloqueado(entrar(client))


def test_abaixo_do_limite_a_senha_certa_entra(client, usuario):
    errar(client, LIMITE_POR_EMAIL - 1)

    assert entrar(client).status_code == 200


def test_bloqueio_vale_para_o_email_digitado_de_outro_jeito(client, usuario):
    errar(client, LIMITE_POR_EMAIL, email="  Ana@Exemplo.COM ")

    assert_bloqueado(entrar(client))


def test_falhas_em_um_email_nao_bloqueiam_outro(client, sessao, usuario):
    UsuarioService(sessao).cadastrar("Bia", "bia@exemplo.com", SENHA)
    sessao.commit()
    errar(client, LIMITE_POR_EMAIL)

    assert entrar(client, email="bia@exemplo.com").status_code == 200


def test_bloqueio_do_email_vale_vindo_de_outro_ip(client, usuario):
    errar(client, LIMITE_POR_EMAIL)

    assert_bloqueado(entrar(cliente_do_ip("203.0.113.9")))


# Por IP


def test_falhas_do_mesmo_ip_bloqueiam_mesmo_trocando_de_email(client, usuario):
    for i in range(LIMITE_POR_IP):
        errar(client, 1, email=f"pessoa{i}@exemplo.com")

    assert_bloqueado(entrar(client))
    # Outro IP continua entrando no mesmo e-mail.
    assert entrar(cliente_do_ip("203.0.113.9")).status_code == 200


def test_ipv6_conta_pela_rede_64_mesmo_trocando_de_endereco(sessao, usuario):
    for i in range(LIMITE_POR_IP):
        errar(cliente_do_ip(f"2001:db8:0:1::{i + 1:x}"), 1, f"pessoa{i}@exemplo.com")

    assert_bloqueado(entrar(cliente_do_ip("2001:db8:0:1:ffff::1")))
    assert entrar(cliente_do_ip("2001:db8:0:2::1")).status_code == 200


# Atrás de um proxy reverso. O ProxyHeadersMiddleware é o que o `fastapi run`
# (uvicorn) põe na frente da API, com os IPs confiáveis de FORWARDED_ALLOW_IPS.

PROXY = "172.18.0.5"


def cliente_pelo_proxy(confiavel: bool) -> TestClient:
    confiaveis = PROXY if confiavel else "127.0.0.1"
    return TestClient(
        ProxyHeadersMiddleware(app, trusted_hosts=confiaveis), client=(PROXY, 50000)
    )


def entrar_pelo_proxy(client, ip_real, email=EMAIL, senha=SENHA):
    return client.post(
        "/auth/login",
        json={"email": email, "senha": senha},
        headers={"X-Forwarded-For": ip_real},
    )


def test_com_proxy_confiavel_cada_cliente_conta_pelo_proprio_ip(
    cliente_anonimo, usuario
):
    proxy = cliente_pelo_proxy(confiavel=True)
    for i in range(LIMITE_POR_IP):
        resposta = entrar_pelo_proxy(
            proxy, "198.51.100.7", f"pessoa{i}@exemplo.com", "senha-errada"
        )
        assert resposta.status_code == 401

    assert_bloqueado(entrar_pelo_proxy(proxy, "198.51.100.7"))
    # Os erros de um cliente não bloqueiam os outros que vêm pelo mesmo proxy.
    assert entrar_pelo_proxy(proxy, "198.51.100.8").status_code == 200


def test_ip_inventado_no_cabecalho_nao_foge_do_limite(cliente_anonimo, usuario):
    """Sem confiar em quem conecta, o X-Forwarded-For é ignorado."""
    desconhecido = cliente_pelo_proxy(confiavel=False)
    for i in range(LIMITE_POR_IP):
        resposta = entrar_pelo_proxy(
            desconhecido, f"198.51.100.{i}", f"pessoa{i}@exemplo.com", "senha-errada"
        )
        assert resposta.status_code == 401

    assert_bloqueado(entrar_pelo_proxy(desconhecido, "198.51.100.200"))


@pytest.mark.parametrize(
    "ip, chave",
    [
        ("203.0.113.9", "203.0.113.9"),
        ("2001:db8:0:1:aaaa::1", "2001:db8:0:1::/64"),
        ("::ffff:203.0.113.9", "203.0.113.9"),
        ("testclient", "testclient"),
        ("", ""),
    ],
)
def test_chave_do_ip(ip, chave):
    assert chave_do_ip(ip) == chave


# Resposta do bloqueio


def test_429_nao_revela_se_o_email_existe(client, usuario):
    errar(client, LIMITE_POR_EMAIL)
    errar(client, LIMITE_POR_EMAIL, email="ninguem@exemplo.com")

    existe = entrar(client)
    nao_existe = entrar(client, email="ninguem@exemplo.com")

    assert_bloqueado(existe)
    assert_bloqueado(nao_existe)
    assert existe.json() == nao_existe.json()
    assert existe.headers.keys() == nao_existe.headers.keys()


def test_retry_after_e_exposto_para_o_painel(client, usuario):
    """Vindo de outra origem, o navegador só deixa o painel ler o cabeçalho se a
    API o expuser no CORS."""
    errar(client, LIMITE_POR_EMAIL)

    resposta = client.post(
        "/auth/login",
        json={"email": EMAIL, "senha": SENHA},
        headers={"Origin": "http://localhost:8081"},
    )

    assert resposta.status_code == 429
    expostos = resposta.headers["access-control-expose-headers"].lower()
    assert "retry-after" in expostos


def test_tentativa_bloqueada_nao_conta_como_falha(client, sessao, usuario):
    errar(client, LIMITE_POR_EMAIL)

    for _ in range(3):
        assert_bloqueado(entrar(client, senha="senha-errada"))

    assert falhas_gravadas(sessao) == LIMITE_POR_EMAIL


def test_retry_after_e_o_tempo_ate_a_falha_mais_antiga_sair_da_janela(
    client, sessao, usuario
):
    errar(client, LIMITE_POR_EMAIL)
    envelhecer_falhas(sessao, timedelta(minutes=10))

    retry_after = int(entrar(client).headers["Retry-After"])

    restante = (JANELA - timedelta(minutes=10)).total_seconds()
    assert restante - 5 <= retry_after <= restante + 1


# Liberação


def test_depois_da_janela_o_login_volta_a_funcionar(client, sessao, usuario):
    errar(client, LIMITE_POR_EMAIL)
    assert_bloqueado(entrar(client))

    envelhecer_falhas(sessao, JANELA)

    assert entrar(client).status_code == 200


def test_falhas_fora_da_janela_sao_apagadas(client, sessao, usuario):
    errar(client, LIMITE_POR_EMAIL - 1)
    envelhecer_falhas(sessao, JANELA + timedelta(minutes=1))

    errar(client, 1)

    assert falhas_gravadas(sessao) == 1


def test_login_certo_zera_a_contagem_do_email(client, sessao, usuario):
    errar(client, LIMITE_POR_EMAIL - 1)

    assert entrar(client).status_code == 200

    assert falhas_gravadas(sessao) == 0
    errar(client, LIMITE_POR_EMAIL - 1)
    assert entrar(client).status_code == 200


def test_login_certo_nao_zera_as_falhas_de_outro_email(client, sessao, usuario):
    errar(client, 2, email="ninguem@exemplo.com")

    assert entrar(client).status_code == 200

    assert falhas_gravadas(sessao) == 2


# Gravação


def test_email_digitado_nao_fica_gravado_em_texto(client, sessao, usuario):
    errar(client, 1, email="minha-senha-no-campo-errado")

    (email_hash,) = sessao.scalars(text("SELECT email_hash FROM tentativas_de_login"))
    assert email_hash == hash_do_email("minha-senha-no-campo-errado")
    assert "minha-senha" not in email_hash


def test_tentativa_ja_esta_gravada_enquanto_a_senha_e_conferida(
    client, usuario, monkeypatch
):
    """Requisições simultâneas precisam ver a tentativa antes da conferência da
    senha; senão um lote de tentativas disparadas juntas passaria inteiro."""
    vistas_por_outra_conexao = []
    conferir = UsuarioService.conferir_credenciais

    def conferir_e_espiar(self, email, senha):
        engine = create_engine(database_url())
        with engine.connect() as outra:
            vistas_por_outra_conexao.append(
                outra.scalar(text("SELECT count(*) FROM tentativas_de_login"))
            )
        engine.dispose()
        return conferir(self, email, senha)

    monkeypatch.setattr(UsuarioService, "conferir_credenciais", conferir_e_espiar)

    entrar(client, senha="senha-errada")

    assert vistas_por_outra_conexao == [1]


def test_email_com_caractere_nulo_conta_como_falha_e_nao_da_500(client, sessao):
    # O PostgreSQL recusa o caractere nulo em texto, mas o e-mail só vai ao banco
    # como hash.
    errar(client, 1, email="ana\u0000@exemplo.com")

    assert falhas_gravadas(sessao) == 1
