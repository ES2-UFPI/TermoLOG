from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from gateways.models import Gateway
from gateways.service import GatewayNaoEncontrado
from salas.models import Sala
from salas.service import SalaNaoEncontrada
from sensores.models import Sensor


class SensorNaoEncontrado(Exception):
    pass


class SensorService:
    """Regras de negócio dos sensores.

    Não há operação de exclusão: o sensor é desativado e mantém o seu ID, que
    nunca volta a ser usado. A transação (commit) é de quem chama.
    """

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def cadastrar(self, sala_id: int, gateway_id: int) -> Sensor:
        """Cadastra na sala um sensor ligado ao gateway. O ID é gerado pelo banco."""
        if self.sessao.get(Sala, sala_id) is None:
            raise SalaNaoEncontrada(sala_id)
        if self.sessao.get(Gateway, gateway_id) is None:
            raise GatewayNaoEncontrado(gateway_id)
        sensor = Sensor(sala_id=sala_id, gateway_id=gateway_id)
        self.sessao.add(sensor)
        self.sessao.flush()
        return sensor

    def listar_da_sala(self, sala_id: int) -> list[Sensor]:
        """Todos os sensores da sala (ativos e desativados), do mais antigo ao mais novo."""
        if self.sessao.get(Sala, sala_id) is None:
            raise SalaNaoEncontrada(sala_id)
        consulta = (
            select(Sensor)
            .where(Sensor.sala_id == sala_id)
            .options(joinedload(Sensor.sala))
            .order_by(Sensor.id)
        )
        return list(self.sessao.scalars(consulta))

    def desativar(self, sensor_id: int) -> Sensor:
        """Desativa o sensor, mantendo o registro e o ID."""
        sensor = self.sessao.get(Sensor, sensor_id)
        if sensor is None:
            raise SensorNaoEncontrado(sensor_id)
        sensor.ativo = False
        self.sessao.flush()
        return sensor
