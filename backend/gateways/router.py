from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from database import get_sessao
from gateways.models import Gateway
from gateways.schemas import GatewayCriado, GatewayCriar, GatewayResumo
from gateways.service import CredencialInvalida, GatewayService

router = APIRouter(prefix="/gateways", tags=["gateways"])

Sessao = Annotated[Session, Depends(get_sessao)]

# auto_error=False para a falta do cabeçalho cair no mesmo 401 do contrato.
bearer = HTTPBearer(auto_error=False)


def gateway_autenticado(
    gateway_id: int,
    sessao: Sessao,
    credenciais: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> Gateway:
    """Dependência das rotas do gateway: confere a chave de API e o {id} da URL.

    Roda antes da validação do corpo, então uma credencial errada dá 401/403
    mesmo com o lote malformado.
    """
    if credenciais is None:
        raise _credencial_invalida()
    try:
        gateway = GatewayService(sessao).autenticar(credenciais.credentials)
    except CredencialInvalida:
        raise _credencial_invalida()
    if gateway.id != gateway_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "credencial não pertence a este gateway"
        )
    return gateway


def _credencial_invalida() -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "credencial inválida",
        headers={"WWW-Authenticate": "Bearer"},
    )


@router.post("", response_model=GatewayCriado, status_code=status.HTTP_201_CREATED)
def cadastrar_gateway(dados: GatewayCriar, sessao: Sessao):
    gateway, chave_api = GatewayService(sessao).cadastrar(dados.nome)
    sessao.commit()
    return GatewayCriado(id=gateway.id, nome=gateway.nome, chave_api=chave_api)


@router.get("", response_model=list[GatewayResumo])
def listar_gateways(sessao: Sessao):
    return [
        GatewayResumo(
            id=gateway.id,
            nome=gateway.nome,
            online=GatewayService.esta_online(gateway),
            ultimo_contato=gateway.ultimo_contato,
        )
        for gateway in GatewayService(sessao).listar()
    ]
