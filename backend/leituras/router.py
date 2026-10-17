from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from database import get_sessao
from leituras.schemas import HistoricoDoSensor
from leituras.service import LeituraService
from sensores.service import SensorNaoEncontrado

router = APIRouter(tags=["leituras"])

Sessao = Annotated[Session, Depends(get_sessao)]


@router.get("/sensores/{sensor_id}/leituras", response_model=HistoricoDoSensor)
def historico_do_sensor(
    sensor_id: int,
    sessao: Sessao,
    inicio: datetime | None = None,
    fim: datetime | None = None,
    pagina: Annotated[int, Query(ge=1)] = 1,
    tamanho: Annotated[int, Query(ge=1, le=1000)] = 100,
):
    if inicio is not None and fim is not None and inicio > fim:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "inicio não pode ser depois de fim"
        )
    try:
        sensor, total, itens = LeituraService(sessao).historico_do_sensor(
            sensor_id, inicio, fim, pagina, tamanho
        )
    except SensorNaoEncontrado:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sensor não encontrado")
    return HistoricoDoSensor(
        sensor_id=sensor.id,
        sala_nome=sensor.sala.nome,
        total=total,
        pagina=pagina,
        itens=itens,
    )
