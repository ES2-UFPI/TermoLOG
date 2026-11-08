from collections import Counter
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_sessao
from leituras.schemas import LeituraDoSensor
from salas.schemas import (
    Faixa,
    IndicadoresDasSalas,
    SalaCriar,
    SalaDetalhe,
    SalaEditar,
    SalaResumo,
    StatusDaSala,
)
from salas.service import (
    SalaNaoEncontrada,
    SalaService,
    percentual_de_salas_dentro_da_faixa,
)

router = APIRouter(prefix="/salas", tags=["salas"])

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
