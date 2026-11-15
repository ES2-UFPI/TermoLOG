import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from alertas.models import Alerta, Situacao, TipoDoDesvio
from leituras.models import Leitura
from salas.models import Sala
from usuarios.models import Usuario

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


class LinhaDeAlerta(NamedTuple):
    """O alerta e o atendimento dele; sem reconhecimento ou encerramento, os campos
    correspondentes ficam None."""

    aberto_em: datetime
    tipo: TipoDoDesvio
    sensor_id: int
    # Valores da leitura que abriu o alerta.
    temperatura: float
    umidade: float
    situacao: Situacao
    reconhecido_por: str | None
    reconhecido_em: datetime | None
    acao_corretiva: str | None
    encerrado_em: datetime | None


@dataclass
class Relatorio:
    """O cabeçalho comum aos relatórios, separado do formato: CSV, PDF e Excel
    usam os mesmos dados."""

    estabelecimento: str
    sala: Sala
    inicio: datetime
    fim: datetime
    responsavel: str


@dataclass
class RelatorioDeLeituras(Relatorio):
    leituras: list[LinhaDoRelatorio]


@dataclass
class RelatorioDeAlertas(Relatorio):
    alertas: list[LinhaDeAlerta]


def _sala(sessao: Session, sala_id: int) -> Sala:
    sala = sessao.get(Sala, sala_id)
    if sala is None:
        raise SalaNaoEncontrada(sala_id)
    return sala


def _estabelecimento() -> str:
    return os.getenv("ESTABELECIMENTO_NOME") or "Não informado"


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
    sala = _sala(sessao, sala_id)
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
        estabelecimento=_estabelecimento(),
        sala=sala,
        inicio=inicio,
        fim=fim,
        responsavel=responsavel,
        leituras=[LinhaDoRelatorio(*linha) for linha in linhas],
    )


def montar_relatorio_de_alertas(
    sessao: Session,
    sala_id: int,
    inicio: datetime,
    fim: datetime,
    responsavel: str,
) -> RelatorioDeAlertas:
    """Alertas abertos na sala no período, em ordem cronológica e com os limites
    inclusos, com quem reconheceu e a ação corretiva de cada um.

    O período vale para a abertura: um alerta aberto antes do início fica de fora,
    mesmo que tenha sido encerrado dentro do período.
    """
    sala = _sala(sessao, sala_id)
    linhas = sessao.execute(
        select(
            Alerta.data_hora,
            Alerta.tipo,
            Alerta.sensor_id,
            Leitura.temperatura,
            Leitura.umidade,
            Alerta.situacao,
            Usuario.nome,
            Alerta.reconhecido_em,
            Alerta.acao_corretiva,
            Alerta.encerrado_em,
        )
        .join(Leitura, Alerta.leitura_id == Leitura.id)
        .outerjoin(Usuario, Alerta.reconhecido_por_id == Usuario.id)
        .where(
            Alerta.sala_id == sala_id,
            Alerta.data_hora >= inicio,
            Alerta.data_hora <= fim,
        )
        .order_by(Alerta.data_hora, Alerta.id)
    )
    return RelatorioDeAlertas(
        estabelecimento=_estabelecimento(),
        sala=sala,
        inicio=inicio,
        fim=fim,
        responsavel=responsavel,
        alertas=[LinhaDeAlerta(*linha) for linha in linhas],
    )
