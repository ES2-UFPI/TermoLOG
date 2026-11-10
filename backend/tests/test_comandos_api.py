"""POST /sensores/{id}/comandos e a entrega dos comandos ao gateway (contrato, 1.3
e 2.5). Precisam de um PostgreSQL (DATABASE_URL).
"""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from comandos.models import Comando
from comandos.service import (
    MAXIMO_DE_CONCLUIDOS,
    VALIDADE_DO_COMANDO,
    ComandoService,
)
from main import app

LOTE = {"versao_config": 0, "comandos_concluidos": [], "leituras": []}
APITAR = {"tipo": "apitar", "duracao_s": 10}


@pytest.fixture
def sala(client):
    return client.post("/salas", json={"nome": "Câmara fria"}).json()


@pytest.fixture
def sensor(client, sala, gateway):
    return client.post(
        f"/salas/{sala['id']}/sensores", json={"gateway_id": gateway["id"]}
    ).json()


@pytest.fixture
def gateway(client):
    return client.post("/gateways", json={"nome": "Filial Centro"}).json()


def cliente_do_gateway(gateway):
    return TestClient(app, headers={"Authorization": f"Bearer {gateway['chave_api']}"})


def enviar_lote(gateway, concluidos=(), lote_id=None):
    return cliente_do_gateway(gateway).post(
        f"/gateways/{gateway['id']}/leituras",
        json={
            **LOTE,
            "lote_id": lote_id or str(uuid4()),
            "comandos_concluidos": list(concluidos),
        },
    )


def comandar(client, sensor, corpo=APITAR):
    return client.post(f"/sensores/{sensor['id']}/comandos", json=corpo)


# Criação


def test_cria_comando_pendente_e_responde_202(client, sensor):
    antes = datetime.now(UTC)
    resposta = comandar(client, sensor)

    assert resposta.status_code == 202
    corpo = resposta.json()
    assert set(corpo) == {"id", "sensor_id", "tipo", "duracao_s", "status", "expira_em"}
    assert corpo["sensor_id"] == sensor["id"]
    assert corpo["tipo"] == "apitar"
    assert corpo["duracao_s"] == 10
    assert corpo["status"] == "pendente"
    # Contrato: respostas em UTC.
    assert corpo["expira_em"].endswith("Z")
    expira_em = datetime.fromisoformat(corpo["expira_em"])
    assert antes + VALIDADE_DO_COMANDO <= expira_em
    assert expira_em <= datetime.now(UTC) + VALIDADE_DO_COMANDO


def test_guarda_quem_mandou_o_comando(client, sensor, usuario, sessao):
    comando_id = comandar(client, sensor).json()["id"]

    assert sessao.get(Comando, comando_id).usuario_id == usuario.id


def test_sensor_inexistente_da_404(client):
    resposta = client.post("/sensores/999/comandos", json=APITAR)

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "sensor não encontrado"}


def test_sensor_inativo_da_409(client, sensor):
    client.post(f"/sensores/{sensor['id']}/desativar")

    resposta = comandar(client, sensor)

    assert resposta.status_code == 409
    assert resposta.json() == {"detail": "sensor inativo"}


@pytest.mark.parametrize(
    "corpo",
    [
        {},
        {"tipo": "apitar"},
        {"duracao_s": 10},
        {"tipo": "explodir", "duracao_s": 10},
        {"tipo": "apitar", "duracao_s": 0},
        {"tipo": "apitar", "duracao_s": 61},
        {"tipo": "apitar", "duracao_s": -5},
        {"tipo": "apitar", "duracao_s": "dez"},
        {"tipo": "apitar", "duracao_s": 1.5},
    ],
)
def test_corpo_invalido_da_422(client, sensor, sessao, corpo):
    assert comandar(client, sensor, corpo).status_code == 422
    assert sessao.scalars(select(Comando)).all() == []


@pytest.mark.parametrize("duracao", [1, 60])
def test_aceita_os_limites_da_duracao(client, sensor, duracao):
    resposta = comandar(client, sensor, {"tipo": "apitar", "duracao_s": duracao})

    assert resposta.status_code == 202


def test_banco_recusa_duracao_e_tipo_invalidos(sessao, client, sensor):
    for campos in ({"duracao_s": 0}, {"duracao_s": 61}, {"tipo": "outro"}):
        sessao.add(
            Comando(
                **{
                    "sensor_id": sensor["id"],
                    "tipo": "apitar",
                    "duracao_s": 10,
                    "expira_em": datetime.now(UTC),
                    **campos,
                }
            )
        )
        with pytest.raises(IntegrityError):
            sessao.flush()
        sessao.rollback()


# Entrega ao gateway


def test_comando_vai_na_resposta_do_proximo_lote(client, gateway, sensor):
    criado = comandar(client, sensor).json()

    resposta = enviar_lote(gateway)

    assert resposta.status_code == 201
    assert resposta.json()["comandos"] == [
        {
            "id": criado["id"],
            "sensor_id": sensor["id"],
            "tipo": "apitar",
            "duracao_s": 10,
            "expira_em": criado["expira_em"],
        }
    ]


def test_comando_segue_sendo_mandado_ate_o_gateway_concluir(client, gateway, sensor):
    comando = comandar(client, sensor).json()

    for _ in range(3):
        assert [c["id"] for c in enviar_lote(gateway).json()["comandos"]] == [
            comando["id"]
        ]

    resposta = enviar_lote(gateway, concluidos=[comando["id"]])

    assert resposta.json()["comandos"] == []
    assert enviar_lote(gateway).json()["comandos"] == []


def test_lote_reenviado_tambem_recebe_os_comandos(client, gateway, sensor):
    comando = comandar(client, sensor).json()
    lote_id = "3f0c6d1e-8a2b-4c55-9b7e-2d1f0a9c4e11"
    enviar_lote(gateway, lote_id=lote_id)

    resposta = enviar_lote(gateway, lote_id=lote_id)

    assert [c["id"] for c in resposta.json()["comandos"]] == [comando["id"]]


def test_so_vai_ao_gateway_do_sensor(client, gateway, sensor):
    outro = client.post("/gateways", json={"nome": "Filial Norte"}).json()
    comandar(client, sensor)

    assert enviar_lote(outro).json()["comandos"] == []
    assert len(enviar_lote(gateway).json()["comandos"]) == 1


def test_gateway_nao_conclui_comando_de_outro_gateway(client, gateway, sensor, sessao):
    outro = client.post("/gateways", json={"nome": "Filial Norte"}).json()
    comando = comandar(client, sensor).json()

    enviar_lote(outro, concluidos=[comando["id"]])

    assert sessao.get(Comando, comando["id"]).situacao == "pendente"
    assert len(enviar_lote(gateway).json()["comandos"]) == 1


def test_ids_desconhecidos_ou_gigantes_em_concluidos_sao_ignorados(
    client, gateway, sensor
):
    comando = comandar(client, sensor).json()

    resposta = enviar_lote(gateway, concluidos=[0, -1, 999, 2**31, 2**63, -(2**40)])

    assert resposta.status_code == 201
    assert [c["id"] for c in resposta.json()["comandos"]] == [comando["id"]]


def test_comando_expirado_nao_e_mais_enviado(client, gateway, sensor, sessao):
    comando = comandar(client, sensor).json()
    sessao.execute(text("UPDATE comandos SET expira_em = now() - interval '1 second'"))
    sessao.commit()

    assert enviar_lote(gateway).json()["comandos"] == []
    assert sessao.get(Comando, comando["id"]).situacao == "expirado"


def test_comando_de_sensor_desativado_depois_nao_e_enviado(client, gateway, sensor):
    comandar(client, sensor)
    client.post(f"/sensores/{sensor['id']}/desativar")

    assert enviar_lote(gateway).json()["comandos"] == []


def test_comando_entregue_nao_volta_a_pendente(client, gateway, sensor, sessao):
    comando = comandar(client, sensor).json()
    enviar_lote(gateway, concluidos=[comando["id"]])

    # Informar o mesmo id de novo não muda nada.
    enviar_lote(gateway, concluidos=[comando["id"]])

    assert sessao.get(Comando, comando["id"]).situacao == "entregue"


def test_comandos_vao_em_ordem_de_criacao(client, gateway, sensor):
    ids = [comandar(client, sensor).json()["id"] for _ in range(3)]

    assert [c["id"] for c in enviar_lote(gateway).json()["comandos"]] == ids


def test_servico_pendentes_expira_so_os_vencidos(client, gateway, sensor, sessao):
    comandar(client, sensor)
    servico = ComandoService(sessao)

    no_prazo = servico.pendentes_do_gateway(gateway["id"])
    depois = servico.pendentes_do_gateway(
        gateway["id"], datetime.now(UTC) + timedelta(hours=2)
    )

    assert len(no_prazo) == 1
    assert depois == []


def test_lote_com_ids_demais_em_concluidos_nao_quebra_e_conclui_os_primeiros(
    client, gateway, sensor, sessao
):
    comando = comandar(client, sensor).json()
    # O comando está entre os primeiros ids; o resto é lixo acima do teto.
    ids = [comando["id"], *range(10_000, 10_000 + MAXIMO_DE_CONCLUIDOS + 500)]

    resposta = enviar_lote(gateway, concluidos=ids)

    assert resposta.status_code == 201
    assert resposta.json()["comandos"] == []
    assert sessao.get(Comando, comando["id"]).situacao == "entregue"
