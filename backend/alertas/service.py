import logging
from datetime import datetime
from typing import Protocol

from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from alertas.models import Alerta, TipoDoDesvio
from leituras.models import Leitura
from salas.models import Sala

logger = logging.getLogger(__name__)


class ObservadorDeAlerta(Protocol):
    """Parte do sistema que reage a um alerta novo (notificações, alarme local)."""

    def alerta_aberto(self, alerta: Alerta) -> None: ...


class AlertaService:
    """Abre os alertas e avisa os observadores inscritos (Observer, arquitetura 4.3).

    O aviso não sai na abertura: a transação ainda pode ser desfeita. Quem faz o
    commit chama avisar() depois dele.
    """

    def __init__(self, sessao: Session):
        self.sessao = sessao
        self.observadores: list[ObservadorDeAlerta] = []
        # Abertos nesta transação e ainda não avisados.
        self._abertos: list[Alerta] = []

    def inscrever(self, observador: ObservadorDeAlerta) -> None:
        self.observadores.append(observador)

    def abrir(
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
            # INSERT não faz nada e o alerta existente é mantido. Só o alerta novo
            # volta no RETURNING, e só ele é avisado.
            alerta = self.sessao.scalar(
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
                .returning(Alerta)
            )
            if alerta is not None:
                self._abertos.append(alerta)

    def avisar(self) -> None:
        """Avisa os observadores dos alertas abertos. Chamar depois do commit.

        Um observador com erro não impede os outros nem desfaz a gravação: o erro
        só vai para o log.
        """
        abertos, self._abertos = self._abertos, []
        for alerta in abertos:
            for observador in self.observadores:
                try:
                    observador.alerta_aberto(alerta)
                except Exception:
                    logger.exception(
                        "observador %r falhou ao receber o alerta %s",
                        observador,
                        alerta.id,
                    )
