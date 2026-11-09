import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from leituras.models import Leitura
from salas.models import Sala

# O Brasil não tem horário de verão desde 2019, então o fuso de Brasília é fixo.
BRASILIA = timezone(timedelta(hours=-3))


class SalaNaoEncontrada(Exception):
    pass


class PeriodoGrandeDemais(Exception):
    def __init__(self, leituras: int, limite: int):
        super().__init__(leituras, limite)
        self.leituras = leituras
        self.limite = limite


class LinhaDoRelatorio(NamedTuple):
    """Só as colunas que o relatório mostra: um mês de leituras como objetos
    completos do ORM ocuparia várias vezes mais memória."""

    data_hora: datetime
    temperatura: float
    umidade: float
    sensor_id: int


@dataclass
class RelatorioDeLeituras:
    """Os dados do relatório, separados do formato: CSV, PDF e Excel usam os mesmos."""

    estabelecimento: str
    sala: Sala
    inicio: datetime
    fim: datetime
    responsavel: str
    leituras: list[LinhaDoRelatorio]


def montar_relatorio(
    sessao: Session,
    sala_id: int,
    inicio: datetime,
    fim: datetime,
    responsavel: str,
    limite: int | None = None,
) -> RelatorioDeLeituras:
    """Leituras da sala em ordem cronológica, com os limites do período inclusos.

    Com ``limite``, conta as leituras antes de carregá-las e dá PeriodoGrandeDemais
    se passarem dele.
    """
    sala = sessao.get(Sala, sala_id)
    if sala is None:
        raise SalaNaoEncontrada(sala_id)
    do_periodo = (
        Leitura.sala_id == sala_id,
        Leitura.data_hora >= inicio,
        Leitura.data_hora <= fim,
    )
    if limite is not None:
        total = sessao.scalar(select(func.count()).where(*do_periodo))
        if total > limite:
            raise PeriodoGrandeDemais(total, limite)
    linhas = sessao.execute(
        select(
            Leitura.data_hora, Leitura.temperatura, Leitura.umidade, Leitura.sensor_id
        )
        .where(*do_periodo)
        .order_by(Leitura.data_hora, Leitura.id)
    )
    return RelatorioDeLeituras(
        estabelecimento=os.getenv("ESTABELECIMENTO_NOME") or "Não informado",
        sala=sala,
        inicio=inicio,
        fim=fim,
        responsavel=responsavel,
        leituras=[LinhaDoRelatorio(*linha) for linha in linhas],
    )
