from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from alertas.router import alerta_service
from alertas.service import AlertaService
from auth.router import sessao_autenticada
from database import get_sessao
from gateways.models import Gateway
from gateways.router import gateway_autenticado
from gateways.service import GatewayService
from leituras.schemas import ConfirmacaoDoLote, HistoricoDoSensor, LoteDeLeituras
from leituras.service import LeituraService
from sensores.service import SensorNaoEncontrado

# Sem dependência no router: o envio de lotes é do gateway (chave de API) e o
# histórico é do painel (login). Cada rota declara a sua.
router = APIRouter(tags=["leituras"])

Sessao = Annotated[Session, Depends(get_sessao)]


def _em_utc(data: datetime | None) -> datetime | None:
    # O contrato pede datas com fuso; sem fuso, o filtro vale como UTC.
    if data is None or data.tzinfo is not None:
        return data
    return data.replace(tzinfo=UTC)


@router.post(
    "/gateways/{gateway_id}/leituras",
    response_model=ConfirmacaoDoLote,
    status_code=status.HTTP_201_CREATED,
)
def receber_lote(
    gateway: Annotated[Gateway, Depends(gateway_autenticado)],
    lote: LoteDeLeituras,
    sessao: Sessao,
    alertas: Annotated[AlertaService, Depends(alerta_service)],
    tarefas: BackgroundTasks,
):
    resultado = LeituraService(sessao).registrar_lote(
        gateway.id, lote.lote_id, lote.leituras, alertas
    )
    # Lote com leituras ou heartbeat: os dois contam como contato (GET /gateways).
    GatewayService(sessao).registrar_contato(gateway)
    sessao.commit()
    # Só depois do commit (um alerta desfeito com a transação não pode ser avisado)
    # e depois da resposta, para um observador lento não atrasar o gateway.
    tarefas.add_task(alertas.avisar)
    return ConfirmacaoDoLote(
        lote_id=lote.lote_id,
        aceitas=resultado.aceitas,
        rejeitadas=resultado.rejeitadas,
    )


@router.get(
    "/sensores/{sensor_id}/leituras",
    response_model=HistoricoDoSensor,
    dependencies=[Depends(sessao_autenticada)],
)
def historico_do_sensor(
    sensor_id: int,
    sessao: Sessao,
    inicio: datetime | None = None,
    fim: datetime | None = None,
    pagina: Annotated[int, Query(ge=1)] = 1,
    tamanho: Annotated[int, Query(ge=1, le=1000)] = 100,
):
    inicio, fim = _em_utc(inicio), _em_utc(fim)
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
