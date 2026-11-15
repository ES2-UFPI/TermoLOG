from collections.abc import Iterable
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from climatizacao.models import ComandoDeClimatizacao
from salas.service import SalaService
from sensores.models import Sensor
from usuarios.models import Usuario

# Quanto o comando espera pela entrega antes de expirar: cobre o heartbeat do
# gateway (60 s) e alguns ciclos de leitura do nó (contrato, 1.3).
VALIDADE = timedelta(minutes=15)
# Faixa do INTEGER do PostgreSQL: um id fora dela não existe e estouraria a consulta.
ID_MIN, ID_MAX = -(2**31), 2**31 - 1


class SalaSemClimatizacao(Exception):
    """A sala não tem sensor_climatizacao_id: não há nó com emissor infravermelho."""


class SensorDeClimatizacaoInativo(Exception):
    pass


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
    ) -> ComandoDeClimatizacao:
        """Cria o comando pendente para o nó de climatização da sala.

        Levanta SalaNaoEncontrada, SalaSemClimatizacao ou SensorDeClimatizacaoInativo.
        """
        sala = SalaService(self.sessao).obter(sala_id)
        if sala.sensor_climatizacao_id is None:
            raise SalaSemClimatizacao(sala_id)
        if not self.sessao.get(Sensor, sala.sensor_climatizacao_id).ativo:
            raise SensorDeClimatizacaoInativo(sala.sensor_climatizacao_id)
        comando = ComandoDeClimatizacao(
            sala_id=sala.id,
            sensor_id=sala.sensor_climatizacao_id,
            acao=acao,
            temperatura_c=temperatura_c,
            usuario=usuario,
            criado_em=agora,
            expira_em=agora + VALIDADE,
        )
        self.sessao.add(comando)
        self.sessao.flush()
        return comando

    def historico(self, sala_id: int, agora: datetime) -> list[ComandoDeClimatizacao]:
        """Comandos da sala, do mais recente ao mais antigo.

        Levanta SalaNaoEncontrada. A transação (commit) é de quem chama.
        """
        SalaService(self.sessao).obter(sala_id)
        self._expirar(agora)
        return list(
            self.sessao.scalars(
                select(ComandoDeClimatizacao)
                .where(ComandoDeClimatizacao.sala_id == sala_id)
                .options(selectinload(ComandoDeClimatizacao.usuario))
                .order_by(
                    ComandoDeClimatizacao.criado_em.desc(),
                    ComandoDeClimatizacao.id.desc(),
                )
            )
        )

    def entregar(
        self, gateway_id: int, concluidos: Iterable[int], agora: datetime
    ) -> list[ComandoDeClimatizacao]:
        """Marca como entregues os comandos que o gateway confirmou e devolve os que
        ainda vão na resposta do lote (pendentes e não expirados, dos sensores dele).

        Id de outro gateway, desconhecido ou de comando já expirado é ignorado. A
        transação (commit) é de quem chama.
        """
        # Antes da confirmação: o que já expirou continua expirado.
        self._expirar(agora)
        do_gateway = select(Sensor.id).where(Sensor.gateway_id == gateway_id)
        ids = {id_ for id_ in concluidos if ID_MIN <= id_ <= ID_MAX}
        if ids:
            self.sessao.execute(
                update(ComandoDeClimatizacao)
                .where(
                    ComandoDeClimatizacao.id.in_(ids),
                    ComandoDeClimatizacao.sensor_id.in_(do_gateway),
                    ComandoDeClimatizacao.situacao == "pendente",
                )
                .values(situacao="entregue")
            )
        return list(
            self.sessao.scalars(
                select(ComandoDeClimatizacao)
                .where(
                    ComandoDeClimatizacao.sensor_id.in_(do_gateway),
                    ComandoDeClimatizacao.situacao == "pendente",
                )
                .order_by(ComandoDeClimatizacao.id)
            )
        )

    def _expirar(self, agora: datetime) -> None:
        """O pendente que passou do expira_em vira expirado e não é mais enviado."""
        self.sessao.execute(
            update(ComandoDeClimatizacao)
            .where(
                ComandoDeClimatizacao.situacao == "pendente",
                ComandoDeClimatizacao.expira_em <= agora,
            )
            .values(situacao="expirado")
        )
