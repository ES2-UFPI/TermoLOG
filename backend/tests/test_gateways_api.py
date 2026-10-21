"""Rotas de gateways. Precisam de um PostgreSQL (DATABASE_URL)."""

from datetime import UTC, datetime, timedelta

from gateways.models import Gateway
from gateways.service import hash_da_chave


def test_cadastra_gateway_e_devolve_a_chave_de_api(client):
    resposta = client.post("/gateways", json={"nome": "Filial Centro"})

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert set(corpo) == {"id", "nome", "chave_api"}
    assert isinstance(corpo["id"], int)
    assert corpo["nome"] == "Filial Centro"
    assert len(corpo["chave_api"]) >= 32


def test_guarda_so_o_hash_da_chave(client, sessao):
    corpo = client.post("/gateways", json={"nome": "Filial Centro"}).json()

    gateway = sessao.get(Gateway, corpo["id"])
    assert gateway.chave_api_hash == hash_da_chave(corpo["chave_api"])
    assert gateway.chave_api_hash != corpo["chave_api"]


def test_cada_gateway_recebe_uma_chave_diferente(client):
    chaves = {
        client.post("/gateways", json={"nome": f"Filial {n}"}).json()["chave_api"]
        for n in range(3)
    }

    assert len(chaves) == 3


def test_recusa_gateway_sem_nome(client):
    assert client.post("/gateways", json={}).status_code == 422
    assert client.post("/gateways", json={"nome": "   "}).status_code == 422


def test_lista_gateways_sem_expor_a_chave(client):
    criados = [
        client.post("/gateways", json={"nome": nome}).json()
        for nome in ("Filial Centro", "Filial Sul")
    ]

    resposta = client.get("/gateways")

    assert resposta.status_code == 200
    assert resposta.json() == [
        {"id": g["id"], "nome": g["nome"], "online": False, "ultimo_contato": None}
        for g in criados
    ]


def test_online_so_com_contato_nos_ultimos_3_minutos(client, sessao):
    agora = datetime.now(UTC)
    ids = []
    for minutos in (2, 4):
        gateway = sessao.get(
            Gateway, client.post("/gateways", json={"nome": "Filial"}).json()["id"]
        )
        gateway.ultimo_contato = agora - timedelta(minutes=minutos)
        ids.append(gateway.id)
    sessao.flush()

    online = {g["id"]: g["online"] for g in client.get("/gateways").json()}

    assert online == {ids[0]: True, ids[1]: False}
