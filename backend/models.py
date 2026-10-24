"""Importa todos os modelos para registrá-los no metadata (usado pelo Alembic)."""

from alertas.models import Alerta
from gateways.models import Gateway
from leituras.models import Leitura, Lote
from salas.models import Sala
from sensores.models import Sensor

__all__ = ["Alerta", "Gateway", "Leitura", "Lote", "Sala", "Sensor"]
