"""Envio dos alertas pelos canais dos usuários (US17, #115). Precisa de PostgreSQL."""

import io
import json
import logging
import smtplib
import ssl
import urllib.error
import urllib.request
from datetime import UTC, datetime
from typing import ClassVar

import pytest
from sqlalchemy import create_engine, select

from alertas.models import Alerta
from alertas.router import alerta_service
from alertas.service import AlertaService
from database import database_url
from leituras.models import Leitura
from notificacoes.canais import CanalEmail, CanalNotificacao, CanalTelegram
from notificacoes.models import CanalDoUsuario, EnvioDeNotificacao
from notificacoes.service import NotificacaoService
from salas.models import Sala
from sensores.service import SensorService
from usuarios.models import Usuario

AGORA = datetime(2026, 11, 10, 17, 30, tzinfo=UTC)


class CanalFalso(CanalNotificacao):
    def __init__(self):
        self.enviados = []

    def enviar(self, canal, alerta):
        self.enviados.append((canal.destino, alerta.id))


class CanalQueFalha(CanalNotificacao):
    def enviar(self, canal, alerta):
        raise ConnectionError("servidor SMTP fora do ar")


@pytest.fixture
def sala(sessao):
    sala = Sala(nome="Câmara fria 1", temperatura_max=8.0)
    sessao.add(sala)
    sessao.flush()
    return sala


@pytest.fixture
def leitura(sessao, sala, gateway):
    sensor = SensorService(sessao).cadastrar(sala.id, gateway.id)
    leitura = Leitura(
        sensor_id=sensor.id,
        sala_id=sala.id,
        temperatura=9.1,
        umidade=61.0,
        data_hora=AGORA,
        dentro_da_faixa=False,
    )
    sessao.add(leitura)
    sessao.flush()
    return leitura


@pytest.fixture
def alerta(sessao, sala, leitura):
    """Alerta aberto e gravado, como chega ao observador."""
    AlertaService(sessao).abrir(leitura, sala, ["temperatura_acima"], AGORA)
    sessao.commit()
    return sessao.scalar(select(Alerta))


def canal(sessao, usuario, tipo="email", destino="ana@exemplo.com", **campos):
    sessao.add(
        CanalDoUsuario(usuario_id=usuario.id, tipo=tipo, destino=destino, **campos)
    )
    sessao.flush()


def envios(sessao):
    sessao.expire_all()
    return list(
        sessao.scalars(select(EnvioDeNotificacao).order_by(EnvioDeNotificacao.id))
    )


def test_envia_o_alerta_pelos_canais_ativos_e_registra(sessao, usuario, alerta):
    canal(sessao, usuario, "email", "ana@exemplo.com")
    outra = Usuario(nome="Bia", email="bia@exemplo.com", senha_hash="x")
    sessao.add(outra)
    sessao.flush()
    canal(sessao, outra, "email", "bia@exemplo.com")
    canal(sessao, outra, "email", "desligado@exemplo.com", ativo=False)
    email = CanalFalso()

    NotificacaoService({"email": email}).alerta_aberto(alerta, sessao)
    sessao.commit()

    assert email.enviados == [
        ("ana@exemplo.com", alerta.id),
        ("bia@exemplo.com", alerta.id),
    ]
    assert [(e.tipo, e.destino, e.sucesso, e.erro) for e in envios(sessao)] == [
        ("email", "ana@exemplo.com", True, None),
        ("email", "bia@exemplo.com", True, None),
    ]
    assert all(e.alerta_id == alerta.id and e.enviado_em for e in envios(sessao))


def test_canal_que_falha_nao_impede_os_outros_e_fica_registrado(
    sessao, usuario, alerta, caplog
):
    canal(sessao, usuario, "email", "ana@exemplo.com")
    canal(sessao, usuario, "telegram", "123456")
    telegram = CanalFalso()
    servico = NotificacaoService({"email": CanalQueFalha(), "telegram": telegram})

    with caplog.at_level(logging.ERROR):
        servico.alerta_aberto(alerta, sessao)
    sessao.commit()

    assert telegram.enviados == [("123456", alerta.id)]
    falha, ok = envios(sessao)
    assert (falha.tipo, falha.sucesso) == ("email", False)
    assert falha.erro == "ConnectionError: servidor SMTP fora do ar"
    assert (ok.tipo, ok.sucesso, ok.erro) == ("telegram", True, None)
    assert "falha ao enviar o alerta" in caplog.text


def test_canal_sem_envio_implementado_fica_registrado_como_erro(
    sessao, usuario, alerta
):
    canal(
        sessao,
        usuario,
        "push",
        "https://push.exemplo.com/abc",
        chaves_push={"p256dh": "x", "auth": "y"},
    )

    NotificacaoService({}).alerta_aberto(alerta, sessao)
    sessao.commit()

    (envio,) = envios(sessao)
    assert not envio.sucesso
    assert "sem envio implementado" in envio.erro


def test_canal_sem_envio_implementado_avisa_sem_traceback(
    sessao, usuario, alerta, caplog
):
    canal(
        sessao,
        usuario,
        "push",
        "https://push.exemplo.com/abc",
        chaves_push={"p256dh": "x", "auth": "y"},
    )

    with caplog.at_level(logging.WARNING):
        NotificacaoService({}).alerta_aberto(alerta, sessao)

    (registro,) = caplog.records
    assert registro.levelno == logging.WARNING
    assert registro.exc_info is None
    assert "sem envio implementado" in registro.getMessage()


class CanalQueInterrompe(CanalNotificacao):
    def enviar(self, canal, alerta):
        raise SystemExit("processo caiu no meio do envio")


def test_envio_ja_feito_fica_registrado_mesmo_se_o_processo_cair_no_canal_seguinte(
    sessao, usuario, alerta
):
    canal(sessao, usuario, "email", "ana@exemplo.com")
    canal(sessao, usuario, "telegram", "123456")
    sessao.commit()
    servico = NotificacaoService(
        {"email": CanalFalso(), "telegram": CanalQueInterrompe()}
    )

    with pytest.raises(SystemExit):
        servico.alerta_aberto(alerta, sessao)

    # Outra conexão só vê o registro se ele foi commitado, e não só gravado na sessão.
    engine = create_engine(database_url())
    with engine.connect() as conexao:
        linhas = conexao.execute(
            select(EnvioDeNotificacao.tipo, EnvioDeNotificacao.sucesso)
        ).all()
    engine.dispose()
    assert linhas == [("email", True)]


def test_o_aviso_do_alerta_novo_envia_pelo_canal_depois_do_commit(
    sessao, usuario, sala, leitura
):
    """Observer e Strategy juntos: o AlertaService.avisar() chama o NotificacaoService."""
    canal(sessao, usuario)
    email = CanalFalso()
    alertas = AlertaService(sessao)
    alertas.inscrever(NotificacaoService({"email": email}))

    alertas.abrir(leitura, sala, ["temperatura_acima"], AGORA)
    assert email.enviados == []  # ainda não avisou: a transação pode ser desfeita
    sessao.commit()
    alertas.avisar()

    assert len(email.enviados) == 1
    assert [e.sucesso for e in envios(sessao)] == [True]


def test_o_servico_de_alertas_da_aplicacao_ja_vem_com_as_notificacoes(sessao):
    (observador,) = alerta_service(sessao).observadores

    assert isinstance(observador, NotificacaoService)
    assert isinstance(observador.canais["email"], CanalEmail)
    assert isinstance(observador.canais["telegram"], CanalTelegram)


class SMTPFalso:
    """Guarda o que o CanalEmail faria no servidor SMTP."""

    instancias: ClassVar[list] = []

    def __init__(self, host, porta, timeout):
        self.chamadas = [("conectar", host, porta, timeout)]
        self.mensagem = None
        SMTPFalso.instancias.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *erro):
        return False

    def starttls(self, context=None):
        self.chamadas.append(("starttls",))
        self.contexto_tls = context

    def login(self, usuario, senha):
        self.chamadas.append(("login", usuario, senha))

    def send_message(self, mensagem):
        self.mensagem = mensagem


@pytest.fixture
def smtp(monkeypatch):
    SMTPFalso.instancias = []
    monkeypatch.setattr(smtplib, "SMTP", SMTPFalso)
    for nome in (
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USUARIO",
        "SMTP_SENHA",
        "SMTP_REMETENTE",
        "SMTP_STARTTLS",
    ):
        monkeypatch.delenv(nome, raising=False)
    return monkeypatch


def test_email_leva_sala_sensor_leitura_e_horario(smtp, sessao, usuario, alerta):
    smtp.setenv("SMTP_HOST", "mailpit")
    smtp.setenv("SMTP_PORT", "1025")
    smtp.setenv("SMTP_STARTTLS", "false")
    smtp.setenv("SMTP_REMETENTE", "alertas@termolog.test")
    canal(sessao, usuario, "email", "ana@exemplo.com")

    CanalEmail().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)

    (conexao,) = SMTPFalso.instancias
    assert conexao.chamadas == [("conectar", "mailpit", 1025, 10)]
    mensagem = conexao.mensagem
    assert mensagem["To"] == "ana@exemplo.com"
    assert mensagem["From"] == "alertas@termolog.test"
    assert (
        mensagem["Subject"] == "TermoLOG: Temperatura acima da faixa em Câmara fria 1"
    )
    corpo = mensagem.get_content()
    assert "9.1 °C" in corpo
    assert f"Sensor: {alerta.sensor_id}" in corpo
    assert "10/11/2026 14:30:00" in corpo  # 17:30 UTC no horário de Brasília


def test_email_usa_tls_e_login_quando_configurados(smtp, sessao, usuario, alerta):
    smtp.setenv("SMTP_HOST", "smtp.exemplo.com")
    smtp.setenv("SMTP_USUARIO", "termolog")
    smtp.setenv("SMTP_SENHA", "segredo")
    canal(sessao, usuario)

    CanalEmail().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)

    (conexao,) = SMTPFalso.instancias
    assert conexao.chamadas == [
        ("conectar", "smtp.exemplo.com", 587, 10),
        ("starttls",),
        ("login", "termolog", "segredo"),
    ]
    # Verifica o certificado do servidor (o padrão do starttls sem contexto não verifica).
    contexto = conexao.contexto_tls
    assert isinstance(contexto, ssl.SSLContext)
    assert contexto.verify_mode == ssl.CERT_REQUIRED and contexto.check_hostname
    # "termolog" não é um endereço de e-mail: não serve de remetente.
    assert conexao.mensagem["From"] == "termolog@localhost"


def test_email_usa_o_usuario_do_login_como_remetente_se_for_um_endereco(
    smtp, sessao, usuario, alerta
):
    smtp.setenv("SMTP_HOST", "smtp.exemplo.com")
    smtp.setenv("SMTP_USUARIO", "alertas@exemplo.com")
    canal(sessao, usuario)

    CanalEmail().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)

    assert SMTPFalso.instancias[0].mensagem["From"] == "alertas@exemplo.com"


def test_nome_de_sala_com_quebra_de_linha_nao_derruba_o_email(
    smtp, sessao, usuario, alerta
):
    smtp.setenv("SMTP_HOST", "mailpit")
    smtp.setenv("SMTP_STARTTLS", "false")
    alerta.sala.nome = "Câmara\nfria\r\n1"
    canal(sessao, usuario)

    CanalEmail().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)

    mensagem = SMTPFalso.instancias[0].mensagem
    assert (
        mensagem["Subject"] == "TermoLOG: Temperatura acima da faixa em Câmara fria 1"
    )
    assert "\n" not in mensagem["Subject"]


def test_email_sem_servidor_configurado_levanta_erro(smtp, sessao, usuario, alerta):
    canal(sessao, usuario)

    with pytest.raises(RuntimeError, match="SMTP_HOST"):
        CanalEmail().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)
    assert SMTPFalso.instancias == []


TOKEN = "123456:ABC-token-secreto"


class RespostaFalsa:
    def __init__(self, corpo):
        self.corpo = json.dumps(corpo).encode()

    def __enter__(self):
        return self

    def __exit__(self, *erro):
        return False

    def read(self, *args):
        return self.corpo


@pytest.fixture
def telegram(monkeypatch):
    """Troca o urlopen: guarda as requisições e devolve (ou levanta) o combinado."""

    class Api:
        requisicoes: ClassVar[list] = []
        resposta: ClassVar[dict] = {"ok": True, "result": {"message_id": 1}}
        erro = None

    Api.requisicoes = []

    def urlopen(requisicao, timeout):
        Api.requisicoes.append((requisicao, timeout))
        if Api.erro:
            raise Api.erro
        return RespostaFalsa(Api.resposta)

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    return Api


def test_telegram_leva_sala_sensor_leitura_e_horario(telegram, sessao, usuario, alerta):
    canal(sessao, usuario, "telegram", "-1001234567890")

    CanalTelegram().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)

    ((requisicao, timeout),) = telegram.requisicoes
    assert requisicao.full_url == f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    assert requisicao.get_method() == "POST"
    assert timeout == 10
    corpo = json.loads(requisicao.data)
    assert corpo["chat_id"] == "-1001234567890"  # texto, como no contrato
    assert "Temperatura acima da faixa em Câmara fria 1" in corpo["text"]
    assert "Sala: Câmara fria 1" in corpo["text"]
    assert f"Sensor: {alerta.sensor_id}" in corpo["text"]
    assert "9.1 °C" in corpo["text"]
    assert "10/11/2026 14:30:00" in corpo["text"]  # 17:30 UTC no horário de Brasília
    assert "parse_mode" not in corpo  # texto puro: o nome da sala não quebra a mensagem


def test_telegram_sem_token_levanta_erro_sem_chamar_a_api(
    telegram, monkeypatch, sessao, usuario, alerta
):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN")
    canal(sessao, usuario, "telegram", "123456")

    with pytest.raises(RuntimeError, match="TELEGRAM_BOT_TOKEN"):
        CanalTelegram().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)
    assert telegram.requisicoes == []


def test_telegram_erro_da_api_levanta_com_o_motivo_e_sem_o_token(
    telegram, sessao, usuario, alerta
):
    telegram.erro = urllib.error.HTTPError(
        f"https://api.telegram.org/bot{TOKEN}/sendMessage",
        400,
        "Bad Request",
        {},
        io.BytesIO(
            json.dumps(
                {"ok": False, "description": "Bad Request: chat not found"}
            ).encode()
        ),
    )
    canal(sessao, usuario, "telegram", "123456")

    with pytest.raises(RuntimeError, match="400.*chat not found") as erro:
        CanalTelegram().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)
    assert TOKEN not in str(erro.value)
    assert erro.value.__cause__ is None and erro.value.__suppress_context__


def test_telegram_fora_do_ar_levanta_erro_sem_o_token(
    telegram, sessao, usuario, alerta
):
    telegram.erro = urllib.error.URLError(f"timeout em /bot{TOKEN}/sendMessage")
    canal(sessao, usuario, "telegram", "123456")

    with pytest.raises(RuntimeError, match="URLError") as erro:
        CanalTelegram().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)
    assert TOKEN not in str(erro.value)


def test_telegram_resposta_sem_ok_levanta_erro(telegram, sessao, usuario, alerta):
    telegram.resposta = {"ok": False, "description": "Forbidden: bot was blocked"}
    canal(sessao, usuario, "telegram", "123456")

    with pytest.raises(RuntimeError, match="bot was blocked"):
        CanalTelegram().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)


def test_falha_do_telegram_fica_registrada_e_nao_afeta_o_email(
    telegram, sessao, usuario, alerta
):
    telegram.erro = urllib.error.URLError("sem rede")
    canal(sessao, usuario, "telegram", "123456")
    canal(sessao, usuario, "email", "ana@exemplo.com")
    email = CanalFalso()

    NotificacaoService({"telegram": CanalTelegram(), "email": email}).alerta_aberto(
        alerta, sessao
    )

    assert email.enviados == [("ana@exemplo.com", alerta.id)]
    falhou, ok = envios(sessao)
    assert (falhou.tipo, falhou.destino, falhou.sucesso) == (
        "telegram",
        "123456",
        False,
    )
    assert "URLError" in falhou.erro and TOKEN not in falhou.erro
    assert (ok.tipo, ok.sucesso, ok.erro) == ("email", True, None)


def test_alerta_chega_no_chat_do_usuario_com_telegram_configurado(
    telegram, sessao, usuario, alerta
):
    canal(sessao, usuario, "telegram", "123456")
    canal(sessao, usuario, "telegram", "987654", ativo=False)

    NotificacaoService({"telegram": CanalTelegram()}).alerta_aberto(alerta, sessao)

    ((requisicao, _),) = telegram.requisicoes  # o canal inativo não recebe
    assert json.loads(requisicao.data)["chat_id"] == "123456"
    (envio,) = envios(sessao)
    assert (envio.tipo, envio.destino, envio.sucesso) == ("telegram", "123456", True)


def test_telegram_token_com_quebra_de_linha_nao_vaza_no_erro(
    monkeypatch, sessao, usuario, alerta, caplog
):
    """Sem o urlopen simulado: a URL com o \\n é recusada antes de qualquer rede."""
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", f"{TOKEN}\n")
    canal(sessao, usuario, "telegram", "123456")

    NotificacaoService({"telegram": CanalTelegram()}).alerta_aberto(alerta, sessao)

    (envio,) = envios(sessao)
    # Com o strip a requisição sai (e falha na rede de teste ou na API): em qualquer
    # caso, o token não pode aparecer no registro nem no log.
    assert TOKEN not in (envio.erro or "")
    assert TOKEN not in caplog.text


def test_telegram_url_recusada_levanta_erro_sem_o_token(
    telegram, sessao, usuario, alerta
):
    import http.client

    telegram.erro = http.client.InvalidURL(f"/bot{TOKEN}\n/sendMessage")
    canal(sessao, usuario, "telegram", "123456")

    with pytest.raises(RuntimeError, match="InvalidURL") as erro:
        CanalTelegram().enviar(sessao.scalar(select(CanalDoUsuario)), alerta)
    assert TOKEN not in str(erro.value)
