"""PDF de registro em tabela, no layout de documento impresso (US10).

Genérico de propósito: o registro de leituras usa agora e o de alertas (#119) vai
usar com outras tabelas, mas o mesmo cabeçalho, rodapé e assinatura.

O layout segue o modelo de fatura A4 tomado como referência na revisão do #194:
faixa cinza no topo com a logo à esquerda e o título à direita, rótulos em negrito
com o valor em cinza embaixo, títulos da tabela em maiúsculas numa faixa cinza e
o bloco de totais com filete escuro e o último valor em destaque. Só a primeira
página traz o cabeçalho completo; as outras abrem com uma faixa de uma linha (logo,
referência e página), para a tabela ocupar a página.

Desenha direto no canvas do ReportLab, sem o Table do platypus. As linhas têm
altura fixa: nenhuma é cortada na quebra de página, a paginação inteira é calculada
antes de desenhar (o "Página X de Y" sai já na primeira passada) e o custo cresce
em linha reta com as leituras. O Table fica cada vez mais lento ao quebrar uma
tabela do tamanho de um mês de leituras.
"""

import io
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from functools import cache, partial
from pathlib import Path
from typing import Literal
from xml.etree import ElementTree

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import FILL_EVEN_ODD, Canvas

LARGURA, ALTURA = A4
MARGEM = 48
LARGURA_UTIL = LARGURA - 2 * MARGEM
# Onde começa a coluna da direita (título, identificação e totais), como no modelo.
COLUNA_DIREITA = LARGURA / 2
LARGURA_DA_DIREITA = LARGURA - MARGEM - COLUNA_DIREITA

FONTE = "Helvetica"
FONTE_NEGRITO = "Helvetica-Bold"
TAMANHO = 8.5
TAMANHO_DO_ROTULO = 8
TAMANHO_DOS_TITULOS = 7
ENTRELINHA = 11
# Os algarismos da Helvetica têm todos a mesma largura: alinhados à direita, os
# números ficam em coluna sem precisar de fonte monoespaçada.
ALTURA_DA_LINHA = 16
ALTURA_DOS_TITULOS = 22
ALTURA_DA_FAIXA_CURTA = 56
# Folga do texto até a borda da célula.
FOLGA = 6
# Espaço entre os blocos (tabela, totais, assinatura).
ESPACO = 24
# O conteúdo vai até aqui; abaixo fica o rodapé.
FUNDO = 52
ALTURA_DO_RODAPE = 28
# Topo do conteúdo nas páginas depois da primeira, abaixo da faixa curta.
TOPO_DAS_DEMAIS = ALTURA - ALTURA_DA_FAIXA_CURTA - ESPACO
# Um nome de sala ou de estabelecimento muito grande não pode empurrar a tabela
# para fora da página: depois disso, o valor é cortado com reticências.
LINHAS_POR_CAMPO = 3
LINHAS_POR_NOTA = 8

# Paleta do modelo, com a cor de marca do painel (tema claro) no lugar do preto.
TINTA = HexColor("#171A1F")
TINTA_SECUNDARIA = HexColor("#585858")
FUNDO_DA_FAIXA = HexColor("#F4F4F7")
FILETE = HexColor("#E2E1E8")
COR_DE_ENFASE = HexColor("#7E4E8A")
COR_DO_DESTAQUE = HexColor("#F0E6F2")

# Cópia de frontend/assets/logo.svg: a imagem Docker só leva a pasta do backend.
LOGO = Path(__file__).with_name("logo.svg")


class Destacado(str):
    """Texto de uma célula que sai em destaque: negrito e fundo só na célula.

    O destaque não depende só da cor, para continuar visível numa impressão em
    preto e branco: quem monta a linha também põe o motivo em outra coluna.
    """


@dataclass(frozen=True)
class Coluna:
    titulo: str
    # Fração da largura útil da página. As frações das colunas somam 1.
    largura: float
    alinhamento: Literal["esquerda", "direita"] = "esquerda"


@dataclass(frozen=True)
class Grupo:
    """Linhas da tabela sob um título (ex.: as de um sensor). Se o grupo é quebrado,
    o título se repete no topo da página seguinte, com "(continuação)"."""

    linhas: Sequence[Sequence[str]]
    titulo: str | None = None


@dataclass(frozen=True)
class Tabela:
    colunas: Sequence[Coluna]
    grupos: Sequence[Grupo]
    # Mostrado no lugar das linhas quando não há nenhuma.
    sem_linhas: str = ""


@dataclass(frozen=True)
class Totais:
    """Valores à direita, o último em destaque depois de um filete; as notas vão
    à esquerda, na mesma altura."""

    itens: Sequence[tuple[str, str]]
    notas: Sequence[tuple[str, str]] = ()


@dataclass(frozen=True)
class Assinatura:
    """Campos para preencher à mão: (legenda sob a linha, valor já impresso nela)."""

    titulo: str
    campos: Sequence[tuple[str, str]]


Bloco = Tabela | Totais | Assinatura


@dataclass(frozen=True)
class Documento:
    titulo: str
    # Na faixa do topo, abaixo do título (ex.: período e emissão).
    identificacao: Sequence[tuple[str, str]]
    # Abaixo da faixa, em duas colunas: (esquerda, direita).
    campos: tuple[Sequence[tuple[str, str]], Sequence[tuple[str, str]]]
    # Na faixa curta das páginas depois da primeira (ex.: sala e período).
    referencia: str
    rodape: str
    conteudo: Sequence[Bloco]


def gerar_pdf(documento: Documento) -> bytes:
    """O PDF com o cabeçalho completo na primeira página, os blocos de ``conteudo``
    em sequência e ``rodape`` com o número da página em todas."""
    saida = io.BytesIO()
    canvas = Canvas(saida, pagesize=A4, pageCompression=1)
    canvas.setTitle(documento.titulo)
    canvas.setCreator("TermoLOG")
    _registrar_logo(canvas)

    topo = _desenhar_cabecalho(canvas, documento)
    if topo < FUNDO:
        raise ValueError("o cabeçalho não cabe na primeira página")
    paginas = _paginar(documento.conteudo, topo - ESPACO)
    total = len(paginas)
    for numero, desenhos in enumerate(paginas, start=1):
        if numero > 1:
            _desenhar_faixa_curta(canvas, documento.referencia, numero, total)
        for desenhar in desenhos:
            desenhar(canvas)
        _desenhar_rodape(canvas, documento.rodape, numero, total)
        canvas.showPage()
    canvas.save()
    return saida.getvalue()


# Paginação: decide em que página e altura cada pedaço sai, sem desenhar nada.

Desenho = Callable[[Canvas], None]


class _Paginacao:
    def __init__(self, topo: float):
        self.paginas: list[list[Desenho]] = [[]]
        self.y = topo

    @property
    def pagina(self) -> int:
        return len(self.paginas) - 1

    def cabe(self, altura: float) -> bool:
        return self.y - altura >= FUNDO

    def reservar(self, altura: float):
        """Garante ``altura`` livre na página, passando para a próxima se faltar."""
        if self.cabe(altura):
            return
        self.paginas.append([])
        self.y = TOPO_DAS_DEMAIS
        if not self.cabe(altura):
            raise ValueError("um bloco do PDF não cabe numa página")

    def colocar(self, desenho: Callable[..., None], altura: float, **dados):
        self.paginas[-1].append(partial(desenho, y=self.y, **dados))
        self.y -= altura


def _paginar(conteudo: Sequence[Bloco], topo: float) -> list[list[Desenho]]:
    paginacao = _Paginacao(topo)
    for bloco in conteudo:
        if isinstance(bloco, Tabela):
            _paginar_tabela(paginacao, bloco)
        elif isinstance(bloco, Totais):
            altura = _altura_dos_totais(bloco)
            paginacao.reservar(altura)
            paginacao.colocar(_desenhar_totais, altura, totais=bloco)
        else:
            altura = _altura_da_assinatura(bloco)
            paginacao.reservar(altura)
            paginacao.colocar(_desenhar_assinatura, altura, assinatura=bloco)
        paginacao.y -= ESPACO
    return paginacao.paginas


def _paginar_tabela(paginacao: _Paginacao, tabela: Tabela):
    """Os títulos das colunas saem no topo da tabela e de cada página em que ela
    continua; o título do grupo e ao menos uma linha dele ficam sempre juntos."""
    limites = _limites(tabela.colunas)
    pagina_com_titulos = None

    def garantir(altura: float):
        nonlocal pagina_com_titulos
        titulos = 0 if pagina_com_titulos == paginacao.pagina else ALTURA_DOS_TITULOS
        if not paginacao.cabe(titulos + altura):
            paginacao.reservar(ALTURA_DOS_TITULOS + altura)
        if pagina_com_titulos != paginacao.pagina:
            paginacao.colocar(
                _desenhar_titulos,
                ALTURA_DOS_TITULOS,
                colunas=tabela.colunas,
                limites=limites,
            )
            pagina_com_titulos = paginacao.pagina

    grupos = [grupo for grupo in tabela.grupos if grupo.linhas]
    if not grupos:
        garantir(ALTURA_DA_LINHA)
        paginacao.colocar(_desenhar_aviso, ALTURA_DA_LINHA, texto=tabela.sem_linhas)
        return
    for grupo in grupos:
        altura_do_titulo = ALTURA_DA_LINHA if grupo.titulo else 0
        inicio = 0
        # Cada volta enche o resto da página; a seguinte já começa em outra.
        while inicio < len(grupo.linhas):
            garantir(altura_do_titulo + ALTURA_DA_LINHA)
            if grupo.titulo:
                titulo = (
                    grupo.titulo if inicio == 0 else f"{grupo.titulo} (continuação)"
                )
                paginacao.colocar(
                    _desenhar_titulo_do_grupo, ALTURA_DA_LINHA, texto=titulo
                )
            cabem = int((paginacao.y - FUNDO) // ALTURA_DA_LINHA)
            trecho = grupo.linhas[inicio : inicio + cabem]
            paginacao.colocar(
                _desenhar_linhas,
                len(trecho) * ALTURA_DA_LINHA,
                colunas=tabela.colunas,
                limites=limites,
                linhas=trecho,
            )
            inicio += len(trecho)


# Cabeçalhos e rodapé


@dataclass(frozen=True)
class _Texto:
    fonte: str
    tamanho: float
    cor: HexColor
    x: float
    y: float
    texto: str


def _desenhar_cabecalho(canvas: Canvas, documento: Documento) -> float:
    """Faixa com logo, título e identificação, e os campos em duas colunas abaixo
    dela; devolve onde o conteúdo começa."""
    topo = ALTURA - 34
    textos = []
    y = topo - 12
    for linha in _quebrar(documento.titulo, LARGURA_DA_DIREITA, FONTE_NEGRITO, 14, 2):
        textos.append(_Texto(FONTE_NEGRITO, 14, TINTA, COLUNA_DIREITA, y, linha))
        y -= 18
    y -= 2
    campos, y = _campos(documento.identificacao, COLUNA_DIREITA, LARGURA_DA_DIREITA, y)
    textos += campos
    largura_da_logo = 104
    fundo_da_faixa = min(y, topo - _altura_da_logo(largura_da_logo)) - 22

    canvas.setFillColor(FUNDO_DA_FAIXA)
    canvas.rect(0, fundo_da_faixa, LARGURA, ALTURA - fundo_da_faixa, stroke=0, fill=1)
    _desenhar_logo(canvas, MARGEM, topo, largura_da_logo)

    esquerda, direita = documento.campos
    y = fundo_da_faixa - 18
    textos_da_esquerda, fim_da_esquerda = _campos(
        esquerda, MARGEM, COLUNA_DIREITA - MARGEM - 24, y
    )
    textos_da_direita, fim_da_direita = _campos(
        direita, COLUNA_DIREITA, LARGURA_DA_DIREITA, y
    )
    _escrever(canvas, textos + textos_da_esquerda + textos_da_direita)
    return min(fim_da_esquerda, fim_da_direita)


def _campos(
    campos: Sequence[tuple[str, str]], x: float, largura: float, y: float
) -> tuple[list[_Texto], float]:
    """Rótulo em negrito e o valor em cinza embaixo; devolve onde terminam."""
    textos = []
    for rotulo, valor in campos:
        y -= ENTRELINHA
        textos.append(
            _Texto(FONTE_NEGRITO, TAMANHO_DO_ROTULO, TINTA, x, y, f"{rotulo}:")
        )
        for linha in _quebrar(valor, largura):
            y -= ENTRELINHA
            textos.append(_Texto(FONTE, TAMANHO, TINTA_SECUNDARIA, x, y, linha))
        y -= 8
    return textos, y


def _escrever(canvas: Canvas, textos: Sequence[_Texto]):
    for texto in textos:
        canvas.setFillColor(texto.cor)
        canvas.setFont(texto.fonte, texto.tamanho)
        canvas.drawString(texto.x, texto.y, texto.texto)


def _desenhar_faixa_curta(canvas: Canvas, referencia: str, pagina: int, paginas: int):
    """A faixa das páginas depois da primeira: logo, referência e página, numa linha."""
    fundo = ALTURA - ALTURA_DA_FAIXA_CURTA
    canvas.setFillColor(FUNDO_DA_FAIXA)
    canvas.rect(0, fundo, LARGURA, ALTURA_DA_FAIXA_CURTA, stroke=0, fill=1)
    largura_da_logo = 64
    altura_da_logo = _altura_da_logo(largura_da_logo)
    _desenhar_logo(
        canvas,
        MARGEM,
        fundo + (ALTURA_DA_FAIXA_CURTA + altura_da_logo) / 2,
        largura_da_logo,
    )
    base = fundo + ALTURA_DA_FAIXA_CURTA / 2 - 3
    numero = f"Página {pagina} de {paginas}"
    fim = LARGURA - MARGEM - _largura(numero, FONTE_NEGRITO, TAMANHO_DO_ROTULO) - 16
    disponivel = fim - (MARGEM + largura_da_logo + 24)
    canvas.setFillColor(TINTA_SECUNDARIA)
    canvas.setFont(FONTE, TAMANHO_DO_ROTULO)
    canvas.drawRightString(
        fim, base, _cortar(referencia, disponivel, FONTE, TAMANHO_DO_ROTULO)
    )
    canvas.setFillColor(TINTA)
    canvas.setFont(FONTE_NEGRITO, TAMANHO_DO_ROTULO)
    canvas.drawRightString(LARGURA - MARGEM, base, numero)


def _desenhar_rodape(canvas: Canvas, rodape: str, pagina: int, paginas: int):
    canvas.setFillColor(TINTA_SECUNDARIA)
    canvas.setFont(FONTE, 7.5)
    canvas.drawString(MARGEM, ALTURA_DO_RODAPE, rodape)
    canvas.drawRightString(
        LARGURA - MARGEM, ALTURA_DO_RODAPE, f"Página {pagina} de {paginas}"
    )


# Tabela


def _desenhar_titulos(canvas: Canvas, *, colunas, limites, y: float):
    canvas.setFillColor(FUNDO_DA_FAIXA)
    canvas.rect(
        0, y - ALTURA_DOS_TITULOS, LARGURA, ALTURA_DOS_TITULOS, stroke=0, fill=1
    )
    canvas.setFillColor(TINTA)
    canvas.setFont(FONTE_NEGRITO, TAMANHO_DOS_TITULOS)
    base = y - ALTURA_DOS_TITULOS / 2 - 2.5
    for coluna, limite in zip(colunas, limites):
        titulo = coluna.titulo.upper()
        x = _x(coluna, limite, titulo, FONTE_NEGRITO, TAMANHO_DOS_TITULOS)
        canvas.drawString(x, base, titulo)


def _desenhar_titulo_do_grupo(canvas: Canvas, *, texto: str, y: float):
    base = y - ALTURA_DA_LINHA
    canvas.setFillColor(TINTA)
    canvas.setFont(FONTE_NEGRITO, TAMANHO)
    canvas.drawString(MARGEM + FOLGA, base + 5, texto)
    canvas.setStrokeColor(TINTA)
    canvas.setLineWidth(0.8)
    canvas.line(MARGEM, base, LARGURA - MARGEM, base)


def _desenhar_aviso(canvas: Canvas, *, texto: str, y: float):
    canvas.setFillColor(TINTA_SECUNDARIA)
    canvas.setFont(FONTE, TAMANHO)
    canvas.drawString(MARGEM + FOLGA, y - ALTURA_DA_LINHA + 5, texto)


def _desenhar_linhas(canvas: Canvas, *, colunas, limites, linhas, y: float):
    """As linhas de uma página: fundos dos destaques, filetes e, por fim, o texto.

    Os fundos e os filetes vão cada um num único caminho, e todo o texto num único
    objeto de texto, trocando a fonte só quando muda. Um desenho por célula criaria
    um objeto por célula e deixaria o mês de leituras várias vezes mais lento.
    """
    fundos = canvas.beginPath()
    filetes = canvas.beginPath()
    tem_destaque = False
    for i, linha in enumerate(linhas, start=1):
        base = y - i * ALTURA_DA_LINHA
        filetes.moveTo(MARGEM, base)
        filetes.lineTo(LARGURA - MARGEM, base)
        for (esquerda, direita), celula in zip(limites, linha):
            if isinstance(celula, Destacado):
                fundos.rect(esquerda, base + 1, direita - esquerda, ALTURA_DA_LINHA - 2)
                tem_destaque = True
    if tem_destaque:
        canvas.setFillColor(COR_DO_DESTAQUE)
        canvas.drawPath(fundos, stroke=0, fill=1)
    canvas.setStrokeColor(FILETE)
    canvas.setLineWidth(0.5)
    canvas.drawPath(filetes, stroke=1, fill=0)

    texto = canvas.beginText()
    texto.setFillColor(TINTA)
    fonte_atual = None
    for i, linha in enumerate(linhas, start=1):
        base = y - i * ALTURA_DA_LINHA + 5
        for coluna, limite, celula in zip(colunas, limites, linha):
            fonte = FONTE_NEGRITO if isinstance(celula, Destacado) else FONTE
            if fonte != fonte_atual:
                texto.setFont(fonte, TAMANHO)
                fonte_atual = fonte
            texto.setTextOrigin(_x(coluna, limite, celula, fonte, TAMANHO), base)
            texto.textOut(celula)
    canvas.drawText(texto)


def _limites(colunas: Sequence[Coluna]) -> list[tuple[float, float]]:
    """Onde cada coluna começa e termina na página."""
    limites, esquerda = [], MARGEM
    for coluna in colunas:
        direita = esquerda + coluna.largura * LARGURA_UTIL
        limites.append((esquerda, direita))
        esquerda = direita
    return limites


def _x(
    coluna: Coluna, limite: tuple[float, float], texto: str, fonte: str, tamanho: float
) -> float:
    """Onde o texto começa na coluna, com a folga da borda."""
    esquerda, direita = limite
    if coluna.alinhamento == "direita":
        return direita - FOLGA - _largura(texto, fonte, tamanho)
    return esquerda + FOLGA


# Totais e assinatura

ALTURA_DO_TOTAL = 17


def _notas(totais: Totais) -> tuple[list[_Texto], float]:
    """As notas na coluna da esquerda, a partir de y = 0; devolve a altura."""
    largura = COLUNA_DIREITA - MARGEM - 24
    textos = []
    y = 0.0
    for rotulo, valor in totais.notas:
        y -= ENTRELINHA
        textos.append(
            _Texto(FONTE_NEGRITO, TAMANHO_DO_ROTULO, TINTA, MARGEM, y, f"{rotulo}:")
        )
        for linha in _quebrar(valor, largura, maximo=LINHAS_POR_NOTA):
            y -= ENTRELINHA
            textos.append(_Texto(FONTE, TAMANHO, TINTA_SECUNDARIA, MARGEM, y, linha))
        y -= 8
    return textos, -y


def _altura_dos_totais(totais: Totais) -> float:
    # Filete, os itens comuns, outro filete e o item em destaque.
    itens = 8 + len(totais.itens) * ALTURA_DO_TOTAL + 4 if totais.itens else 0
    return max(itens, _notas(totais)[1])


def _desenhar_totais(canvas: Canvas, *, totais: Totais, y: float):
    textos, _ = _notas(totais)
    _escrever(
        canvas,
        [_Texto(t.fonte, t.tamanho, t.cor, t.x, y + t.y, t.texto) for t in textos],
    )

    if not totais.itens:
        return
    *comuns, (rotulo_final, valor_final) = totais.itens
    direita = LARGURA - MARGEM
    canvas.setStrokeColor(TINTA)
    canvas.setLineWidth(1)
    canvas.line(COLUNA_DIREITA, y, direita, y)
    y -= 8
    canvas.setFillColor(TINTA)
    canvas.setFont(FONTE, TAMANHO)
    for rotulo, valor in comuns:
        y -= ALTURA_DO_TOTAL
        canvas.drawString(COLUNA_DIREITA, y + 5, rotulo)
        canvas.drawRightString(direita, y + 5, valor)
    y -= 4
    canvas.line(COLUNA_DIREITA, y, direita, y)
    y -= ALTURA_DO_TOTAL
    canvas.setFillColor(COR_DE_ENFASE)
    canvas.setFont(FONTE_NEGRITO, TAMANHO)
    canvas.drawString(COLUNA_DIREITA, y + 4, rotulo_final)
    canvas.drawRightString(direita, y + 4, valor_final)


ALTURA_DO_CAMPO_DE_ASSINATURA = 48


def _altura_da_assinatura(assinatura: Assinatura) -> float:
    linhas = -(-len(assinatura.campos) // 2)
    return 22 + linhas * ALTURA_DO_CAMPO_DE_ASSINATURA


def _desenhar_assinatura(canvas: Canvas, *, assinatura: Assinatura, y: float):
    """O título e os campos em duas colunas: valor, linha e a legenda embaixo."""
    canvas.setFillColor(TINTA)
    canvas.setFont(FONTE_NEGRITO, TAMANHO_DO_ROTULO)
    canvas.drawString(MARGEM, y - ENTRELINHA, f"{assinatura.titulo}:")
    canvas.setStrokeColor(TINTA)
    canvas.setLineWidth(0.6)
    largura = (LARGURA_UTIL - 32) / 2
    for i, (legenda, valor) in enumerate(assinatura.campos):
        x = MARGEM + (i % 2) * (largura + 32)
        linha = y - 22 - (i // 2) * ALTURA_DO_CAMPO_DE_ASSINATURA - 28
        canvas.line(x, linha, x + largura, linha)
        canvas.setFillColor(TINTA)
        canvas.setFont(FONTE, TAMANHO)
        canvas.drawString(x, linha + 5, _cortar(valor, largura, FONTE, TAMANHO))
        canvas.setFillColor(TINTA_SECUNDARIA)
        canvas.setFont(FONTE, 7.5)
        canvas.drawString(x, linha - 10, legenda)


# Logo


@cache
def _tracos_da_logo() -> tuple[float, float, list[list[tuple[str, list[float]]]]]:
    """Largura, altura e os caminhos da logo, lidos do SVG uma vez por processo."""
    svg = ElementTree.parse(LOGO).getroot()
    _, _, largura, altura = map(float, svg.get("viewBox").split())
    caminhos = [
        _comandos(caminho.get("d"))
        for caminho in svg.iter("{http://www.w3.org/2000/svg}path")
    ]
    return largura, altura, caminhos


_TOKEN = re.compile(r"-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?|[A-Za-z]")
_ARGUMENTOS = {"M": 2, "L": 2, "C": 6, "Z": 0}


def _comandos(caminho: str) -> list[tuple[str, list[float]]]:
    """Os comandos de um caminho SVG em coordenadas absolutas (M, L, C e Z), os
    únicos que a logo usa. Outro comando dá erro em vez de distorcer a logo."""
    comandos: list[tuple[str, list[float]]] = []
    comando, numeros = None, []
    for token in _TOKEN.findall(caminho):
        if token.isalpha():
            if token not in _ARGUMENTOS:
                raise ValueError(f"comando {token} do SVG não suportado na logo")
            comando = token
            if comando == "Z":
                comandos.append(("Z", []))
            continue
        if comando is None or comando == "Z":
            raise ValueError("número fora de um comando no caminho da logo")
        numeros.append(float(token))
        if len(numeros) == _ARGUMENTOS[comando]:
            comandos.append((comando, numeros))
            numeros = []
            # No SVG, os pares que seguem um M sem letra nova são linhas.
            if comando == "M":
                comando = "L"
    return comandos


def _registrar_logo(canvas: Canvas):
    """Grava a logo uma vez no PDF; cada página só a referencia."""
    largura, altura, caminhos = _tracos_da_logo()
    canvas.beginForm("logo", 0, 0, largura, altura)
    canvas.setFillColor(TINTA)
    caminho = canvas.beginPath()
    for comandos in caminhos:
        for comando, n in comandos:
            # O y do SVG cresce para baixo; o do PDF, para cima.
            if comando == "M":
                caminho.moveTo(n[0], altura - n[1])
            elif comando == "L":
                caminho.lineTo(n[0], altura - n[1])
            elif comando == "C":
                caminho.curveTo(
                    n[0], altura - n[1], n[2], altura - n[3], n[4], altura - n[5]
                )
            else:
                caminho.close()
    canvas.drawPath(caminho, stroke=0, fill=1, fillMode=FILL_EVEN_ODD)
    canvas.endForm()


def _altura_da_logo(largura: float) -> float:
    largura_original, altura_original, _ = _tracos_da_logo()
    return largura * altura_original / largura_original


def _desenhar_logo(canvas: Canvas, x: float, topo: float, largura: float):
    escala = largura / _tracos_da_logo()[0]
    canvas.saveState()
    canvas.translate(x, topo - _altura_da_logo(largura))
    canvas.scale(escala, escala)
    canvas.doForm("logo")
    canvas.restoreState()


# Texto


def _largura(texto: str, fonte: str = FONTE, tamanho: float = TAMANHO) -> float:
    return stringWidth(texto, fonte, tamanho)


def _quebrar(
    texto: str,
    largura: float,
    fonte: str = FONTE,
    tamanho: float = TAMANHO,
    maximo: int = LINHAS_POR_CAMPO,
) -> list[str]:
    """O texto em linhas que cabem na largura, no máximo ``maximo``; a última leva
    reticências se o texto não coube."""
    linhas = [
        pedaco
        for linha in simpleSplit(texto, fonte, tamanho, largura) or [""]
        for pedaco in _partir(linha, largura, fonte, tamanho)
    ]
    if len(linhas) > maximo:
        linhas = linhas[:maximo]
        linhas[-1] = _cortar(linhas[-1] + "…", largura, fonte, tamanho)
    return linhas


def _partir(linha: str, largura: float, fonte: str, tamanho: float) -> list[str]:
    """A linha em pedaços que cabem na largura. O simpleSplit só quebra nos
    espaços: uma palavra sem espaço maior que a página sairia pela margem."""
    pedacos: list[str] = []
    while _largura(linha, fonte, tamanho) > largura:
        corte = len(linha) - 1
        while corte > 1 and _largura(linha[:corte], fonte, tamanho) > largura:
            corte -= 1
        pedacos.append(linha[:corte])
        linha = linha[corte:]
    return [*pedacos, linha]


def _cortar(texto: str, largura: float, fonte: str, tamanho: float) -> str:
    """O texto numa linha só, cortado com reticências se não couber."""
    if _largura(texto, fonte, tamanho) <= largura:
        return texto
    texto = texto.removesuffix("…")
    while texto and _largura(texto + "…", fonte, tamanho) > largura:
        texto = texto[:-1]
    return texto + "…"
