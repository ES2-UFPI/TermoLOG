from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from auth.schemas import Login, SessaoAberta, UsuarioResposta
from auth.service import AuthService, CredenciaisInvalidas, NaoAutenticado, expira_em
from database import get_sessao
from usuarios.models import Usuario

router = APIRouter(prefix="/auth", tags=["auth"])

Sessao = Annotated[Session, Depends(get_sessao)]

# auto_error=False para a falta do cabeçalho cair no mesmo 401 do contrato.
bearer = HTTPBearer(auto_error=False)


Credenciais = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]


@dataclass(frozen=True)
class SessaoValida:
    """Retrato da sessão autenticada, tirado antes do commit.

    Depois do commit o SQLAlchemy recarregaria a SessaoDeLogin do banco. Se um
    logout simultâneo já tivesse apagado a linha, isso daria erro 500 em vez de
    401. Por isso a dependência devolve só os ids, que não mudam.
    """

    id: int
    usuario_id: int


def _autenticar(
    sessao: Session, credenciais: HTTPAuthorizationCredentials | None, renovar: bool
) -> SessaoValida:
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
    valida = SessaoValida(sessao_de_login.id, sessao_de_login.usuario_id)
    sessao.commit()
    return valida


def sessao_autenticada(sessao: Sessao, credenciais: Credenciais) -> SessaoValida:
    """Dependência das rotas do painel: confere o token e renova o último uso.

    A renovação é gravada aqui, antes da rota, para valer mesmo se a rota falhar.
    As rotas que não precisam do usuário usam só esta, sem carregá-lo.
    """
    return _autenticar(sessao, credenciais, renovar=True)


def sessao_a_encerrar(sessao: Sessao, credenciais: Credenciais) -> SessaoValida:
    """Dependência do logout: confere a sessão sem renovar, já que ela vai acabar."""
    return _autenticar(sessao, credenciais, renovar=False)


SessaoAtual = Annotated[SessaoValida, Depends(sessao_autenticada)]


def usuario_logado(sessao: Sessao, sessao_valida: SessaoAtual) -> Usuario:
    """Dependência das rotas que usam quem está logado: o usuário da sessão."""
    usuario = sessao.get(Usuario, sessao_valida.usuario_id)
    # Usuário apagado depois da autenticação: a sessão foi junto (CASCADE).
    if usuario is None:
        raise _nao_autenticado()
    return usuario


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
    sessao_valida: Annotated[SessaoValida, Depends(sessao_a_encerrar)],
    sessao: Sessao,
):
    AuthService(sessao).sair(sessao_valida.id)
    sessao.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=UsuarioResposta)
def eu(usuario: Annotated[Usuario, Depends(usuario_logado)]):
    return usuario
