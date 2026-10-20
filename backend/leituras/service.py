from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from leituras.models import Leitura
from leituras.schemas import LeituraRecebida
from sensores.models import Sensor
from sensores.service import SensorNaoEncontrado

# Limites físicos do DHT22: fora deles a leitura é defeito do sensor, não da sala.
TEMPERATURA_MIN, TEMPERATURA_MAX = -40.0, 80.0
UMIDADE_MIN, UMIDADE_MAX = 0.0, 100.0
# Folga para o relógio do nó estar um pouco adiantado em relação ao do servidor.
TOLERANCIA_NO_FUTURO = timedelta(minutes=5)


@dataclass
class LeituraRejeitada:
    indice: int
    sensor_id: int
    motivo: str


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

    def registrar_lote(
        self, leituras: Sequence[LeituraRecebida], agora: datetime | None = None
    ) -> tuple[int, list[LeituraRejeitada]]:
        """Grava as leituras válidas do lote e devolve quantas entraram e as recusadas.

        Um item inválido não derruba o lote: ele volta como rejeitado e os outros são
        gravados. A transação (commit) é de quem chama.
        """
        agora = agora or datetime.now(UTC)
        ids = {leitura.sensor_id for leitura in leituras}
        sensores = {
            sensor.id: sensor
            for sensor in self.sessao.scalars(select(Sensor).where(Sensor.id.in_(ids)))
        }

        aceitas = 0
        rejeitadas = []
        for indice, leitura in enumerate(leituras):
            motivo = self._motivo_da_rejeicao(
                leitura, sensores.get(leitura.sensor_id), agora
            )
            if motivo is not None:
                rejeitadas.append(LeituraRejeitada(indice, leitura.sensor_id, motivo))
                continue
            self.sessao.add(
                Leitura(
                    sensor_id=leitura.sensor_id,
                    # A sala do momento da leitura, para o histórico não mudar depois.
                    sala_id=sensores[leitura.sensor_id].sala_id,
                    temperatura=leitura.temperatura,
                    umidade=leitura.umidade,
                    data_hora=leitura.data_hora.astimezone(UTC),
                )
            )
            aceitas += 1
        self.sessao.flush()
        return aceitas, rejeitadas

    @staticmethod
    def _motivo_da_rejeicao(
        leitura: LeituraRecebida, sensor: Sensor | None, agora: datetime
    ) -> str | None:
        if sensor is None:
            return "sensor_nao_cadastrado"
        if not sensor.ativo:
            return "sensor_inativo"
        if not (
            TEMPERATURA_MIN <= leitura.temperatura <= TEMPERATURA_MAX
            and UMIDADE_MIN <= leitura.umidade <= UMIDADE_MAX
        ):
            return "valor_fora_do_limite"
        # Sem fuso não dá para saber a hora real da leitura.
        if (
            leitura.data_hora.tzinfo is None
            or leitura.data_hora > agora + TOLERANCIA_NO_FUTURO
        ):
            return "data_hora_invalida"
        return None
