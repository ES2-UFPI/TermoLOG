"""Série histórica agregada por sala (gráfico). Precisa de um PostgreSQL (DATABASE_URL)."""

from datetime import UTC, datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from gateways.service import GatewayService
from leituras.models import Leitura
from salas.models import Sala
from sensores.service import SensorService

# 20/10/2026 12:07 UTC: fora do limite de intervalo de propósito (5 min, 1 h e 4 h).
FIM = datetime(2026, 10, 20, 12, 7, tzinfo=UTC)


@pytest.fixture
def sala(sessao):
    sala = Sala(nome="Câmara fria", temperatura_min=2, temperatura_max=8)
    sessao.add(sala)
    sessao.flush()
    return sala


@pytest.fixture
def sensor(sessao, sala, gateway):
    return SensorService(sessao).cadastrar(sala.id, gateway.id)


@pytest.fixture
def gravar(sessao):
    def _gravar(sensor, quando, temperatura=5.0, umidade=60.0):
        sessao.add(
            Leitura(
                sensor_id=sensor.id,
                sala_id=sensor.sala_id,
                temperatura=temperatura,
                umidade=umidade,
                data_hora=quando,
            )
        )
        sessao.flush()

    return _gravar


def historico(client, sala, periodo="dia", fim=FIM, **query):
    params = {"periodo": periodo, "fim": fim.isoformat(), **query}
    return client.get(f"/salas/{sala.id}/historico", params=params)


def inicios(resposta):
    return [datetime.fromisoformat(p["inicio"]) for p in resposta.json()["pontos"]]


def test_agrega_media_minimo_e_maximo_de_temperatura_e_umidade(
    client, sala, sensor, gravar
):
    # Três leituras no mesmo intervalo de 5 min (12:05 a 12:10).
    gravar(sensor, FIM - timedelta(minutes=2), temperatura=4.0, umidade=50.0)
    gravar(sensor, FIM - timedelta(minutes=1), temperatura=6.0, umidade=70.0)
    gravar(sensor, FIM, temperatura=8.0, umidade=60.0)

    resposta = historico(client, sala)

    assert resposta.status_code == 200
    assert resposta.json()["pontos"] == [
        {
            "inicio": "2026-10-20T12:05:00Z",
            "quantidade": 3,
            "temperatura": {"media": 6.0, "min": 4.0, "max": 8.0},
            "umidade": {"media": 60.0, "min": 50.0, "max": 70.0},
        }
    ]


def test_junta_os_sensores_da_sala_e_ignora_as_outras_salas(
    client, sessao, sala, sensor, gravar
):
    segundo = SensorService(sessao).cadastrar(
        sala.id, GatewayService(sessao).cadastrar("Outro gateway")[0].id
    )
    outra_sala = Sala(nome="Outra")
    sessao.add(outra_sala)
    sessao.flush()
    de_outra_sala = SensorService(sessao).cadastrar(outra_sala.id, sensor.gateway_id)
    gravar(sensor, FIM, temperatura=4.0)
    gravar(segundo, FIM, temperatura=6.0)
    gravar(de_outra_sala, FIM, temperatura=30.0)

    (ponto,) = historico(client, sala).json()["pontos"]

    assert ponto["quantidade"] == 2
    assert ponto["temperatura"] == {"media": 5.0, "min": 4.0, "max": 6.0}


def test_arredonda_a_media_em_duas_casas(client, sala, sensor, gravar):
    for temperatura in (1.0, 1.0, 2.0):
        gravar(sensor, FIM, temperatura=temperatura)

    (ponto,) = historico(client, sala).json()["pontos"]

    assert ponto["temperatura"]["media"] == 1.33


def test_intervalo_sem_leitura_nao_vira_ponto(client, sala, sensor, gravar):
    gravar(sensor, FIM)
    gravar(sensor, FIM - timedelta(hours=1))

    resposta = historico(client, sala)

    # Só dois pontos: os 10 intervalos vazios entre eles não ganham valor inventado.
    assert inicios(resposta) == [
        datetime(2026, 10, 20, 11, 5, tzinfo=UTC),
        datetime(2026, 10, 20, 12, 5, tzinfo=UTC),
    ]


def test_sala_sem_leitura_volta_com_a_janela_a_faixa_e_nenhum_ponto(client, sala):
    corpo = historico(client, sala).json()

    assert corpo["pontos"] == []
    assert corpo["sala_id"] == sala.id
    assert corpo["nome"] == "Câmara fria"
    assert corpo["faixa"] == {
        "temperatura_min": 2,
        "temperatura_max": 8,
        "umidade_min": None,
        "umidade_max": None,
    }


def test_sala_sem_faixa_volta_com_os_limites_nulos(client, sessao):
    sala = Sala(nome="Sem faixa")
    sessao.add(sala)
    sessao.flush()

    assert historico(client, sala).json()["faixa"] == {
        "temperatura_min": None,
        "temperatura_max": None,
        "umidade_min": None,
        "umidade_max": None,
    }


@pytest.mark.parametrize(
    ("periodo", "intervalo_s", "pontos", "janela"),
    [
        ("dia", 300, 288, timedelta(days=1)),
        ("semana", 3600, 168, timedelta(days=7)),
        ("mes", 14400, 180, timedelta(days=30)),
    ],
)
def test_janela_e_intervalo_de_cada_periodo(
    client, sala, periodo, intervalo_s, pontos, janela
):
    corpo = historico(client, sala, periodo).json()

    assert corpo["periodo"] == periodo
    assert corpo["intervalo_s"] == intervalo_s
    assert datetime.fromisoformat(corpo["fim"]) == FIM
    inicio = datetime.fromisoformat(corpo["inicio"])
    # O início é o do primeiro intervalo: a janela tem exatamente ``pontos`` deles,
    # o último contendo o fim, e nunca passa do tamanho do período.
    assert inicio.timestamp() % intervalo_s == 0
    assert FIM - inicio < janela
    assert FIM - inicio >= janela - timedelta(seconds=intervalo_s)
    assert (FIM - inicio) // timedelta(seconds=intervalo_s) == pontos - 1


@pytest.mark.parametrize(
    ("periodo", "pontos", "no_primeiro", "no_ultimo"),
    # O primeiro ponto é um intervalo inteiro; o último vai só até o fim (12:07):
    # 12:05 a 12:07 são 3 leituras no dia, 12:00 a 12:07 são 8 na semana e no mês.
    [("dia", 288, 5, 3), ("semana", 168, 60, 8), ("mes", 180, 240, 8)],
)
def test_quantidade_de_pontos_e_limitada_em_qualquer_periodo(
    client, sessao, sala, sensor, periodo, pontos, no_primeiro, no_ultimo
):
    # Uma leitura por minuto durante 31 dias (44.640 leituras): mais que qualquer
    # janela. Inserida direto no banco, sem passar pelo ORM, para o teste ser rápido.
    sessao.execute(
        text(
            "INSERT INTO leituras (sensor_id, sala_id, temperatura, umidade,"
            " data_hora, dentro_da_faixa)"
            " SELECT :sensor, :sala, 5, 60, g, true"
            " FROM generate_series(CAST(:fim AS timestamptz) - interval '31 days',"
            " CAST(:fim AS timestamptz), interval '1 minute') AS g"
        ),
        {"sensor": sensor.id, "sala": sala.id, "fim": FIM},
    )

    quantidades = [
        p["quantidade"] for p in historico(client, sala, periodo).json()["pontos"]
    ]

    # Com leitura em todo minuto nenhum intervalo fica vazio: vêm todos os pontos,
    # e só eles, por mais leituras que o período tenha.
    assert len(quantidades) == pontos
    assert quantidades[0] == no_primeiro
    assert quantidades[-1] == no_ultimo
    assert set(quantidades[1:-1]) == {no_primeiro}


@pytest.mark.parametrize(
    ("periodo", "limite"),
    [
        ("dia", timedelta(days=1)),
        ("semana", timedelta(days=7)),
        ("mes", timedelta(days=30)),
    ],
)
def test_leitura_fora_da_janela_fica_de_fora(
    client, sala, sensor, gravar, periodo, limite
):
    resposta0 = historico(client, sala, periodo)
    inicio = datetime.fromisoformat(resposta0.json()["inicio"])
    gravar(sensor, inicio - timedelta(seconds=1), temperatura=1.0)
    gravar(sensor, inicio, temperatura=2.0)
    gravar(sensor, FIM, temperatura=3.0)
    gravar(sensor, FIM + timedelta(seconds=1), temperatura=99.0)

    pontos = historico(client, sala, periodo).json()["pontos"]

    # Entram o instante do início e o do fim (limites inclusos); saem os de fora.
    assert [p["temperatura"]["media"] for p in pontos] == [2.0, 3.0]
    assert FIM - datetime.fromisoformat(pontos[0]["inicio"]) < limite


def test_periodo_padrao_e_dia(client, sala):
    resposta = client.get(
        f"/salas/{sala.id}/historico", params={"fim": FIM.isoformat()}
    )

    assert resposta.status_code == 200
    assert resposta.json()["periodo"] == "dia"
    assert resposta.json()["intervalo_s"] == 300


def test_sem_fim_a_janela_termina_agora(client, sala, sensor, gravar):
    gravar(sensor, datetime.now(UTC) - timedelta(minutes=1))

    resposta = client.get(f"/salas/{sala.id}/historico")

    assert resposta.status_code == 200
    fim = datetime.fromisoformat(resposta.json()["fim"])
    assert abs(datetime.now(UTC) - fim) < timedelta(minutes=1)
    assert len(resposta.json()["pontos"]) == 1


def test_fim_sem_fuso_vale_como_utc(client, sala, sensor, gravar):
    gravar(sensor, FIM)

    resposta = client.get(
        f"/salas/{sala.id}/historico",
        params={"fim": FIM.replace(tzinfo=None).isoformat()},
    )

    assert datetime.fromisoformat(resposta.json()["fim"]) == FIM
    assert len(resposta.json()["pontos"]) == 1


def test_fim_em_outro_fuso_e_convertido_para_utc(client, sala, sensor, gravar):
    gravar(sensor, FIM)
    brasilia = timezone(timedelta(hours=-3))

    resposta = historico(client, sala, fim=FIM.astimezone(brasilia))

    corpo = resposta.json()
    assert datetime.fromisoformat(corpo["fim"]) == FIM
    assert corpo["fim"].endswith("Z")
    assert inicios(resposta) == [datetime(2026, 10, 20, 12, 5, tzinfo=UTC)]


def test_arredonda_tambem_a_media_da_umidade(client, sala, sensor, gravar):
    for umidade in (50.0, 50.0, 51.0):
        gravar(sensor, FIM, umidade=umidade)

    (ponto,) = historico(client, sala).json()["pontos"]

    assert ponto["umidade"]["media"] == 50.33


def test_fim_exatamente_no_comeco_de_um_intervalo(client, sala, sensor, gravar):
    fim = datetime(2026, 10, 20, 12, 5, tzinfo=UTC)
    gravar(sensor, fim, temperatura=3.0)
    gravar(sensor, fim - timedelta(microseconds=1), temperatura=1.0)
    gravar(sensor, fim + timedelta(microseconds=1), temperatura=99.0)

    pontos = historico(client, sala, fim=fim).json()["pontos"]

    # O último ponto é o que começa em ``fim`` e só tem a leitura daquele instante.
    assert [(p["inicio"], p["temperatura"]["media"]) for p in pontos] == [
        ("2026-10-20T12:00:00Z", 1.0),
        ("2026-10-20T12:05:00Z", 3.0),
    ]


def test_sensor_desativado_continua_na_serie_da_sala(
    client, sessao, sala, sensor, gravar
):
    gravar(sensor, FIM)
    SensorService(sessao).desativar(sensor.id)

    (ponto,) = historico(client, sala).json()["pontos"]

    assert ponto["quantidade"] == 1


def test_datas_saem_em_utc_mesmo_com_o_banco_em_outro_fuso(
    client, sessao, sala, sensor, gravar
):
    gravar(sensor, FIM)
    sessao.execute(text("SET TIME ZONE 'America/Fortaleza'"))

    corpo = historico(client, sala, "mes").json()

    # O intervalo de 4 h continua alinhado em UTC (12:00), e não na hora do banco.
    assert corpo["pontos"][0]["inicio"] == "2026-10-20T12:00:00Z"
    assert corpo["inicio"].endswith("Z")
    assert corpo["fim"].endswith("Z")


@pytest.mark.parametrize(
    "fim",
    [
        "0001-01-01T00:00:00Z",
        "0001-01-01T00:00:00+03:00",
        "9999-12-31T23:59:59-03:00",
    ],
)
@pytest.mark.parametrize("periodo", ["dia", "mes"])
def test_fim_fora_do_calendario_responde_422(client, sala, fim, periodo):
    resposta = client.get(
        f"/salas/{sala.id}/historico", params={"periodo": periodo, "fim": fim}
    )

    assert resposta.status_code == 422
    assert resposta.json() == {"detail": "fim fora do intervalo suportado"}


def test_os_pontos_vem_em_ordem_cronologica(client, sala, sensor, gravar):
    # Gravadas fora de ordem, como acontece quando o nó central reenvia atrasadas.
    for minutos in (0, 30, 10, 20):
        gravar(sensor, FIM - timedelta(minutes=minutos))

    horas = inicios(historico(client, sala))

    assert horas == sorted(horas)
    assert len(horas) == 4


def test_sala_inexistente_responde_404(client):
    resposta = client.get("/salas/999999/historico")

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "sala não encontrada"}


@pytest.mark.parametrize("periodo", ["ano", "", "DIA"])
def test_periodo_invalido_responde_422(client, sala, periodo):
    assert historico(client, sala, periodo).status_code == 422


def test_fim_invalido_responde_422(client, sala):
    resposta = client.get(f"/salas/{sala.id}/historico", params={"fim": "ontem"})

    assert resposta.status_code == 422


def test_exige_login(cliente_anonimo, sala):
    resposta = cliente_anonimo.get(f"/salas/{sala.id}/historico")

    assert resposta.status_code == 401
