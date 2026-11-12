"""POST /alertas/{id}/encerrar (contrato, 2.7, US12). Precisa de um PostgreSQL
(DATABASE_URL)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from alertas.models import Alerta
from alertas.router import TAMANHO_MAXIMO_DA_ACAO
from tests.conftest import ABERTO_EM

RECONHECIDO_EM = ABERTO_EM + timedelta(minutes=1)


@pytest.fixture
def reconhecido(criar_alerta):
    return criar_alerta("reconhecido", reconhecido_em=RECONHECIDO_EM)


def encerrar(cliente, alerta_id, acao="Porta da câmara fechada", **kwargs):
    kwargs.setdefault("json", {"acao_corretiva": acao})
    return cliente.post(f"/alertas/{alerta_id}/encerrar", **kwargs)


def test_encerra_alerta_reconhecido_com_a_acao_corretiva(client, sessao, reconhecido):
    antes = datetime.now(UTC)
    resposta = encerrar(client, reconhecido.id, "Porta da câmara fechada")
    depois = datetime.now(UTC)

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["id"] == reconhecido.id
    assert corpo["situacao"] == "encerrado"
    assert corpo["acao_corretiva"] == "Porta da câmara fechada"
    encerrado_em = datetime.fromisoformat(corpo["encerrado_em"])
    assert antes <= encerrado_em <= depois
    assert datetime.fromisoformat(corpo["reconhecido_em"]) == RECONHECIDO_EM

    # A rota usa a mesma sessão do teste: o rollback descarta o que não foi
    # commitado, então o que sobra está gravado de fato.
    sessao.rollback()
    gravado = sessao.get(Alerta, reconhecido.id)
    assert gravado.situacao == "encerrado"
    assert gravado.acao_corretiva == "Porta da câmara fechada"
    assert gravado.encerrado_em == encerrado_em


@pytest.mark.parametrize(
    "situacao, atendimento, detalhe",
    [
        ("pendente", {}, "alerta precisa estar reconhecido"),
        (
            "encerrado",
            {
                "reconhecido_em": RECONHECIDO_EM,
                "acao_corretiva": "Porta fechada",
                "encerrado_em": RECONHECIDO_EM + timedelta(minutes=1),
            },
            "alerta já encerrado",
        ),
    ],
)
def test_alerta_que_nao_esta_reconhecido_da_409_e_nao_muda(
    client, sessao, criar_alerta, situacao, atendimento, detalhe
):
    alerta = criar_alerta(situacao, **atendimento)

    resposta = encerrar(client, alerta.id, "Outra ação")

    assert resposta.status_code == 409
    assert resposta.json() == {"detail": detalhe}
    sessao.expire_all()
    gravado = sessao.get(Alerta, alerta.id)
    assert gravado.situacao == situacao
    assert gravado.acao_corretiva == atendimento.get("acao_corretiva")
    assert gravado.encerrado_em == atendimento.get("encerrado_em")


@pytest.mark.parametrize("acao", ["", "   ", "\n\t"])
def test_acao_vazia_da_422_e_nao_encerra(client, sessao, reconhecido, acao):
    resposta = encerrar(client, reconhecido.id, acao)

    assert resposta.status_code == 422
    sessao.expire_all()
    assert sessao.get(Alerta, reconhecido.id).situacao == "reconhecido"


@pytest.mark.parametrize(
    "corpo", [None, {}, {"acao_corretiva": None}, {"acao_corretiva": 1}]
)
def test_sem_acao_corretiva_da_422(client, sessao, reconhecido, corpo):
    resposta = encerrar(client, reconhecido.id, json=corpo)

    assert resposta.status_code == 422
    sessao.expire_all()
    assert sessao.get(Alerta, reconhecido.id).situacao == "reconhecido"


def test_resposta_tem_o_formato_do_get_de_alertas(client, reconhecido):
    corpo = encerrar(client, reconhecido.id).json()

    [listado] = client.get("/alertas").json()
    assert corpo == listado


def test_visualizador_tambem_encerra(visualizador, reconhecido):
    resposta = encerrar(visualizador, reconhecido.id)

    assert resposta.status_code == 200
    assert resposta.json()["situacao"] == "encerrado"


def test_corpo_da_requisicao_nao_altera_hora_nem_reconhecimento(client, reconhecido):
    antes = datetime.now(UTC)

    resposta = encerrar(
        client,
        reconhecido.id,
        json={
            "acao_corretiva": "Porta fechada",
            "encerrado_em": "2020-01-01T00:00:00Z",
            "reconhecido_em": "2020-01-01T00:00:00Z",
            "situacao": "pendente",
        },
    )

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["situacao"] == "encerrado"
    assert datetime.fromisoformat(corpo["encerrado_em"]) >= antes
    assert datetime.fromisoformat(corpo["reconhecido_em"]) == RECONHECIDO_EM


def test_alerta_inexistente_da_404(client):
    resposta = encerrar(client, 999)

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "alerta não encontrado"}


# Fora de 1..2**31-1 não é id de alerta; acima disso, o banco recusaria com 500.
@pytest.mark.parametrize("alerta_id", [0, -1, 2**31])
def test_id_fora_da_faixa_da_422(client, alerta_id):
    assert encerrar(client, alerta_id).status_code == 422


def test_sem_login_da_401_e_nao_encerra(cliente_anonimo, sessao, reconhecido):
    resposta = encerrar(cliente_anonimo, reconhecido.id)

    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "não autenticado"}
    sessao.expire_all()
    assert sessao.get(Alerta, reconhecido.id).situacao == "reconhecido"


# O trigger de imutabilidade (#88, US25): depois de encerrado pela API, nem um
# UPDATE por fora muda o alerta.
@pytest.mark.parametrize(
    "valores",
    [
        {"acao_corretiva": "Outra ação"},
        {"encerrado_em": ABERTO_EM},
        {"situacao": "reconhecido"},
    ],
    ids=["acao_corretiva", "encerrado_em", "situacao"],
)
def test_banco_recusa_mudar_alerta_encerrado(client, sessao, reconhecido, valores):
    assert encerrar(client, reconhecido.id).status_code == 200

    with pytest.raises(IntegrityError, match="encerrado"):
        sessao.execute(
            update(Alerta).where(Alerta.id == reconhecido.id).values(**valores)
        )


def test_acao_acima_do_limite_da_422(client, sessao, reconhecido):
    resposta = encerrar(client, reconhecido.id, "x" * (TAMANHO_MAXIMO_DA_ACAO + 1))

    assert resposta.status_code == 422
    sessao.expire_all()
    assert sessao.get(Alerta, reconhecido.id).situacao == "reconhecido"


def test_acao_no_limite_encerra(client, reconhecido):
    acao = "x" * TAMANHO_MAXIMO_DA_ACAO

    resposta = encerrar(client, reconhecido.id, acao)

    assert resposta.status_code == 200
    assert resposta.json()["acao_corretiva"] == acao


def test_encerrar_duas_vezes_da_409_e_mantem_o_primeiro(client, reconhecido):
    primeiro = encerrar(client, reconhecido.id, "Porta fechada").json()

    resposta = encerrar(client, reconhecido.id, "Outra ação")

    assert resposta.status_code == 409
    assert resposta.json() == {"detail": "alerta já encerrado"}
    [listado] = client.get("/alertas").json()
    assert listado["acao_corretiva"] == "Porta fechada"
    assert listado["encerrado_em"] == primeiro["encerrado_em"]
