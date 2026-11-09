"""Leituras e alertas não podem ser alterados nem apagados. Precisa de um PostgreSQL
(DATABASE_URL)."""

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import delete, select, text, update
from sqlalchemy.exc import IntegrityError

from alertas.models import Alerta
from alertas.service import AlertaService
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
    LeituraService(sessao).registrar_lote(
        gateway.id, uuid4(), [leitura], AlertaService(sessao)
    )
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
        update(Alerta).values(
            data_hora=datetime(2026, 1, 1, tzinfo=UTC), acao_corretiva="Porta fechada"
        ),
        delete(Alerta),
        text("TRUNCATE alertas"),
    ],
    ids=[
        "update_tipo",
        "update_data_hora",
        "update_junto_da_situacao",
        "update_junto_do_encerramento",
        "delete",
        "truncate",
    ],
)
def test_banco_recusa_alterar_ou_apagar_alerta(sessao, alerta, comando):
    with pytest.raises(IntegrityError):
        sessao.execute(comando)


def test_alerta_usa_os_valores_do_contrato(alerta):
    # Contrato de API, 2.7: tipo diz a grandeza e o lado do desvio; situacao é
    # pendente, reconhecido ou encerrado.
    assert alerta.tipo == "temperatura_acima"
    assert alerta.situacao == "pendente"


def test_reconhecimento_e_encerramento_podem_ser_gravados(sessao, alerta):
    reconhecido_em = datetime(2026, 10, 16, 14, 35, tzinfo=UTC)
    encerrado_em = datetime(2026, 10, 16, 15, 0, tzinfo=UTC)
    alerta.situacao = "reconhecido"
    alerta.reconhecido_em = reconhecido_em
    sessao.commit()
    alerta.situacao = "encerrado"
    alerta.acao_corretiva = "Porta da câmara fechada"
    alerta.encerrado_em = encerrado_em
    sessao.commit()

    sessao.expire_all()
    gravado = sessao.get(Alerta, alerta.id)
    assert gravado.situacao == "encerrado"
    assert gravado.reconhecido_em == reconhecido_em
    assert gravado.acao_corretiva == "Porta da câmara fechada"
    assert gravado.encerrado_em == encerrado_em


def test_alerta_encerrado_nao_muda_mais_de_situacao(sessao, alerta):
    alerta.situacao = "reconhecido"
    sessao.commit()
    alerta.situacao = "encerrado"
    sessao.commit()

    alerta.situacao = "pendente"
    with pytest.raises(IntegrityError, match="encerrado"):
        sessao.commit()


# Contrato de API, 2.7 (US25): só pendente → reconhecido → encerrado.
@pytest.mark.parametrize(
    ("caminho", "alteracao"),
    [
        ([], {"situacao": "encerrado"}),
        (["reconhecido"], {"situacao": "pendente"}),
        (["reconhecido", "encerrado"], {"situacao": "reconhecido"}),
        (["reconhecido", "encerrado"], {"acao_corretiva": "Outra ação"}),
    ],
    ids=[
        "pula_de_pendente_para_encerrado",
        "volta_de_reconhecido_para_pendente",
        "volta_de_encerrado_para_reconhecido",
        "muda_a_acao_corretiva_depois_de_encerrado",
    ],
)
def test_banco_recusa_mudanca_fora_do_fluxo_do_alerta(
    sessao, alerta, caminho, alteracao
):
    for situacao in caminho:
        alerta.situacao = situacao
        sessao.commit()

    for coluna, valor in alteracao.items():
        setattr(alerta, coluna, valor)
    with pytest.raises(IntegrityError):
        sessao.commit()


def test_api_nao_tem_rota_para_editar_ou_apagar_leituras_e_alertas():
    rotas = [
        (caminho, metodo)
        for caminho, metodos in app.openapi()["paths"].items()
        if "leituras" in caminho or "alertas" in caminho
        for metodo in metodos
    ]
    assert rotas
    assert not [rota for rota in rotas if rota[1] in {"put", "patch", "delete"}]
