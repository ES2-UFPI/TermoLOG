"""Situações do alerta (State, arquitetura 4.2).

Cada situação sabe que ações aceita e para qual situação o alerta vai. Ação que a
situação não aceita levanta TransicaoInvalida, que a rota responde com 409. O banco
guarda a situação como texto, e ``SITUACOES`` escolhe a classe pelo valor.
"""

from datetime import datetime

from alertas.models import Alerta, Situacao
from usuarios.models import Usuario


class TransicaoInvalida(Exception):
    """Ação que a situação atual do alerta não aceita (a rota responde 409)."""


class SituacaoDoAlerta:
    def reconhecer(self, alerta: Alerta, usuario: Usuario, agora: datetime) -> None:
        raise TransicaoInvalida("alerta não está pendente")


class Pendente(SituacaoDoAlerta):
    def reconhecer(self, alerta: Alerta, usuario: Usuario, agora: datetime) -> None:
        alerta.reconhecido_por = usuario
        alerta.reconhecido_em = agora
        alerta.situacao = "reconhecido"


# O encerramento (US26, #102) entra nas duas classes abaixo.
class Reconhecido(SituacaoDoAlerta):
    pass


class Encerrado(SituacaoDoAlerta):
    pass


SITUACOES: dict[Situacao, SituacaoDoAlerta] = {
    "pendente": Pendente(),
    "reconhecido": Reconhecido(),
    "encerrado": Encerrado(),
}
