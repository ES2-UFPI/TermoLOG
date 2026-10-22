"""Ingestão dos lotes do nó central (gateway). Precisa de um PostgreSQL (DATABASE_URL)."""

import threading
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from database import database_url
from leituras.models import Leitura
from leituras.schemas import LeituraRecebida
from leituras.service import LeituraService
from salas.models import Sala
from sensores.service import SensorService

LOTE_ID = "3f0c6d1e-8a2b-4c55-9b7e-2d1f0a9c4e11"
OUTRO_LOTE_ID = "9b1e2c3d-0000-4a1b-8c2d-123456789abc"


@pytest.fixture
def sala(sessao):
    sala = Sala(nome="Câmara fria 1")
    sessao.add(sala)
    sessao.flush()
    return sala


@pytest.fixture
def sensor(sessao, sala, gateway):
    return SensorService(sessao).cadastrar(sala.id, gateway["id"])


def item(
    sensor_id, temperatura=4.3, umidade=61.0, data_hora="2026-10-16T14:30:00-03:00"
):
    return {
        "sensor_id": sensor_id,
        "temperatura": temperatura,
        "umidade": umidade,
        "data_hora": data_hora,
    }


@pytest.fixture
def gateway(client):
    """Gateway cadastrado, com a chave de API já nos cabeçalhos do cliente."""
    gateway = client.post("/gateways", json={"nome": "Filial Centro"}).json()
    client.headers["Authorization"] = f"Bearer {gateway['chave_api']}"
    return gateway


@pytest.fixture
def enviar(client, gateway):
    def _enviar(itens, **campos):
        lote = {
            "lote_id": LOTE_ID,
            "versao_config": 0,
            "comandos_concluidos": [],
            "leituras": itens,
            **campos,
        }
        return client.post(f"/gateways/{gateway['id']}/leituras", json=lote)

    return _enviar


def gravadas(sessao):
    return list(sessao.scalars(select(Leitura).order_by(Leitura.id)))


def test_lote_valido_e_gravado_e_confirmado(enviar, sessao, gateway, sala, sensor):
    outro = SensorService(sessao).cadastrar(sala.id, gateway["id"])

    resposta = enviar([item(sensor.id), item(outro.id, 5.1, 58.5)])

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


def test_grava_a_hora_do_no_em_utc(enviar, sessao, sensor):
    enviar([item(sensor.id, data_hora="2026-10-16T14:30:00-03:00")])

    (leitura,) = gravadas(sessao)
    assert leitura.data_hora == datetime(2026, 10, 16, 17, 30, tzinfo=UTC)


def test_heartbeat_sem_leituras_e_confirmado(enviar, sessao):
    resposta = enviar([])

    assert resposta.status_code == 201
    assert resposta.json()["aceitas"] == 0
    assert gravadas(sessao) == []


def test_item_invalido_nao_derruba_o_lote(enviar, sessao, sensor):
    resposta = enviar(
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


def test_recusa_leitura_de_sensor_nao_cadastrado_sem_gravar(enviar, sessao):
    resposta = enviar([item(9999)])

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["aceitas"] == 0
    assert corpo["rejeitadas"] == [
        {"indice": 0, "sensor_id": 9999, "motivo": "sensor_nao_cadastrado"}
    ]
    assert gravadas(sessao) == []


def test_recusa_leitura_de_sensor_desativado(client, enviar, sessao, sensor):
    # Pela rota, como o administrador faz: a desativação já está gravada quando o
    # lote chega.
    assert client.post(f"/sensores/{sensor.id}/desativar").status_code == 200

    resposta = enviar([item(sensor.id)])

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["aceitas"] == 0
    assert corpo["rejeitadas"] == [
        {"indice": 0, "sensor_id": sensor.id, "motivo": "sensor_inativo"}
    ]
    assert gravadas(sessao) == []


def test_sensor_inativo_nao_derruba_o_lote(enviar, sessao, gateway, sala, sensor):
    inativo = SensorService(sessao).cadastrar(sala.id, gateway["id"])
    SensorService(sessao).desativar(inativo.id)

    resposta = enviar([item(sensor.id), item(inativo.id)])

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["aceitas"] == 1
    assert corpo["rejeitadas"] == [
        {"indice": 1, "sensor_id": inativo.id, "motivo": "sensor_inativo"}
    ]
    assert [lt.sensor_id for lt in gravadas(sessao)] == [sensor.id]


def test_recusa_leitura_medida_antes_da_desativacao(enviar, sessao, sensor):
    # Vale o estado do sensor quando o lote chega (1.2): a leitura foi medida com o
    # sensor ainda ativo, mas ficou na fila do gateway até depois da desativação.
    medida = (datetime.now(UTC) - timedelta(minutes=10)).isoformat()
    SensorService(sessao).desativar(sensor.id)

    resposta = enviar([item(sensor.id, data_hora=medida)])

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["aceitas"] == 0
    assert corpo["rejeitadas"] == [
        {"indice": 0, "sensor_id": sensor.id, "motivo": "sensor_inativo"}
    ]
    assert gravadas(sessao) == []


@pytest.mark.parametrize(
    "campos",
    [
        {"umidade": 140.0},
        {"data_hora": "2026-10-16T14:30:00"},
        {"data_hora": "2099-01-01T00:00:00-03:00"},
    ],
    ids=["valor-fora-do-limite", "data-hora-sem-fuso", "data-hora-no-futuro"],
)
def test_problema_do_sensor_vale_antes_dos_outros(enviar, sessao, sensor, campos):
    SensorService(sessao).desativar(sensor.id)

    resposta = enviar([{**item(9999), **campos}, {**item(sensor.id), **campos}])

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["aceitas"] == 0
    assert corpo["rejeitadas"] == [
        {"indice": 0, "sensor_id": 9999, "motivo": "sensor_nao_cadastrado"},
        {"indice": 1, "sensor_id": sensor.id, "motivo": "sensor_inativo"},
    ]
    assert gravadas(sessao) == []


@pytest.mark.parametrize(
    "data_hora",
    ["2026-10-16T14:30:00", "2099-01-01T00:00:00-03:00"],
    ids=["sem-fuso", "no-futuro"],
)
def test_valor_fora_do_limite_vale_antes_da_data_hora(enviar, sessao, sensor, data_hora):
    corpo = enviar([item(sensor.id, umidade=140.0, data_hora=data_hora)]).json()

    assert corpo["rejeitadas"] == [
        {"indice": 0, "sensor_id": sensor.id, "motivo": "valor_fora_do_limite"}
    ]
    assert gravadas(sessao) == []


@pytest.mark.parametrize(
    "temperatura, umidade",
    [(-40.1, 50.0), (80.1, 50.0), (4.0, -0.1), (4.0, 100.1)],
)
def test_recusa_valores_fora_do_limite_fisico(enviar, sensor, temperatura, umidade):
    corpo = enviar([item(sensor.id, temperatura, umidade)]).json()

    assert corpo["aceitas"] == 0
    assert corpo["rejeitadas"][0]["motivo"] == "valor_fora_do_limite"


@pytest.mark.parametrize("temperatura, umidade", [(-40.0, 0.0), (80.0, 100.0)])
def test_aceita_os_limites_fisicos_exatos(enviar, sensor, temperatura, umidade):
    corpo = enviar([item(sensor.id, temperatura, umidade)]).json()

    assert corpo["aceitas"] == 1


def test_recusa_data_hora_mais_de_5_min_no_futuro(enviar, sensor):
    agora = datetime.now(UTC)
    no_limite = (agora + timedelta(minutes=4)).isoformat()
    adiantada = (agora + timedelta(minutes=6)).isoformat()

    corpo = enviar(
        [item(sensor.id, data_hora=no_limite), item(sensor.id, data_hora=adiantada)],
    ).json()

    assert corpo["aceitas"] == 1
    assert corpo["rejeitadas"] == [
        {"indice": 1, "sensor_id": sensor.id, "motivo": "data_hora_invalida"}
    ]


def test_recusa_data_hora_sem_fuso(enviar, sensor):
    corpo = enviar([item(sensor.id, data_hora="2026-10-16T14:30:00")]).json()

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
def test_recusa_lote_malformado(enviar, sessao, sensor, campos):
    resposta = enviar([item(sensor.id)], **campos)

    assert resposta.status_code == 422
    assert gravadas(sessao) == []


def test_recusa_lote_sem_lote_id_dizendo_o_campo(client, gateway, sessao):
    resposta = client.post(
        f"/gateways/{gateway['id']}/leituras", json={"versao_config": 0, "leituras": []}
    )

    assert resposta.status_code == 422
    (erro,) = resposta.json()["detail"]
    assert erro["loc"] == ["body", "lote_id"]


def test_recusa_lote_com_mais_de_100_leituras(enviar, sessao, sensor):
    resposta = enviar([item(sensor.id)] * 101)

    assert resposta.status_code == 422
    assert resposta.json()["detail"][0]["loc"] == ["body", "leituras"]
    assert gravadas(sessao) == []


def test_aceita_lote_com_100_leituras(enviar, sensor):
    assert enviar([item(sensor.id)] * 100).json()["aceitas"] == 100


@pytest.mark.parametrize(
    "campo, valor",
    [
        ("sensor_id", "doze"),
        ("temperatura", "quente"),
        ("umidade", None),
        ("data_hora", "ontem"),
        # Sem conversão: número em texto e data como timestamp também são recusados.
        ("sensor_id", "12"),
        ("sensor_id", 12.0),
        ("temperatura", "4.3"),
        ("umidade", "61"),
        ("data_hora", 1760635800),
    ],
)
def test_recusa_item_com_tipo_errado_apontando_o_item(
    enviar, sessao, sensor, campo, valor
):
    leituras = [item(sensor.id), {**item(sensor.id), campo: valor}]

    resposta = enviar(leituras)

    assert resposta.status_code == 422
    (erro,) = resposta.json()["detail"]
    assert erro["loc"] == ["body", "leituras", 1, campo]
    assert gravadas(sessao) == []


def test_aceita_temperatura_e_umidade_inteiras(enviar, sensor):
    assert enviar([item(sensor.id, temperatura=4, umidade=61)]).json()["aceitas"] == 1


@pytest.mark.parametrize("sensor_id", [2**31, -(2**31) - 1, 10**30])
def test_sensor_id_fora_do_integer_e_recusado_sem_derrubar_o_lote(
    enviar, sessao, sensor, sensor_id
):
    resposta = enviar([item(sensor.id), item(sensor_id)])

    assert resposta.status_code == 201
    assert resposta.json()["aceitas"] == 1
    assert resposta.json()["rejeitadas"] == [
        {"indice": 1, "sensor_id": sensor_id, "motivo": "sensor_nao_cadastrado"}
    ]
    assert len(gravadas(sessao)) == 1


def test_recusa_item_sem_campo_obrigatorio(enviar, sensor):
    leitura = item(sensor.id)
    del leitura["umidade"]

    assert enviar([leitura]).status_code == 422


def test_recusa_json_invalido(client, gateway):
    resposta = client.post(
        f"/gateways/{gateway['id']}/leituras",
        content=b"{nao e json",
        headers={"Content-Type": "application/json"},
    )

    assert resposta.status_code == 422


def test_lote_atualiza_o_ultimo_contato_do_gateway(client, enviar, gateway):
    enviar([])

    (listado,) = client.get("/gateways").json()
    assert listado["id"] == gateway["id"]
    assert listado["online"] is True
    assert listado["ultimo_contato"] is not None


@pytest.mark.parametrize(
    "cabecalhos",
    [{}, {"Authorization": "Bearer chave-que-nao-existe"}, {"Authorization": "x"}],
)
def test_recusa_lote_sem_credencial_valida(client, sessao, gateway, sensor, cabecalhos):
    client.headers.pop("Authorization")

    resposta = client.post(
        f"/gateways/{gateway['id']}/leituras",
        json={"lote_id": LOTE_ID, "versao_config": 0, "leituras": [item(sensor.id)]},
        headers=cabecalhos,
    )

    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "credencial inválida"}
    assert gravadas(sessao) == []


def test_recusa_chave_de_outro_gateway(client, sessao, gateway, sensor):
    outro = client.post("/gateways", json={"nome": "Filial Sul"}).json()

    resposta = client.post(
        f"/gateways/{outro['id']}/leituras",
        json={"lote_id": LOTE_ID, "versao_config": 0, "leituras": [item(sensor.id)]},
    )

    assert resposta.status_code == 403
    assert resposta.json() == {"detail": "credencial não pertence a este gateway"}
    assert gravadas(sessao) == []


def test_confere_a_credencial_antes_do_corpo(client, gateway):
    client.headers["Authorization"] = "Bearer chave-que-nao-existe"

    resposta = client.post(f"/gateways/{gateway['id']}/leituras", json={})

    assert resposta.status_code == 401


@pytest.mark.parametrize("desativado", [False, True], ids=["ativo", "desativado"])
def test_recusa_leitura_de_sensor_de_outro_gateway(
    client, sessao, enviar, sala, desativado
):
    # Ativo ou não, o sensor de outro gateway é recusado como não cadastrado.
    outro = client.post("/gateways", json={"nome": "Filial Sul"}).json()
    sensor_do_outro = SensorService(sessao).cadastrar(sala.id, outro["id"])
    if desativado:
        SensorService(sessao).desativar(sensor_do_outro.id)

    resposta = enviar([item(sensor_do_outro.id)])

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["aceitas"] == 0
    assert corpo["rejeitadas"] == [
        {
            "indice": 0,
            "sensor_id": sensor_do_outro.id,
            "motivo": "sensor_nao_cadastrado",
        }
    ]
    assert gravadas(sessao) == []


def test_reenvio_do_lote_nao_grava_de_novo_e_devolve_o_mesmo_resultado(
    enviar, sessao, sensor
):
    leituras = [item(sensor.id), item(9999)]
    primeira = enviar(leituras)

    segunda = enviar(leituras)

    assert segunda.status_code == 201
    assert segunda.json() == primeira.json()
    assert segunda.json()["aceitas"] == 1
    assert len(gravadas(sessao)) == 1


def test_reenvio_devolve_o_resultado_da_primeira_vez_mesmo_com_outro_conteudo(
    enviar, sessao, sensor
):
    enviar([item(sensor.id)])

    corpo = enviar([item(sensor.id), item(sensor.id)]).json()

    assert corpo["aceitas"] == 1
    assert len(gravadas(sessao)) == 1


def test_reenvio_depois_da_desativacao_devolve_o_resultado_da_primeira_vez(
    enviar, sessao, sensor
):
    # A resposta se perdeu, o sensor foi desativado e o gateway reenvia o mesmo lote:
    # vale o resultado da primeira vez, sem conferir o sensor de novo (1.2).
    primeira = enviar([item(sensor.id)])
    SensorService(sessao).desativar(sensor.id)

    segunda = enviar([item(sensor.id)])

    assert segunda.status_code == 201
    corpo = segunda.json()
    assert corpo == primeira.json()
    assert corpo["aceitas"] == 1
    assert corpo["rejeitadas"] == []
    assert len(gravadas(sessao)) == 1


def test_lotes_diferentes_sao_gravados(enviar, sessao, sensor):
    enviar([item(sensor.id)])
    enviar([item(sensor.id)], lote_id=OUTRO_LOTE_ID)

    assert len(gravadas(sessao)) == 2


def test_mesmo_lote_id_em_gateways_diferentes_nao_colide(
    client, sessao, enviar, gateway, sala, sensor
):
    outro = client.post("/gateways", json={"nome": "Filial Sul"}).json()
    sensor_do_outro = SensorService(sessao).cadastrar(sala.id, outro["id"])
    enviar([item(sensor.id)])

    resposta = client.post(
        f"/gateways/{outro['id']}/leituras",
        json={
            "lote_id": LOTE_ID,
            "versao_config": 0,
            "leituras": [item(sensor_do_outro.id)],
        },
        headers={"Authorization": f"Bearer {outro['chave_api']}"},
    )

    assert resposta.json()["aceitas"] == 1
    assert len(gravadas(sessao)) == 2


def test_reenvio_simultaneo_nao_grava_em_dobro(sessao, gateway, sensor):
    # Duas conexões de verdade, como duas requisições ao mesmo tempo: o reenvio
    # chega enquanto a transação do primeiro envio ainda não terminou.
    sessao.commit()
    engine = create_engine(database_url())
    lote_id = UUID(LOTE_ID)
    leituras = [LeituraRecebida(**item(sensor.id))]
    resultado = {}
    with Session(engine) as primeira, Session(engine) as segunda:
        lote = LeituraService(primeira).registrar_lote(gateway["id"], lote_id, leituras)

        reenvio = threading.Thread(
            target=lambda: resultado.update(
                lote=LeituraService(segunda).registrar_lote(
                    gateway["id"], lote_id, leituras
                )
            )
        )
        reenvio.start()
        reenvio.join(timeout=1)
        assert reenvio.is_alive(), "o reenvio deveria esperar o primeiro terminar"

        primeira.commit()
        reenvio.join(timeout=10)
        assert not reenvio.is_alive()
        assert resultado["lote"].id == lote.id
        assert resultado["lote"].aceitas == 1
        segunda.commit()

        total = primeira.scalar(select(func.count()).select_from(Leitura))
    engine.dispose()
    assert total == 1


FAIXA = {
    "temperatura_min": 2,
    "temperatura_max": 8,
    "umidade_min": 30,
    "umidade_max": 60,
}


@pytest.mark.parametrize(
    ("faixa", "temperatura", "umidade", "dentro"),
    [
        (FAIXA, 5.0, 45.0, True),
        (FAIXA, 2.0, 45.0, True),
        (FAIXA, 8.0, 45.0, True),
        (FAIXA, 5.0, 30.0, True),
        (FAIXA, 5.0, 60.0, True),
        (FAIXA, 2.0, 60.0, True),
        (FAIXA, 1.9, 45.0, False),
        (FAIXA, 8.1, 45.0, False),
        (FAIXA, 5.0, 29.9, False),
        (FAIXA, 5.0, 60.1, False),
        ({"temperatura_max": 8}, -40.0, 0.0, True),
        ({"temperatura_max": 8}, 8.1, 45.0, False),
        ({"umidade_min": 30}, 80.0, 100.0, True),
        ({"umidade_min": 30}, 5.0, 29.9, False),
        ({}, 80.0, 100.0, True),
    ],
    ids=[
        "dentro",
        "no-minimo-de-temperatura",
        "no-maximo-de-temperatura",
        "no-minimo-de-umidade",
        "no-maximo-de-umidade",
        "nos-dois-limites",
        "abaixo-da-temperatura",
        "acima-da-temperatura",
        "abaixo-da-umidade",
        "acima-da-umidade",
        "so-maximo-dentro",
        "so-maximo-acima",
        "so-minimo-dentro",
        "so-minimo-abaixo",
        "sala-sem-faixa",
    ],
)
def test_leitura_e_classificada_pela_faixa_ao_ser_gravada(
    enviar, sessao, sala, sensor, faixa, temperatura, umidade, dentro
):
    for campo, valor in faixa.items():
        setattr(sala, campo, valor)
    sessao.flush()

    resposta = enviar([item(sensor.id, temperatura, umidade)])

    assert resposta.status_code == 201
    (leitura,) = gravadas(sessao)
    assert leitura.dentro_da_faixa is dentro


def test_classificacao_nao_muda_se_a_faixa_mudar_depois(enviar, sessao, sala, sensor):
    sala.temperatura_max = 8
    sessao.flush()
    enviar([item(sensor.id, temperatura=7.0)])

    sala.temperatura_max = 6
    sessao.flush()
    sessao.expire_all()

    (leitura,) = gravadas(sessao)
    assert leitura.dentro_da_faixa is True
