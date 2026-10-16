from sqlalchemy.orm import Session

from salas.models import Sala
from sensores.models import Sensor


class SalaNaoEncontrada(Exception):
    pass


class SensorNaoEncontrado(Exception):
    pass


class SensorService:
    """Regras de negócio dos sensores.

    Não há operação de exclusão: o sensor é desativado e mantém o seu ID, que
    nunca volta a ser usado. A transação (commit) é de quem chama.
    """

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def cadastrar(self, sala_id: int) -> Sensor:
        """Cadastra um sensor na sala. O ID é gerado pelo banco."""
        if self.sessao.get(Sala, sala_id) is None:
            raise SalaNaoEncontrada(sala_id)
        sensor = Sensor(sala_id=sala_id)
        self.sessao.add(sensor)
        self.sessao.flush()
        return sensor

    def desativar(self, sensor_id: int) -> Sensor:
        """Desativa o sensor, mantendo o registro e o ID."""
        sensor = self.sessao.get(Sensor, sensor_id)
        if sensor is None:
            raise SensorNaoEncontrado(sensor_id)
        sensor.ativo = False
        self.sessao.flush()
        return sensor
