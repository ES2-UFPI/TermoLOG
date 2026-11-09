"""Canais de notificação do usuário logado (US17, #114)."""

import base64
import secrets

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from auth.service import AuthService
from main import app
from notificacoes.models import CanalDoUsuario
from usuarios.models import Usuario

ROTA = "/auth/me/canais"


def base64url(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).rstrip(b"=").decode()


def inscricao_push(endpoint="https://fcm.googleapis.com/fcm/send/abc123"):
    """Como o navegador devolve em PushSubscription.toJSON()."""
    return {
        "endpoint": endpoint,
        "keys": {
            # Ponto P-256 não comprimido: 0x04 + 64 bytes.
            "p256dh": base64url(b"\x04" + secrets.token_bytes(64)),
            "auth": base64url(secrets.token_bytes(16)),
        },
    }


def email(destino="ana@exemplo.com", **campos):
    return {"tipo": "email", "destino": destino, **campos}


def telegram(destino="123456789", **campos):
    return {"tipo": "telegram", "destino": destino, **campos}


def push(destino=None, **campos):
    return {"tipo": "push", "destino": destino or inscricao_push(), **campos}


@pytest.fixture
def outro_cliente(sessao):
    """Cliente de outra pessoa logada, para conferir que os canais não se misturam."""
    outro = Usuario(nome="Bruno", email="bruno@exemplo.com", senha_hash="sem-senha")
    sessao.add(outro)
    sessao.flush()
    _, token = AuthService(sessao).abrir_sessao(outro)
    sessao.commit()
    return TestClient(app, headers={"Authorization": f"Bearer {token}"})


def test_sem_canais_a_lista_vem_vazia(client):
    resposta = client.get(ROTA)

    assert resposta.status_code == 200
    assert resposta.json() == []


def test_salva_e_devolve_varios_canais_ativos_ao_mesmo_tempo(client):
    assinatura = inscricao_push()
    canais = [email(), telegram(), push(assinatura)]

    resposta = client.put(ROTA, json=canais)

    esperado = [
        {"tipo": "email", "destino": "ana@exemplo.com", "ativo": True},
        {"tipo": "telegram", "destino": "123456789", "ativo": True},
        {"tipo": "push", "destino": assinatura, "ativo": True},
    ]
    assert resposta.status_code == 200
    assert resposta.json() == esperado
    assert client.get(ROTA).json() == esperado


def test_canal_pode_ficar_guardado_e_desligado(client):
    client.put(ROTA, json=[email(), telegram(ativo=False)])

    assert [c["ativo"] for c in client.get(ROTA).json()] == [True, False]


def test_put_substitui_a_lista_inteira(client, sessao):
    client.put(ROTA, json=[email(), telegram()])

    resposta = client.put(ROTA, json=[telegram("987654321")])

    assert resposta.json() == [
        {"tipo": "telegram", "destino": "987654321", "ativo": True}
    ]
    assert len(sessao.scalars(select(CanalDoUsuario)).all()) == 1


def test_lista_vazia_remove_todos_os_canais(client):
    client.put(ROTA, json=[email(), telegram()])

    assert client.put(ROTA, json=[]).json() == []
    assert client.get(ROTA).json() == []


def test_cada_usuario_ve_e_altera_so_os_proprios_canais(client, outro_cliente):
    client.put(ROTA, json=[email("ana@exemplo.com")])
    outro_cliente.put(ROTA, json=[email("bruno@exemplo.com"), telegram()])

    # Trocar os próprios canais não mexe nos da outra pessoa.
    client.put(ROTA, json=[telegram("111")])

    assert client.get(ROTA).json() == [
        {"tipo": "telegram", "destino": "111", "ativo": True}
    ]
    assert [c["destino"] for c in outro_cliente.get(ROTA).json()] == [
        "bruno@exemplo.com",
        "123456789",
    ]


def test_dois_usuarios_podem_usar_o_mesmo_destino(client, outro_cliente):
    # Um grupo do Telegram ou um e-mail da equipe pode servir a mais de uma pessoa.
    assert client.put(ROTA, json=[telegram("-1001234567890")]).status_code == 200
    assert outro_cliente.put(ROTA, json=[telegram("-1001234567890")]).status_code == 200


def test_canais_somem_quando_o_usuario_e_apagado(client, sessao, usuario):
    client.put(ROTA, json=[email(), telegram()])

    sessao.delete(usuario)
    sessao.commit()

    assert sessao.scalars(select(CanalDoUsuario)).all() == []


def test_rotas_exigem_login(cliente_anonimo):
    assert cliente_anonimo.get(ROTA).status_code == 401
    assert cliente_anonimo.put(ROTA, json=[]).status_code == 401


# --- Validação do destino conforme o tipo ---------------------------------------


def test_email_e_guardado_em_minusculas_e_sem_espacos(client):
    resposta = client.put(ROTA, json=[email("  Ana.Lima@Exemplo.COM ")])

    assert resposta.json()[0]["destino"] == "ana.lima@exemplo.com"


@pytest.mark.parametrize(
    "destino",
    ["ana", "ana@", "@exemplo.com", "ana@exemplo", "", "a" * 250 + "@exemplo.com"],
)
def test_recusa_email_invalido(client, destino):
    resposta = client.put(ROTA, json=[email(destino)])

    assert resposta.status_code == 422
    assert client.get(ROTA).json() == []


@pytest.mark.parametrize("destino", ["123456789", "-1001234567890", " 42 "])
def test_aceita_chat_id_do_telegram(client, destino):
    resposta = client.put(ROTA, json=[telegram(destino)])

    assert resposta.status_code == 200
    assert resposta.json()[0]["destino"] == destino.strip()


@pytest.mark.parametrize(
    "destino",
    [
        "@meu_canal",  # nome público: o bot precisa do chat_id numérico
        "0",
        "-0",
        "12a3",
        "1.5",
        "",
        "+123",
        "00123",
        str(2**53),  # o Telegram garante no máximo 52 bits
        123456789,  # número em vez de texto
    ],
)
def test_recusa_chat_id_invalido(client, destino):
    assert client.put(ROTA, json=[telegram(destino)]).status_code == 422


@pytest.mark.parametrize(
    "alteracao",
    [
        {"endpoint": "http://fcm.googleapis.com/fcm/send/abc"},  # sem HTTPS
        {"endpoint": "nao-e-url"},
        {"endpoint": "https://push.exemplo.com/" + "a" * 2048},
        {"keys": {"auth": base64url(secrets.token_bytes(16))}},  # sem p256dh
        {"keys": {"p256dh": base64url(b"\x04" + secrets.token_bytes(64))}},  # sem auth
        {
            "keys": {
                "p256dh": base64url(b"\x04" + secrets.token_bytes(32)),  # curta
                "auth": base64url(secrets.token_bytes(16)),
            }
        },
        {
            "keys": {
                "p256dh": base64url(b"\x02" + secrets.token_bytes(64)),  # não é 0x04
                "auth": base64url(secrets.token_bytes(16)),
            }
        },
        {
            "keys": {
                "p256dh": base64url(b"\x04" + secrets.token_bytes(64)),
                "auth": base64url(secrets.token_bytes(8)),  # auth com 8 bytes
            }
        },
        {
            "keys": {
                "p256dh": "não é base64!",
                "auth": base64url(secrets.token_bytes(16)),
            }
        },
    ],
    ids=[
        "http",
        "nao-e-url",
        "endpoint-longo",
        "sem-p256dh",
        "sem-auth",
        "p256dh-curta",
        "p256dh-comprimida",
        "auth-curta",
        "p256dh-nao-base64",
    ],
)
def test_recusa_inscricao_push_invalida(client, alteracao):
    resposta = client.put(ROTA, json=[push({**inscricao_push(), **alteracao})])

    assert resposta.status_code == 422


def test_push_aceita_a_inscricao_inteira_do_navegador(client):
    # PushSubscription.toJSON() traz também o expirationTime, que não é guardado.
    assinatura = inscricao_push()

    resposta = client.put(ROTA, json=[push({**assinatura, "expirationTime": None})])

    assert resposta.status_code == 200
    assert resposta.json()[0]["destino"] == assinatura


def test_push_aceita_chave_em_base64_com_preenchimento(client):
    assinatura = inscricao_push()
    chaves = assinatura["keys"]
    com_igual = {
        "p256dh": base64.urlsafe_b64encode(
            base64.urlsafe_b64decode(chaves["p256dh"] + "=")
        ).decode(),
        "auth": base64.urlsafe_b64encode(
            base64.urlsafe_b64decode(chaves["auth"] + "==")
        ).decode(),
    }

    resposta = client.put(ROTA, json=[push({**assinatura, "keys": com_igual})])

    assert resposta.status_code == 200


@pytest.mark.parametrize(
    "canal",
    [
        {"tipo": "email", "destino": {"endereco": "ana@exemplo.com"}},
        {"tipo": "push", "destino": "https://fcm.googleapis.com/fcm/send/abc"},
        {"tipo": "sms", "destino": "+5586999999999"},
        {"destino": "ana@exemplo.com"},
        {"tipo": "email"},
    ],
    ids=["email-objeto", "push-texto", "tipo-desconhecido", "sem-tipo", "sem-destino"],
)
def test_recusa_canal_malformado(client, canal):
    assert client.put(ROTA, json=[canal]).status_code == 422


def test_recusa_o_mesmo_canal_repetido(client):
    # O e-mail repetido só aparece depois de normalizado.
    resposta = client.put(
        ROTA, json=[email("ana@exemplo.com"), email("ANA@exemplo.com")]
    )

    assert resposta.status_code == 422
    assert "repetido" in str(resposta.json()["detail"])


def test_recusa_a_mesma_inscricao_push_repetida(client):
    assinatura = inscricao_push()

    resposta = client.put(ROTA, json=[push(assinatura), push(assinatura)])

    assert resposta.status_code == 422


def test_mesmo_destino_em_tipos_diferentes_nao_e_repetido(client):
    # Improvável, mas o texto igual em tipos diferentes é outro canal.
    resposta = client.put(ROTA, json=[telegram("123"), email("123@exemplo.com")])

    assert resposta.status_code == 200


def test_aceita_ate_10_canais(client):
    canais = [email(f"pessoa{i}@exemplo.com") for i in range(10)]

    assert client.put(ROTA, json=canais).status_code == 200
    assert client.put(ROTA, json=[*canais, telegram()]).status_code == 422


def test_put_invalido_nao_apaga_os_canais_que_ja_existiam(client):
    client.put(ROTA, json=[email(), telegram()])

    client.put(ROTA, json=[telegram("0")])

    assert len(client.get(ROTA).json()) == 2
