"""Unicidade e desativação de sensores. Precisa de um PostgreSQL (DATABASE_URL)."""

import pytest
from sqlalchemy import delete, insert, inspect
from sqlalchemy.exc import IntegrityError

from salas.models import Sala
from sensores.models import Sensor
from sensores.service import SalaNaoEncontrada, SensorNaoEncontrado, SensorService


@pytest.fixture
def sala(sessao):
    sala = Sala(nome="Câmara fria")
    sessao.add(sala)
    sessao.flush()
    return sala


@pytest.fixture
def service(sessao):
    return SensorService(sessao)


def test_cada_sensor_cadastrado_recebe_um_id_proprio(service, sala):
    sensores = [service.cadastrar(sala.id) for _ in range(3)]

    ids = [sensor.id for sensor in sensores]
    assert None not in ids
    assert len(set(ids)) == 3


def test_banco_impede_dois_sensores_com_o_mesmo_id(sessao, service, sala):
    existente = service.cadastrar(sala.id)

    # INSERT direto (Core): com sessao.add() o ORM avisa do conflito antes do banco.
    with pytest.raises(IntegrityError, match="pk_sensores"):
        sessao.execute(insert(Sensor).values(id=existente.id, sala_id=sala.id))


def test_id_do_sensor_e_chave_primaria_no_banco(sessao):
    inspetor = inspect(sessao.get_bind())

    assert inspetor.get_pk_constraint("sensores")["constrained_columns"] == ["id"]


def test_sensor_desativado_mantem_o_id(sessao, service, sala):
    sensor = service.cadastrar(sala.id)
    id_original = sensor.id

    service.desativar(sensor.id)
    sessao.expire_all()

    guardado = sessao.get(Sensor, id_original)
    assert guardado is not None
    assert guardado.id == id_original
    assert guardado.ativo is False


def test_id_de_sensor_desativado_nao_e_reutilizado(service, sala):
    desativado = service.cadastrar(sala.id)
    service.desativar(desativado.id)

    novos = [service.cadastrar(sala.id) for _ in range(3)]

    assert desativado.id not in {sensor.id for sensor in novos}


def test_desativar_duas_vezes_nao_muda_nada(service, sala):
    sensor = service.cadastrar(sala.id)

    service.desativar(sensor.id)
    service.desativar(sensor.id)

    assert sensor.ativo is False


def test_id_de_sensor_apagado_diretamente_no_banco_nao_volta(sessao, service, sala):
    # Rede de segurança: o serviço não apaga sensores, mas, se alguém apagar na mão,
    # o ID ainda assim não é reaproveitado.
    apagado = service.cadastrar(sala.id)
    id_apagado = apagado.id
    sessao.expunge(apagado)
    sessao.execute(delete(Sensor).where(Sensor.id == id_apagado))

    novo = service.cadastrar(sala.id)

    assert novo.id != id_apagado


def test_nao_cadastra_sensor_em_sala_inexistente(service):
    with pytest.raises(SalaNaoEncontrada):
        service.cadastrar(9999)


def test_nao_desativa_sensor_inexistente(service):
    with pytest.raises(SensorNaoEncontrado):
        service.desativar(9999)


def test_lista_sensores_da_sala_em_ordem_de_id(service, sala):
    cadastrados = [service.cadastrar(sala.id) for _ in range(3)]

    assert service.listar_da_sala(sala.id) == cadastrados


def test_nao_lista_sensores_de_sala_inexistente(service):
    with pytest.raises(SalaNaoEncontrada):
        service.listar_da_sala(9999)
