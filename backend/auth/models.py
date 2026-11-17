from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base
from usuarios.models import Usuario


class SessaoDeLogin(Base):
    """Sessão aberta no login. Vale até 30 minutos depois do último uso (US27)."""

    __tablename__ = "sessoes"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Só o hash do token: o token em si aparece uma única vez, na resposta do login.
    # É único para a sessão ser encontrada pelo token que o painel envia.
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="CASCADE"), index=True
    )
    criada_em: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ultimo_uso: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    usuario: Mapped[Usuario] = relationship()


TAMANHO_DA_ROTA = 2048


class AcessoNegado(Base):
    """Requisição a uma rota Admin recusada com 403 (trilha de auditoria, US24).

    Depois de gravado o registro não pode ser alterado nem apagado, nem por fora da
    API: um trigger do banco recusa (migration 0017), no mesmo padrão das leituras
    e dos alertas (#54). Por isso o usuário também não pode ser apagado (RESTRICT):
    quando o painel passar a gerenciar usuários, a saída é desativá-los. A garantia
    vale contra a API e contra SQL comum, não contra quem é dono do banco (que pode
    desligar o trigger).
    """

    __tablename__ = "acessos_negados"

    id: Mapped[int] = mapped_column(primary_key=True)
    usuario_id: Mapped[int] = mapped_column(
        ForeignKey("usuarios.id", ondelete="RESTRICT"), index=True
    )
    metodo: Mapped[str] = mapped_column(String(16))
    # O caminho como foi pedido, com os ids (/salas/7/sensores), e não o modelo da
    # rota: a auditoria precisa saber em que recurso a pessoa tentou mexer. Vem do
    # cliente e a linha não pode ser apagada depois: o que passa do tamanho é cortado.
    rota: Mapped[str] = mapped_column(String(TAMANHO_DA_ROTA))
    data_hora: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class TentativaDeLogin(Base):
    """Login que errou o e-mail ou a senha, contado para o limite de tentativas.

    A linha é gravada antes de a senha ser conferida (ver auth.tentativas) e fica
    só se o login falhar. Linhas mais velhas que a janela do limite são apagadas.
    """

    __tablename__ = "tentativas_de_login"
    __table_args__ = (
        Index("ix_tentativas_de_login_email_hash_data_hora", "email_hash", "data_hora"),
        Index("ix_tentativas_de_login_ip_data_hora", "ip", "data_hora"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # SHA-256 do e-mail normalizado, e não o texto digitado (ver hash_do_email).
    email_hash: Mapped[str] = mapped_column(String(64))
    # O IP (no IPv6, a rede /64). Sem tamanho: vem do servidor ou do proxy, não de
    # um formulário. Nulo quando o servidor não informa o IP: a tentativa conta só
    # para o e-mail.
    ip: Mapped[str | None] = mapped_column(String)
    # Índice próprio para a limpeza das tentativas fora da janela.
    data_hora: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
