"""Relatório de leituras em CSV. Precisa de um PostgreSQL (DATABASE_URL)."""

import csv
import io
from datetime import UTC, datetime, timedelta

import pytest

from leituras.models import Leitura
from relatorios.service import montar_relatorio
from salas.models import Sala
from sensores.service import SensorService
from usuarios.admin_padrao import NOME_ADMIN_PADRAO

BASE = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)
PERIODO = {"inicio": "2026-10-16T00:00:00-03:00", "fim": "2026-10-16T23:59:59-03:00"}


@pytest.fixture
def sala(sessao):
    sala = Sala(nome="Câmara fria 1", temperatura_min=2.0, temperatura_max=8.5)
    sessao.add(sala)
    sessao.flush()
    return sala


@pytest.fixture
def sensor(sessao, sala, gateway):
    return SensorService(sessao).cadastrar(sala.id, gateway.id)


@pytest.fixture
def gravar(sessao, sala):
    def _gravar(sensor, minutos, temperatura=4.5, umidade=60.0):
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


def pedir(client, sala_id, **query):
    return client.get(
        "/relatorios/leituras",
        params={"sala_id": sala_id, "formato": "csv", **PERIODO, **query},
    )


def linhas(resposta):
    return list(
        csv.reader(io.StringIO(resposta.content.decode("utf-8-sig")), delimiter=";")
    )


def test_csv_traz_cabecalho_faixa_e_leituras_em_ordem(
    client, sala, sensor, gravar, monkeypatch
):
    monkeypatch.setenv("ESTABELECIMENTO_NOME", "Hospital Central")
    gravar(sensor, 30, temperatura=9.1, umidade=61.5)
    gravar(sensor, 0)

    resposta = pedir(client, sala.id)

    assert resposta.status_code == 200
    assert resposta.headers["content-type"].startswith("text/csv")
    assert resposta.headers["content-disposition"] == (
        f'attachment; filename="relatorio-leituras-sala-{sala.id}-20261016-20261016.csv"'
    )
    assert linhas(resposta) == [
        ["Estabelecimento", "Hospital Central"],
        ["Sala", "Câmara fria 1"],
        ["Período", "16/10/2026 00:00:00 a 16/10/2026 23:59:59"],
        ["Responsável técnico", NOME_ADMIN_PADRAO],
        ["Faixa de temperatura", "2,0 a 8,5 °C"],
        ["Faixa de umidade", "sem limite"],
        [],
        ["Data e hora", "Temperatura (°C)", "Umidade (%)", "ID do sensor"],
        # 12:00 UTC é 09:00 em Brasília.
        ["16/10/2026 09:00:00", "4,5", "60,0", str(sensor.id)],
        ["16/10/2026 09:30:00", "9,1", "61,5", str(sensor.id)],
    ]


def test_periodo_sem_leituras_gera_cabecalho_e_tabela_vazia(client, sala):
    resposta = pedir(client, sala.id)
    assert resposta.status_code == 200
    assert linhas(resposta)[-1] == [
        "Data e hora",
        "Temperatura (°C)",
        "Umidade (%)",
        "ID do sensor",
    ]


def test_limites_do_periodo_entram_e_o_que_passa_fica_de_fora(
    client, sala, sensor, gravar
):
    gravar(sensor, -1)
    gravar(sensor, 0)
    gravar(sensor, 10)
    gravar(sensor, 11)
    inicio, fim = BASE, BASE + timedelta(minutes=10)
    resposta = pedir(client, sala.id, inicio=inicio.isoformat(), fim=fim.isoformat())
    assert [linha[0] for linha in linhas(resposta)[8:]] == [
        "16/10/2026 09:00:00",
        "16/10/2026 09:10:00",
    ]


def test_so_entram_leituras_da_sala_pedida(
    client, sessao, sala, sensor, gravar, gateway
):
    outra = Sala(nome="Outra")
    sessao.add(outra)
    sessao.flush()
    gravar(sensor, 0)
    assert len(linhas(pedir(client, outra.id))) == 8


@pytest.mark.parametrize(
    "query",
    [
        {"inicio": "2026-10-16T00:00:00"},
        {"fim": "2026-10-16T23:59:59"},
        {"inicio": "2026-10-17T00:00:00-03:00"},
        {"formato": "xlsx"},
        {"formato": "doc"},
    ],
)
def test_pedido_invalido_responde_422(client, sala, query):
    assert pedir(client, sala.id, **query).status_code == 422


@pytest.mark.parametrize("sala_id", [999999, 2**40])
def test_sala_que_nao_existe(client, sala_id):
    esperado = 404 if sala_id < 2**31 else 422
    assert pedir(client, sala_id).status_code == esperado


def test_fusos_diferentes_no_inicio_e_no_fim_nao_quebram(client, sala):
    resposta = pedir(
        client, sala.id, inicio="2026-10-16T00:00:00Z", fim="2026-10-16T23:00:00-03:00"
    )
    assert resposta.status_code == 200


@pytest.mark.parametrize("inicio", ["=", "+", "-", "@", "\t", "\r"])
def test_nome_que_comeca_como_formula_ganha_apostrofo(client, sessao, sala, inicio):
    sala.nome = f"{inicio}Sala"
    sessao.flush()
    assert linhas(pedir(client, sala.id))[1][1] == f"'{inicio}Sala"


def test_nome_que_viraria_formula_na_planilha_vai_como_texto(client, sessao, sala):
    sala.nome = '=HYPERLINK("http://x")'
    sessao.flush()
    assert linhas(pedir(client, sala.id))[1][1] == '\'=HYPERLINK("http://x")'


def test_servico_monta_com_o_estabelecimento_padrao(sessao, sala, monkeypatch):
    monkeypatch.delenv("ESTABELECIMENTO_NOME", raising=False)
    relatorio = montar_relatorio(sessao, sala.id, BASE, BASE, "Ana")
    assert relatorio.estabelecimento == "Não informado"
    assert relatorio.leituras == []


def test_cabecalho_do_nome_do_arquivo_e_exposto_para_o_painel(client, sala):
    resposta = client.get(
        "/relatorios/leituras",
        params={"sala_id": sala.id, "formato": "csv", **PERIODO},
        headers={"Origin": "http://localhost:8081"},
    )
    assert (
        "content-disposition"
        in resposta.headers["access-control-expose-headers"].lower()
    )
