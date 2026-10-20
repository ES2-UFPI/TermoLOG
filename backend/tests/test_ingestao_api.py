"""Ingestão dos lotes do nó central (gateway). Precisa de um PostgreSQL (DATABASE_URL)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from leituras.models import Leitura
from salas.models import Sala
from sensores.service import SensorService

LOTE_ID = "3f0c6d1e-8a2b-4c55-9b7e-2d1f0a9c4e11"


@pytest.fixture
def sala(sessao):
    sala = Sala(nome="Câmara fria 1")
    sessao.add(sala)
    sessao.flush()
    return sala


@pytest.fixture
def sensor(sessao, sala):
    return SensorService(sessao).cadastrar(sala.id)


def item(
    sensor_id, temperatura=4.3, umidade=61.0, data_hora="2026-10-16T14:30:00-03:00"
):
    return {
        "sensor_id": sensor_id,
        "temperatura": temperatura,
        "umidade": umidade,
        "data_hora": data_hora,
    }


def enviar(client, itens, **campos):
    lote = {
        "lote_id": LOTE_ID,
        "versao_config": 0,
        "comandos_concluidos": [],
        "leituras": itens,
        **campos,
    }
    return client.post("/gateways/1/leituras", json=lote)


def gravadas(sessao):
    return list(sessao.scalars(select(Leitura).order_by(Leitura.id)))


def test_lote_valido_e_gravado_e_confirmado(client, sessao, sala, sensor):
    outro = SensorService(sessao).cadastrar(sala.id)

    resposta = enviar(client, [item(sensor.id), item(outro.id, 5.1, 58.5)])

    assert resposta.status_code == 201
    assert resposta.json() == {
        "lote_id": LOTE_ID,
        "aceitas": 2,
        "rejeitadas": [],
        "config": None,
        "comandos": [],
    }
    leituras = gravadas(sessao)
    assert [(lt.sensor_id, lt.temperatura, lt.umidade) for lt in leituras] == [
        (sensor.id, 4.3, 61.0),
        (outro.id, 5.1, 58.5),
    ]
    assert {lt.sala_id for lt in leituras} == {sala.id}


def test_grava_a_hora_do_no_em_utc(client, sessao, sensor):
    enviar(client, [item(sensor.id, data_hora="2026-10-16T14:30:00-03:00")])

    (leitura,) = gravadas(sessao)
    assert leitura.data_hora == datetime(2026, 10, 16, 17, 30, tzinfo=UTC)


def test_heartbeat_sem_leituras_e_confirmado(client, sessao):
    resposta = enviar(client, [])

    assert resposta.status_code == 201
    assert resposta.json()["aceitas"] == 0
    assert gravadas(sessao) == []


def test_item_invalido_nao_derruba_o_lote(client, sessao, sensor):
    resposta = enviar(
        client,
        [item(sensor.id), item(9999), item(sensor.id, umidade=140.0)],
    )

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["aceitas"] == 1
    assert corpo["rejeitadas"] == [
        {"indice": 1, "sensor_id": 9999, "motivo": "sensor_nao_cadastrado"},
        {"indice": 2, "sensor_id": sensor.id, "motivo": "valor_fora_do_limite"},
    ]
    assert len(gravadas(sessao)) == 1


def test_recusa_leitura_de_sensor_desativado(client, sessao, sensor):
    SensorService(sessao).desativar(sensor.id)

    corpo = enviar(client, [item(sensor.id)]).json()

    assert corpo["aceitas"] == 0
    assert corpo["rejeitadas"] == [
        {"indice": 0, "sensor_id": sensor.id, "motivo": "sensor_inativo"}
    ]


@pytest.mark.parametrize(
    "temperatura, umidade",
    [(-40.1, 50.0), (80.1, 50.0), (4.0, -0.1), (4.0, 100.1)],
)
def test_recusa_valores_fora_do_limite_fisico(client, sensor, temperatura, umidade):
    corpo = enviar(client, [item(sensor.id, temperatura, umidade)]).json()

    assert corpo["aceitas"] == 0
    assert corpo["rejeitadas"][0]["motivo"] == "valor_fora_do_limite"


@pytest.mark.parametrize("temperatura, umidade", [(-40.0, 0.0), (80.0, 100.0)])
def test_aceita_os_limites_fisicos_exatos(client, sensor, temperatura, umidade):
    corpo = enviar(client, [item(sensor.id, temperatura, umidade)]).json()

    assert corpo["aceitas"] == 1


def test_recusa_data_hora_mais_de_5_min_no_futuro(client, sensor):
    agora = datetime.now(UTC)
    no_limite = (agora + timedelta(minutes=4)).isoformat()
    adiantada = (agora + timedelta(minutes=6)).isoformat()

    corpo = enviar(
        client,
        [item(sensor.id, data_hora=no_limite), item(sensor.id, data_hora=adiantada)],
    ).json()

    assert corpo["aceitas"] == 1
    assert corpo["rejeitadas"] == [
        {"indice": 1, "sensor_id": sensor.id, "motivo": "data_hora_invalida"}
    ]


def test_recusa_data_hora_sem_fuso(client, sensor):
    corpo = enviar(client, [item(sensor.id, data_hora="2026-10-16T14:30:00")]).json()

    assert corpo["rejeitadas"][0]["motivo"] == "data_hora_invalida"


@pytest.mark.parametrize(
    "campos",
    [
        {"lote_id": "nao-e-uuid"},
        {"lote_id": None},
        {"versao_config": -1},
        {"versao_config": "sete"},
        {"comandos_concluidos": ["quatro"]},
        {"leituras": None},
    ],
)
def test_recusa_lote_malformado(client, sessao, sensor, campos):
    resposta = enviar(client, [item(sensor.id)], **campos)

    assert resposta.status_code == 422
    assert gravadas(sessao) == []


def test_recusa_lote_sem_lote_id_dizendo_o_campo(client, sessao):
    resposta = client.post(
        "/gateways/1/leituras", json={"versao_config": 0, "leituras": []}
    )

    assert resposta.status_code == 422
    (erro,) = resposta.json()["detail"]
    assert erro["loc"] == ["body", "lote_id"]


def test_recusa_lote_com_mais_de_100_leituras(client, sessao, sensor):
    resposta = enviar(client, [item(sensor.id)] * 101)

    assert resposta.status_code == 422
    assert resposta.json()["detail"][0]["loc"] == ["body", "leituras"]
    assert gravadas(sessao) == []


def test_aceita_lote_com_100_leituras(client, sensor):
    assert enviar(client, [item(sensor.id)] * 100).json()["aceitas"] == 100


@pytest.mark.parametrize(
    "campo, valor",
    [
        ("sensor_id", "doze"),
        ("temperatura", "quente"),
        ("umidade", None),
        ("data_hora", "ontem"),
    ],
)
def test_recusa_item_com_tipo_errado_apontando_o_item(
    client, sessao, sensor, campo, valor
):
    leituras = [item(sensor.id), {**item(sensor.id), campo: valor}]

    resposta = enviar(client, leituras)

    assert resposta.status_code == 422
    (erro,) = resposta.json()["detail"]
    assert erro["loc"] == ["body", "leituras", 1, campo]
    assert gravadas(sessao) == []


def test_recusa_item_sem_campo_obrigatorio(client, sensor):
    leitura = item(sensor.id)
    del leitura["umidade"]

    assert enviar(client, [leitura]).status_code == 422


def test_recusa_json_invalido(client):
    resposta = client.post(
        "/gateways/1/leituras",
        content=b"{nao e json",
        headers={"Content-Type": "application/json"},
    )

    assert resposta.status_code == 422
