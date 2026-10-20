"""Status atual de todas as salas (painel). Precisa de um PostgreSQL (DATABASE_URL)."""

from datetime import UTC, datetime, timedelta

from leituras.models import Leitura
from salas.models import Sala
from sensores.service import SensorService

BASE = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)


def cadastrar(sessao, nome, **faixa):
    sala = Sala(nome=nome, **faixa)
    sessao.add(sala)
    sessao.flush()
    return sala, SensorService(sessao).cadastrar(sala.id)


def gravar(sessao, sensor, minutos, temperatura, umidade=60.0):
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


def test_retorna_todas_as_salas_com_e_sem_leitura(client, sessao):
    _, sensor = cadastrar(sessao, "Câmara fria", temperatura_min=2, temperatura_max=8)
    cadastrar(sessao, "Estoque")
    gravar(sessao, sensor, 0, temperatura=4.0)

    salas = status_por_nome(client)

    assert salas.keys() == {"Câmara fria", "Estoque"}
    assert salas["Câmara fria"]["ultima_leitura"]["temperatura"] == 4.0
    assert salas["Estoque"]["ultima_leitura"] is None
    assert salas["Estoque"]["dentro_da_faixa"] is None


def test_traz_a_leitura_mais_recente_com_o_id_do_sensor_e_a_faixa(client, sessao):
    sala, sensor = cadastrar(
        sessao, "Câmara fria", temperatura_min=2, temperatura_max=8
    )
    # Gravadas fora de ordem: vale a data_hora, não a ordem de chegada.
    gravar(sessao, sensor, 10, temperatura=5.0, umidade=61.0)
    gravar(sessao, sensor, 0, temperatura=4.0)

    camara = status_por_nome(client)["Câmara fria"]

    assert camara["id"] == sala.id
    assert (camara["temperatura_min"], camara["temperatura_max"]) == (2, 8)
    assert camara["ultima_leitura"]["sensor_id"] == sensor.id
    assert camara["ultima_leitura"]["temperatura"] == 5.0
    assert camara["ultima_leitura"]["umidade"] == 61.0
    assert datetime.fromisoformat(camara["ultima_leitura"]["data_hora"]) == (
        BASE + timedelta(minutes=10)
    )


def test_sem_salas_retorna_lista_vazia(client):
    assert client.get("/salas/status").json() == []
