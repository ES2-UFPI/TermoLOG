from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth.router import exigir_admin
from comandos.schemas import ComandoCriado, ComandoCriar
from comandos.service import ComandoService, SensorInativo
from database import get_sessao
from gateways.service import GatewayNaoEncontrado
from salas.service import SalaNaoEncontrada
from sensores.schemas import SensorCriar, SensorResposta
from sensores.service import SensorNaoEncontrado, SensorService
from usuarios.models import Usuario

# Todas as rotas de sensores são do painel e só do administrador (contrato, 2.1).
router = APIRouter(tags=["sensores"], dependencies=[Depends(exigir_admin)])

Sessao = Annotated[Session, Depends(get_sessao)]


@router.post(
    "/salas/{sala_id}/sensores",
    response_model=SensorResposta,
    status_code=status.HTTP_201_CREATED,
)
def cadastrar_sensor(sala_id: int, dados: SensorCriar, sessao: Sessao):
    try:
        sensor = SensorService(sessao).cadastrar(sala_id, dados.gateway_id)
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")
    except GatewayNaoEncontrado:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "gateway não encontrado")
    sessao.commit()
    return sensor


@router.get("/salas/{sala_id}/sensores", response_model=list[SensorResposta])
def listar_sensores_da_sala(sala_id: int, sessao: Sessao):
    try:
        return SensorService(sessao).listar_da_sala(sala_id)
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")


@router.post("/sensores/{sensor_id}/desativar", response_model=SensorResposta)
def desativar_sensor(sensor_id: int, sessao: Sessao):
    try:
        sensor = SensorService(sessao).desativar(sensor_id)
    except SensorNaoEncontrado:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sensor não encontrado")
    sessao.commit()
    return sensor


@router.post(
    "/sensores/{sensor_id}/comandos",
    response_model=ComandoCriado,
    status_code=status.HTTP_202_ACCEPTED,
)
def enviar_comando(
    sensor_id: int,
    dados: ComandoCriar,
    sessao: Sessao,
    # Já exigido pelo router; repetido aqui só para receber quem mandou o comando.
    administrador: Annotated[Usuario, Depends(exigir_admin)],
):
    try:
        comando = ComandoService(sessao).criar(
            sensor_id, dados.tipo, dados.duracao_s, administrador.id
        )
    except SensorNaoEncontrado:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sensor não encontrado")
    except SensorInativo:
        raise HTTPException(status.HTTP_409_CONFLICT, "sensor inativo")
    # Montada antes do commit: depois dele o SQLAlchemy recarregaria os campos.
    resposta = ComandoCriado.model_validate(comando)
    sessao.commit()
    return resposta
