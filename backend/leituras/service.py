from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import exists, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from alertas.models import Alerta, TipoDoDesvio
from leituras.models import Leitura, Lote
from leituras.schemas import LeituraRecebida
from salas.models import Sala
from salas.service import desvios
from sensores.models import Sensor
from sensores.service import SensorNaoEncontrado

# Limites físicos do DHT22: fora deles a leitura é defeito do sensor, não da sala.
TEMPERATURA_MIN, TEMPERATURA_MAX = -40.0, 80.0
UMIDADE_MIN, UMIDADE_MAX = 0.0, 100.0
# Folga para o relógio do nó estar um pouco adiantado em relação ao do servidor.
TOLERANCIA_NO_FUTURO = timedelta(minutes=5)
# Faixa do INTEGER do PostgreSQL: um id fora dela não existe e estouraria a consulta.
ID_MIN, ID_MAX = -(2**31), 2**31 - 1


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
        self,
        gateway_id: int,
        lote_id: UUID,
        leituras: Sequence[LeituraRecebida],
        agora: datetime | None = None,
    ) -> Lote:
        """Grava as leituras válidas do lote e devolve o resultado (aceitas e recusadas).

        Um item inválido não derruba o lote: ele volta como rejeitado e os outros são
        gravados. Um lote_id que o gateway já enviou não grava nada e devolve o
        resultado da primeira vez. A transação (commit) é de quem chama.
        """
        anterior = self._lote(gateway_id, lote_id)
        if anterior is not None:
            return anterior
        lote = Lote(gateway_id=gateway_id, lote_id=lote_id, aceitas=0, rejeitadas=[])
        try:
            # Savepoint: se falhar, só o INSERT do lote é desfeito, não a transação.
            with self.sessao.begin_nested():
                self.sessao.add(lote)
        except IntegrityError:
            # Reenvio simultâneo: a outra requisição gravou o lote entre a consulta
            # acima e este INSERT, que esperou o commit dela antes de falhar.
            return self._lote(gateway_id, lote_id)

        agora = agora or datetime.now(UTC)
        ids = {
            leitura.sensor_id
            for leitura in leituras
            if ID_MIN <= leitura.sensor_id <= ID_MAX
        }
        # Sensor de outro gateway (ou com id fora da faixa) fica de fora e é
        # recusado como não cadastrado.
        sensores = {
            sensor.id: sensor
            for sensor in self.sessao.scalars(
                select(Sensor)
                .where(Sensor.id.in_(ids), Sensor.gateway_id == gateway_id)
                .options(selectinload(Sensor.sala))
            )
        }

        rejeitadas = []
        fora_da_faixa = []
        for indice, leitura in enumerate(leituras):
            motivo = self._motivo_da_rejeicao(
                leitura, sensores.get(leitura.sensor_id), agora
            )
            if motivo is not None:
                rejeitadas.append(LeituraRejeitada(indice, leitura.sensor_id, motivo))
                continue
            # A sala do momento da leitura, para o histórico não mudar depois.
            sala = sensores[leitura.sensor_id].sala
            gravada = Leitura(
                sensor_id=leitura.sensor_id,
                sala_id=sala.id,
                temperatura=leitura.temperatura,
                umidade=leitura.umidade,
                data_hora=leitura.data_hora.astimezone(UTC),
            )
            tipos = desvios(gravada, sala)
            gravada.dentro_da_faixa = not tipos
            self.sessao.add(gravada)
            if tipos:
                fora_da_faixa.append((gravada, sala, tipos))
        lote.aceitas = len(leituras) - len(rejeitadas)
        lote.rejeitadas = [asdict(rejeitada) for rejeitada in rejeitadas]
        self.sessao.flush()
        # Em ordem cronológica, para o alerta ficar com a primeira leitura do desvio
        # neste lote.
        for gravada, sala, tipos in sorted(fora_da_faixa, key=lambda f: f[0].data_hora):
            self._abrir_alertas(gravada, sala, tipos, agora)
        return lote

    def _abrir_alertas(
        self,
        leitura: Leitura,
        sala: Sala,
        tipos: list[TipoDoDesvio],
        agora: datetime,
    ) -> None:
        """Abre um alerta pendente para cada desvio que ainda não tem um na sala."""
        for tipo in tipos:
            # Leitura atrasada (o nó central reenvia o que acumulou sem internet) não
            # abre alerta se o mesmo desvio já teve um alerta, em qualquer situação,
            # aberto por uma leitura posterior a ela.
            if self.sessao.scalar(
                select(
                    exists().where(
                        Alerta.sala_id == sala.id,
                        Alerta.tipo == tipo,
                        Alerta.leitura_id == Leitura.id,
                        Leitura.data_hora > leitura.data_hora,
                    )
                )
            ):
                continue
            # O índice único parcial (um pendente por sala e tipo) decide: se já
            # houver um, inclusive aberto por outra requisição ao mesmo tempo, o
            # INSERT não faz nada e o alerta existente é mantido.
            self.sessao.execute(
                insert(Alerta)
                .values(
                    sala_id=sala.id,
                    sensor_id=leitura.sensor_id,
                    leitura_id=leitura.id,
                    tipo=tipo,
                    data_hora=agora,
                    situacao="pendente",
                )
                .on_conflict_do_nothing(
                    index_elements=[Alerta.sala_id, Alerta.tipo],
                    index_where=Alerta.situacao == "pendente",
                )
            )

    def _lote(self, gateway_id: int, lote_id: UUID) -> Lote | None:
        return self.sessao.scalar(
            select(Lote).where(Lote.gateway_id == gateway_id, Lote.lote_id == lote_id)
        )

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
