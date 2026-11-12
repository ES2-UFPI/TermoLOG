import json
import os
import smtplib
import ssl
import urllib.error
import urllib.request
from abc import ABC, abstractmethod
from email.message import EmailMessage

from alertas.models import Alerta
from notificacoes.models import CanalDoUsuario
from relatorios.service import BRASILIA

# Espera máxima do servidor SMTP: um servidor travado não segura o envio para sempre.
TIMEOUT_SMTP_S = 10
# Idem para a API do Telegram.
TIMEOUT_TELEGRAM_S = 10
URL_TELEGRAM = "https://api.telegram.org"

DESVIOS = {
    "temperatura_acima": "Temperatura acima da faixa",
    "temperatura_abaixo": "Temperatura abaixo da faixa",
    "umidade_acima": "Umidade acima da faixa",
    "umidade_abaixo": "Umidade abaixo da faixa",
}


def texto_do_alerta(alerta: Alerta) -> tuple[str, str]:
    """Título e corpo do aviso: sala, sensor, leitura e horário. Todo canal usa."""
    leitura = alerta.leitura
    # O nome da sala vem de cadastro: uma quebra de linha nele derrubaria o assunto do
    # e-mail (cabeçalho não aceita quebra), então o título sai numa linha só.
    titulo = " ".join(f"TermoLOG: {DESVIOS[alerta.tipo]} em {alerta.sala.nome}".split())
    corpo = (
        f"{DESVIOS[alerta.tipo]}.\n"
        f"Sala: {alerta.sala.nome}\n"
        f"Sensor: {alerta.sensor_id}\n"
        f"Leitura: {leitura.temperatura:.1f} °C e {leitura.umidade:.1f} % de umidade\n"
        f"Medida em: {leitura.data_hora.astimezone(BRASILIA):%d/%m/%Y %H:%M:%S}"
        " (horário de Brasília)\n"
    )
    return titulo, corpo


class CanalNotificacao(ABC):
    """Um jeito de avisar o usuário de um alerta (Strategy, arquitetura 4.1).

    Quem envia só conhece esta interface. Falhou, levanta exceção: quem chama
    registra o erro e segue para o próximo canal.
    """

    @abstractmethod
    def enviar(self, canal: CanalDoUsuario, alerta: Alerta) -> None: ...


class CanalEmail(CanalNotificacao):
    """Envio por SMTP, configurado por variáveis de ambiente (lidas a cada envio).

    SMTP_HOST (obrigatória), SMTP_PORT (587), SMTP_USUARIO e SMTP_SENHA (sem
    usuário, não há login), SMTP_REMETENTE e SMTP_STARTTLS (ligado; "false" o desliga,
    como no Mailpit de desenvolvimento).

    O STARTTLS confere o certificado do servidor. Com ele desligado e usuário definido,
    a senha vai em texto puro: só para o Mailpit local. O SSL implícito (porta 465) não
    é suportado: use a 587 com STARTTLS.
    """

    def enviar(self, canal: CanalDoUsuario, alerta: Alerta) -> None:
        host = os.getenv("SMTP_HOST")
        if not host:
            raise RuntimeError("SMTP_HOST não configurado")
        usuario = os.getenv("SMTP_USUARIO")
        titulo, corpo = texto_do_alerta(alerta)
        mensagem = EmailMessage()
        mensagem["Subject"] = titulo
        # O usuário do login só serve de remetente se for um endereço de e-mail.
        mensagem["From"] = (
            os.getenv("SMTP_REMETENTE")
            or (usuario if usuario and "@" in usuario else None)
            or "termolog@localhost"
        )
        mensagem["To"] = canal.destino
        mensagem.set_content(corpo)
        with smtplib.SMTP(
            host, int(os.getenv("SMTP_PORT", "587")), timeout=TIMEOUT_SMTP_S
        ) as smtp:
            if os.getenv("SMTP_STARTTLS", "true").lower() not in ("0", "false"):
                smtp.starttls(context=ssl.create_default_context())
            if usuario:
                smtp.login(usuario, os.getenv("SMTP_SENHA", ""))
            smtp.send_message(mensagem)


class CanalTelegram(CanalNotificacao):
    """Envio pelo bot do Telegram (Bot API, ``sendMessage``).

    O token do bot vem de TELEGRAM_BOT_TOKEN, lido a cada envio. O destino do canal é
    o chat_id do usuário (ou do grupo), que só recebe mensagens depois de ter enviado
    ``/start`` ao bot (o vínculo por link, em ``telegram_bot``, já faz isso). A
    mensagem sai como texto puro, sem formatação.

    O token faz parte da URL da API, então nenhuma exceção levantada aqui o carrega:
    o erro vai para o registro de envios e para o log.
    """

    def enviar(self, canal: CanalDoUsuario, alerta: Alerta) -> None:
        titulo, corpo = texto_do_alerta(alerta)
        enviar_mensagem_telegram(canal.destino, f"{titulo}\n\n{corpo}")


def enviar_mensagem_telegram(chat_id: str, texto: str) -> None:
    """Manda ``texto`` ao chat pelo bot. Falhou, levanta RuntimeError sem o token.

    Serve ao alerta (CanalTelegram) e à resposta do bot no vínculo do chat.
    """
    chamar_api_telegram("sendMessage", {"chat_id": chat_id, "text": texto})


def chamar_api_telegram(
    metodo: str, dados: dict, timeout: float = TIMEOUT_TELEGRAM_S
) -> dict:
    """Chama um método da Bot API e devolve a resposta (``{"ok": true, "result": ...}``).

    Falhou, levanta RuntimeError: nenhuma mensagem de erro carrega o token, que faz
    parte da URL.
    """
    token = (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        raise RuntimeError("TELEGRAM_BOT_TOKEN não configurado")
    requisicao = urllib.request.Request(
        f"{URL_TELEGRAM}/bot{token}/{metodo}",
        data=json.dumps(dados).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(requisicao, timeout=timeout) as resposta:
            resultado = json.load(resposta)
    except urllib.error.HTTPError as erro:
        # A API explica o motivo no corpo (chat não encontrado, bot bloqueado...).
        raise RuntimeError(
            f"API do Telegram respondeu {erro.code}: {_descricao_do_erro(erro)}"
        ) from None
    except Exception as erro:  # noqa: BLE001
        # Rede fora do ar, timeout, resposta que não é JSON, URL recusada... Só o
        # tipo vai adiante: a mensagem de algumas dessas exceções traz a URL, e o
        # token faz parte dela.
        raise RuntimeError(
            f"falha ao chamar a API do Telegram: {type(erro).__name__}"
        ) from None
    if not isinstance(resultado, dict) or not resultado.get("ok"):
        descricao = (
            resultado.get("description") if isinstance(resultado, dict) else None
        )
        raise RuntimeError(f"API do Telegram recusou a chamada: {descricao}")
    return resultado


def _descricao_do_erro(erro: urllib.error.HTTPError) -> str:
    try:
        return json.load(erro).get("description") or erro.reason
    except Exception:  # noqa: BLE001
        # Corpo ilegível ou cortado: o código HTTP já diz o essencial.
        return str(erro.reason)
