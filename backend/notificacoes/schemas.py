import base64
import binascii
import re
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    EmailStr,
    Field,
)

from notificacoes.models import TAMANHO_MAXIMO_DO_DESTINO

# Limite só para barrar listas absurdas: ninguém precisa de mais canais que isso.
MAXIMO_DE_CANAIS = 10

# O Telegram garante que o chat_id cabe em 52 bits (com sinal: grupos são negativos).
LIMITE_DO_CHAT_ID = 2**52


def _sem_espacos(valor):
    return valor.strip() if isinstance(valor, str) else valor


def _email_minusculo(email: str) -> str:
    # Como no login: a mesma caixa para o mesmo endereço não virar dois canais.
    return email.lower()


def _chat_id(texto: str) -> str:
    # Só o número: o nome público (@canal) não serve para o bot enviar a mensagem.
    if (
        not re.fullmatch(r"-?[1-9][0-9]*", texto)
        or abs(int(texto)) >= LIMITE_DO_CHAT_ID
    ):
        raise ValueError(
            "chat_id do Telegram deve ser um número inteiro diferente de 0"
        )
    return texto


def _endpoint_https(url: str) -> str:
    partes = urlsplit(url)
    if partes.scheme != "https" or not partes.netloc or " " in url:
        raise ValueError("endpoint da inscrição de push deve ser uma URL https")
    return url


def _base64url(tamanho: int, primeiro_byte: int | None = None):
    """Chave da inscrição de push em base64url, com o tamanho fixo do Web Push."""

    def validar(texto: str) -> str:
        sem_preenchimento = texto.rstrip("=")
        if not re.fullmatch(r"[A-Za-z0-9_-]+", sem_preenchimento):
            raise ValueError("chave deve estar em base64url")
        try:
            dados = base64.urlsafe_b64decode(
                sem_preenchimento + "=" * (-len(sem_preenchimento) % 4)
            )
        except binascii.Error:
            raise ValueError("chave deve estar em base64url")
        if len(dados) != tamanho or (
            primeiro_byte is not None and dados[0] != primeiro_byte
        ):
            raise ValueError(f"chave deve ter {tamanho} bytes")
        # Guardada sempre sem o "=" final, como o navegador envia.
        return sem_preenchimento

    return AfterValidator(validar)


Texto = Annotated[str, BeforeValidator(_sem_espacos)]


class ChavesPush(BaseModel):
    # Ponto P-256 não comprimido (0x04 + 64 bytes) e o segredo de 16 bytes (RFC 8291).
    p256dh: Annotated[str, _base64url(65, primeiro_byte=0x04)]
    auth: Annotated[str, _base64url(16)]


class InscricaoPush(BaseModel):
    """Como o navegador devolve em ``PushSubscription.toJSON()``. Campos a mais,
    como o ``expirationTime``, são ignorados."""

    endpoint: Annotated[
        Texto,
        Field(max_length=TAMANHO_MAXIMO_DO_DESTINO),
        AfterValidator(_endpoint_https),
    ]
    keys: ChavesPush


class CanalEmail(BaseModel):
    tipo: Literal["email"]
    destino: Annotated[
        EmailStr, BeforeValidator(_sem_espacos), AfterValidator(_email_minusculo)
    ]
    ativo: bool = True


class CanalTelegram(BaseModel):
    tipo: Literal["telegram"]
    destino: Annotated[Texto, AfterValidator(_chat_id)]
    ativo: bool = True


class CanalPush(BaseModel):
    tipo: Literal["push"]
    destino: InscricaoPush
    ativo: bool = True


Canal = Annotated[CanalEmail | CanalTelegram | CanalPush, Field(discriminator="tipo")]


def chave_do_canal(canal: CanalEmail | CanalTelegram | CanalPush) -> tuple[str, str]:
    """O que identifica o canal: tipo e destino (no push, o endpoint)."""
    destino = canal.destino.endpoint if isinstance(canal, CanalPush) else canal.destino
    return canal.tipo, destino


def _sem_repetidos(canais: list) -> list:
    vistos = set()
    for canal in canais:
        chave = chave_do_canal(canal)
        if chave in vistos:
            raise ValueError(f"canal repetido: {chave[0]} {chave[1]}")
        vistos.add(chave)
    return canais


# Corpo do PUT: a lista inteira, que substitui a anterior.
ListaDeCanais = Annotated[
    list[Canal], Field(max_length=MAXIMO_DE_CANAIS), AfterValidator(_sem_repetidos)
]
