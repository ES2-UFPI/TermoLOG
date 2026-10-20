from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from database import get_sessao
from leituras.schemas import ConfirmacaoDoLote, HistoricoDoSensor, LoteDeLeituras
from leituras.service import LeituraService
from sensores.service import SensorNaoEncontrado

router = APIRouter(tags=["leituras"])

Sessao = Annotated[Session, Depends(get_sessao)]


@router.post(
    "/gateways/{gateway_id}/leituras",
    response_model=ConfirmacaoDoLote,
    status_code=status.HTTP_201_CREATED,
)
def receber_lote(gateway_id: int, lote: LoteDeLeituras, sessao: Sessao):
    # TODO: conferir a chave de API e o gateway_id (1.1) e tornar o lote_id
    # idempotente (1.2) quando existir o cadastro de gateways.
    aceitas, rejeitadas = LeituraService(sessao).registrar_lote(lote.leituras)
    sessao.commit()
    return ConfirmacaoDoLote(
        lote_id=lote.lote_id, aceitas=aceitas, rejeitadas=rejeitadas
    )


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
