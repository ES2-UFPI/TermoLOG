"""POST /alertas/{id}/reconhecer (contrato, 2.7, US12). Precisa de um PostgreSQL
(DATABASE_URL)."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from alertas.models import Alerta
from leituras.models import Leitura
from salas.models import Sala
from sensores.service import SensorService
from usuarios.models import Usuario

ABERTO_EM = datetime(2026, 10, 16, 17, 30, tzinfo=UTC)


@pytest.fixture
def criar_alerta(sessao, gateway):
    """Cria um alerta na situação pedida, aberto pela leitura medida 5 s antes."""
    sala = Sala(nome="Câmara fria 1", temperatura_max=8)
    sessao.add(sala)
    sessao.flush()
    sensor = SensorService(sessao).cadastrar(sala.id, gateway.id)

    def criar(situacao="pendente", **atendimento):
        leitura = Leitura(
            sensor_id=sensor.id,
            sala_id=sala.id,
            temperatura=9.1,
            umidade=61.0,
            data_hora=ABERTO_EM - timedelta(seconds=5),
        )
        sessao.add(leitura)
        sessao.flush()
        alerta = Alerta(
            sala_id=sala.id,
            sensor_id=sensor.id,
            leitura_id=leitura.id,
            tipo="temperatura_acima",
            data_hora=ABERTO_EM,
            situacao=situacao,
            **atendimento,
        )
        sessao.add(alerta)
        sessao.commit()
        return alerta

    return criar


@pytest.fixture
def pendente(criar_alerta):
    return criar_alerta()


def reconhecer(cliente, alerta_id, **kwargs):
    return cliente.post(f"/alertas/{alerta_id}/reconhecer", **kwargs)


def test_reconhece_alerta_pendente_com_usuario_e_hora_da_sessao(
    client, sessao, usuario, pendente
):
    antes = datetime.now(UTC)
    resposta = reconhecer(client, pendente.id)
    depois = datetime.now(UTC)

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["id"] == pendente.id
    assert corpo["situacao"] == "reconhecido"
    assert corpo["reconhecido_por"] == {"id": usuario.id, "nome": usuario.nome}
    reconhecido_em = datetime.fromisoformat(corpo["reconhecido_em"])
    assert reconhecido_em.tzinfo is not None
    assert antes <= reconhecido_em <= depois
    assert corpo["acao_corretiva"] is None
    assert corpo["encerrado_em"] is None

    sessao.expire_all()
    gravado = sessao.get(Alerta, pendente.id)
    assert gravado.situacao == "reconhecido"
    assert gravado.reconhecido_por_id == usuario.id
    assert gravado.reconhecido_em == reconhecido_em


def test_resposta_tem_o_formato_do_get_de_alertas(client, pendente):
    corpo = reconhecer(client, pendente.id).json()

    [listado] = client.get("/alertas").json()
    assert corpo == listado
    assert corpo["sala_nome"] == "Câmara fria 1"
    assert corpo["leitura"] == {
        "temperatura": 9.1,
        "umidade": 61.0,
        "data_hora": "2026-10-16T17:29:55Z",
    }


def test_visualizador_tambem_reconhece(visualizador, sessao, pendente):
    resposta = reconhecer(visualizador, pendente.id)

    assert resposta.status_code == 200
    assert resposta.json()["reconhecido_por"]["nome"] == "Vera"


@pytest.mark.parametrize(
    "situacao, atendimento",
    [
        ("reconhecido", {"reconhecido_em": ABERTO_EM + timedelta(minutes=1)}),
        (
            "encerrado",
            {
                "reconhecido_em": ABERTO_EM + timedelta(minutes=1),
                "acao_corretiva": "Porta fechada",
                "encerrado_em": ABERTO_EM + timedelta(minutes=2),
            },
        ),
    ],
)
def test_alerta_que_nao_esta_pendente_da_409_e_nao_muda(
    client, sessao, criar_alerta, situacao, atendimento
):
    alerta = criar_alerta(situacao, **atendimento)

    resposta = reconhecer(client, alerta.id)

    assert resposta.status_code == 409
    assert resposta.json() == {"detail": "alerta não está pendente"}
    sessao.expire_all()
    gravado = sessao.get(Alerta, alerta.id)
    assert gravado.situacao == situacao
    assert gravado.reconhecido_por_id is None
    assert gravado.reconhecido_em == atendimento["reconhecido_em"]


def test_reconhecer_duas_vezes_da_409_e_mantem_o_primeiro(
    client, visualizador, usuario, pendente
):
    primeiro = reconhecer(client, pendente.id).json()

    resposta = reconhecer(visualizador, pendente.id)

    assert resposta.status_code == 409
    [listado] = client.get("/alertas").json()
    assert listado["reconhecido_por"] == {"id": usuario.id, "nome": usuario.nome}
    assert listado["reconhecido_em"] == primeiro["reconhecido_em"]


def test_corpo_da_requisicao_nao_altera_quem_nem_quando(
    client, sessao, usuario, pendente
):
    outra = Usuario(nome="Outra", email="outra@exemplo.com", senha_hash="sem-senha")
    sessao.add(outra)
    sessao.commit()
    antes = datetime.now(UTC)

    resposta = reconhecer(
        client,
        pendente.id,
        json={
            "reconhecido_por": outra.id,
            "reconhecido_por_id": outra.id,
            "reconhecido_em": "2020-01-01T00:00:00Z",
            "situacao": "encerrado",
            "acao_corretiva": "nenhuma",
        },
    )

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["situacao"] == "reconhecido"
    assert corpo["reconhecido_por"] == {"id": usuario.id, "nome": usuario.nome}
    assert datetime.fromisoformat(corpo["reconhecido_em"]) >= antes
    assert corpo["acao_corretiva"] is None


def test_alerta_inexistente_da_404(client):
    resposta = reconhecer(client, 999)

    assert resposta.status_code == 404
    assert resposta.json() == {"detail": "alerta não encontrado"}


# Fora de 1..2**31-1 não é id de alerta; acima disso, o banco recusaria com 500.
@pytest.mark.parametrize("alerta_id", [0, -1, 2**31])
def test_id_fora_da_faixa_da_422(client, alerta_id):
    assert reconhecer(client, alerta_id).status_code == 422


def test_sem_login_da_401_e_nao_reconhece(cliente_anonimo, sessao, pendente):
    resposta = reconhecer(cliente_anonimo, pendente.id)

    assert resposta.status_code == 401
    assert resposta.json() == {"detail": "não autenticado"}
    sessao.expire_all()
    assert sessao.get(Alerta, pendente.id).situacao == "pendente"


# O trigger de imutabilidade (#88, #92): quem reconheceu e quando só são gravados
# na passagem de pendente para reconhecido, e depois não mudam mais.
def test_banco_recusa_trocar_quem_reconheceu(client, sessao, pendente):
    reconhecer(client, pendente.id)
    outra = Usuario(nome="Outra", email="outra@exemplo.com", senha_hash="sem-senha")
    sessao.add(outra)
    sessao.commit()

    with pytest.raises(IntegrityError, match="reconhecimento"):
        sessao.execute(
            update(Alerta)
            .where(Alerta.id == pendente.id)
            .values(reconhecido_por_id=outra.id)
        )
    sessao.rollback()

    with pytest.raises(IntegrityError, match="reconhecimento"):
        sessao.execute(
            update(Alerta)
            .where(Alerta.id == pendente.id)
            .values(reconhecido_em=ABERTO_EM)
        )


def test_banco_recusa_reconhecimento_sem_mudar_a_situacao(sessao, usuario, pendente):
    with pytest.raises(IntegrityError, match="reconhecimento"):
        sessao.execute(
            update(Alerta)
            .where(Alerta.id == pendente.id)
            .values(reconhecido_por_id=usuario.id)
        )
