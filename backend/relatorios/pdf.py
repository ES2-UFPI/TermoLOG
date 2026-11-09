"""PDF em tabela com cabeçalho fixo em todas as páginas (US10).

Genérico de propósito: o relatório de leituras usa agora e o de alertas (#119) vai
usar com outras colunas, mas o mesmo cabeçalho.

Desenha direto no canvas do ReportLab, sem o Table do platypus. As linhas têm
altura fixa, então cada página leva sempre o mesmo número delas: nenhuma linha é
cortada na quebra de página, o total de páginas é sabido antes de desenhar e o
custo cresce em linha reta com as leituras. Um mês de uma sala com três sensores
(130 mil linhas) sai em poucos segundos. O Table fica cada vez mais lento ao
quebrar uma tabela desse tamanho.
"""

import io
import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from reportlab.lib.colors import Color, black
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas

LARGURA, ALTURA = A4
MARGEM = 40
LARGURA_UTIL = LARGURA - 2 * MARGEM

FONTE = "Helvetica"
FONTE_NEGRITO = "Helvetica-Bold"
TAMANHO = 9
ENTRELINHA = 12
ALTURA_DA_LINHA = 14
# A tabela vai até aqui; abaixo fica o rodapé.
FUNDO_DA_TABELA = MARGEM
# Um nome de sala ou de estabelecimento muito grande não pode empurrar a tabela
# para fora da página: depois disso, o valor é cortado com reticências.
LINHAS_POR_CAMPO = 3

COR_DO_DESTAQUE = Color(1, 0.87, 0.87)
COR_DA_GRADE = Color(0.6, 0.6, 0.6)
COR_DO_RODAPE = Color(0.35, 0.35, 0.35)


class Destacado(str):
    """Texto de uma célula que sai em destaque: negrito e a linha toda com fundo.

    O destaque não depende só da cor, para continuar visível numa impressão em
    preto e branco: quem monta a célula também põe no texto o motivo.
    """


@dataclass(frozen=True)
class Coluna:
    titulo: str
    # Fração da largura útil da página. As frações das colunas somam 1.
    largura: float
    alinhamento: Literal["esquerda", "direita"] = "esquerda"


def gerar_pdf(
    titulo: str,
    cabecalho: Sequence[tuple[str, str]],
    colunas: Sequence[Coluna],
    linhas: Sequence[Sequence[str]],
    *,
    legenda: str,
    sem_linhas: str,
    rodape: str,
) -> bytes:
    """O PDF com ``titulo`` e os campos de ``cabecalho`` (rótulo, valor) no topo de
    todas as páginas, seguidos da tabela. ``rodape`` sai em todas as páginas, ao
    lado do número da página. Sem linhas, a tabela vem vazia, com ``sem_linhas``.
    """
    campos = [(rotulo, _quebrar(rotulo, valor)) for rotulo, valor in cabecalho]
    limites = _limites(colunas)
    saida = io.BytesIO()
    canvas = Canvas(saida, pagesize=A4, pageCompression=1)
    canvas.setTitle(titulo)
    canvas.setCreator("TermoLOG")

    def desenhar_topo() -> float:
        y = _desenhar_cabecalho(canvas, titulo, campos, legenda)
        return _desenhar_titulos(canvas, colunas, limites, y)

    # O topo é igual em todas as páginas: a primeira diz onde a tabela começa e,
    # com isso, quantas linhas cabem em cada página.
    topo = desenhar_topo()
    linhas_por_pagina = int((topo - FUNDO_DA_TABELA) // ALTURA_DA_LINHA)
    if linhas_por_pagina < 1:
        raise ValueError("o cabeçalho não deixa espaço para a tabela na página")
    paginas = max(1, math.ceil(len(linhas) / linhas_por_pagina))
    for pagina in range(paginas):
        if pagina:
            desenhar_topo()
        inicio = pagina * linhas_por_pagina
        trecho = linhas[inicio : inicio + linhas_por_pagina]
        if trecho:
            _desenhar_linhas(canvas, colunas, limites, trecho, topo)
        else:
            canvas.setFont(FONTE, TAMANHO)
            canvas.drawString(MARGEM + 4, topo - ALTURA_DA_LINHA + 4, sem_linhas)
        _desenhar_rodape(canvas, rodape, pagina + 1, paginas)
        canvas.showPage()
    canvas.save()
    return saida.getvalue()


def _largura(texto: str, fonte: str) -> float:
    return stringWidth(texto, fonte, TAMANHO)


def _quebrar(rotulo: str, valor: str) -> list[str]:
    """O valor em linhas que cabem ao lado do rótulo, no máximo LINHAS_POR_CAMPO."""
    largura = LARGURA_UTIL - _largura(f"{rotulo}: ", FONTE_NEGRITO)
    linhas = [
        pedaco
        for linha in simpleSplit(valor, FONTE, TAMANHO, largura) or [""]
        for pedaco in _partir(linha, largura)
    ]
    if len(linhas) > LINHAS_POR_CAMPO:
        linhas = linhas[:LINHAS_POR_CAMPO]
        ultima = linhas[-1]
        while ultima and _largura(ultima + "…", FONTE) > largura:
            ultima = ultima[:-1]
        linhas[-1] = ultima + "…"
    return linhas


def _partir(linha: str, largura: float) -> list[str]:
    """A linha em pedaços que cabem na largura. O simpleSplit só quebra nos
    espaços: uma palavra sem espaço maior que a página sairia pela margem."""
    pedacos: list[str] = []
    while _largura(linha, FONTE) > largura:
        corte = len(linha) - 1
        while corte > 1 and _largura(linha[:corte], FONTE) > largura:
            corte -= 1
        pedacos.append(linha[:corte])
        linha = linha[corte:]
    return [*pedacos, linha]


def _desenhar_cabecalho(
    canvas: Canvas, titulo: str, campos: list[tuple[str, list[str]]], legenda: str
) -> float:
    """Desenha o título, os campos e a legenda; devolve onde a tabela começa."""
    y = ALTURA - MARGEM - 14
    canvas.setFillColor(black)
    canvas.setFont(FONTE_NEGRITO, 14)
    canvas.drawString(MARGEM, y, titulo)
    y -= 10
    for rotulo, valor in campos:
        rotulo = f"{rotulo}: "
        recuo = MARGEM + _largura(rotulo, FONTE_NEGRITO)
        for i, trecho in enumerate(valor):
            y -= ENTRELINHA
            if i == 0:
                canvas.setFont(FONTE_NEGRITO, TAMANHO)
                canvas.drawString(MARGEM, y, rotulo)
            canvas.setFont(FONTE, TAMANHO)
            canvas.drawString(recuo, y, trecho)
    y -= ENTRELINHA + 8
    canvas.setFont(FONTE, 8)
    canvas.drawString(MARGEM, y, legenda)
    return y - 6


def _desenhar_titulos(canvas: Canvas, colunas, limites, y: float) -> float:
    y -= ENTRELINHA
    canvas.setFont(FONTE_NEGRITO, TAMANHO)
    for coluna, limite in zip(colunas, limites):
        x = _x(coluna, limite, coluna.titulo, FONTE_NEGRITO)
        canvas.drawString(x, y, coluna.titulo)
    canvas.setStrokeColor(COR_DA_GRADE)
    canvas.line(MARGEM, y - 4, LARGURA - MARGEM, y - 4)
    return y - 4


def _desenhar_linhas(canvas: Canvas, colunas, limites, trecho, topo: float):
    """As linhas de uma página: primeiro os fundos dos destaques, depois o texto.

    Todo o texto vai num único objeto de texto, trocando a fonte só quando muda.
    Um drawString por célula criaria um objeto por célula e deixaria o mês de
    leituras várias vezes mais lento.
    """
    canvas.setFillColor(COR_DO_DESTAQUE)
    for i, linha in enumerate(trecho, start=1):
        if any(isinstance(celula, Destacado) for celula in linha):
            y = topo - i * ALTURA_DA_LINHA
            canvas.rect(MARGEM, y, LARGURA_UTIL, ALTURA_DA_LINHA, stroke=0, fill=1)
    texto = canvas.beginText()
    texto.setFillColor(black)
    fonte_atual = None
    for i, linha in enumerate(trecho, start=1):
        base = topo - i * ALTURA_DA_LINHA + 4
        for coluna, limite, celula in zip(colunas, limites, linha):
            fonte = FONTE_NEGRITO if isinstance(celula, Destacado) else FONTE
            if fonte != fonte_atual:
                texto.setFont(fonte, TAMANHO)
                fonte_atual = fonte
            texto.setTextOrigin(_x(coluna, limite, celula, fonte), base)
            texto.textOut(celula)
    canvas.drawText(texto)


def _desenhar_rodape(canvas: Canvas, rodape: str, pagina: int, paginas: int):
    canvas.setFillColor(COR_DO_RODAPE)
    canvas.setFont(FONTE, 8)
    canvas.drawString(MARGEM, MARGEM - 14, rodape)
    canvas.drawRightString(
        LARGURA - MARGEM, MARGEM - 14, f"Página {pagina} de {paginas}"
    )


def _limites(colunas: Sequence[Coluna]) -> list[tuple[float, float]]:
    """Onde cada coluna começa e termina na página."""
    limites, esquerda = [], MARGEM
    for coluna in colunas:
        direita = esquerda + coluna.largura * LARGURA_UTIL
        limites.append((esquerda, direita))
        esquerda = direita
    return limites


def _x(coluna: Coluna, limite: tuple[float, float], texto: str, fonte: str) -> float:
    """Onde o texto começa na coluna, com 4 pt de folga da borda."""
    esquerda, direita = limite
    if coluna.alinhamento == "direita":
        return direita - 4 - _largura(texto, fonte)
    return esquerda + 4
