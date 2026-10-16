from sqlalchemy import true

from leituras.models import Leitura
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


def test_toda_leitura_fica_vinculada_a_um_sensor_e_a_uma_sala():
    colunas = Leitura.__table__.c

    for coluna, tabela in (
        (colunas.sensor_id, "sensores.id"),
        (colunas.sala_id, "salas.id"),
    ):
        assert coluna.nullable is False
        (chave,) = coluna.foreign_keys
        assert chave.target_fullname == tabela
        assert chave.ondelete == "RESTRICT"


def test_leitura_exige_temperatura_umidade_e_data_hora():
    colunas = Leitura.__table__.c

    assert colunas.temperatura.nullable is False
    assert colunas.umidade.nullable is False
    assert colunas.data_hora.nullable is False
    assert colunas.data_hora.type.timezone is True
    # A hora vem da medição no nó, não do momento em que a API grava.
    assert colunas.data_hora.server_default is None


def test_leitura_tem_indice_por_sala_e_data_hora():
    (indice,) = Leitura.__table__.indexes

    assert [coluna.name for coluna in indice.columns] == ["sala_id", "data_hora"]


def test_relacionamento_entre_leitura_sala_e_sensor():
    sala = Sala(nome="Câmara fria")
    sensor = Sensor(sala=sala)
    leitura = Leitura(sensor=sensor, sala=sala, temperatura=4.5, umidade=60.0)

    assert leitura in sensor.leituras
    assert leitura in sala.leituras
