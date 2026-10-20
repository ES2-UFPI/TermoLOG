import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from gateways.models import Gateway

# Sem contato há mais que isso, o gateway é considerado offline. O heartbeat vem a
# cada 60 s, então 3 min toleram duas perdas seguidas.
TEMPO_ATE_FICAR_OFFLINE = timedelta(minutes=3)


class GatewayNaoEncontrado(Exception):
    pass


class CredencialInvalida(Exception):
    pass


def hash_da_chave(chave_api: str) -> str:
    # A chave é aleatória e longa (não é uma senha escolhida por alguém), então um
    # SHA-256 sem salt basta e permite buscar o gateway direto pelo hash.
    return hashlib.sha256(chave_api.encode()).hexdigest()


class GatewayService:
    """Regras de negócio dos gateways. A transação (commit) é de quem chama."""

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def cadastrar(self, nome: str) -> tuple[Gateway, str]:
        """Cadastra o gateway e devolve a chave de API, que não fica guardada."""
        chave_api = secrets.token_urlsafe(32)
        gateway = Gateway(nome=nome, chave_api_hash=hash_da_chave(chave_api))
        self.sessao.add(gateway)
        self.sessao.flush()
        return gateway, chave_api

    def listar(self) -> list[Gateway]:
        return list(self.sessao.scalars(select(Gateway).order_by(Gateway.id)))

    def autenticar(self, chave_api: str) -> Gateway:
        """O gateway dono da chave de API."""
        gateway = self.sessao.scalar(
            select(Gateway).where(Gateway.chave_api_hash == hash_da_chave(chave_api))
        )
        if gateway is None:
            raise CredencialInvalida
        return gateway

    def registrar_contato(self, gateway: Gateway, agora: datetime | None = None):
        gateway.ultimo_contato = agora or datetime.now(UTC)
        self.sessao.flush()

    @staticmethod
    def esta_online(gateway: Gateway, agora: datetime | None = None) -> bool:
        if gateway.ultimo_contato is None:
            return False
        agora = agora or datetime.now(UTC)
        return agora - gateway.ultimo_contato < TEMPO_ATE_FICAR_OFFLINE
