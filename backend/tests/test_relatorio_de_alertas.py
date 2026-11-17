"""Relatório de alertas e ações corretivas (#119). Precisa de um PostgreSQL
(DATABASE_URL)."""

import csv
import io
import re
from contextlib import ExitStack, nullcontext
from datetime import UTC, datetime, timedelta

import pytest
from pypdf import PdfReader
from reportlab.pdfbase.pdfmetrics import stringWidth

from alertas.models import Alerta
from leituras.models import Leitura
from relatorios.exportadores import (
    COLUNAS_DOS_ALERTAS,
    PDFS_NA_FILA,
    PDFS_SIMULTANEOS,
    ExportadorDeAlertasPDF,
    ExportadorPDF,
    SemVaga,
    _grupo_do_alerta,
)
from relatorios.pdf import FOLGA, FONTE, LARGURA_UTIL, TAMANHO, linhas_da_celula
from relatorios.service import (
    LinhaDeAlerta,
    SalaNaoEncontrada,
    montar_relatorio_de_alertas,
)
from salas.models import Sala
from sensores.service import SensorService
from usuarios.admin_padrao import NOME_ADMIN_PADRAO

BASE = datetime(2026, 10, 16, 12, 0, tzinfo=UTC)
PERIODO = {"inicio": "2026-10-16T00:00:00-03:00", "fim": "2026-10-16T23:59:59-03:00"}
COLUNAS_DO_CSV = [
    "Aberto em",
    "Tipo",
    "ID do sensor",
    "Temperatura (°C)",
    "Umidade (%)",
    "Situação",
    "Reconhecido por",
    "Reconhecido em",
    "Ação corretiva",
    "Encerrado em",
]


def minutos(n):
    return BASE + timedelta(minutes=n)


@pytest.fixture
def sala(sessao):
    sala = Sala(nome="Câmara fria 1", temperatura_min=2.0, temperatura_max=8.5)
    sessao.add(sala)
    sessao.flush()
    return sala


@pytest.fixture
def sensor(sessao, sala, gateway):
    return SensorService(sessao).cadastrar(sala.id, gateway.id)


@pytest.fixture
def criar(sessao, sala, sensor):
    """Alerta aberto aos ``aberto`` minutos de BASE pela leitura medida 5 s antes."""

    def _criar(
        aberto,
        situacao="pendente",
        tipo="temperatura_acima",
        sala_id=None,
        sensor_id=None,
        **atendimento,
    ):
        leitura = Leitura(
            sensor_id=sensor_id or sensor.id,
            sala_id=sala_id or sala.id,
            temperatura=9.1,
            umidade=61.5,
            data_hora=minutos(aberto) - timedelta(seconds=5),
        )
        sessao.add(leitura)
        sessao.flush()
        alerta = Alerta(
            sala_id=sala_id or sala.id,
            sensor_id=sensor_id or sensor.id,
            leitura_id=leitura.id,
            tipo=tipo,
            data_hora=minutos(aberto),
            situacao=situacao,
            **atendimento,
        )
        sessao.add(alerta)
        sessao.flush()
        return alerta

    return _criar


@pytest.fixture(autouse=True)
def estabelecimento(monkeypatch):
    monkeypatch.setenv("ESTABELECIMENTO_NOME", "Hospital Central")


def pedir(cliente, sala_id, **query):
    return cliente.get(
        "/relatorios/alertas",
        params={"sala_id": sala_id, "formato": "csv", **PERIODO, **query},
    )


def linhas(resposta):
    return list(
        csv.reader(io.StringIO(resposta.content.decode("utf-8-sig")), delimiter=";")
    )


# Serviço


def test_lista_os_alertas_do_periodo_em_ordem_com_o_atendimento(
    sessao, sala, sensor, criar, usuario
):
    criar(
        30,
        "encerrado",
        tipo="umidade_acima",
        reconhecido_por=usuario,
        reconhecido_em=minutos(31),
        acao_corretiva="Porta da câmara fechada",
        encerrado_em=minutos(40),
    )
    criar(0)
    criar(
        10,
        "reconhecido",
        tipo="temperatura_abaixo",
        reconhecido_por=usuario,
        reconhecido_em=minutos(12),
    )

    relatorio = montar_relatorio_de_alertas(sessao, sala.id, BASE, minutos(60), "Ana")

    assert relatorio.sala == sala
    assert relatorio.responsavel == "Ana"
    assert relatorio.alertas == [
        LinhaDeAlerta(
            aberto_em=minutos(0),
            tipo="temperatura_acima",
            sensor_id=sensor.id,
            temperatura=9.1,
            umidade=61.5,
            situacao="pendente",
            reconhecido_por=None,
            reconhecido_em=None,
            acao_corretiva=None,
            encerrado_em=None,
        ),
        LinhaDeAlerta(
            aberto_em=minutos(10),
            tipo="temperatura_abaixo",
            sensor_id=sensor.id,
            temperatura=9.1,
            umidade=61.5,
            situacao="reconhecido",
            reconhecido_por=usuario.nome,
            reconhecido_em=minutos(12),
            acao_corretiva=None,
            encerrado_em=None,
        ),
        LinhaDeAlerta(
            aberto_em=minutos(30),
            tipo="umidade_acima",
            sensor_id=sensor.id,
            temperatura=9.1,
            umidade=61.5,
            situacao="encerrado",
            reconhecido_por=usuario.nome,
            reconhecido_em=minutos(31),
            acao_corretiva="Porta da câmara fechada",
            encerrado_em=minutos(40),
        ),
    ]


def test_limites_do_periodo_entram_e_o_que_passa_fica_de_fora(sessao, sala, criar):
    for aberto, tipo in [
        (-1, "temperatura_acima"),
        (0, "temperatura_abaixo"),
        (10, "umidade_acima"),
        (11, "umidade_abaixo"),
    ]:
        criar(aberto, tipo=tipo)

    relatorio = montar_relatorio_de_alertas(sessao, sala.id, BASE, minutos(10), "Ana")

    assert [alerta.aberto_em for alerta in relatorio.alertas] == [
        minutos(0),
        minutos(10),
    ]


def test_so_entram_alertas_da_sala_pedida(sessao, sala, criar, gateway):
    outra = Sala(nome="Outra", temperatura_max=8)
    sessao.add(outra)
    sessao.flush()
    sensor_da_outra = SensorService(sessao).cadastrar(outra.id, gateway.id)
    criar(0, sala_id=outra.id, sensor_id=sensor_da_outra.id)

    relatorio = montar_relatorio_de_alertas(sessao, sala.id, BASE, minutos(60), "Ana")

    assert relatorio.alertas == []


def test_sala_que_nao_existe_no_servico(sessao):
    with pytest.raises(SalaNaoEncontrada):
        montar_relatorio_de_alertas(sessao, 999999, BASE, BASE, "Ana")


# Rota, em CSV


def test_csv_traz_o_cabecalho_dos_relatorios_e_os_alertas(
    client, sala, sensor, criar, usuario
):
    criar(0)
    criar(
        10,
        "encerrado",
        tipo="umidade_acima",
        reconhecido_por=usuario,
        reconhecido_em=minutos(11),
        acao_corretiva="Porta da câmara fechada",
        encerrado_em=minutos(20),
    )

    resposta = pedir(client, sala.id)

    assert resposta.status_code == 200
    assert resposta.headers["content-type"].startswith("text/csv")
    assert resposta.headers["content-disposition"] == (
        f'attachment; filename="relatorio-alertas-sala-{sala.id}-20261016-20261016.csv"'
    )
    assert linhas(resposta) == [
        ["Estabelecimento", "Hospital Central"],
        ["Sala", "Câmara fria 1"],
        ["Período", "16/10/2026 00:00:00 a 16/10/2026 23:59:59"],
        ["Responsável técnico", NOME_ADMIN_PADRAO],
        ["Faixa de temperatura", "2,0 a 8,5 °C"],
        ["Faixa de umidade", "sem limite"],
        [],
        COLUNAS_DO_CSV,
        # 12:00 UTC é 09:00 em Brasília. O pendente sai sem atendimento.
        [
            "16/10/2026 09:00:00",
            "Temperatura acima da faixa",
            str(sensor.id),
            "9,1",
            "61,5",
            "Pendente",
            "",
            "",
            "",
            "",
        ],
        [
            "16/10/2026 09:10:00",
            "Umidade acima da faixa",
            str(sensor.id),
            "9,1",
            "61,5",
            "Encerrado",
            NOME_ADMIN_PADRAO,
            "16/10/2026 09:11:00",
            "Porta da câmara fechada",
            "16/10/2026 09:20:00",
        ],
    ]


def test_reconhecido_sai_sem_acao(client, sala, criar, usuario):
    criar(0, "reconhecido", reconhecido_por=usuario, reconhecido_em=minutos(1))

    *_, linha = linhas(pedir(client, sala.id))

    assert linha[5:] == [
        "Reconhecido",
        NOME_ADMIN_PADRAO,
        "16/10/2026 09:01:00",
        "",
        "",
    ]


def test_periodo_sem_alertas_gera_cabecalho_e_tabela_vazia(client, sala):
    resposta = pedir(client, sala.id)
    assert resposta.status_code == 200
    assert linhas(resposta)[-1] == COLUNAS_DO_CSV


@pytest.mark.parametrize("inicio", ["=", "+", "-", "@", "\t", "\r"])
def test_acao_e_nome_que_comecam_como_formula_ganham_apostrofo(
    client, sessao, sala, criar, usuario, inicio
):
    usuario.nome = f"{inicio}Ana"
    criar(
        0,
        "encerrado",
        reconhecido_por=usuario,
        reconhecido_em=minutos(1),
        acao_corretiva=f"{inicio}SOMA(1)",
        encerrado_em=minutos(2),
    )

    *_, linha = linhas(pedir(client, sala.id))

    assert linha[6] == f"'{inicio}Ana"
    assert linha[8] == f"'{inicio}SOMA(1)"


@pytest.mark.parametrize(
    "query",
    [
        {"inicio": "2026-10-16T00:00:00"},
        {"fim": "2026-10-16T23:59:59"},
        {"inicio": "2026-10-17T00:00:00-03:00"},
        {"formato": "xlsx"},
        {"formato": "doc"},
    ],
)
def test_pedido_invalido_responde_422(client, sala, query):
    assert pedir(client, sala.id, **query).status_code == 422


@pytest.mark.parametrize("sala_id", [999999, 2**40])
def test_sala_que_nao_existe(client, sala_id):
    esperado = 404 if sala_id < 2**31 else 422
    assert pedir(client, sala_id).status_code == esperado


def test_rota_exige_login(cliente_anonimo, sala):
    assert pedir(cliente_anonimo, sala.id).status_code == 401


# Rota, em PDF


def paginas(conteudo: bytes) -> list[str]:
    """O texto de cada página, com os espaços e quebras de linha juntados em um só."""
    leitor = PdfReader(io.BytesIO(conteudo))
    return [" ".join(pagina.extract_text().split()) for pagina in leitor.pages]


def test_pdf_traz_o_cabecalho_dos_relatorios_e_cada_alerta(
    client, sala, sensor, criar, usuario
):
    criar(0)
    criar(
        10,
        "encerrado",
        tipo="umidade_acima",
        reconhecido_por=usuario,
        reconhecido_em=minutos(11),
        acao_corretiva="Porta da câmara fechada",
        encerrado_em=minutos(20),
    )

    resposta = pedir(client, sala.id, formato="pdf")

    assert resposta.status_code == 200
    assert resposta.headers["content-type"] == "application/pdf"
    assert resposta.headers["content-disposition"] == (
        f'attachment; filename="relatorio-alertas-sala-{sala.id}-20261016-20261016.pdf"'
    )
    (texto,) = paginas(resposta.content)
    assert texto.startswith("Registro de alertas e ações corretivas")
    for trecho in [
        "Estabelecimento: Hospital Central",
        "Sala: Câmara fria 1",
        "Período: 16/10/2026 00:00:00 a 16/10/2026 23:59:59 (horário de Brasília)",
        f"Responsável técnico: {NOME_ADMIN_PADRAO}",
        "Faixa de temperatura: 2,0000 a 8,5000 °C",
        # Cada alerta: o título com o desvio, o sensor e a abertura, e o atendimento.
        (
            f"Temperatura acima da faixa · Sensor {sensor.id} · aberto em "
            "16/10/2026 09:00:00"
        ),
        "Leitura 9,1000 °C · 61,5000 % Situação Pendente",
        f"Umidade acima da faixa · Sensor {sensor.id} · aberto em 16/10/2026 09:10:00",
        "Situação Encerrado",
        f"Reconhecido por {NOME_ADMIN_PADRAO} em 16/10/2026 09:11:00",
        "Ação corretiva Porta da câmara fechada",
        "Encerrado em 16/10/2026 09:20:00",
        # O mesmo campo de assinatura do registro de leituras.
        "Registro profissional (conselho e número)",
    ]:
        assert trecho in texto


def test_pdf_sem_alertas_avisa_na_tabela(client, sala):
    resposta = pedir(client, sala.id, formato="pdf")
    assert resposta.status_code == 200
    (texto,) = paginas(resposta.content)
    assert "Nenhum alerta no período." in texto


def test_pdf_quebra_a_acao_longa_em_linhas_sem_perder_nada(
    client, sala, criar, usuario
):
    acao = " ".join(f"passo{n}" for n in range(300))
    criar(
        0,
        "encerrado",
        reconhecido_por=usuario,
        reconhecido_em=minutos(1),
        acao_corretiva=acao,
        encerrado_em=minutos(2),
    )

    resposta = pedir(client, sala.id, formato="pdf")

    assert resposta.status_code == 200
    texto = " ".join(paginas(resposta.content))
    # Toda a ação sai, na ordem, mesmo que a página quebre no meio dela.
    assert re.findall(r"passo\d+", texto) == acao.split()


def test_cada_linha_do_alerta_cabe_na_coluna():
    acao = "Porta fechada " * 60 + "x" * 400
    alerta = LinhaDeAlerta(
        aberto_em=BASE,
        tipo="temperatura_acima",
        sensor_id=1,
        temperatura=9.1,
        umidade=61.5,
        situacao="encerrado",
        reconhecido_por="Ana " * 80,
        reconhecido_em=BASE,
        acao_corretiva=acao,
        encerrado_em=BASE,
    )

    grupo = _grupo_do_alerta(alerta)

    for coluna in COLUNAS_DOS_ALERTAS:
        largura = coluna.largura * LARGURA_UTIL - 2 * FOLGA
        indice = COLUNAS_DOS_ALERTAS.index(coluna)
        for linha in grupo.linhas:
            assert stringWidth(linha[indice], FONTE, TAMANHO) <= largura
    # As linhas de continuação deixam o rótulo vazio e, juntas, trazem a ação toda.
    inicio = next(
        i for i, linha in enumerate(grupo.linhas) if linha[0] == "Ação corretiva"
    )
    fim = next(i for i, linha in enumerate(grupo.linhas) if linha[0] == "Encerrado em")
    trechos = grupo.linhas[inicio:fim]
    assert all(linha[0] == "" for linha in trechos[1:])
    assert "".join(linha[1] for linha in trechos).replace(" ", "") == acao.replace(
        " ", ""
    )


def encerrado(**campos):
    return LinhaDeAlerta(
        **{
            "aberto_em": BASE,
            "tipo": "temperatura_acima",
            "sensor_id": 1,
            "temperatura": 9.1,
            "umidade": 61.5,
            "situacao": "encerrado",
            "reconhecido_por": "Ana",
            "reconhecido_em": BASE,
            "acao_corretiva": "Porta fechada",
            "encerrado_em": BASE,
            **campos,
        }
    )


def test_acao_em_paragrafos_mantem_as_linhas_em_branco():
    _, valor = COLUNAS_DOS_ALERTAS
    assert linhas_da_celula("Porta fechada.\n\nTermômetro trocado.", valor) == [
        "Porta fechada.",
        "",
        "Termômetro trocado.",
    ]


def test_reconhecimento_sem_hora_sai_so_com_o_nome():
    grupo = _grupo_do_alerta(encerrado(reconhecido_em=None))
    assert ["Reconhecido por", "Ana"] in grupo.linhas


def test_pdf_de_alertas_divide_a_fila_com_o_de_leituras(monkeypatch):
    leituras = ExportadorPDF()
    alertas = ExportadorDeAlertasPDF(leituras)
    # Sem esperar a vez de montar, para ocupar a fila toda nesta mesma thread.
    monkeypatch.setattr(leituras, "_vagas", nullcontext())

    with ExitStack() as pedidos:
        for _ in range(PDFS_SIMULTANEOS + PDFS_NA_FILA):
            pedidos.enter_context(leituras.vaga())
        with pytest.raises(SemVaga), alertas.vaga():
            pass
