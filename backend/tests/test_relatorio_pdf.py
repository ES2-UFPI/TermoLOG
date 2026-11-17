"""Relatório de leituras em PDF (#107).

Os testes da rota precisam de um PostgreSQL (DATABASE_URL); os do gerador, não.
"""

import io
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, nullcontext
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pypdf import PdfReader
from reportlab.pdfbase.pdfmetrics import stringWidth

from leituras.models import Leitura
from relatorios import router
from relatorios.exportadores import (
    EXPORTADORES,
    PDFS_NA_FILA,
    PDFS_SIMULTANEOS,
    ExportadorCSV,
    ExportadorPDF,
    SemVaga,
    _duracao,
    _estatistica,
    _percentual,
)
from relatorios.pdf import (
    FONTE,
    LARGURA_UTIL,
    TAMANHO,
    Assinatura,
    Coluna,
    Destacado,
    Documento,
    Grupo,
    Tabela,
    Totais,
    _comandos,
    _quebrar,
    gerar_pdf,
)
from relatorios.resumo import SILENCIO_MAXIMO, Estatistica, resumir
from relatorios.service import RelatorioDeLeituras
from salas.models import Sala
from sensores.service import SensorService
from usuarios.admin_padrao import NOME_ADMIN_PADRAO

BASE = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)
PERIODO = {"inicio": "2026-10-16T00:00:00-03:00", "fim": "2026-10-16T23:59:59-03:00"}
CABECALHO = [
    "Estabelecimento: Hospital Central",
    "Sala: Câmara fria 1",
    "Período: 16/10/2026 00:00:00 a 16/10/2026 23:59:59 (horário de Brasília)",
    f"Responsável técnico: {NOME_ADMIN_PADRAO}",
    # No PDF, a faixa sai com as mesmas quatro casas das leituras.
    "Faixa de temperatura: 2,0000 a 8,5000 °C",
    "Faixa de umidade: a partir de 40,0000 %",
]
REFERENCIA = (
    "Hospital Central · Câmara fria 1 · 16/10/2026 00:00:00 a 16/10/2026 23:59:59"
)


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
    assert texto.startswith("Registro de temperatura e umidade")
    for campo in CABECALHO:
        assert campo in texto


def test_cabecalho_completo_so_na_primeira_pagina(client, sala, sensor, gravar):
    for minuto in range(150):
        gravar(sensor, minuto)

    textos = paginas(pedir_pdf(client, sala.id).content)

    assert len(textos) >= 3
    for campo in CABECALHO:
        assert campo in textos[0]
    for numero, texto in enumerate(textos, start=1):
        assert "DATA E HORA" in texto
        assert f"Página {numero} de {len(textos)}" in texto
    # Nas outras, só a faixa de uma linha com sala, período e página.
    for numero, texto in enumerate(textos[1:], start=2):
        assert f"{REFERENCIA} Página {numero} de {len(textos)}" in texto
        assert "Estabelecimento:" not in texto


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

    assert "09:00:00 9,1000 60,0000 Temperatura acima" in texto
    assert "09:01:00 1,5000 35,0000 Temperatura abaixo e umidade abaixo" in texto
    # No limite está dentro (Contrato, 2.1): a linha das 09:02 fica sem situação.
    assert "09:02:00 8,5000 40,0000" in texto
    assert texto.count("acima") == 1
    assert texto.count("abaixo") == 2


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


# Vagas para o PDF (sem banco: a rota é chamada direto, com a consulta trocada)


def pedir_em_paralelo(monkeypatch, formato, quantos, montar):
    monkeypatch.setattr(router, "montar_relatorio", montar)
    monkeypatch.setattr(EXPORTADORES[formato], "exportar", lambda relatorio: b"")
    sessao = SimpleNamespace(commit=lambda: None)
    usuario = SimpleNamespace(nome="Ana")

    def pedir(_):
        return router.relatorio_de_leituras(sessao, usuario, 1, BASE, BASE, formato)

    with ThreadPoolExecutor(max_workers=quantos) as pool:
        return list(pool.map(pedir, range(quantos)))


def test_limita_quantos_pdfs_saem_ao_mesmo_tempo(monkeypatch):
    rodando = 0
    maximo = 0
    trava = threading.Lock()

    def montar_devagar(*args):
        nonlocal rodando, maximo
        with trava:
            rodando += 1
            maximo = max(maximo, rodando)
        time.sleep(0.05)
        with trava:
            rodando -= 1
        return relatorio([])

    respostas = pedir_em_paralelo(
        monkeypatch, "pdf", PDFS_SIMULTANEOS * 3, montar_devagar
    )

    assert all(resposta.status_code == 200 for resposta in respostas)
    assert maximo == PDFS_SIMULTANEOS


def test_alem_da_fila_o_pdf_e_recusado_na_hora(monkeypatch):
    exportador = ExportadorPDF()
    # Sem esperar a vez de montar, para ocupar a fila toda nesta mesma thread.
    monkeypatch.setattr(exportador, "_vagas", nullcontext())

    with ExitStack() as pedidos:
        for _ in range(PDFS_SIMULTANEOS + PDFS_NA_FILA):
            pedidos.enter_context(exportador.vaga())
        with pytest.raises(SemVaga), exportador.vaga():
            pass
    # Com a fila livre, volta a aceitar.
    with exportador.vaga():
        pass


def test_fila_cheia_de_pdfs_da_503(monkeypatch):
    def sem_vaga():
        raise SemVaga

    monkeypatch.setattr(EXPORTADORES["pdf"], "vaga", sem_vaga)
    montar = []
    monkeypatch.setattr(router, "montar_relatorio", lambda *args: montar.append(1))
    sessao = SimpleNamespace(commit=lambda: None)

    with pytest.raises(HTTPException) as erro:
        router.relatorio_de_leituras(
            sessao, SimpleNamespace(nome="Ana"), 1, BASE, BASE, "pdf"
        )

    assert erro.value.status_code == 503
    assert erro.value.headers == {"Retry-After": "10"}
    assert montar == []


def test_csv_nao_espera_vaga(monkeypatch):
    quantos = PDFS_SIMULTANEOS * 3
    # Só passa se todos os pedidos estiverem na consulta ao mesmo tempo.
    todos_juntos = threading.Barrier(quantos, timeout=5)

    def montar_junto(*args):
        todos_juntos.wait()
        return relatorio([])

    respostas = pedir_em_paralelo(monkeypatch, "csv", quantos, montar_junto)

    assert isinstance(EXPORTADORES["csv"], ExportadorCSV)
    assert all(resposta.status_code == 200 for resposta in respostas)


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


def documento(**mudancas):
    """Um documento mínimo para os testes do gerador, com ``mudancas`` por cima."""
    campos = {
        "titulo": "Registro",
        "identificacao": [("Período", "hoje")],
        "campos": ([("Sala", "A")], []),
        "referencia": "A · hoje",
        "rodape": "",
        "conteudo": [Tabela([Coluna("A", 1.0)], [Grupo([["linha"]])])],
    }
    return Documento(**(campos | mudancas))


def test_sem_faixa_nada_fica_em_destaque():
    pdf = ExportadorPDF().exportar(relatorio([leitura(0, temperatura=-40.0)]))

    (texto,) = paginas(pdf)
    assert "-40,0000" in texto
    assert "acima" not in texto
    assert "abaixo" not in texto


def test_rodape_traz_quando_o_pdf_foi_gerado():
    gerado_em = datetime(2026, 11, 9, 21, 30, tzinfo=UTC)

    pdf = ExportadorPDF(agora=lambda: gerado_em).exportar(relatorio([]))

    (texto,) = paginas(pdf)
    assert "Gerado pelo TermoLOG em 09/11/2026 18:30:00 (horário de Brasília)" in texto
    assert "Emitido em: 09/11/2026 18:30:00 (horário de Brasília)" in texto


def test_valores_saem_com_quatro_casas_decimais():
    pdf = ExportadorPDF().exportar(
        relatorio(
            [leitura(0, temperatura=4.099999904632568, umidade=12.299999999999999)]
        )
    )

    (texto,) = paginas(pdf)
    assert "09:00:00 4,1000 12,3000" in texto


def test_negativo_que_arredonda_para_zero_sai_sem_sinal():
    pdf = ExportadorPDF().exportar(relatorio([leitura(0, temperatura=-0.00001)]))

    (texto,) = paginas(pdf)
    assert "09:00:00 0,0000 60,0000" in texto
    assert "-0,0000" not in texto


def test_leituras_saem_agrupadas_por_sensor():
    leituras = [
        leitura(minuto, sensor_id=sensor) for minuto in range(3) for sensor in (2, 1)
    ]

    (texto,) = paginas(ExportadorPDF().exportar(relatorio(leituras)))

    sensor_1 = texto.index("Sensor 1 · 3 leituras")
    sensor_2 = texto.index("Sensor 2 · 3 leituras")
    assert sensor_1 < sensor_2
    assert texto[sensor_1:sensor_2].count("16/10/2026 09:0") == 3
    assert texto[sensor_2:].count("16/10/2026 09:0") == 3


def test_grupo_quebrado_repete_o_titulo_na_pagina_seguinte():
    leituras = [leitura(minuto) for minuto in range(120)]

    textos = paginas(ExportadorPDF().exportar(relatorio(leituras)))

    assert len(textos) >= 2
    assert "Sensor 1 · 120 leituras" in textos[0]
    assert "Sensor 1 · 120 leituras (continuação)" in textos[1]


def test_primeira_pagina_traz_o_resumo_do_periodo():
    leituras = [
        leitura(0, temperatura=9.0),
        leitura(1, temperatura=5.0),
        leitura(2, temperatura=5.0),
        leitura(3, temperatura=9.5),
        leitura(4, temperatura=5.0),
    ]

    textos = paginas(ExportadorPDF().exportar(relatorio(leituras, temperatura_max=8.0)))

    # Sensor, leituras, % na faixa, mín./máx./média de temperatura e de umidade.
    assert "Sensor 1 5 60,0 % 5,0000 9,5000 6,7000 60,0000 60,0000 60,0000" in textos[0]
    for total in (
        "Leituras 5",
        "Dentro da faixa 60,0 %",
        "Leituras fora da faixa 2",
        "Saídas da faixa 2",
        "Tempo fora da faixa 2 min",
    ):
        assert total in textos[0]


def test_sala_fica_fora_enquanto_algum_sensor_estiver_fora():
    leituras = [
        leitura(0, temperatura=9.0, sensor_id=1),
        leitura(1, temperatura=9.0, sensor_id=2),
        leitura(2, temperatura=5.0, sensor_id=1),
        leitura(3, temperatura=5.0, sensor_id=2),
    ]

    resumo = resumir(relatorio(leituras, temperatura_max=8.0))

    assert resumo.ocorrencias == 1
    assert resumo.tempo_fora == timedelta(minutes=3)
    assert [sensor.sensor_id for sensor in resumo.sensores] == [1, 2]
    assert [sensor.dentro_da_faixa for sensor in resumo.sensores] == [1, 1]
    assert resumo.sensores[0].temperatura.media == 7.0


def test_periodo_que_acaba_fora_conta_ate_a_ultima_leitura():
    leituras = [
        leitura(0, temperatura=5.0),
        leitura(3, temperatura=9.0),
        leitura(4, temperatura=9.0),
    ]

    resumo = resumir(relatorio(leituras, temperatura_max=8.0))

    assert resumo.ocorrencias == 1
    assert resumo.tempo_fora == timedelta(minutes=1)


def test_sensor_que_para_de_enviar_fora_nao_segura_a_sala_fora():
    leituras = [
        leitura(0, temperatura=9.0, sensor_id=2),
        # O sensor 2 não manda mais nada; o 1 segue dentro da faixa.
        *(leitura(minuto, sensor_id=1) for minuto in range(1, 60)),
    ]

    resumo = resumir(relatorio(leituras, temperatura_max=8.0))

    # A saída termina na última leitura do sensor 2: dura zero, e não uma hora.
    assert timedelta(minutes=59) > SILENCIO_MAXIMO
    assert resumo.ocorrencias == 1
    assert resumo.tempo_fora == timedelta()


def test_resumo_destaca_minima_e_maxima_fora_para_qualquer_lado():
    # Câmara fria toda abaixo da faixa: a máxima também está fora.
    abaixo = _estatistica(Estatistica(0.5, 1.5, 1.0), 2.0, 8.5)
    dentro = _estatistica(Estatistica(2.0, 8.5, 5.0), 2.0, 8.5)

    assert all(isinstance(celula, Destacado) for celula in abaixo)
    assert not any(isinstance(celula, Destacado) for celula in dentro)


def test_percentual_e_duracao_nao_escondem_desvio():
    assert _percentual(9_999, 10_000) == "99,9 %"
    assert _percentual(1, 10_000) == "0,1 %"
    assert _percentual(1, 1) == "100,0 %"
    assert _percentual(0, 0) == "—"
    assert _duracao(timedelta()) == "0 min"
    assert _duracao(timedelta(seconds=30)) == "menos de 1 min"
    assert _duracao(timedelta(minutes=125)) == "2 h 05 min"
    assert _duracao(timedelta(hours=1_500)) == "1.500 h 00 min"


def test_assinatura_do_responsavel_tecnico_no_fim():
    textos = paginas(ExportadorPDF().exportar(relatorio([leitura(0)])))

    ultima = textos[-1]
    assert (
        "Responsável técnico: Assinatura Ana Nome "
        "Registro profissional (conselho e número) Data"
    ) in ultima
    assert ultima.rindex("Responsável técnico:") > ultima.rindex("09:00:00")


def test_valor_grande_no_cabecalho_e_cortado_sem_empurrar_a_tabela():
    pdf = gerar_pdf(
        documento(
            campos=(
                [("Sala", "muito comprida " * 200), ("Responsável técnico", "Ana")],
                [],
            )
        )
    )

    (texto,) = paginas(pdf)
    assert "…" in texto
    assert "Responsável técnico: Ana" in texto
    assert "linha" in texto


def test_referencia_grande_na_faixa_curta_e_cortada():
    linhas = [[str(numero)] for numero in range(100)]
    pdf = gerar_pdf(
        documento(
            referencia="sala " * 200,
            conteudo=[Tabela([Coluna("A", 1.0)], [Grupo(linhas)])],
        )
    )

    textos = paginas(pdf)
    assert len(textos) >= 2
    assert "… Página 2 de" in textos[1]


def test_palavra_sem_espaco_maior_que_a_largura_e_quebrada():
    palavra = "CAMARA_FRIA_ALA_NORTE_" * 4

    linhas = _quebrar(palavra, LARGURA_UTIL / 2)

    assert len(linhas) > 1
    assert "".join(linhas) == palavra
    for linha in linhas:
        assert stringWidth(linha, FONTE, TAMANHO) <= LARGURA_UTIL / 2


def test_cabecalho_que_nao_cabe_na_pagina_da_erro_claro():
    campos = [(f"Campo {i}", "texto longo " * 60) for i in range(20)]

    with pytest.raises(ValueError, match="cabeçalho não cabe"):
        gerar_pdf(documento(campos=(campos, campos)))


def test_bloco_maior_que_uma_pagina_da_erro_claro():
    totais = Totais([(f"Item {i}", "1") for i in range(60)])

    with pytest.raises(ValueError, match="não cabe numa página"):
        gerar_pdf(documento(conteudo=[totais]))


def test_tabela_sem_linhas_mostra_o_aviso():
    pdf = gerar_pdf(
        documento(
            conteudo=[
                Tabela([Coluna("A", 1.0)], [Grupo([], "Vazio")], sem_linhas="Nada.")
            ]
        )
    )

    (texto,) = paginas(pdf)
    assert "Nada." in texto
    assert "Vazio" not in texto


def test_texto_vai_como_esta_sem_virar_marcacao():
    pdf = gerar_pdf(
        documento(
            campos=([("Sala", "<b>Sala & cia</b>")], []),
            conteudo=[
                Tabela([Coluna("A", 1.0)], [Grupo([[Destacado("<i>x</i>")]])]),
                Assinatura("Assinatura", [("Nome", "<u>Ana</u>")]),
            ],
        )
    )

    (texto,) = paginas(pdf)
    assert "<b>Sala & cia</b>" in texto
    assert "<i>x</i>" in texto
    assert "<u>Ana</u>" in texto


def test_caractere_fora_da_fonte_nao_quebra_o_pdf():
    dados = relatorio([leitura(0)])
    dados.sala.nome = "Sala 😀 中文 \x00"

    (texto,) = paginas(ExportadorPDF().exportar(dados))

    assert "Sala:" in texto


def test_logo_le_so_os_comandos_absolutos_do_svg():
    assert _comandos("M0 0 1.5-2C1 2 3 4 5 6Z") == [
        ("M", [0.0, 0.0]),
        # Par sem letra depois do M é uma linha.
        ("L", [1.5, -2.0]),
        ("C", [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]),
        ("Z", []),
    ]
    with pytest.raises(ValueError, match="não suportado"):
        _comandos("M0 0 l1 1")


def test_totais_sem_itens_saem_so_com_as_notas():
    pdf = gerar_pdf(documento(conteudo=[Totais([], notas=[("Notas", "nada")])]))

    (texto,) = paginas(pdf)
    assert "Notas: nada" in texto


def test_um_mes_de_leituras_sai_em_poucos_segundos():
    """Um sensor manda uma leitura por minuto: um mês são 43.200 linhas, umas mil
    páginas, todas com o valor em destaque. Leva por volta de 2 s; o limite folgado
    é para máquinas lentas."""
    leituras = [leitura(minuto) for minuto in range(30 * 24 * 60)]

    inicio = time.perf_counter()
    pdf = ExportadorPDF().exportar(relatorio(leituras, temperatura_max=4.0))
    duracao = time.perf_counter() - inicio

    assert pdf.startswith(b"%PDF-")
    assert duracao < 20
