"""GET /alertas (contrato, 2.7). Precisa de um PostgreSQL (DATABASE_URL)."""

from datetime import UTC, datetime, timedelta

import pytest

from alertas.models import Alerta
from leituras.models import Leitura
from salas.models import Sala
from sensores.service import SensorService

BASE = datetime(2026, 10, 16, 17, 30, tzinfo=UTC)


def criar_sala(sessao, gateway, nome):
    sala = Sala(nome=nome, temperatura_max=8)
    sessao.add(sala)
    sessao.flush()
    return sala, SensorService(sessao).cadastrar(sala.id, gateway.id)


def criar_alerta(sessao, sala, sensor, minutos, situacao="pendente", **atendimento):
    """Alerta aberto `minutos` depois de BASE pela leitura medida 5 s antes."""
    leitura = Leitura(
        sensor_id=sensor.id,
        sala_id=sala.id,
        temperatura=9.1,
        umidade=61.0,
        data_hora=BASE + timedelta(minutes=minutos, seconds=-5),
    )
    sessao.add(leitura)
    sessao.flush()
    alerta = Alerta(
        sala_id=sala.id,
        sensor_id=sensor.id,
        leitura_id=leitura.id,
        tipo="temperatura_acima",
        data_hora=BASE + timedelta(minutes=minutos),
        situacao=situacao,
        **atendimento,
    )
    sessao.add(alerta)
    sessao.flush()
    return alerta


@pytest.fixture
def alertas(sessao, gateway):
    """Câmara: um pendente (mais novo), um reconhecido e um encerrado.
    Estoque: um pendente e um reconhecido."""
    camara, sensor_camara = criar_sala(sessao, gateway, "Câmara fria 1")
    estoque, sensor_estoque = criar_sala(sessao, gateway, "Estoque")
    criados = {
        "camara_encerrado": criar_alerta(
            sessao,
            camara,
            sensor_camara,
            0,
            "encerrado",
            reconhecido_em=BASE + timedelta(minutes=1),
            acao_corretiva="Porta fechada",
            encerrado_em=BASE + timedelta(minutes=2),
        ),
        "estoque_reconhecido": criar_alerta(
            sessao,
            estoque,
            sensor_estoque,
            10,
            "reconhecido",
            reconhecido_em=BASE + timedelta(minutes=11),
        ),
        "camara_reconhecido": criar_alerta(
            sessao,
            camara,
            sensor_camara,
            20,
            "reconhecido",
            reconhecido_em=BASE + timedelta(minutes=21),
        ),
        "estoque_pendente": criar_alerta(sessao, estoque, sensor_estoque, 30),
        "camara_pendente": criar_alerta(sessao, camara, sensor_camara, 40),
    }
    sessao.commit()
    return criados


def ids(resposta):
    assert resposta.status_code == 200
    return [alerta["id"] for alerta in resposta.json()]


def test_sem_alertas_retorna_lista_vazia(client):
    resposta = client.get("/alertas")

    assert resposta.status_code == 200
    assert resposta.json() == []


def test_lista_todos_os_mais_recentes_primeiro(client, alertas):
    esperados = [
        "camara_pendente",
        "estoque_pendente",
        "camara_reconhecido",
        "estoque_reconhecido",
        "camara_encerrado",
    ]

    assert ids(client.get("/alertas")) == [alertas[nome].id for nome in esperados]


def test_alerta_no_formato_do_contrato(client, alertas):
    alerta = alertas["camara_encerrado"]

    [corpo] = [a for a in client.get("/alertas").json() if a["id"] == alerta.id]

    assert corpo == {
        "id": alerta.id,
        "sala_id": alerta.sala_id,
        "sala_nome": "Câmara fria 1",
        "sensor_id": alerta.sensor_id,
        "tipo": "temperatura_acima",
        "situacao": "encerrado",
        "data_hora": "2026-10-16T17:30:00Z",
        "leitura": {
            "temperatura": 9.1,
            "umidade": 61.0,
            "data_hora": "2026-10-16T17:29:55Z",
        },
        "reconhecido_por": None,
        "reconhecido_em": "2026-10-16T17:31:00Z",
        "acao_corretiva": "Porta fechada",
        "encerrado_em": "2026-10-16T17:32:00Z",
    }


def test_pendente_vem_sem_reconhecimento_nem_encerramento(client, alertas):
    alerta = alertas["camara_pendente"]

    [corpo] = client.get("/alertas", params={"sala_id": alerta.sala_id}).json()[:1]

    assert corpo["id"] == alerta.id
    assert corpo["situacao"] == "pendente"
    assert corpo["reconhecido_por"] is None
    assert corpo["reconhecido_em"] is None
    assert corpo["acao_corretiva"] is None
    assert corpo["encerrado_em"] is None


@pytest.mark.parametrize(
    "situacao, esperados",
    [
        ("pendente", ["camara_pendente", "estoque_pendente"]),
        ("reconhecido", ["camara_reconhecido", "estoque_reconhecido"]),
        ("encerrado", ["camara_encerrado"]),
    ],
)
def test_filtra_por_situacao(client, alertas, situacao, esperados):
    resposta = client.get("/alertas", params={"situacao": situacao})

    assert ids(resposta) == [alertas[nome].id for nome in esperados]


def test_filtra_por_sala(client, alertas):
    sala_id = alertas["estoque_pendente"].sala_id

    resposta = client.get("/alertas", params={"sala_id": sala_id})

    assert ids(resposta) == [
        alertas["estoque_pendente"].id,
        alertas["estoque_reconhecido"].id,
    ]


def test_filtra_por_situacao_e_sala_juntos(client, alertas):
    sala_id = alertas["camara_reconhecido"].sala_id

    resposta = client.get(
        "/alertas", params={"situacao": "reconhecido", "sala_id": sala_id}
    )

    assert ids(resposta) == [alertas["camara_reconhecido"].id]


def test_sala_sem_alertas_retorna_lista_vazia(client, alertas, gateway, sessao):
    sala, _ = criar_sala(sessao, gateway, "Sala nova")
    sessao.commit()

    assert ids(client.get("/alertas", params={"sala_id": sala.id})) == []


def test_situacao_invalida_da_422(client):
    resposta = client.get("/alertas", params={"situacao": "aberto"})

    assert resposta.status_code == 422


def test_sem_login_da_401(cliente_anonimo, alertas):
    resposta = cliente_anonimo.get("/alertas")

    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "não autenticado"}
