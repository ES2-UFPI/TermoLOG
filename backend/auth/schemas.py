from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from usuarios.models import Perfil
from usuarios.service import TAMANHO_MAXIMO_DO_EMAIL

# Limite só para barrar corpos absurdos: nenhuma senha real chega perto.
TAMANHO_MAXIMO_DA_SENHA = 1024


class Login(BaseModel):
    # Texto livre, sem validar o formato: e-mail malformado cai no mesmo 401 de
    # e-mail inexistente. Só o tamanho é limitado (422), por ser o da coluna.
    email: str = Field(max_length=TAMANHO_MAXIMO_DO_EMAIL)
    senha: str = Field(max_length=TAMANHO_MAXIMO_DA_SENHA)


class UsuarioResposta(BaseModel):
    """O usuário como aparece para o painel: nunca com a senha nem o hash dela."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    nome: str
    email: str
    perfil: Perfil


class SessaoAberta(BaseModel):
    """Resposta do login: a única vez em que o token aparece."""

    token: str
    expira_em: datetime
    usuario: UsuarioResposta
