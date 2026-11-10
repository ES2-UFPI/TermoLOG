from collections import Counter
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from auth.router import sessao_autenticada
from database import get_sessao
from leituras.schemas import LeituraDoSensor
from leituras.service import em_utc
from salas.schemas import (
    Faixa,
    HistoricoDaSala,
    IndicadoresDasSalas,
    PontoDoHistorico,
    SalaCriar,
    SalaDetalhe,
    SalaEditar,
    SalaResumo,
    StatusDaSala,
)
from salas.service import (
    PERIODOS,
    Periodo,
    SalaNaoEncontrada,
    SalaService,
    percentual_de_salas_dentro_da_faixa,
)

# Todas as rotas de salas são do painel: exigem login (contrato, 2.1).
router = APIRouter(
    prefix="/salas", tags=["salas"], dependencies=[Depends(sessao_autenticada)]
)

Sessao = Annotated[Session, Depends(get_sessao)]


@router.post("", response_model=SalaDetalhe, status_code=status.HTTP_201_CREATED)
def cadastrar_sala(dados: SalaCriar, sessao: Sessao):
    sala = SalaService(sessao).cadastrar(
        dados.nome, dados.descricao, **dados.faixa.model_dump()
    )
    sessao.commit()
    return sala


@router.get("", response_model=list[SalaResumo])
def listar_salas(sessao: Sessao):
    return SalaService(sessao).listar()


# Antes de /{sala_id}, senão "status" e "indicadores" seriam lidos como id de sala.
@router.get("/status", response_model=list[StatusDaSala])
def status_das_salas(sessao: Sessao):
    service = SalaService(sessao)
    conformidade = service.conformidade(datetime.now(UTC))
    return [
        StatusDaSala(
            sala_id=sala.id,
            nome=sala.nome,
            faixa=Faixa.model_validate(sala),
            status=status_da_sala,
            conformidade_24h=conformidade.get(sala.id),
            leituras=[LeituraDoSensor.model_validate(leitura) for leitura in leituras],
        )
        for sala, leituras, status_da_sala in service.status()
    ]


@router.get("/indicadores", response_model=IndicadoresDasSalas)
def indicadores_das_salas(sessao: Sessao):
    contagem = Counter(status for _, _, status in SalaService(sessao).status())
    return IndicadoresDasSalas(
        salas_dentro_da_faixa=percentual_de_salas_dentro_da_faixa(contagem),
        salas_ok=contagem["ok"],
        salas_fora_da_faixa=contagem["fora_da_faixa"],
        salas_sem_leitura=contagem["sem_leitura"],
    )


@router.get("/{sala_id}/historico", response_model=HistoricoDaSala)
def historico_da_sala(
    sala_id: int,
    sessao: Sessao,
    periodo: Periodo = "dia",
    fim: datetime | None = None,
):
    try:
        # A resposta é sempre em UTC, mesmo que o fim venha em outro fuso.
        fim = (em_utc(fim) or datetime.now(UTC)).astimezone(UTC)
        sala, inicio, pontos = SalaService(sessao).historico(sala_id, periodo, fim)
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")
    except OverflowError:
        # Data perto do ano 1 ou do 9999: a conversão de fuso ou o início da janela
        # sai do calendário.
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "fim fora do intervalo suportado"
        )
    return HistoricoDaSala(
        sala_id=sala.id,
        nome=sala.nome,
        periodo=periodo,
        intervalo_s=int(PERIODOS[periodo].intervalo.total_seconds()),
        inicio=inicio,
        fim=fim,
        faixa=Faixa.model_validate(sala),
        pontos=[PontoDoHistorico.model_validate(ponto) for ponto in pontos],
    )


@router.get("/{sala_id}", response_model=SalaDetalhe)
def detalhar_sala(sala_id: int, sessao: Sessao):
    try:
        return SalaService(sessao).obter(sala_id)
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")


@router.patch("/{sala_id}", response_model=SalaDetalhe)
def editar_sala(sala_id: int, dados: SalaEditar, sessao: Sessao):
    campos = dados.model_dump(exclude_unset=True, exclude={"faixa"})
    # A faixa vem como objeto, mas na sala são colunas.
    if "faixa" in dados.model_fields_set:
        campos |= (dados.faixa or Faixa()).model_dump()
    try:
        sala = SalaService(sessao).editar(sala_id, campos)
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")
    sessao.commit()
    return sala
