"""Comandos de climatização da sala (US22, #160). Precisa de um PostgreSQL (DATABASE_URL)."""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import update

from climatizacao.models import ComandoDeClimatizacao
from climatizacao.service import VALIDADE_DO_COMANDO
from main import app
from salas.models import Sala
from sensores.service import SensorService
from usuarios.admin_padrao import NOME_ADMIN_PADRAO


@pytest.fixture
def gateway(client):
    """Gateway cadastrado pelo painel, com a chave de API do nó central."""
    return client.post("/gateways", json={"nome": "Filial Centro"}).json()


@pytest.fixture
def sala(sessao):
    sala = Sala(nome="Escritório")
    sessao.add(sala)
    sessao.commit()
    return sala


@pytest.fixture
def emissor(sessao, sala, gateway):
    """Sensor da sala com o emissor infravermelho do ar-condicionado."""
    sensor = SensorService(sessao).cadastrar(sala.id, gateway["id"])
    sessao.commit()
    return sensor


@pytest.fixture
def sala_climatizada(client, sala, emissor):
    resposta = client.patch(
        f"/salas/{sala.id}", json={"sensor_climatizacao_id": emissor.id}
    )
    assert resposta.status_code == 200
    return sala


@pytest.fixture
def enviar_lote(cliente_anonimo, gateway):
    """Envia um heartbeat do gateway, com os comandos que ele já entregou."""
    cliente = TestClient(
        app, headers={"Authorization": f"Bearer {gateway['chave_api']}"}
    )

    def _enviar(comandos_concluidos=()):
        resposta = cliente.post(
            f"/gateways/{gateway['id']}/leituras",
            json={
                "lote_id": str(uuid.uuid4()),
                "versao_config": 0,
                "comandos_concluidos": list(comandos_concluidos),
                "leituras": [],
            },
        )
        assert resposta.status_code == 201
        return resposta.json()["comandos"]

    return _enviar


def comandar(client, sala, acao="ligar", **campos):
    return client.post(f"/salas/{sala.id}/climatizacao", json={"acao": acao, **campos})


def expirar(sessao, comando_id):
    sessao.execute(
        update(ComandoDeClimatizacao)
        .where(ComandoDeClimatizacao.id == comando_id)
        .values(expira_em=datetime.now(UTC) - timedelta(seconds=1))
    )
    sessao.commit()


# Sensor de climatização da sala


def test_sala_nasce_sem_sensor_de_climatizacao(client, sala):
    assert client.get(f"/salas/{sala.id}").json()["sensor_climatizacao_id"] is None


def test_admin_define_e_remove_o_sensor_de_climatizacao(client, sala, emissor):
    definida = client.patch(
        f"/salas/{sala.id}", json={"sensor_climatizacao_id": emissor.id}
    )

    assert definida.status_code == 200
    assert definida.json()["sensor_climatizacao_id"] == emissor.id
    assert client.get(f"/salas/{sala.id}").json()["sensor_climatizacao_id"] == (
        emissor.id
    )

    removida = client.patch(f"/salas/{sala.id}", json={"sensor_climatizacao_id": None})

    assert removida.json()["sensor_climatizacao_id"] is None


def test_editar_outros_campos_mantem_o_sensor_de_climatizacao(
    client, sala_climatizada, emissor
):
    resposta = client.patch(f"/salas/{sala_climatizada.id}", json={"nome": "Sala 2"})

    assert resposta.json()["sensor_climatizacao_id"] == emissor.id


def test_aceita_sensor_inativo_ja_escolhido(client, sala_climatizada, emissor):
    # O Desfazer do painel devolve o sensor anterior, mesmo que ele esteja inativo.
    client.post(f"/sensores/{emissor.id}/desativar")

    resposta = client.patch(
        f"/salas/{sala_climatizada.id}", json={"sensor_climatizacao_id": emissor.id}
    )

    assert resposta.status_code == 200


def test_recusa_sensor_de_outra_sala_ou_inexistente(client, sessao, sala, gateway):
    outra = Sala(nome="Depósito")
    sessao.add(outra)
    sessao.flush()
    de_outra_sala = SensorService(sessao).cadastrar(outra.id, gateway["id"])
    sessao.commit()

    for sensor_id in (de_outra_sala.id, 999_999):
        resposta = client.patch(
            f"/salas/{sala.id}", json={"sensor_climatizacao_id": sensor_id}
        )

        assert resposta.status_code == 422
        assert resposta.json() == {"detail": "sensor de climatização não é desta sala"}
    assert client.get(f"/salas/{sala.id}").json()["sensor_climatizacao_id"] is None


def test_visualizador_nao_define_o_sensor_de_climatizacao(visualizador, sala, emissor):
    resposta = visualizador.patch(
        f"/salas/{sala.id}", json={"sensor_climatizacao_id": emissor.id}
    )

    assert resposta.status_code == 403


# POST /salas/{id}/climatizacao


def test_comando_criado_fica_pendente(client, sessao, sala_climatizada, emissor):
    antes = datetime.now(UTC)
    resposta = comandar(client, sala_climatizada, "ligar")

    assert resposta.status_code == 202
    corpo = resposta.json()
    assert corpo == {
        "id": corpo["id"],
        "sala_id": sala_climatizada.id,
        "sensor_id": emissor.id,
        "acao": "ligar",
        "temperatura_c": None,
        "usuario": {"id": corpo["usuario"]["id"], "nome": NOME_ADMIN_PADRAO},
        "criado_em": corpo["criado_em"],
        "expira_em": corpo["expira_em"],
        "situacao": "pendente",
    }
    criado_em = datetime.fromisoformat(corpo["criado_em"])
    assert criado_em >= antes - timedelta(seconds=1)
    assert datetime.fromisoformat(corpo["expira_em"]) == criado_em + VALIDADE_DO_COMANDO


@pytest.mark.parametrize("temperatura", [16, 22, 30])
def test_ajustar_leva_a_temperatura(client, sala_climatizada, temperatura):
    resposta = comandar(client, sala_climatizada, "ajustar", temperatura_c=temperatura)

    assert resposta.status_code == 202
    assert resposta.json()["acao"] == "ajustar"
    assert resposta.json()["temperatura_c"] == temperatura


@pytest.mark.parametrize(
    "corpo",
    [
        {"acao": "ajustar"},
        {"acao": "ajustar", "temperatura_c": None},
        {"acao": "ajustar", "temperatura_c": 15},
        {"acao": "ajustar", "temperatura_c": 31},
        {"acao": "ajustar", "temperatura_c": 22.5},
        {"acao": "ligar", "temperatura_c": 22},
        {"acao": "desligar", "temperatura_c": 22},
        {"acao": "apitar"},
        {},
    ],
)
def test_recusa_comando_invalido(client, sala_climatizada, corpo):
    resposta = client.post(f"/salas/{sala_climatizada.id}/climatizacao", json=corpo)

    assert resposta.status_code == 422
    assert client.get(f"/salas/{sala_climatizada.id}/climatizacao").json() == []


def test_sala_sem_sensor_de_climatizacao_recusa_o_comando(client, sala):
    resposta = comandar(client, sala)

    assert resposta.status_code == 422
    assert resposta.json() == {"detail": "sala sem sensor de climatização"}


def test_sensor_de_climatizacao_inativo_recusa_o_comando(
    client, sala_climatizada, emissor
):
    client.post(f"/sensores/{emissor.id}/desativar")

    resposta = comandar(client, sala_climatizada)

    assert resposta.status_code == 409
    assert resposta.json() == {"detail": "sensor inativo"}


def test_comando_para_sala_inexistente(client):
    resposta = client.post("/salas/999999/climatizacao", json={"acao": "ligar"})

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "sala não encontrada"}


def test_visualizador_nao_envia_comando(visualizador, sala_climatizada):
    resposta = comandar(visualizador, sala_climatizada)

    assert resposta.status_code == 403
    assert resposta.json() == {"detail": "permissão insuficiente"}


# GET /salas/{id}/climatizacao


def test_historico_lista_do_mais_recente_ao_mais_antigo(client, sala_climatizada):
    ligar = comandar(client, sala_climatizada, "ligar").json()
    ajustar = comandar(client, sala_climatizada, "ajustar", temperatura_c=20).json()

    resposta = client.get(f"/salas/{sala_climatizada.id}/climatizacao")

    assert resposta.status_code == 200
    assert resposta.json() == [ajustar, ligar]


def test_historico_e_so_da_sala(client, sessao, sala_climatizada, gateway):
    outra = Sala(nome="Depósito")
    sessao.add(outra)
    sessao.flush()
    sensor = SensorService(sessao).cadastrar(outra.id, gateway["id"])
    sessao.commit()
    client.patch(f"/salas/{outra.id}", json={"sensor_climatizacao_id": sensor.id})
    comandar(client, outra)

    assert client.get(f"/salas/{sala_climatizada.id}/climatizacao").json() == []


def test_visualizador_ve_o_historico(client, visualizador, sala_climatizada):
    comandar(client, sala_climatizada)

    resposta = visualizador.get(f"/salas/{sala_climatizada.id}/climatizacao")

    assert resposta.status_code == 200
    assert len(resposta.json()) == 1


def test_historico_de_sala_inexistente(client):
    resposta = client.get("/salas/999999/climatizacao")

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "sala não encontrada"}


# Entrega pelo lote do gateway (contrato, 1.3)


def test_comando_vai_no_proximo_lote_ate_ser_concluido(
    client, sala_climatizada, emissor, enviar_lote
):
    comando = comandar(client, sala_climatizada, "ajustar", temperatura_c=21).json()
    esperado = {
        "id": comando["id"],
        "sensor_id": emissor.id,
        "tipo": "climatizacao",
        "acao": "ajustar",
        "temperatura_c": 21,
        "expira_em": comando["expira_em"],
    }

    assert enviar_lote() == [esperado]
    # Pendente até o gateway confirmar: vai de novo no lote seguinte.
    assert enviar_lote() == [esperado]
    assert enviar_lote([comando["id"]]) == []
    assert enviar_lote() == []

    (historico,) = client.get(f"/salas/{sala_climatizada.id}/climatizacao").json()
    assert historico["situacao"] == "entregue"


def test_lote_sem_comandos_pendentes_responde_lista_vazia(enviar_lote):
    assert enviar_lote() == []


def test_comando_expirado_nao_e_enviado(client, sessao, sala_climatizada, enviar_lote):
    comando = comandar(client, sala_climatizada).json()
    expirar(sessao, comando["id"])

    assert enviar_lote() == []
    (historico,) = client.get(f"/salas/{sala_climatizada.id}/climatizacao").json()
    assert historico["situacao"] == "expirado"


def test_historico_mostra_expirado_mesmo_sem_lote(client, sessao, sala_climatizada):
    comando = comandar(client, sala_climatizada).json()
    expirar(sessao, comando["id"])

    (historico,) = client.get(f"/salas/{sala_climatizada.id}/climatizacao").json()

    assert historico["situacao"] == "expirado"


def test_expirado_nao_vira_entregue(client, sessao, sala_climatizada, enviar_lote):
    comando = comandar(client, sala_climatizada).json()
    expirar(sessao, comando["id"])

    enviar_lote([comando["id"]])

    (historico,) = client.get(f"/salas/{sala_climatizada.id}/climatizacao").json()
    assert historico["situacao"] == "expirado"


def test_comando_de_outro_gateway_nao_vai_no_lote(
    client, sessao, sala, sala_climatizada, enviar_lote
):
    outro_gateway = client.post("/gateways", json={"nome": "Filial Sul"}).json()
    outra = Sala(nome="Depósito")
    sessao.add(outra)
    sessao.flush()
    sensor = SensorService(sessao).cadastrar(outra.id, outro_gateway["id"])
    sessao.commit()
    client.patch(f"/salas/{outra.id}", json={"sensor_climatizacao_id": sensor.id})
    comando = comandar(client, outra).json()

    # Nem é entregue, nem o gateway errado consegue concluí-lo.
    assert enviar_lote([comando["id"]]) == []
    (historico,) = client.get(f"/salas/{outra.id}/climatizacao").json()
    assert historico["situacao"] == "pendente"


def test_id_concluido_desconhecido_nao_derruba_o_lote(enviar_lote):
    assert enviar_lote([999_999, 2**31, -(2**31) - 1]) == []
