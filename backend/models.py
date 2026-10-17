"""Importa todos os modelos para registrá-los no metadata (usado pelo Alembic)."""

from leituras.models import Leitura
from salas.models import Sala
from sensores.models import Sensor

__all__ = ["Leitura", "Sala", "Sensor"]
