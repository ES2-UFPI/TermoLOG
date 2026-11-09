"""Formatos do relatório de leituras: cada um é uma estratégia (Strategy) com a
mesma interface, escolhida pelo ``formato`` da rota (Detalhamento dos Módulos,
4.1). Um formato novo, como o Excel (#108), é só mais uma classe em EXPORTADORES.
"""

import csv
import io
from abc import ABC, abstractmethod
from datetime import datetime

from relatorios.pdf import Coluna, Destacado, gerar_pdf
from relatorios.service import BRASILIA, LinhaDoRelatorio, RelatorioDeLeituras
from salas.models import Sala
from salas.service import desvios


class Exportador(ABC):
    media_type: str
    extensao: str
    # Quantas leituras o formato aceita num relatório (None: sem limite).
    limite_de_leituras: int | None = None

    @abstractmethod
    def exportar(self, relatorio: RelatorioDeLeituras) -> bytes: ...


def formatar_data_hora(data: datetime) -> str:
    return data.astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M:%S")


def formatar_numero(valor: float) -> str:
    return str(valor).replace(".", ",")


def formatar_faixa(minimo: float | None, maximo: float | None, unidade: str) -> str:
    if minimo is not None and maximo is not None:
        return f"{formatar_numero(minimo)} a {formatar_numero(maximo)} {unidade}"
    if maximo is not None:
        return f"até {formatar_numero(maximo)} {unidade}"
    if minimo is not None:
        return f"a partir de {formatar_numero(minimo)} {unidade}"
    return "sem limite"


def periodo(relatorio: RelatorioDeLeituras) -> str:
    return (
        f"{formatar_data_hora(relatorio.inicio)} a {formatar_data_hora(relatorio.fim)}"
    )


# CSV


def _texto_seguro(texto: str) -> str:
    # O nome vem de cadastro: sem o apóstrofo, "=..." viraria fórmula na planilha.
    # A lista é a da OWASP para injeção em CSV, que inclui tab e retorno de carro.
    return f"'{texto}" if texto.startswith(("=", "+", "-", "@", "\t", "\r")) else texto


class ExportadorCSV(Exportador):
    """CSV que abre direto no Excel em português: ";", vírgula decimal e BOM."""

    media_type = "text/csv; charset=utf-8"
    extensao = "csv"

    def exportar(self, relatorio: RelatorioDeLeituras) -> bytes:
        sala = relatorio.sala
        saida = io.StringIO()
        escritor = csv.writer(saida, delimiter=";", lineterminator="\r\n")
        escritor.writerows(
            [
                ["Estabelecimento", _texto_seguro(relatorio.estabelecimento)],
                ["Sala", _texto_seguro(sala.nome)],
                ["Período", periodo(relatorio)],
                ["Responsável técnico", _texto_seguro(relatorio.responsavel)],
                [
                    "Faixa de temperatura",
                    formatar_faixa(sala.temperatura_min, sala.temperatura_max, "°C"),
                ],
                [
                    "Faixa de umidade",
                    formatar_faixa(sala.umidade_min, sala.umidade_max, "%"),
                ],
                [],
                ["Data e hora", "Temperatura (°C)", "Umidade (%)", "ID do sensor"],
            ]
        )
        # Monta o arquivo em memória; um mês tem dezenas de milhares de linhas,
        # o que cabe. Trocar por streaming se o período passar a ser muito maior.
        escritor.writerows(
            [
                formatar_data_hora(leitura.data_hora),
                formatar_numero(leitura.temperatura),
                formatar_numero(leitura.umidade),
                leitura.sensor_id,
            ]
            for leitura in relatorio.leituras
        )
        return saida.getvalue().encode("utf-8-sig")


# PDF

COLUNAS_DAS_LEITURAS = [
    Coluna("Data e hora", 0.34),
    Coluna("Temperatura (°C)", 0.24, "direita"),
    Coluna("Umidade (%)", 0.24, "direita"),
    Coluna("ID do sensor", 0.18, "direita"),
]


class ExportadorPDF(Exportador):
    """O PDF para a vigilância sanitária: cabeçalho fixo em todas as páginas e as
    leituras fora da faixa em destaque."""

    media_type = "application/pdf"
    extensao = "pdf"
    # Um mês de uma sala com 4 sensores (uma leitura por minuto cada) ainda cabe,
    # em uns 8 s. Sem o limite, um período de anos prenderia a memória e o
    # servidor por minutos; para isso há o CSV.
    limite_de_leituras = 200_000

    def __init__(self, agora=lambda: datetime.now(BRASILIA)):
        self._agora = agora

    def exportar(self, relatorio: RelatorioDeLeituras) -> bytes:
        sala = relatorio.sala
        return gerar_pdf(
            "Relatório de leituras",
            cabecalho_do_pdf(relatorio),
            COLUNAS_DAS_LEITURAS,
            [_linha(leitura, sala) for leitura in relatorio.leituras],
            legenda=(
                "Em destaque, os valores fora da faixa da sala, marcados com "
                "(acima) ou (abaixo)."
            ),
            sem_linhas="Nenhuma leitura no período.",
            rodape=(
                f"Gerado pelo TermoLOG em {formatar_data_hora(self._agora())} "
                "(horário de Brasília)"
            ),
        )


def cabecalho_do_pdf(relatorio: RelatorioDeLeituras) -> list[tuple[str, str]]:
    sala = relatorio.sala
    return [
        ("Estabelecimento", relatorio.estabelecimento),
        ("Sala", sala.nome),
        ("Período", f"{periodo(relatorio)} (horário de Brasília)"),
        ("Responsável técnico", relatorio.responsavel),
        (
            "Faixa de temperatura",
            formatar_faixa(sala.temperatura_min, sala.temperatura_max, "°C"),
        ),
        ("Faixa de umidade", formatar_faixa(sala.umidade_min, sala.umidade_max, "%")),
    ]


def _linha(leitura: LinhaDoRelatorio, sala: Sala) -> list[str]:
    """A leitura como linha da tabela, com o valor fora da faixa destacado.

    A faixa é a atual da sala, a mesma do cabeçalho: o PDF fica coerente com o que
    mostra. A faixa que valia na hora da leitura não fica guardada, só se a leitura
    estava dentro dela (Leitura.dentro_da_faixa), sem dizer qual valor saiu.
    """
    tipos = desvios(leitura, sala)
    return [
        formatar_data_hora(leitura.data_hora),
        _valor(leitura.temperatura, "temperatura", tipos),
        _valor(leitura.umidade, "umidade", tipos),
        str(leitura.sensor_id),
    ]


def _valor(valor: float, grandeza: str, tipos: list[str]) -> str:
    # Duas casas bastam (o DHT22 mede de 0,1 em 0,1) e evitam que um float com
    # ruído, como 4.099999904632568, invada a coluna vizinha.
    texto = formatar_numero(round(valor, 2))
    for lado in ("acima", "abaixo"):
        if f"{grandeza}_{lado}" in tipos:
            return Destacado(f"{texto} ({lado})")
    return texto


EXPORTADORES: dict[str, Exportador] = {
    "csv": ExportadorCSV(),
    "pdf": ExportadorPDF(),
}
