from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
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

Periodo = Literal["dia", "semana", "mes"]


@dataclass(frozen=True)
class Granularidade:
    """Como um período do gráfico é fatiado: ``pontos`` intervalos de ``intervalo``."""

    intervalo: timedelta
    pontos: int


# Dia de 5 em 5 min (288 pontos), semana de hora em hora (168) e mês (30 dias) de
# 4 em 4 h (180): o gráfico nunca passa de 288 pontos, com 1 leitura por minuto ou
# com 1 por hora (Contrato, 2.4).
PERIODOS: dict[Periodo, Granularidade] = {
    "dia": Granularidade(timedelta(minutes=5), 288),
    "semana": Granularidade(timedelta(hours=1), 168),
    "mes": Granularidade(timedelta(hours=4), 180),
}
# Os intervalos dividem o dia: alinhados a partir da época (UTC), cada ponto começa
# em minuto múltiplo de 5 (dia), em hora cheia (semana) ou em hora múltipla de 4 (mês).
ORIGEM_DOS_INTERVALOS = datetime(1970, 1, 1, tzinfo=UTC)


@dataclass
class Estatistica:
    media: float
    min: float
    max: float


@dataclass
class PontoDoHistorico:
    inicio: datetime
    quantidade: int
    temperatura: Estatistica
    umidade: Estatistica


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

    def historico(
        self, sala_id: int, periodo: Periodo, fim: datetime
    ) -> tuple[Sala, datetime, list[PontoDoHistorico]]:
        """Série da sala para o gráfico: média, mínimo e máximo por intervalo.

        A janela termina em ``fim`` e tem o tamanho do período. Devolve a sala, o
        início da janela (alinhado ao intervalo, para o primeiro ponto ser inteiro)
        e os pontos em ordem cronológica, reunindo todos os sensores da sala. O
        intervalo sem leitura não vira ponto: nenhum valor é inventado. Os limites
        são inclusos e a conta é feita no banco, pelo índice (sala_id, data_hora).
        """
        sala = self.obter(sala_id)
        tamanho = PERIODOS[periodo]
        passo = tamanho.intervalo
        # O último ponto é o intervalo que contém ``fim``; a janela tem ``pontos``
        # intervalos até ele.
        ultimo = ORIGEM_DOS_INTERVALOS + (
            (fim - ORIGEM_DOS_INTERVALOS) // passo * passo
        )
        inicio = ultimo - passo * (tamanho.pontos - 1)

        intervalo = func.date_bin(passo, Leitura.data_hora, ORIGEM_DOS_INTERVALOS)
        consulta = (
            select(
                intervalo,
                func.count(),
                func.avg(Leitura.temperatura),
                func.min(Leitura.temperatura),
                func.max(Leitura.temperatura),
                func.avg(Leitura.umidade),
                func.min(Leitura.umidade),
                func.max(Leitura.umidade),
            )
            .where(
                Leitura.sala_id == sala_id,
                Leitura.data_hora >= inicio,
                Leitura.data_hora <= fim,
            )
            .group_by(intervalo)
            .order_by(intervalo)
        )
        pontos = [
            PontoDoHistorico(
                # O banco devolve no fuso da sessão; o contrato responde em UTC.
                inicio=linha[0].astimezone(UTC),
                quantidade=linha[1],
                temperatura=Estatistica(round(linha[2], 2), linha[3], linha[4]),
                umidade=Estatistica(round(linha[5], 2), linha[6], linha[7]),
            )
            for linha in self.sessao.execute(consulta)
        ]
        return sala, inicio, pontos

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
