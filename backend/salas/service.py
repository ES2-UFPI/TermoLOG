from sqlalchemy import select
from sqlalchemy.orm import Session

from salas.models import Sala


class SalaNaoEncontrada(Exception):
    pass


class SalaService:
    """Regras de negócio das salas. A transação (commit) é de quem chama."""

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def cadastrar(self, nome: str, descricao: str | None = None) -> Sala:
        sala = Sala(nome=nome, descricao=descricao)
        self.sessao.add(sala)
        self.sessao.flush()
        return sala

    def listar(self) -> list[Sala]:
        return list(self.sessao.scalars(select(Sala).order_by(Sala.id)))

    def obter(self, sala_id: int) -> Sala:
        sala = self.sessao.get(Sala, sala_id)
        if sala is None:
            raise SalaNaoEncontrada(sala_id)
        return sala

    def editar(self, sala_id: int, campos: dict) -> Sala:
        """Altera só os campos recebidos."""
        sala = self.obter(sala_id)
        for campo, valor in campos.items():
            setattr(sala, campo, valor)
        self.sessao.flush()
        return sala

    def cadastrar_faixa_temperatura(self, sala_id: int, minimo: float, maximo: float):
        sala = self.obter(sala_id)
        sala.temperatura_min = minimo
        sala.temperatura_max = maximo
        self.sessao.flush()
        return sala

    def cadastrar_faixa_umidade(self, sala_id: int, minimo: float, maximo: float):
        sala = self.obter(sala_id)
        sala.umidade_min = minimo
        sala.umidade_max = maximo
        self.sessao.flush()
        return sala
