"""Relatório de leituras em PDF (#107).

Os testes da rota precisam de um PostgreSQL (DATABASE_URL); os do gerador, não.
"""

import io
import time
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from pypdf import PdfReader
from reportlab.pdfbase.pdfmetrics import stringWidth

from leituras.models import Leitura
from relatorios.exportadores import EXPORTADORES, ExportadorPDF
from relatorios.pdf import (
    FONTE,
    FONTE_NEGRITO,
    LARGURA_UTIL,
    TAMANHO,
    Coluna,
    Destacado,
    _quebrar,
    gerar_pdf,
)
from relatorios.service import RelatorioDeLeituras
from salas.models import Sala
from sensores.service import SensorService

BASE = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)
PERIODO = {"inicio": "2026-10-16T00:00:00-03:00", "fim": "2026-10-16T23:59:59-03:00"}
CABECALHO = [
    "Estabelecimento: Hospital Central",
    "Sala: Câmara fria 1",
    "Período: 16/10/2026 00:00:00 a 16/10/2026 23:59:59 (horário de Brasília)",
    "Responsável técnico: Ana",
    "Faixa de temperatura: 2,0 a 8,5 °C",
    "Faixa de umidade: a partir de 40,0 %",
]


@pytest.fixture
def sala(sessao):
    sala = Sala(
        nome="Câmara fria 1", temperatura_min=2.0, temperatura_max=8.5, umidade_min=40
    )
    sessao.add(sala)
    sessao.flush()
    return sala


@pytest.fixture
def sensor(sessao, sala, gateway):
    return SensorService(sessao).cadastrar(sala.id, gateway.id)


@pytest.fixture
def gravar(sessao, sala):
    def _gravar(sensor, minutos, temperatura=4.5, umidade=60.0):
        sessao.add(
            Leitura(
                sensor_id=sensor.id,
                sala_id=sala.id,
                temperatura=temperatura,
                umidade=umidade,
                data_hora=BASE + timedelta(minutes=minutos),
            )
        )
        sessao.flush()

    return _gravar


@pytest.fixture(autouse=True)
def estabelecimento(monkeypatch):
    monkeypatch.setenv("ESTABELECIMENTO_NOME", "Hospital Central")


def pedir_pdf(client, sala_id):
    return client.get(
        "/relatorios/leituras",
        params={"sala_id": sala_id, "formato": "pdf", **PERIODO},
    )


def paginas(conteudo: bytes) -> list[str]:
    """O texto de cada página, com os espaços e quebras de linha juntados em um só:
    o rótulo e o valor de um campo são desenhados separados e saem em linhas
    diferentes na extração."""
    leitor = PdfReader(io.BytesIO(conteudo))
    return [" ".join(pagina.extract_text().split()) for pagina in leitor.pages]


# Rota


def test_pdf_tem_tipo_nome_e_cabecalho(client, sala, sensor, gravar):
    gravar(sensor, 0)

    resposta = pedir_pdf(client, sala.id)

    assert resposta.status_code == 200
    assert resposta.headers["content-type"] == "application/pdf"
    assert resposta.headers["content-disposition"] == (
        f'attachment; filename="relatorio-leituras-sala-{sala.id}-20261016-20261016.pdf"'
    )
    assert resposta.content.startswith(b"%PDF-")
    (texto,) = paginas(resposta.content)
    assert texto.startswith("Relatório de leituras")
    for campo in CABECALHO:
        assert campo in texto


def test_cabecalho_se_repete_em_todas_as_paginas(client, sala, sensor, gravar):
    for minuto in range(150):
        gravar(sensor, minuto)

    textos = paginas(pedir_pdf(client, sala.id).content)

    assert len(textos) >= 3
    for numero, texto in enumerate(textos, start=1):
        for campo in CABECALHO:
            assert campo in texto
        assert "Data e hora" in texto
        assert f"Página {numero} de {len(textos)}" in texto


def test_cada_leitura_sai_uma_vez_e_inteira_na_quebra_de_pagina(
    client, sala, sensor, gravar
):
    for minuto in range(150):
        gravar(sensor, minuto, temperatura=4.0 + minuto % 10 / 10)

    texto = "\n".join(paginas(pedir_pdf(client, sala.id).content))

    for minuto in range(150):
        # Em Brasília (UTC-3), como sai no PDF.
        hora = BASE + timedelta(minutes=minuto) - timedelta(hours=3)
        assert texto.count(hora.strftime("%d/%m/%Y %H:%M:%S")) == 1
    # Ordem cronológica: a primeira e a última leitura nas pontas da tabela.
    assert texto.index("16/10/2026 09:00:00") < texto.index("16/10/2026 11:29:00")


def test_data_e_hora_no_fuso_de_brasilia(client, sala, sensor, gravar):
    gravar(sensor, 0)  # 12:00 em UTC

    (texto,) = paginas(pedir_pdf(client, sala.id).content)

    assert "16/10/2026 09:00:00" in texto
    assert "12:00:00" not in texto


def test_valores_fora_da_faixa_sao_marcados(client, sala, sensor, gravar):
    gravar(sensor, 0, temperatura=9.1)
    gravar(sensor, 1, temperatura=1.5, umidade=35.0)
    gravar(sensor, 2, temperatura=8.5, umidade=40.0)

    (texto,) = paginas(pedir_pdf(client, sala.id).content)

    assert "9,1 (acima)" in texto
    assert "1,5 (abaixo)" in texto
    assert "35,0 (abaixo)" in texto
    # No limite está dentro (Contrato, 2.1).
    assert "8,5 (" not in texto
    assert "40,0 (" not in texto


def test_periodo_sem_leituras_gera_uma_pagina_com_a_tabela_vazia(client, sala):
    resposta = pedir_pdf(client, sala.id)

    assert resposta.status_code == 200
    (texto,) = paginas(resposta.content)
    assert "Nenhuma leitura no período." in texto
    assert "Página 1 de 1" in texto


def test_periodo_com_leituras_demais_para_o_pdf_da_422(
    client, sala, sensor, gravar, monkeypatch
):
    monkeypatch.setattr(EXPORTADORES["pdf"], "limite_de_leituras", 2)
    for minuto in range(3):
        gravar(sensor, minuto)

    resposta = pedir_pdf(client, sala.id)

    assert resposta.status_code == 422
    assert resposta.json() == {
        "detail": "o período tem 3 leituras e o PDF aceita até 2: escolha um "
        "período menor ou baixe em CSV"
    }
    # O CSV não tem esse limite.
    csv = client.get(
        "/relatorios/leituras",
        params={"sala_id": sala.id, "formato": "csv", **PERIODO},
    )
    assert csv.status_code == 200


def test_no_limite_de_leituras_o_pdf_sai(client, sala, sensor, gravar, monkeypatch):
    monkeypatch.setattr(EXPORTADORES["pdf"], "limite_de_leituras", 3)
    for minuto in range(3):
        gravar(sensor, minuto)

    assert pedir_pdf(client, sala.id).status_code == 200


def test_xlsx_continua_indisponivel(client, sala):
    resposta = client.get(
        "/relatorios/leituras",
        params={"sala_id": sala.id, "formato": "xlsx", **PERIODO},
    )

    assert resposta.status_code == 422
    assert resposta.json() == {"detail": "formato xlsx ainda não disponível"}


# Gerador


def relatorio(leituras, **sala):
    faixa = dict.fromkeys(
        ("temperatura_min", "temperatura_max", "umidade_min", "umidade_max")
    )
    return RelatorioDeLeituras(
        estabelecimento="Hospital Central",
        sala=SimpleNamespace(nome="Câmara fria 1", **(faixa | sala)),
        inicio=BASE,
        fim=BASE + timedelta(days=30),
        responsavel="Ana",
        leituras=leituras,
    )


def leitura(minutos, temperatura=4.5, umidade=60.0, sensor_id=1):
    return SimpleNamespace(
        data_hora=BASE + timedelta(minutes=minutos),
        temperatura=temperatura,
        umidade=umidade,
        sensor_id=sensor_id,
    )


def test_sem_faixa_nada_fica_em_destaque():
    pdf = ExportadorPDF().exportar(relatorio([leitura(0, temperatura=-40.0)]))

    (texto,) = paginas(pdf)
    assert "-40,0" in texto
    assert "(acima)" not in texto.split("Data e hora")[1]
    assert "(abaixo)" not in texto.split("Data e hora")[1]


def test_rodape_traz_quando_o_pdf_foi_gerado():
    gerado_em = datetime(2026, 11, 9, 21, 30, tzinfo=UTC)

    pdf = ExportadorPDF(agora=lambda: gerado_em).exportar(relatorio([]))

    (texto,) = paginas(pdf)
    assert "Gerado pelo TermoLOG em 09/11/2026 18:30:00 (horário de Brasília)" in texto


def test_valor_grande_no_cabecalho_e_cortado_sem_empurrar_a_tabela():
    pdf = gerar_pdf(
        "Relatório",
        [("Sala", "muito comprida " * 200), ("Responsável técnico", "Ana")],
        [Coluna("A", 1.0)],
        [["linha"]],
        legenda="",
        sem_linhas="",
        rodape="",
    )

    (texto,) = paginas(pdf)
    assert "…" in texto
    assert "Responsável técnico: Ana" in texto
    assert "linha" in texto


def test_palavra_sem_espaco_maior_que_a_pagina_e_quebrada():
    palavra = "CAMARA_FRIA_ALA_NORTE_" * 6

    linhas = _quebrar("Sala", palavra)

    disponivel = LARGURA_UTIL - stringWidth("Sala: ", FONTE_NEGRITO, TAMANHO)
    assert len(linhas) > 1
    assert "".join(linhas) == palavra
    for linha in linhas:
        assert stringWidth(linha, FONTE, TAMANHO) <= disponivel


def test_cabecalho_que_ocupa_a_pagina_toda_da_erro_claro():
    campos = [(f"Campo {i}", "texto longo " * 60) for i in range(20)]

    with pytest.raises(ValueError, match="espaço para a tabela"):
        gerar_pdf(
            "Relatório",
            campos,
            [Coluna("A", 1.0)],
            [],
            legenda="",
            sem_linhas="",
            rodape="",
        )


def test_valor_com_ruido_de_float_sai_com_duas_casas():
    pdf = ExportadorPDF().exportar(
        relatorio(
            [leitura(0, temperatura=4.099999904632568, umidade=12.299999999999999)]
        )
    )

    (texto,) = paginas(pdf)
    assert "4,1 12,3" in texto


def test_texto_vai_como_esta_sem_virar_marcacao():
    pdf = gerar_pdf(
        "Relatório",
        [("Sala", "<b>Sala & cia</b>")],
        [Coluna("A", 1.0)],
        [[Destacado("<i>x</i>")]],
        legenda="",
        sem_linhas="",
        rodape="",
    )

    (texto,) = paginas(pdf)
    assert "<b>Sala & cia</b>" in texto
    assert "<i>x</i>" in texto


def test_caractere_fora_da_fonte_nao_quebra_o_pdf():
    dados = relatorio([leitura(0)])
    dados.sala.nome = "Sala 😀 中文 \x00"

    (texto,) = paginas(ExportadorPDF().exportar(dados))

    assert "Sala:" in texto


def test_um_mes_de_leituras_sai_em_poucos_segundos():
    """Um sensor manda uma leitura por minuto: um mês são 43.200 linhas, umas mil
    páginas. Leva por volta de 2 s; o limite folgado é para máquinas lentas."""
    leituras = [leitura(minuto) for minuto in range(30 * 24 * 60)]

    inicio = time.perf_counter()
    pdf = ExportadorPDF().exportar(relatorio(leituras, temperatura_max=4.0))
    duracao = time.perf_counter() - inicio

    assert pdf.startswith(b"%PDF-")
    assert duracao < 20
