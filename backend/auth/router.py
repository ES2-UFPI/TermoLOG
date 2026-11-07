from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from auth.models import SessaoDeLogin
from auth.schemas import Login, SessaoAberta, UsuarioResposta
from auth.service import AuthService, CredenciaisInvalidas, NaoAutenticado, expira_em
from database import get_sessao
from usuarios.models import Usuario

router = APIRouter(prefix="/auth", tags=["auth"])

Sessao = Annotated[Session, Depends(get_sessao)]

# auto_error=False para a falta do cabeçalho cair no mesmo 401 do contrato.
bearer = HTTPBearer(auto_error=False)


Credenciais = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


def _autenticar(
    sessao: Session, credenciais: HTTPAuthorizationCredentials | None, renovar: bool
) -> SessaoDeLogin:
    if credenciais is None:
        raise _nao_autenticado()
    try:
        sessao_de_login = AuthService(sessao).autenticar(
            credenciais.credentials, renovar=renovar
        )
    except NaoAutenticado:
        # Grava a remoção da sessão expirada antes de responder.
        sessao.commit()
        raise _nao_autenticado()
    sessao.commit()
    return sessao_de_login


def sessao_autenticada(sessao: Sessao, credenciais: Credenciais) -> SessaoDeLogin:
    """Dependência das rotas do painel: a sessão do token, com o último uso renovado.

    A renovação é gravada aqui, antes da rota, para valer mesmo se a rota falhar.
    """
    return _autenticar(sessao, credenciais, renovar=True)


def sessao_a_encerrar(sessao: Sessao, credenciais: Credenciais) -> SessaoDeLogin:
    """Dependência do logout: confere a sessão sem renovar, já que ela vai acabar."""
    return _autenticar(sessao, credenciais, renovar=False)


SessaoAtual = Annotated[SessaoDeLogin, Depends(sessao_autenticada)]


def usuario_logado(sessao_de_login: SessaoAtual) -> Usuario:
    """Dependência das rotas Logado: o usuário dono da sessão."""
    return sessao_de_login.usuario


def _nao_autenticado() -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "não autenticado",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("/login", response_model=SessaoAberta)
def entrar(dados: Login, sessao: Sessao):
    try:
        sessao_de_login, token = AuthService(sessao).entrar(dados.email, dados.senha)
    except CredenciaisInvalidas:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "e-mail ou senha inválidos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    # Montada antes do commit, com os valores calculados aqui: depois dele o
    # SQLAlchemy recarregaria os campos do banco.
    resposta = SessaoAberta(
        token=token,
        expira_em=expira_em(sessao_de_login),
        usuario=UsuarioResposta.model_validate(sessao_de_login.usuario),
    )
    sessao.commit()
    return resposta


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def sair(
    sessao_de_login: Annotated[SessaoDeLogin, Depends(sessao_a_encerrar)],
    sessao: Sessao,
):
    AuthService(sessao).sair(sessao_de_login)
    sessao.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UsuarioResposta)
def eu(usuario: Annotated[Usuario, Depends(usuario_logado)]):
    return usuario
