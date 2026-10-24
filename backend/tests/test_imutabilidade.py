"""Leituras e alertas não podem ser alterados nem apagados. Precisa de um PostgreSQL
(DATABASE_URL)."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import IntegrityError

from alertas.models import Alerta
from leituras.models import Leitura
from leituras.schemas import LeituraRecebida
from leituras.service import LeituraService
from main import app
from salas.models import Sala
from sensores.service import SensorService


@pytest.fixture
def alerta(sessao, gateway):
    """Alerta pendente aberto por uma leitura fora da faixa (que fica gravada)."""
    sala = Sala(nome="Câmara fria", temperatura_max=8)
    sessao.add(sala)
    sessao.flush()
    sensor = SensorService(sessao).cadastrar(sala.id, gateway.id)
    leitura = LeituraRecebida(
        sensor_id=sensor.id,
        temperatura=9.0,
        umidade=50.0,
        data_hora=datetime(2026, 10, 16, 14, 30, tzinfo=UTC),
    )
    LeituraService(sessao).registrar_lote(gateway.id, uuid4(), [leitura])
    sessao.commit()
    return sessao.scalar(select(Alerta))


@pytest.mark.parametrize(
    "comando",
    [
        update(Leitura).values(temperatura=5.0),
        update(Leitura).values(dentro_da_faixa=True),
        delete(Leitura),
        text("TRUNCATE leituras CASCADE"),
    ],
    ids=["update_valor", "update_classificacao", "delete", "truncate"],
)
def test_banco_recusa_alterar_ou_apagar_leitura(sessao, alerta, comando):
    with pytest.raises(IntegrityError, match="imutável"):
        sessao.execute(comando)


@pytest.mark.parametrize(
    "comando",
    [
        update(Alerta).values(tipo="temperatura_abaixo"),
        update(Alerta).values(data_hora=datetime(2026, 1, 1, tzinfo=UTC)),
        update(Alerta).values(tipo="umidade_acima", situacao="reconhecido"),
        delete(Alerta),
        text("TRUNCATE alertas"),
    ],
    ids=[
        "update_tipo",
        "update_data_hora",
        "update_junto_da_situacao",
        "delete",
        "truncate",
    ],
)
def test_banco_recusa_alterar_ou_apagar_alerta(sessao, alerta, comando):
    with pytest.raises(IntegrityError):
        sessao.execute(comando)


def test_situacao_do_alerta_pode_mudar(sessao, alerta):
    alerta.situacao = "reconhecido"
    sessao.commit()

    sessao.expire_all()
    assert sessao.get(Alerta, alerta.id).situacao == "reconhecido"


def test_api_nao_tem_rota_para_editar_ou_apagar_leituras_e_alertas():
    rotas = [
        (caminho, metodo)
        for caminho, metodos in app.openapi()["paths"].items()
        if "leituras" in caminho or "alertas" in caminho
        for metodo in metodos
    ]
    assert rotas
    assert not [rota for rota in rotas if rota[1] in {"put", "patch", "delete"}]
