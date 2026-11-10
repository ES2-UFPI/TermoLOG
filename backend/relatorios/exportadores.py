"""Formatos do relatório de leituras: cada um é uma estratégia (Strategy) com a
mesma interface, escolhida pelo ``formato`` da rota (Detalhamento dos Módulos,
4.1). Um formato novo, como o Excel (#108), é só mais uma classe em EXPORTADORES.
"""

import csv
import io
from abc import ABC, abstractmethod
from collections import defaultdict
from collections.abc import Callable, Iterator
from contextlib import AbstractContextManager, contextmanager, nullcontext
from datetime import datetime, timedelta
from threading import BoundedSemaphore

from relatorios.pdf import (
    Assinatura,
    Coluna,
    Destacado,
    Documento,
    Grupo,
    Tabela,
    Totais,
    gerar_pdf,
)
from relatorios.resumo import Estatistica, resumir
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

    def vaga(self) -> AbstractContextManager:
        """Segurada pela rota da consulta até o fim da exportação: um formato
        pesado limita quantos relatórios são montados ao mesmo tempo. Dá SemVaga
        se a fila de espera já estiver cheia."""
        return nullcontext()


class SemVaga(Exception):
    pass


def formatar_milhar(numero: int) -> str:
    return f"{numero:,}".replace(",", ".")


def formatar_data_hora(data: datetime) -> str:
    return data.astimezone(BRASILIA).strftime("%d/%m/%Y %H:%M:%S")


def formatar_numero(valor: float) -> str:
    return str(valor).replace(".", ",")


def formatar_faixa(
    minimo: float | None,
    maximo: float | None,
    unidade: str,
    numero: Callable[[float], str] = formatar_numero,
) -> str:
    if minimo is not None and maximo is not None:
        return f"{numero(minimo)} a {numero(maximo)} {unidade}"
    if maximo is not None:
        return f"até {numero(maximo)} {unidade}"
    if minimo is not None:
        return f"a partir de {numero(minimo)} {unidade}"
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

# Quantos PDFs são montados ao mesmo tempo, por processo. Cada um no limite de
# leituras ocupa ~270 MB e ~6 s de CPU: sem o limite, cinco pedidos de um mês
# juntos derrubam o contêiner por falta de memória. Com os 2 workers do Dockerfile,
# saem até 2 no contêiner (~540 MB). Os pedidos além dele esperam a vez, sem alocar
# nada.
PDFS_SIMULTANEOS = 1
# Quantos pedidos esperam a vez, por processo. A rota é síncrona: quem espera
# ocupa uma thread do pool que a ingestão dos gateways também usa. Com a fila
# cheia, o pedido recebe 503 na hora em vez de prender mais uma thread.
PDFS_NA_FILA = 4

# Quatro casas fixas: a precisão que o banco guarda aparece no PDF e os números
# ficam alinhados na coluna.
CASAS_DECIMAIS = 4

COLUNAS_DO_RESUMO = [
    Coluna("Sensor", 0.12),
    Coluna("Leituras", 0.10, "direita"),
    Coluna("Na faixa", 0.11, "direita"),
    *(
        Coluna(titulo, 0.67 / 6, "direita")
        for titulo in ("Mín. °C", "Máx. °C", "Média °C", "Mín. %", "Máx. %", "Média %")
    ),
]

COLUNAS_DAS_LEITURAS = [
    Coluna("Data e hora", 0.27),
    Coluna("Temperatura (°C)", 0.20, "direita"),
    Coluna("Umidade (%)", 0.20, "direita"),
    Coluna("Situação", 0.33),
]

OBSERVACOES = (
    "Valores fora da faixa da sala saem em negrito e com fundo, e a coluna "
    "Situação diz qual grandeza saiu e para que lado. A faixa considerada é a "
    "atual da sala. Uma saída da faixa vai do primeiro valor fora até a leitura em "
    "que todos os sensores voltam a ela; um sensor que para de enviar deixa de "
    "contar depois da última leitura dele."
)


class ExportadorPDF(Exportador):
    """O registro para a vigilância sanitária: resumo do período na primeira
    página, as leituras agrupadas por sensor com os valores fora da faixa em
    destaque e o campo de assinatura do responsável técnico no fim."""

    media_type = "application/pdf"
    extensao = "pdf"
    # Um mês de uma sala com 4 sensores (uma leitura por minuto cada) ainda cabe,
    # em uns 8 s. Sem o limite, um período de anos prenderia a memória e o
    # servidor por minutos; para isso há o CSV.
    limite_de_leituras = 200_000

    def __init__(self, agora=lambda: datetime.now(BRASILIA)):
        self._agora = agora
        self._vagas = BoundedSemaphore(PDFS_SIMULTANEOS)
        # Quem está montando e quem espera: passou disso, nem entra na fila.
        self._pedidos = BoundedSemaphore(PDFS_SIMULTANEOS + PDFS_NA_FILA)

    @contextmanager
    def vaga(self) -> Iterator[None]:
        if not self._pedidos.acquire(blocking=False):
            raise SemVaga
        try:
            with self._vagas:
                yield
        finally:
            self._pedidos.release()

    def exportar(self, relatorio: RelatorioDeLeituras) -> bytes:
        sala = relatorio.sala
        emitido_em = f"{formatar_data_hora(self._agora())} (horário de Brasília)"
        return gerar_pdf(
            Documento(
                titulo="Registro de temperatura e umidade",
                identificacao=[
                    ("Período", f"{periodo(relatorio)} (horário de Brasília)"),
                    ("Emitido em", emitido_em),
                ],
                campos=(
                    [
                        ("Estabelecimento", relatorio.estabelecimento),
                        ("Sala", sala.nome),
                        ("Responsável técnico", relatorio.responsavel),
                    ],
                    [
                        (
                            "Faixa de temperatura",
                            formatar_faixa(
                                sala.temperatura_min,
                                sala.temperatura_max,
                                "°C",
                                _decimal,
                            ),
                        ),
                        (
                            "Faixa de umidade",
                            formatar_faixa(
                                sala.umidade_min, sala.umidade_max, "%", _decimal
                            ),
                        ),
                    ],
                ),
                # Uma página solta ainda diz de onde é.
                referencia=(
                    f"{relatorio.estabelecimento} · {sala.nome} · {periodo(relatorio)}"
                ),
                rodape=f"Gerado pelo TermoLOG em {emitido_em}",
                conteudo=[
                    *_resumo(relatorio),
                    Tabela(
                        COLUNAS_DAS_LEITURAS,
                        _grupos_por_sensor(relatorio),
                        sem_linhas="Nenhuma leitura no período.",
                    ),
                    Assinatura(
                        "Responsável técnico",
                        [
                            ("Assinatura", ""),
                            ("Nome", relatorio.responsavel),
                            ("Registro profissional (conselho e número)", ""),
                            ("Data", ""),
                        ],
                    ),
                ],
            )
        )


def _resumo(relatorio: RelatorioDeLeituras) -> list[Tabela | Totais]:
    sala = relatorio.sala
    resumo = resumir(relatorio)
    linhas = [
        [
            f"Sensor {sensor.sensor_id}",
            formatar_milhar(sensor.leituras),
            _percentual(sensor.dentro_da_faixa, sensor.leituras),
            *_estatistica(
                sensor.temperatura, sala.temperatura_min, sala.temperatura_max
            ),
            *_estatistica(sensor.umidade, sala.umidade_min, sala.umidade_max),
        ]
        for sensor in resumo.sensores
    ]
    fora = resumo.leituras - resumo.dentro_da_faixa
    return [
        Tabela(
            COLUNAS_DO_RESUMO,
            [Grupo(linhas)],
            sem_linhas="Nenhum sensor com leituras no período.",
        ),
        Totais(
            [
                ("Leituras", formatar_milhar(resumo.leituras)),
                (
                    "Dentro da faixa",
                    _percentual(resumo.dentro_da_faixa, resumo.leituras),
                ),
                ("Leituras fora da faixa", formatar_milhar(fora)),
                ("Saídas da faixa", formatar_milhar(resumo.ocorrencias)),
                ("Tempo fora da faixa", _duracao(resumo.tempo_fora)),
            ],
            notas=[("Observações", OBSERVACOES)],
        ),
    ]


def _estatistica(
    estatistica: Estatistica, minimo: float | None, maximo: float | None
) -> list[str]:
    """Mínima, máxima e média, cada uma em destaque se estiver fora da faixa, para
    qualquer lado (uma câmara fria toda abaixo da faixa tem a máxima fora também)."""

    def celula(valor: float) -> str:
        texto = _decimal(valor)
        abaixo = minimo is not None and valor < minimo
        acima = maximo is not None and valor > maximo
        return Destacado(texto) if abaixo or acima else texto

    return [
        celula(estatistica.minimo),
        celula(estatistica.maximo),
        celula(estatistica.media),
    ]


def _grupos_por_sensor(relatorio: RelatorioDeLeituras) -> list[Grupo]:
    """As leituras de cada sensor juntas, em ordem cronológica, e não intercaladas."""
    por_sensor: defaultdict[int, list[list[str]]] = defaultdict(list)
    for leitura in relatorio.leituras:
        por_sensor[leitura.sensor_id].append(_linha(leitura, relatorio.sala))
    return [
        Grupo(linhas, f"Sensor {sensor} · {_quantidade(len(linhas), 'leitura')}")
        for sensor, linhas in sorted(por_sensor.items())
    ]


def _linha(leitura: LinhaDoRelatorio, sala: Sala) -> list[str]:
    """A leitura como linha da tabela: só a célula do valor fora da faixa fica em
    destaque, e a situação diz qual saiu e para que lado.

    A faixa é a atual da sala, a mesma do cabeçalho: o PDF fica coerente com o que
    mostra. A faixa que valia na hora da leitura não fica guardada, só se a leitura
    estava dentro dela (Leitura.dentro_da_faixa), sem dizer qual valor saiu.
    """
    tipos = desvios(leitura, sala)
    situacao = " e ".join(tipo.replace("_", " ") for tipo in tipos)
    return [
        formatar_data_hora(leitura.data_hora),
        _valor(leitura.temperatura, "temperatura", tipos),
        _valor(leitura.umidade, "umidade", tipos),
        situacao[:1].upper() + situacao[1:],
    ]


def _valor(valor: float, grandeza: str, tipos: list[str]) -> str:
    texto = _decimal(valor)
    if any(tipo.startswith(f"{grandeza}_") for tipo in tipos):
        return Destacado(texto)
    return texto


def _decimal(valor: float) -> str:
    texto = f"{valor:.{CASAS_DECIMAIS}f}"
    # Um valor negativo que arredonda para zero não sai como "-0,0000".
    if float(texto) == 0:
        texto = texto.removeprefix("-")
    return texto.replace(".", ",")


def _percentual(parte: int, total: int) -> str:
    if not total:
        return "—"
    texto = f"{100 * parte / total:.1f}"
    # O arredondamento não pode esconder um desvio (99,96 % viraria 100,0 %) nem
    # apagar o pouco que ficou dentro (0,04 % viraria 0,0 %).
    if parte < total and texto == "100.0":
        texto = "99.9"
    elif parte > 0 and texto == "0.0":
        texto = "0.1"
    return f"{texto.replace('.', ',')} %"


def _duracao(tempo: timedelta) -> str:
    minutos = int(tempo.total_seconds() // 60)
    if not minutos:
        return "menos de 1 min" if tempo else "0 min"
    horas, minutos = divmod(minutos, 60)
    if not horas:
        return f"{minutos} min"
    return f"{formatar_milhar(horas)} h {minutos:02d} min"


def _quantidade(numero: int, nome: str) -> str:
    plural = "" if numero == 1 else "s"
    return f"{formatar_milhar(numero)} {nome}{plural}"


EXPORTADORES: dict[str, Exportador] = {
    "csv": ExportadorCSV(),
    "pdf": ExportadorPDF(),
}
