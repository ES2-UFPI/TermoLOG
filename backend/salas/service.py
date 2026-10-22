from collections import defaultdict
from typing import Literal

from sqlalchemy import select, true
from sqlalchemy.orm import Session, aliased

from leituras.models import Leitura
from salas.models import Sala
from sensores.models import Sensor

Status = Literal["ok", "fora_da_faixa", "sem_leitura"]


class SalaNaoEncontrada(Exception):
    pass


def dentro_da_faixa(leitura: Leitura, sala: Sala) -> bool:
    """Limite nulo não conta e valor igual ao limite está dentro (Contrato, 2.1)."""

    def respeita(valor: float, minimo: float | None, maximo: float | None) -> bool:
        return (minimo is None or valor >= minimo) and (
            maximo is None or valor <= maximo
        )

    return respeita(
        leitura.temperatura, sala.temperatura_min, sala.temperatura_max
    ) and respeita(leitura.umidade, sala.umidade_min, sala.umidade_max)


def classificar(leituras: list[Leitura], sala: Sala) -> Status:
    """Status da sala pelas últimas leituras dos seus sensores ativos (Contrato, 2.3)."""
    if not leituras:
        return "sem_leitura"
    if all(dentro_da_faixa(leitura, sala) for leitura in leituras):
        return "ok"
    return "fora_da_faixa"


class SalaService:
    """Regras de negócio das salas. A transação (commit) é de quem chama."""

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def cadastrar(self, nome: str, descricao: str | None = None) -> Sala:
        sala = Sala(nome=nome, descricao=descricao)
        self.sessao.add(sala)
        self.sessao.flush()
        return sala

    def listar(self) -> list[Sala]:
        return list(self.sessao.scalars(select(Sala).order_by(Sala.id)))

    def status(self) -> list[tuple[Sala, list[Leitura], Status]]:
        """Cada sala com a última leitura de cada sensor ativo e o status dela."""
        # Uma busca por sensor ativo (LATERAL ... LIMIT 1). O filtro por sala_id usa
        # o índice (sala_id, data_hora) e fica com a leitura medida na sala atual
        # do sensor, mesmo que ele já tenha estado em outra.
        ultima = (
            select(Leitura)
            .where(Leitura.sensor_id == Sensor.id, Leitura.sala_id == Sensor.sala_id)
            .order_by(Leitura.data_hora.desc(), Leitura.id.desc())
            .limit(1)
            .lateral()
        )
        leitura = aliased(Leitura, ultima)
        consulta = (
            select(leitura)
            .select_from(Sensor)
            .join(ultima, true())
            .where(Sensor.ativo)
            .order_by(leitura.sensor_id)
        )
        por_sala = defaultdict(list)
        for ultima_leitura in self.sessao.scalars(consulta):
            por_sala[ultima_leitura.sala_id].append(ultima_leitura)

        return [
            (sala, por_sala[sala.id], classificar(por_sala[sala.id], sala))
            for sala in self.listar()
        ]

    def obter(self, sala_id: int) -> Sala:
        sala = self.sessao.get(Sala, sala_id)
        if sala is None:
            raise SalaNaoEncontrada(sala_id)
        return sala

    def editar(self, sala_id: int, campos: dict) -> Sala:
        """Altera só os campos recebidos."""
        sala = self.obter(sala_id)
        for campo, valor in campos.items():
            setattr(sala, campo, valor)
        self.sessao.flush()
        return sala
