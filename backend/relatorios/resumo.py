"""Resumo do período para a primeira página do registro (#107): o que a vigilância
quer saber antes de folhear a tabela. Não depende do formato, então o Excel (#108)
também pode usar.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from relatorios.service import RelatorioDeLeituras
from salas.service import desvios

# Cada sensor manda uma leitura por minuto. Um sensor fora da faixa que fica mais
# que isso sem enviar (desligado, trocado de sala, com defeito) deixa de segurar a
# sala fora: a saída dele termina na última leitura que chegou. Sem isso, um sensor
# que parou fora da faixa marcaria a sala fora até o fim do período.
SILENCIO_MAXIMO = timedelta(minutes=3)


@dataclass(frozen=True)
class Estatistica:
    minimo: float
    maximo: float
    media: float


@dataclass(frozen=True)
class ResumoDoSensor:
    sensor_id: int
    leituras: int
    dentro_da_faixa: int
    temperatura: Estatistica
    umidade: Estatistica


@dataclass(frozen=True)
class ResumoDoPeriodo:
    sensores: list[ResumoDoSensor]
    leituras: int
    dentro_da_faixa: int
    # Quantas vezes a sala saiu da faixa e por quanto tempo ficou fora, somado.
    ocorrencias: int
    tempo_fora: timedelta


class _Acumulado:
    """Mínimo, máximo e soma correntes: não guarda os valores de um mês inteiro."""

    __slots__ = ("maximo", "minimo", "soma")

    def __init__(self, valor: float):
        self.minimo = self.maximo = valor
        self.soma = 0.0

    def somar(self, valor: float):
        self.minimo = min(self.minimo, valor)
        self.maximo = max(self.maximo, valor)
        self.soma += valor

    def estatistica(self, quantidade: int) -> Estatistica:
        return Estatistica(self.minimo, self.maximo, self.soma / quantidade)


class _Sensor:
    __slots__ = ("dentro", "leituras", "temperatura", "umidade")

    def __init__(self, temperatura: float, umidade: float):
        self.leituras = self.dentro = 0
        self.temperatura = _Acumulado(temperatura)
        self.umidade = _Acumulado(umidade)


def resumir(relatorio: RelatorioDeLeituras) -> ResumoDoPeriodo:
    """Estatísticas por sensor e as saídas da sala da faixa.

    A sala está fora da faixa enquanto a última leitura de algum sensor estiver
    fora (e for recente: SILENCIO_MAXIMO). Cada saída conta do primeiro valor fora
    até a leitura em que todos os sensores voltaram; se o período acaba com a sala
    fora, conta até a última leitura fora. A faixa é a atual da sala, a mesma do
    destaque da tabela.
    """
    sala = relatorio.sala
    sensores: dict[int, _Sensor] = {}
    # Sensor fora da faixa -> hora da última leitura dele.
    fora: dict[int, datetime] = {}
    saiu_em: datetime | None = None
    ocorrencias = 0
    tempo_fora = timedelta()
    for leitura in relatorio.leituras:
        agora = leitura.data_hora
        calados = [s for s, ultima in fora.items() if agora - ultima > SILENCIO_MAXIMO]
        if calados:
            fim = max(fora.pop(sensor) for sensor in calados)
            if not fora and saiu_em is not None:
                tempo_fora += fim - saiu_em
                saiu_em = None

        sensor = sensores.get(leitura.sensor_id)
        if sensor is None:
            sensor = sensores[leitura.sensor_id] = _Sensor(
                leitura.temperatura, leitura.umidade
            )
        sensor.leituras += 1
        sensor.temperatura.somar(leitura.temperatura)
        sensor.umidade.somar(leitura.umidade)
        if desvios(leitura, sala):
            fora[leitura.sensor_id] = agora
        else:
            sensor.dentro += 1
            fora.pop(leitura.sensor_id, None)

        if fora and saiu_em is None:
            saiu_em = agora
            ocorrencias += 1
        elif not fora and saiu_em is not None:
            tempo_fora += agora - saiu_em
            saiu_em = None
    if saiu_em is not None:
        tempo_fora += max(fora.values()) - saiu_em

    return ResumoDoPeriodo(
        sensores=[
            ResumoDoSensor(
                sensor_id=sensor_id,
                leituras=sensor.leituras,
                dentro_da_faixa=sensor.dentro,
                temperatura=sensor.temperatura.estatistica(sensor.leituras),
                umidade=sensor.umidade.estatistica(sensor.leituras),
            )
            for sensor_id, sensor in sorted(sensores.items())
        ],
        leituras=len(relatorio.leituras),
        dentro_da_faixa=sum(sensor.dentro for sensor in sensores.values()),
        ocorrencias=ocorrencias,
        tempo_fora=tempo_fora,
    )
