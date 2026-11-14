from datetime import datetime

from sqlalchemy.orm import Session

from usuarios.models import Usuario


class SalaSemClimatizacao(Exception):
    """A sala não tem sensor_climatizacao_id: não há nó com emissor infravermelho."""


class ClimatizacaoService:
    def __init__(self, sessao: Session):
        self.sessao = sessao

    def enviar(
        self,
        sala_id: int,
        acao: str,
        temperatura_c: int | None,
        usuario: Usuario,
        agora: datetime,
    ):
        """Cria o comando pendente para o nó de climatização da sala.

        Levanta SalaNaoEncontrada ou SalaSemClimatizacao.
        """
        raise NotImplementedError

    def historico(self, sala_id: int):
        """Comandos da sala, do mais recente ao mais antigo.

        Levanta SalaNaoEncontrada.
        """
        raise NotImplementedError
