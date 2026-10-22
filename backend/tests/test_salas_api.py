"""Rotas de salas. Precisam de um PostgreSQL (DATABASE_URL)."""

import pytest

SEM_FAIXA = {
    "temperatura_min": None,
    "temperatura_max": None,
    "umidade_min": None,
    "umidade_max": None,
}


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
        "faixa": SEM_FAIXA,
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
    assert set(resposta.json()[0]) == {"id", "nome", "descricao", "faixa"}


def test_lista_vazia_sem_salas(client):
    assert client.get("/salas").json() == []


def test_detalha_sala_com_os_sensores(client, sala, gateway):
    for _ in range(2):
        client.post(f"/salas/{sala['id']}/sensores", json={"gateway_id": gateway.id})

    resposta = client.get(f"/salas/{sala['id']}")

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["nome"] == "Câmara fria 1"
    assert [sensor["id"] for sensor in corpo["sensores"]] == sorted(
        sensor["id"] for sensor in corpo["sensores"]
    )
    assert len(corpo["sensores"]) == 2
    assert set(corpo["sensores"][0]) == {"id", "gateway_id", "ativo", "data_cadastro"}


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


FAIXAS = [
    {"temperatura_min": 2, "temperatura_max": 8, "umidade_min": 30, "umidade_max": 60},
    {"temperatura_max": 8},
    {"temperatura_min": 18, "umidade_max": 60},
]
FAIXAS_IDS = ["faixa", "so-maximo", "so-minimo"]
FAIXAS_INVALIDAS = [
    {"temperatura_min": 8, "temperatura_max": 2},
    {"umidade_min": 50, "umidade_max": 50},
    {"temperatura_max": "abc"},
]


@pytest.mark.parametrize("faixa", FAIXAS, ids=FAIXAS_IDS)
def test_cadastra_sala_com_faixa(client, faixa):
    resposta = client.post("/salas", json={"nome": "Câmara", "faixa": faixa})

    assert resposta.status_code == 201
    assert resposta.json()["faixa"] == SEM_FAIXA | faixa


@pytest.mark.parametrize("faixa", FAIXAS_INVALIDAS)
def test_recusa_cadastro_com_faixa_invalida(client, faixa):
    resposta = client.post("/salas", json={"nome": "Câmara", "faixa": faixa})

    assert resposta.status_code == 422
    assert client.get("/salas").json() == []


@pytest.mark.parametrize("faixa", FAIXAS, ids=FAIXAS_IDS)
def test_edita_e_consulta_a_faixa(client, sala, faixa):
    resposta = client.patch(f"/salas/{sala['id']}", json={"faixa": faixa})

    assert resposta.status_code == 200
    assert resposta.json()["faixa"] == SEM_FAIXA | faixa
    assert client.get(f"/salas/{sala['id']}").json()["faixa"] == SEM_FAIXA | faixa
    assert client.get("/salas").json()[0]["faixa"] == SEM_FAIXA | faixa


def test_faixa_enviada_substitui_a_anterior(client, sala):
    client.patch(
        f"/salas/{sala['id']}",
        json={"faixa": {"temperatura_min": 2, "temperatura_max": 8}},
    )

    resposta = client.patch(f"/salas/{sala['id']}", json={"faixa": {"umidade_max": 60}})

    assert resposta.json()["faixa"] == SEM_FAIXA | {"umidade_max": 60}


def test_edicao_sem_faixa_mantem_a_faixa(client, sala):
    client.patch(f"/salas/{sala['id']}", json={"faixa": {"temperatura_max": 8}})

    resposta = client.patch(f"/salas/{sala['id']}", json={"nome": "Outra"})

    assert resposta.json()["faixa"] == SEM_FAIXA | {"temperatura_max": 8}


def test_faixa_nula_remove_a_faixa(client, sala):
    client.patch(f"/salas/{sala['id']}", json={"faixa": {"temperatura_max": 8}})

    resposta = client.patch(f"/salas/{sala['id']}", json={"faixa": None})

    assert resposta.status_code == 200
    assert resposta.json()["faixa"] == SEM_FAIXA


@pytest.mark.parametrize("faixa", FAIXAS_INVALIDAS)
def test_recusa_edicao_com_faixa_invalida(client, sala, faixa):
    resposta = client.patch(f"/salas/{sala['id']}", json={"faixa": faixa})

    assert resposta.status_code == 422
    assert client.get(f"/salas/{sala['id']}").json()["faixa"] == SEM_FAIXA
