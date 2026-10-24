from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_sessao
from gateways.service import GatewayNaoEncontrado
from salas.service import SalaNaoEncontrada
from sensores.schemas import SensorCriar, SensorResposta
from sensores.service import SensorNaoEncontrado, SensorService

router = APIRouter(tags=["sensores"])

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
