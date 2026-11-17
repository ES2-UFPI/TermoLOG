"""Indicadores de conformidade das salas (#19). Precisa de um PostgreSQL (DATABASE_URL)."""

from datetime import UTC, datetime, timedelta

from gateways.service import GatewayService
from leituras.models import Leitura
from salas.models import Sala
from salas.service import SalaService
from sensores.service import SensorService

AGORA = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
FAIXA_CAMARA = {"temperatura_min": 2, "temperatura_max": 8}


def criar_sala(sessao, nome, **faixa):
    sala = Sala(nome=nome, **faixa)
    sessao.add(sala)
    sessao.flush()
    return sala


def criar_sensor(sessao, sala):
    gateway, _ = GatewayService(sessao).cadastrar("Gateway de teste")
    return SensorService(sessao).cadastrar(sala.id, gateway.id)


def gravar(sessao, sensor, data_hora, dentro, temperatura=5.0):
    sessao.add(
        Leitura(
            sensor_id=sensor.id,
            sala_id=sensor.sala_id,
            temperatura=temperatura,
            umidade=60.0,
            data_hora=data_hora,
            dentro_da_faixa=dentro,
        )
    )
    sessao.flush()


def horas_atras(horas):
    return AGORA - timedelta(hours=horas)


# Conformidade por sala (percentual de leituras dentro da faixa em 24 h)


def test_conformidade_bate_com_o_calculo_manual(sessao):
    camara = criar_sala(sessao, "Câmara", **FAIXA_CAMARA)
    estoque = criar_sala(sessao, "Estoque", **FAIXA_CAMARA)
    sensor_camara, sensor_estoque = (
        criar_sensor(sessao, camara),
        criar_sensor(sessao, estoque),
    )

    # Câmara: 3 dentro e 1 fora na janela = 75%.
    for horas, dentro in [(1, True), (5, True), (12, False), (23.9, True)]:
        gravar(sessao, sensor_camara, horas_atras(horas), dentro)
    # Estoque: 1 dentro e 2 fora = 33,3%.
    for horas, dentro in [(2, True), (3, False), (4, False)]:
        gravar(sessao, sensor_estoque, horas_atras(horas), dentro)

    assert SalaService(sessao).conformidade(AGORA) == {
        camara.id: 75.0,
        estoque.id: 33.3,
    }


def test_conformidade_soma_todos_os_sensores_da_sala(sessao):
    sala = criar_sala(sessao, "Câmara", **FAIXA_CAMARA)
    primeiro, segundo = criar_sensor(sessao, sala), criar_sensor(sessao, sala)
    gravar(sessao, primeiro, horas_atras(1), True)
    gravar(sessao, segundo, horas_atras(1), False)

    assert SalaService(sessao).conformidade(AGORA) == {sala.id: 50.0}


def test_conformidade_so_conta_as_ultimas_24_horas(sessao):
    sala = criar_sala(sessao, "Câmara", **FAIXA_CAMARA)
    sensor = criar_sensor(sessao, sala)
    gravar(sessao, sensor, horas_atras(1), True)
    gravar(sessao, sensor, horas_atras(24), False)  # no limite, já fora da janela
    gravar(sessao, sensor, horas_atras(30), False)
    gravar(sessao, sensor, AGORA + timedelta(minutes=5), False)  # relógio adiantado

    assert SalaService(sessao).conformidade(AGORA) == {sala.id: 100.0}


def test_leitura_sem_classificacao_nao_entra_na_conta(sessao):
    sala = criar_sala(sessao, "Câmara", **FAIXA_CAMARA)
    sensor = criar_sensor(sessao, sala)
    gravar(sessao, sensor, horas_atras(1), True)
    gravar(sessao, sensor, horas_atras(2), None)

    assert SalaService(sessao).conformidade(AGORA) == {sala.id: 100.0}


def test_sala_sem_leitura_na_janela_fica_fora(sessao):
    criar_sala(sessao, "Sem sensor")
    antiga = criar_sala(sessao, "Só leitura antiga", **FAIXA_CAMARA)
    gravar(sessao, criar_sensor(sessao, antiga), horas_atras(48), True)
    sem_classificacao = criar_sala(sessao, "Só leitura sem classificação")
    gravar(sessao, criar_sensor(sessao, sem_classificacao), horas_atras(1), None)

    assert SalaService(sessao).conformidade(AGORA) == {}


def test_status_traz_a_conformidade_de_cada_sala(client, sessao):
    agora = datetime.now(UTC)
    com_leitura = criar_sala(sessao, "Com leitura", **FAIXA_CAMARA)
    sensor = criar_sensor(sessao, com_leitura)
    gravar(sessao, sensor, agora - timedelta(hours=2), True)
    gravar(sessao, sensor, agora - timedelta(hours=1), False)
    criar_sala(sessao, "Sem leitura")

    salas = {sala["nome"]: sala for sala in client.get("/salas/status").json()}

    assert salas["Com leitura"]["conformidade_24h"] == 50.0
    # Sem leitura não é 0% (não conforme) nem 100% (conforme): é desconhecido.
    assert salas["Sem leitura"]["conformidade_24h"] is None


# Indicador geral (percentual de salas dentro da faixa agora)


def indicadores(client):
    resposta = client.get("/salas/indicadores")
    assert resposta.status_code == 200
    return resposta.json()


def test_indicador_geral_bate_com_o_calculo_manual(client, sessao):
    for nome, temperatura in [("Ok 1", 5.0), ("Ok 2", 7.0), ("Fora", 12.0)]:
        sala = criar_sala(sessao, nome, **FAIXA_CAMARA)
        gravar(sessao, criar_sensor(sessao, sala), horas_atras(1), None, temperatura)
    criar_sala(sessao, "Sem sensor")
    criar_sensor(sessao, criar_sala(sessao, "Sensor sem leitura"))

    # 2 ok de 3 salas com leitura; as 2 sem leitura não entram na conta.
    assert indicadores(client) == {
        "salas_dentro_da_faixa": 66.7,
        "salas_ok": 2,
        "salas_fora_da_faixa": 1,
        "salas_sem_leitura": 2,
    }


def test_indicador_geral_sem_salas_com_leitura_e_nulo(client, sessao):
    criar_sala(sessao, "Sem sensor")

    assert indicadores(client) == {
        "salas_dentro_da_faixa": None,
        "salas_ok": 0,
        "salas_fora_da_faixa": 0,
        "salas_sem_leitura": 1,
    }


def test_indicador_geral_sem_salas(client):
    assert indicadores(client)["salas_dentro_da_faixa"] is None
