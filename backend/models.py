"""Importa todos os modelos para registrá-los no metadata (usado pelo Alembic)."""

from alertas.models import Alerta
from auth.models import AcessoNegado, SessaoDeLogin, TentativaDeLogin
from gateways.models import Gateway
from leituras.models import Leitura, Lote
from notificacoes.models import CanalDoUsuario, EnvioDeNotificacao
from salas.models import Sala
from sensores.models import Sensor
from usuarios.models import Usuario

__all__ = [
    "AcessoNegado",
    "Alerta",
    "CanalDoUsuario",
    "EnvioDeNotificacao",
    "Gateway",
    "Leitura",
    "Lote",
    "Sala",
    "Sensor",
    "SessaoDeLogin",
    "TentativaDeLogin",
    "Usuario",
]
