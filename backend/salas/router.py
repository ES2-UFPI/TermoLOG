from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_sessao
from leituras.service import LeituraService
from salas.schemas import (
    SalaCriar,
    SalaDetalhe,
    SalaEditar,
    SalaResumo,
    StatusDaSala,
    UltimaLeitura,
)
from salas.service import SalaNaoEncontrada, SalaService

router = APIRouter(prefix="/salas", tags=["salas"])

Sessao = Annotated[Session, Depends(get_sessao)]


@router.post("", response_model=SalaDetalhe, status_code=status.HTTP_201_CREATED)
def cadastrar_sala(dados: SalaCriar, sessao: Sessao):
    sala = SalaService(sessao).cadastrar(dados.nome, dados.descricao)
    sessao.commit()
    return sala


@router.get("", response_model=list[SalaResumo])
def listar_salas(sessao: Sessao):
    return SalaService(sessao).listar()


# Antes de /{sala_id}, senão "status" seria lido como um id de sala.
@router.get("/status", response_model=list[StatusDaSala])
def status_das_salas(sessao: Sessao):
    ultimas = LeituraService(sessao).ultimas_por_sala()
    resposta = []
    for sala in SalaService(sessao).listar():
        status_da_sala = StatusDaSala.model_validate(sala)
        leitura = ultimas.get(sala.id)
        if leitura is not None:
            status_da_sala.ultima_leitura = UltimaLeitura.model_validate(leitura)
        resposta.append(status_da_sala)
    return resposta


@router.get("/{sala_id}", response_model=SalaDetalhe)
def detalhar_sala(sala_id: int, sessao: Sessao):
    try:
        return SalaService(sessao).obter(sala_id)
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")


@router.patch("/{sala_id}", response_model=SalaDetalhe)
def editar_sala(sala_id: int, dados: SalaEditar, sessao: Sessao):
    try:
        sala = SalaService(sessao).editar(sala_id, dados.model_dump(exclude_unset=True))
    except SalaNaoEncontrada:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "sala não encontrada")
    sessao.commit()
    return sala
