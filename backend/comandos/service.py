from collections.abc import Iterable
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from comandos.models import Comando, TipoDeComando
from leituras.service import ID_MAX, ID_MIN
from sensores.models import Sensor
from sensores.service import SensorNaoEncontrado

# Quanto tempo o comando espera ser entregue antes de ser descartado. Cobre o
# envio do gateway (até 60 s) e o próximo ciclo de leitura do nó (contrato, 1.3).
# Valor da implementação: o contrato ainda não define a validade (ver o README).
VALIDADE_DO_COMANDO = timedelta(hours=1)
# Quantos ids de ``comandos_concluidos`` valem por lote. Um gateway só tem um comando
# por vez por nó; acima disso é defeito, e o resto segue pendente e é reenviado.
MAXIMO_DE_CONCLUIDOS = 1000


class SensorInativo(Exception):
    pass


class ComandoService:
    """Comandos para os nós. A transação (commit) é de quem chama."""

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def criar(
        self,
        sensor_id: int,
        tipo: TipoDeComando,
        duracao_s: int,
        usuario_id: int,
        agora: datetime | None = None,
    ) -> Comando:
        """Cria um comando pendente para o sensor, que precisa estar ativo."""
        agora = agora or datetime.now(UTC)
        sensor = self.sessao.get(Sensor, sensor_id)
        if sensor is None:
            raise SensorNaoEncontrado(sensor_id)
        if not sensor.ativo:
            raise SensorInativo(sensor_id)
        comando = Comando(
            sensor_id=sensor_id,
            tipo=tipo,
            duracao_s=duracao_s,
            usuario_id=usuario_id,
            situacao="pendente",
            expira_em=agora + VALIDADE_DO_COMANDO,
        )
        self.sessao.add(comando)
        self.sessao.flush()
        return comando

    def concluir(self, gateway_id: int, ids: Iterable[int]):
        """Marca como entregues os comandos que o gateway informou.

        Só vale para sensores do próprio gateway, e só para comandos ainda
        pendentes: um id desconhecido, de outro gateway ou já resolvido é ignorado.
        """
        # Só ids que cabem no INTEGER do banco (os outros não existem), e em número
        # limitado, para o IN da consulta não crescer sem controle.
        validos = sorted({i for i in ids if ID_MIN <= i <= ID_MAX})
        ids = validos[:MAXIMO_DE_CONCLUIDOS]
        if not ids:
            return
        self.sessao.execute(
            update(Comando)
            .where(
                Comando.id.in_(ids),
                Comando.situacao == "pendente",
                Comando.sensor_id.in_(
                    select(Sensor.id).where(Sensor.gateway_id == gateway_id)
                ),
            )
            .values(situacao="entregue")
        )

    def pendentes_do_gateway(
        self, gateway_id: int, agora: datetime | None = None
    ) -> list[Comando]:
        """Os comandos a mandar ao gateway: pendentes, no prazo, de sensores ativos.

        Os que passaram do prazo sem entrega viram ``expirado`` aqui mesmo, no
        lote do gateway do sensor: o de um gateway parado fica ``pendente`` até ele
        voltar a falar, mas nunca é enviado depois do prazo.
        """
        agora = agora or datetime.now(UTC)
        sensores = select(Sensor.id).where(Sensor.gateway_id == gateway_id)
        self.sessao.execute(
            update(Comando)
            .where(
                Comando.situacao == "pendente",
                Comando.expira_em <= agora,
                Comando.sensor_id.in_(sensores),
            )
            .values(situacao="expirado")
        )
        return list(
            self.sessao.scalars(
                select(Comando)
                .join(Sensor, Sensor.id == Comando.sensor_id)
                .where(
                    Comando.situacao == "pendente",
                    # Também no prazo: não depende do UPDATE acima ter pegado tudo.
                    Comando.expira_em > agora,
                    Sensor.gateway_id == gateway_id,
                    Sensor.ativo,
                )
                .order_by(Comando.id)
            )
        )
