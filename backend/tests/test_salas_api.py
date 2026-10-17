"""Rotas de salas. Precisam de um PostgreSQL (DATABASE_URL)."""

import pytest


@pytest.fixture
def sala(client):
    return client.post(
        "/salas", json={"nome": "Câmara fria 1", "descricao": "Carnes"}
    ).json()


def test_cadastra_sala(client):
    resposta = client.post(
        "/salas", json={"nome": "Câmara fria 1", "descricao": "Carnes"}
    )

    assert resposta.status_code == 201
    assert resposta.json() == {
        "id": resposta.json()["id"],
        "nome": "Câmara fria 1",
        "descricao": "Carnes",
        "sensores": [],
    }


def test_descricao_e_opcional(client):
    resposta = client.post("/salas", json={"nome": "Estoque seco"})

    assert resposta.status_code == 201
    assert resposta.json()["descricao"] is None


@pytest.mark.parametrize(
    "corpo", [{}, {"nome": ""}, {"nome": "   "}, {"nome": "a" * 101}]
)
def test_recusa_sala_sem_nome_valido(client, corpo):
    assert client.post("/salas", json=corpo).status_code == 422


def test_lista_salas_em_ordem_de_cadastro(client):
    for nome in ("A", "B", "C"):
        client.post("/salas", json={"nome": nome})

    resposta = client.get("/salas")

    assert resposta.status_code == 200
    assert [sala["nome"] for sala in resposta.json()] == ["A", "B", "C"]
    assert set(resposta.json()[0]) == {"id", "nome", "descricao"}


def test_lista_vazia_sem_salas(client):
    assert client.get("/salas").json() == []


def test_detalha_sala_com_os_sensores(client, sala):
    for _ in range(2):
        client.post(f"/salas/{sala['id']}/sensores")

    resposta = client.get(f"/salas/{sala['id']}")

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["nome"] == "Câmara fria 1"
    assert [sensor["id"] for sensor in corpo["sensores"]] == sorted(
        sensor["id"] for sensor in corpo["sensores"]
    )
    assert len(corpo["sensores"]) == 2
    assert set(corpo["sensores"][0]) == {"id", "ativo", "data_cadastro"}


def test_detalhe_de_sala_inexistente_da_404(client):
    resposta = client.get("/salas/9999")

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "sala não encontrada"}


def test_edita_so_os_campos_enviados(client, sala):
    resposta = client.patch(f"/salas/{sala['id']}", json={"nome": "Câmara fria 2"})

    assert resposta.status_code == 200
    assert resposta.json()["nome"] == "Câmara fria 2"
    assert resposta.json()["descricao"] == "Carnes"
    assert client.get(f"/salas/{sala['id']}").json()["nome"] == "Câmara fria 2"


def test_edita_descricao_e_permite_limpar(client, sala):
    resposta = client.patch(f"/salas/{sala['id']}", json={"descricao": None})

    assert resposta.status_code == 200
    assert resposta.json()["descricao"] is None
    assert resposta.json()["nome"] == "Câmara fria 1"


@pytest.mark.parametrize("corpo", [{"nome": None}, {"nome": ""}])
def test_recusa_nome_invalido_na_edicao(client, sala, corpo):
    assert client.patch(f"/salas/{sala['id']}", json=corpo).status_code == 422


def test_editar_sala_inexistente_da_404(client):
    resposta = client.patch("/salas/9999", json={"nome": "X"})

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "sala não encontrada"}
