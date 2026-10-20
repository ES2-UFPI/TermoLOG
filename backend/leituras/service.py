from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from leituras.models import Leitura
from sensores.models import Sensor
from sensores.service import SensorNaoEncontrado


class LeituraService:
    """Consultas e regras de negócio das leituras."""

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def historico_do_sensor(
        self,
        sensor_id: int,
        inicio: datetime | None,
        fim: datetime | None,
        pagina: int,
        tamanho: int,
    ) -> tuple[Sensor, int, list[Leitura]]:
        """Leituras do sensor em ordem cronológica, com os limites do período inclusos.

        Devolve o sensor, o total de leituras do filtro (sem paginar) e a página.
        """
        sensor = self.sessao.get(Sensor, sensor_id)
        if sensor is None:
            raise SensorNaoEncontrado(sensor_id)

        filtros = [Leitura.sensor_id == sensor_id]
        if inicio is not None:
            filtros.append(Leitura.data_hora >= inicio)
        if fim is not None:
            filtros.append(Leitura.data_hora <= fim)

        total = self.sessao.scalar(
            select(func.count()).select_from(Leitura).where(*filtros)
        )
        itens = self.sessao.scalars(
            select(Leitura)
            .where(*filtros)
            # O id desempata leituras com a mesma data_hora, para a paginação ser estável.
            .order_by(Leitura.data_hora, Leitura.id)
            .offset((pagina - 1) * tamanho)
            .limit(tamanho)
        )
        return sensor, total, list(itens)

    def ultimas_por_sala(self) -> dict[int, Leitura]:
        """Leitura mais recente de cada sala que já tem leitura, pelo id da sala."""
        # DISTINCT ON fica com a primeira linha de cada sala na ordem do ORDER BY,
        # e usa o índice (sala_id, data_hora).
        leituras = self.sessao.scalars(
            select(Leitura)
            .distinct(Leitura.sala_id)
            .order_by(Leitura.sala_id, Leitura.data_hora.desc(), Leitura.id.desc())
        )
        return {leitura.sala_id: leitura for leitura in leituras}
