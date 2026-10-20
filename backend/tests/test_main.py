from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_libera_o_painel_web_no_cors():
    painel = "http://localhost:8081"  # origem do painel (Expo), não a porta da API
    response = client.get("/health", headers={"Origin": painel})
    assert response.headers["access-control-allow-origin"] == painel
