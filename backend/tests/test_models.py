from sqlalchemy import true

from salas.models import Sala
from sensores.models import Sensor


def test_sala_tem_nome_obrigatorio_e_descricao_opcional():
    colunas = Sala.__table__.c

    assert colunas.nome.nullable is False
    assert colunas.descricao.nullable is True


def test_todo_sensor_fica_vinculado_a_uma_sala():
    sala_id = Sensor.__table__.c.sala_id

    assert sala_id.nullable is False
    (chave,) = sala_id.foreign_keys
    assert chave.target_fullname == "salas.id"
    assert chave.ondelete == "RESTRICT"


def test_sensor_nasce_ativo_com_data_de_cadastro():
    colunas = Sensor.__table__.c

    assert colunas.ativo.nullable is False
    assert str(colunas.ativo.server_default.arg) == str(true())
    assert colunas.data_cadastro.nullable is False
    assert colunas.data_cadastro.server_default is not None


def test_relacionamento_entre_sala_e_sensor():
    sala = Sala(nome="Câmara fria")
    sensor = Sensor(sala=sala)

    assert sensor in sala.sensores
