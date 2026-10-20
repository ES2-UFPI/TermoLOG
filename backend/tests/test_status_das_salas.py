"""Status atual de todas as salas (painel). Precisa de um PostgreSQL (DATABASE_URL)."""

from datetime import UTC, datetime, timedelta

import pytest

from leituras.models import Leitura
from salas.models import Sala
from sensores.service import SensorService

BASE = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
FAIXA_CAMARA = {"temperatura_min": 2, "temperatura_max": 8}


def criar_sala(sessao, nome, **faixa):
    sala = Sala(nome=nome, **faixa)
    sessao.add(sala)
    sessao.flush()
    return sala


def criar_sensor(sessao, sala):
    return SensorService(sessao).cadastrar(sala.id)


def gravar(sessao, sensor, minutos, temperatura=5.0, umidade=60.0):
    sessao.add(
        Leitura(
            sensor_id=sensor.id,
            sala_id=sensor.sala_id,
            temperatura=temperatura,
            umidade=umidade,
            data_hora=BASE + timedelta(minutes=minutos),
        )
    )
    sessao.flush()


def status_por_nome(client):
    resposta = client.get("/salas/status")
    assert resposta.status_code == 200
    return {sala["nome"]: sala for sala in resposta.json()}


def test_sala_sem_leitura_vem_com_lista_vazia(client, sessao):
    criar_sala(sessao, "Sem sensor")
    criar_sensor(sessao, criar_sala(sessao, "Sensor sem leitura"))

    salas = status_por_nome(client)

    for nome in ("Sem sensor", "Sensor sem leitura"):
        assert salas[nome]["leituras"] == []
        assert salas[nome]["status"] == "sem_leitura"


def test_traz_a_ultima_leitura_de_cada_sensor_ativo(client, sessao):
    sala = criar_sala(sessao, "Câmara fria", **FAIXA_CAMARA)
    primeiro, segundo = criar_sensor(sessao, sala), criar_sensor(sessao, sala)
    # Gravadas fora de ordem: vale a data_hora, não a ordem de chegada.
    gravar(sessao, segundo, 10, temperatura=6.0)
    gravar(sessao, primeiro, 5, temperatura=4.5, umidade=61.0)
    gravar(sessao, primeiro, 0, temperatura=4.0)

    camara = status_por_nome(client)["Câmara fria"]

    assert camara["sala_id"] == sala.id
    assert camara["faixa"] == {
        "temperatura_min": 2,
        "temperatura_max": 8,
        "umidade_min": None,
        "umidade_max": None,
    }
    assert camara["intervalo_leitura_s"] is None
    assert [
        (item["sensor_id"], item["temperatura"]) for item in camara["leituras"]
    ] == [
        (primeiro.id, 4.5),
        (segundo.id, 6.0),
    ]
    assert datetime.fromisoformat(camara["leituras"][0]["data_hora"]) == (
        BASE + timedelta(minutes=5)
    )
    assert camara["leituras"][0]["umidade"] == 61.0


def test_sensor_desativado_sai_da_lista(client, sessao):
    sala = criar_sala(sessao, "Câmara fria", **FAIXA_CAMARA)
    antigo, novo = criar_sensor(sessao, sala), criar_sensor(sessao, sala)
    gravar(sessao, antigo, 0, temperatura=25.0)  # leitura do sensor com defeito
    SensorService(sessao).desativar(antigo.id)

    camara = status_por_nome(client)["Câmara fria"]

    # O substituto ainda não leu: a sala fica sem leitura, não com os 25 °C.
    assert camara["leituras"] == []
    assert camara["status"] == "sem_leitura"

    gravar(sessao, novo, 1, temperatura=5.0)
    camara = status_por_nome(client)["Câmara fria"]
    assert [item["sensor_id"] for item in camara["leituras"]] == [novo.id]


@pytest.mark.parametrize(
    ("faixa", "temperaturas", "status"),
    [
        (FAIXA_CAMARA, [5.0], "ok"),
        (FAIXA_CAMARA, [8.0], "ok"),  # no limite conta como dentro
        (FAIXA_CAMARA, [8.1], "fora_da_faixa"),
        (FAIXA_CAMARA, [5.0, 9.1], "fora_da_faixa"),  # basta um sensor fora
        ({"temperatura_max": 8}, [-18.0], "ok"),  # só máximo
        ({}, [30.0], "ok"),  # sala sem faixa
    ],
    ids=["dentro", "no-limite", "fora", "um-sensor-fora", "so-maximo", "sem-faixa"],
)
def test_status_segue_a_faixa_da_sala(client, sessao, faixa, temperaturas, status):
    sala = criar_sala(sessao, "Sala", **faixa)
    for minutos, temperatura in enumerate(temperaturas):
        gravar(sessao, criar_sensor(sessao, sala), minutos, temperatura=temperatura)

    assert status_por_nome(client)["Sala"]["status"] == status


def test_umidade_fora_da_faixa_tambem_conta(client, sessao):
    sala = criar_sala(sessao, "Estoque", umidade_min=30, umidade_max=60)
    gravar(sessao, criar_sensor(sessao, sala), 0, umidade=75.0)

    assert status_por_nome(client)["Estoque"]["status"] == "fora_da_faixa"


def test_sem_salas_retorna_lista_vazia(client):
    assert client.get("/salas/status").json() == []
