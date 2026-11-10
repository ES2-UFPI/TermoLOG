import os
import smtplib
from abc import ABC, abstractmethod
from email.message import EmailMessage

from alertas.models import Alerta
from notificacoes.models import CanalDoUsuario
from relatorios.service import BRASILIA

# Espera máxima do servidor SMTP: um servidor travado não segura o envio para sempre.
TIMEOUT_SMTP_S = 10

DESVIOS = {
    "temperatura_acima": "Temperatura acima da faixa",
    "temperatura_abaixo": "Temperatura abaixo da faixa",
    "umidade_acima": "Umidade acima da faixa",
    "umidade_abaixo": "Umidade abaixo da faixa",
}


def texto_do_alerta(alerta: Alerta) -> tuple[str, str]:
    """Título e corpo do aviso: sala, sensor, leitura e horário. Todo canal usa."""
    leitura = alerta.leitura
    titulo = f"TermoLOG: {DESVIOS[alerta.tipo]} em {alerta.sala.nome}"
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
    """

    def enviar(self, canal: CanalDoUsuario, alerta: Alerta) -> None:
        host = os.getenv("SMTP_HOST")
        if not host:
            raise RuntimeError("SMTP_HOST não configurado")
        usuario = os.getenv("SMTP_USUARIO")
        titulo, corpo = texto_do_alerta(alerta)
        mensagem = EmailMessage()
        mensagem["Subject"] = titulo
        mensagem["From"] = (
            os.getenv("SMTP_REMETENTE") or usuario or "termolog@localhost"
        )
        mensagem["To"] = canal.destino
        mensagem.set_content(corpo)
        with smtplib.SMTP(
            host, int(os.getenv("SMTP_PORT", "587")), timeout=TIMEOUT_SMTP_S
        ) as smtp:
            if os.getenv("SMTP_STARTTLS", "true").lower() not in ("0", "false"):
                smtp.starttls()
            if usuario:
                smtp.login(usuario, os.getenv("SMTP_SENHA", ""))
            smtp.send_message(mensagem)
