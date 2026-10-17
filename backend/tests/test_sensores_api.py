"""Rotas de sensores. Precisam de um PostgreSQL (DATABASE_URL)."""

import pytest


@pytest.fixture
def sala(client):
    return client.post("/salas", json={"nome": "Câmara fria 1"}).json()


def test_cadastra_sensor_na_sala_e_devolve_id_e_nome_da_sala(client, sala):
    resposta = client.post(f"/salas/{sala['id']}/sensores")

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert isinstance(corpo["id"], int)
    assert corpo["sala_id"] == sala["id"]
    assert corpo["sala_nome"] == "Câmara fria 1"
    assert corpo["ativo"] is True
    assert corpo["data_cadastro"]


def test_cada_sensor_recebe_um_id_diferente(client, sala):
    ids = {client.post(f"/salas/{sala['id']}/sensores").json()["id"] for _ in range(3)}

    assert len(ids) == 3


def test_cadastrar_sensor_em_sala_inexistente_da_404(client):
    resposta = client.post("/salas/9999/sensores")

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "sala não encontrada"}


def test_lista_sensores_da_sala_com_id_e_nome_da_sala(client, sala):
    outra = client.post("/salas", json={"nome": "Estoque"}).json()
    criados = [client.post(f"/salas/{sala['id']}/sensores").json() for _ in range(2)]
    client.post(f"/salas/{outra['id']}/sensores")

    resposta = client.get(f"/salas/{sala['id']}/sensores")

    assert resposta.status_code == 200
    assert [sensor["id"] for sensor in resposta.json()] == [s["id"] for s in criados]
    assert {sensor["sala_nome"] for sensor in resposta.json()} == {"Câmara fria 1"}


def test_lista_inclui_sensores_desativados(client, sala):
    sensor = client.post(f"/salas/{sala['id']}/sensores").json()
    client.post(f"/sensores/{sensor['id']}/desativar")

    (listado,) = client.get(f"/salas/{sala['id']}/sensores").json()

    assert listado["id"] == sensor["id"]
    assert listado["ativo"] is False


def test_listar_sensores_de_sala_inexistente_da_404(client):
    assert client.get("/salas/9999/sensores").status_code == 404


def test_desativa_sensor_mantendo_id_e_nome_da_sala(client, sala):
    sensor = client.post(f"/salas/{sala['id']}/sensores").json()

    resposta = client.post(f"/sensores/{sensor['id']}/desativar")

    assert resposta.status_code == 200
    assert resposta.json() == {**sensor, "ativo": False}


def test_desativar_de_novo_nao_muda_nada(client, sala):
    sensor = client.post(f"/salas/{sala['id']}/sensores").json()
    primeira = client.post(f"/sensores/{sensor['id']}/desativar")

    segunda = client.post(f"/sensores/{sensor['id']}/desativar")

    assert segunda.status_code == 200
    assert segunda.json() == primeira.json()


def test_id_de_sensor_desativado_nao_e_reaproveitado(client, sala):
    desativado = client.post(f"/salas/{sala['id']}/sensores").json()
    client.post(f"/sensores/{desativado['id']}/desativar")

    novo = client.post(f"/salas/{sala['id']}/sensores").json()

    assert novo["id"] != desativado["id"]


def test_desativar_sensor_inexistente_da_404(client):
    resposta = client.post("/sensores/9999/desativar")

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "sensor não encontrado"}


def test_renomear_a_sala_reflete_no_nome_dos_sensores(client, sala):
    sensor = client.post(f"/salas/{sala['id']}/sensores").json()
    client.patch(f"/salas/{sala['id']}", json={"nome": "Câmara fria 9"})

    (listado,) = client.get(f"/salas/{sala['id']}/sensores").json()

    assert listado["id"] == sensor["id"]
    assert listado["sala_nome"] == "Câmara fria 9"
