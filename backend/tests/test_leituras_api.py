"""Histórico de leituras por sensor. Precisa de um PostgreSQL (DATABASE_URL)."""

from datetime import UTC, datetime, timedelta

import pytest

from leituras.models import Leitura
from salas.models import Sala
from sensores.service import SensorService

BASE = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)


@pytest.fixture
def sala(sessao):
    sala = Sala(nome="Câmara fria 1")
    sessao.add(sala)
    sessao.flush()
    return sala


@pytest.fixture
def sensor(sessao, sala):
    return SensorService(sessao).cadastrar(sala.id)


@pytest.fixture
def gravar(sessao, sala):
    def _gravar(sensor, minutos, temperatura=4.0, umidade=60.0):
        sessao.add(
            Leitura(
                sensor_id=sensor.id,
                sala_id=sala.id,
                temperatura=temperatura,
                umidade=umidade,
                data_hora=BASE + timedelta(minutes=minutos),
            )
        )
        sessao.flush()

    return _gravar


def historico(client, sensor, **query):
    return client.get(f"/sensores/{sensor.id}/leituras", params=query)


def test_retorna_as_leituras_do_sensor_em_ordem_cronologica(client, sensor, gravar):
    # Gravadas fora de ordem, como acontece quando o nó central reenvia atrasadas.
    for minutos in (30, 0, 20, 10):
        gravar(sensor, minutos)

    resposta = historico(client, sensor)

    assert resposta.status_code == 200
    horas = [item["data_hora"] for item in resposta.json()["itens"]]
    assert [datetime.fromisoformat(h) for h in horas] == [
        BASE + timedelta(minutes=m) for m in (0, 10, 20, 30)
    ]


def test_resposta_traz_id_do_sensor_nome_da_sala_e_os_valores(client, sensor, gravar):
    gravar(sensor, 0, temperatura=4.3, umidade=61.5)

    corpo = historico(client, sensor).json()

    assert corpo["sensor_id"] == sensor.id
    assert corpo["sala_nome"] == "Câmara fria 1"
    assert corpo["total"] == 1
    assert corpo["pagina"] == 1
    (item,) = corpo["itens"]
    assert set(item) == {"temperatura", "umidade", "data_hora"}
    assert (item["temperatura"], item["umidade"]) == (4.3, 61.5)


def test_so_traz_leituras_do_sensor_pedido(client, sessao, sala, sensor, gravar):
    outro = SensorService(sessao).cadastrar(sala.id)
    gravar(sensor, 0)
    gravar(outro, 5)
    gravar(outro, 6)

    assert historico(client, sensor).json()["total"] == 1
    assert historico(client, outro).json()["total"] == 2


def test_sensor_sem_leituras_devolve_lista_vazia(client, sensor):
    corpo = historico(client, sensor).json()

    assert corpo["total"] == 0
    assert corpo["itens"] == []


def test_sensor_desativado_continua_com_o_historico(client, sessao, sensor, gravar):
    gravar(sensor, 0)
    SensorService(sessao).desativar(sensor.id)

    assert historico(client, sensor).json()["total"] == 1


def test_id_inexistente_da_404(client):
    resposta = client.get("/sensores/9999/leituras")

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "sensor não encontrado"}


def test_filtra_pelo_periodo_com_limites_inclusos(client, sensor, gravar):
    for minutos in (0, 10, 20, 30, 40):
        gravar(sensor, minutos)

    corpo = historico(
        client,
        sensor,
        inicio=(BASE + timedelta(minutes=10)).isoformat(),
        fim=(BASE + timedelta(minutes=30)).isoformat(),
    ).json()

    assert corpo["total"] == 3
    assert [datetime.fromisoformat(i["data_hora"]) for i in corpo["itens"]] == [
        BASE + timedelta(minutes=m) for m in (10, 20, 30)
    ]


def test_aceita_so_inicio_ou_so_fim(client, sensor, gravar):
    for minutos in (0, 10, 20):
        gravar(sensor, minutos)
    meio = (BASE + timedelta(minutes=10)).isoformat()

    assert historico(client, sensor, inicio=meio).json()["total"] == 2
    assert historico(client, sensor, fim=meio).json()["total"] == 2


def test_periodo_respeita_o_fuso_informado(client, sensor, gravar):
    gravar(sensor, 0)  # 12:00 UTC = 09:00 em -03:00

    dentro = historico(client, sensor, inicio="2026-10-16T09:00:00-03:00")
    fora = historico(client, sensor, inicio="2026-10-16T09:01:00-03:00")

    assert dentro.json()["total"] == 1
    assert fora.json()["total"] == 0


def test_recusa_inicio_depois_do_fim(client, sensor):
    resposta = historico(
        client,
        sensor,
        inicio="2026-10-17T00:00:00+00:00",
        fim="2026-10-16T00:00:00+00:00",
    )

    assert resposta.status_code == 422


def test_recusa_data_invalida(client, sensor):
    assert historico(client, sensor, inicio="ontem").status_code == 422


def test_pagina_o_resultado_sem_repetir_nem_perder_leituras(client, sensor, gravar):
    for minutos in range(5):
        gravar(sensor, minutos)

    paginas = [historico(client, sensor, pagina=p, tamanho=2).json() for p in (1, 2, 3)]

    assert [len(p["itens"]) for p in paginas] == [2, 2, 1]
    assert {p["total"] for p in paginas} == {5}
    assert [p["pagina"] for p in paginas] == [1, 2, 3]
    horas = [i["data_hora"] for p in paginas for i in p["itens"]]
    assert [datetime.fromisoformat(h) for h in horas] == [
        BASE + timedelta(minutes=m) for m in range(5)
    ]


def test_pagina_alem_do_fim_vem_vazia_com_o_total(client, sensor, gravar):
    gravar(sensor, 0)

    corpo = historico(client, sensor, pagina=5, tamanho=10).json()

    assert corpo["itens"] == []
    assert corpo["total"] == 1


def test_leituras_com_a_mesma_hora_mantem_a_ordem_entre_paginas(client, sensor, gravar):
    for _ in range(4):
        gravar(sensor, 0)

    p1 = historico(client, sensor, pagina=1, tamanho=2).json()["itens"]
    p2 = historico(client, sensor, pagina=2, tamanho=2).json()["itens"]

    assert len(p1) + len(p2) == 4


def test_padrao_de_100_por_pagina(client, sensor, gravar):
    for minutos in range(101):
        gravar(sensor, minutos)

    corpo = historico(client, sensor).json()

    assert corpo["total"] == 101
    assert len(corpo["itens"]) == 100


@pytest.mark.parametrize(
    "query",
    [{"pagina": 0}, {"tamanho": 0}, {"tamanho": 1001}, {"pagina": "x"}],
)
def test_recusa_paginacao_invalida(client, sensor, query):
    assert historico(client, sensor, **query).status_code == 422


def test_tamanho_maximo_de_1000_e_aceito(client, sensor):
    assert historico(client, sensor, tamanho=1000).status_code == 200
