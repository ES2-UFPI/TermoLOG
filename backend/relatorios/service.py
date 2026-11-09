import csv
import io
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from leituras.models import Leitura
from salas.models import Sala

# O Brasil não tem horário de verão desde 2019, então o fuso de Brasília é fixo.
BRASILIA = timezone(timedelta(hours=-3))


class SalaNaoEncontrada(Exception):
    pass


@dataclass
class RelatorioDeLeituras:
    """Os dados do relatório, separados do formato: PDF e Excel usam os mesmos."""

    estabelecimento: str
    sala: Sala
    inicio: datetime
    fim: datetime
    responsavel: str
    leituras: list[Leitura]


def montar_relatorio(
    sessao: Session, sala_id: int, inicio: datetime, fim: datetime, responsavel: str
) -> RelatorioDeLeituras:
    """Leituras da sala em ordem cronológica, com os limites do período inclusos."""
    sala = sessao.get(Sala, sala_id)
    if sala is None:
        raise SalaNaoEncontrada(sala_id)
    leituras = sessao.scalars(
        select(Leitura)
        .where(
            Leitura.sala_id == sala_id,
            Leitura.data_hora >= inicio,
            Leitura.data_hora <= fim,
        )
        .order_by(Leitura.data_hora, Leitura.id)
    )
    return RelatorioDeLeituras(
        estabelecimento=os.getenv("ESTABELECIMENTO_NOME") or "Não informado",
        sala=sala,
        inicio=inicio,
        fim=fim,
        responsavel=responsavel,
        leituras=list(leituras),
    )


def _data_hora(data: datetime) -> str:
    return data.astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M:%S")


def _numero(valor: float) -> str:
    return str(valor).replace(".", ",")


def _faixa(minimo: float | None, maximo: float | None, unidade: str) -> str:
    if minimo is not None and maximo is not None:
        return f"{_numero(minimo)} a {_numero(maximo)} {unidade}"
    if maximo is not None:
        return f"até {_numero(maximo)} {unidade}"
    if minimo is not None:
        return f"a partir de {_numero(minimo)} {unidade}"
    return "sem limite"


def _texto_seguro(texto: str) -> str:
    # O nome vem de cadastro: sem o apóstrofo, "=..." viraria fórmula na planilha.
    return f"'{texto}" if texto.startswith(("=", "+", "-", "@")) else texto


def para_csv(relatorio: RelatorioDeLeituras) -> bytes:
    """CSV que abre direto no Excel em português: ";", vírgula decimal e BOM."""
    sala = relatorio.sala
    saida = io.StringIO()
    escritor = csv.writer(saida, delimiter=";", lineterminator="\r\n")
    periodo = f"{_data_hora(relatorio.inicio)} a {_data_hora(relatorio.fim)}"
    escritor.writerows(
        [
            ["Estabelecimento", _texto_seguro(relatorio.estabelecimento)],
            ["Sala", _texto_seguro(sala.nome)],
            ["Período", periodo],
            ["Responsável técnico", _texto_seguro(relatorio.responsavel)],
            [
                "Faixa de temperatura",
                _faixa(sala.temperatura_min, sala.temperatura_max, "°C"),
            ],
            ["Faixa de umidade", _faixa(sala.umidade_min, sala.umidade_max, "%")],
            [],
            ["Data e hora", "Temperatura (°C)", "Umidade (%)", "ID do sensor"],
        ]
    )
    # ponytail: monta o arquivo em memória; um mês tem dezenas de milhares de linhas,
    # o que cabe. Trocar por streaming se o período passar a ser muito maior.
    escritor.writerows(
        [
            _data_hora(leitura.data_hora),
            _numero(leitura.temperatura),
            _numero(leitura.umidade),
            leitura.sensor_id,
        ]
        for leitura in relatorio.leituras
    )
    return saida.getvalue().encode("utf-8-sig")
