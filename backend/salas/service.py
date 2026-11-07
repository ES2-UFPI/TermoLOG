from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Literal

from sqlalchemy import Integer, cast, func, select, true
from sqlalchemy.orm import Session, aliased

from alertas.models import TipoDoDesvio
from leituras.models import Leitura
from salas.models import Sala
from sensores.models import Sensor

Status = Literal["ok", "fora_da_faixa", "sem_leitura"]


class SalaNaoEncontrada(Exception):
    pass


def desvios(leitura: Leitura, sala: Sala) -> list[TipoDoDesvio]:
    """Limite nulo não conta e valor igual ao limite está dentro (Contrato, 2.1)."""
    encontrados: list[TipoDoDesvio] = []
    if sala.temperatura_min is not None and leitura.temperatura < sala.temperatura_min:
        encontrados.append("temperatura_abaixo")
    if sala.temperatura_max is not None and leitura.temperatura > sala.temperatura_max:
        encontrados.append("temperatura_acima")
    if sala.umidade_min is not None and leitura.umidade < sala.umidade_min:
        encontrados.append("umidade_abaixo")
    if sala.umidade_max is not None and leitura.umidade > sala.umidade_max:
        encontrados.append("umidade_acima")
    return encontrados


def dentro_da_faixa(leitura: Leitura, sala: Sala) -> bool:
    return not desvios(leitura, sala)


def classificar(leituras: list[Leitura], sala: Sala) -> Status:
    """Status da sala pelas últimas leituras dos seus sensores ativos (Contrato, 2.3)."""
    if not leituras:
        return "sem_leitura"
    if all(dentro_da_faixa(leitura, sala) for leitura in leituras):
        return "ok"
    return "fora_da_faixa"


JANELA_DA_CONFORMIDADE = timedelta(hours=24)


def percentual_de_salas_dentro_da_faixa(contagem: Counter[Status]) -> float | None:
    """Salas ok sobre as salas com leitura. Sala sem leitura fica fora da conta."""
    com_leitura = contagem["ok"] + contagem["fora_da_faixa"]
    if not com_leitura:
        return None
    return round(100 * contagem["ok"] / com_leitura, 1)


class SalaService:
    """Regras de negócio das salas. A transação (commit) é de quem chama."""

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def cadastrar(
        self, nome: str, descricao: str | None = None, **faixa: float | None
    ) -> Sala:
        sala = Sala(nome=nome, descricao=descricao, **faixa)
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

    def conformidade(self, agora: datetime) -> dict[int, float]:
        """Percentual de leituras dentro da faixa por sala, nas últimas 24 h.

        A conta é feita no banco (uma linha por sala). Vale a classificação gravada
        com a leitura, isto é, a faixa da sala no momento da medição. Leitura sem
        classificação (dentro_da_faixa nulo) não entra na média, e sala sem leitura
        classificada na janela não aparece no resultado.
        """
        # AVG de inteiro dá numeric no PostgreSQL, que o ROUND(x, 1) aceita.
        percentual = func.round(
            func.avg(cast(Leitura.dentro_da_faixa, Integer)) * 100, 1
        )
        consulta = (
            select(Leitura.sala_id, percentual)
            .where(
                Leitura.data_hora > agora - JANELA_DA_CONFORMIDADE,
                Leitura.data_hora <= agora,
                Leitura.dentro_da_faixa.is_not(None),
            )
            .group_by(Leitura.sala_id)
        )
        return {
            sala_id: float(valor) for sala_id, valor in self.sessao.execute(consulta)
        }

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
