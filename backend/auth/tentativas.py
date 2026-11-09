"""Limite de logins errados por e-mail e por IP, contra senha tentada por força bruta.

Cada falha fica gravada por JANELA. Com LIMITE_POR_EMAIL falhas no mesmo e-mail, ou
LIMITE_POR_IP vindas do mesmo IP, o login é recusado sem conferir a senha até a
falha mais antiga das que bloqueiam sair da janela. Um login certo apaga as falhas
daquele e-mail. Sem o IP de quem conectou, vale só o limite por e-mail.

O limite fica no banco, e não na memória, para valer com mais de um processo do
servidor e não zerar quando o contêiner reinicia.
"""

import hashlib
import ipaddress
import math
from datetime import datetime, timedelta

from sqlalchemy import ColumnElement, delete, select
from sqlalchemy.orm import Session

from auth.models import TentativaDeLogin
from usuarios.service import normalizar_email

JANELA = timedelta(minutes=15)
LIMITE_POR_EMAIL = 5
LIMITE_POR_IP = 20


class MuitasTentativas(Exception):
    def __init__(self, espera: timedelta):
        super().__init__(espera)
        self.espera = espera

    @property
    def segundos(self) -> int:
        """A espera arredondada para cima, como vai no cabeçalho Retry-After."""
        return max(1, math.ceil(self.espera.total_seconds()))


def hash_do_email(email: str) -> str:
    """Chave do e-mail: tamanho fixo e sem o caractere nulo, que o PostgreSQL recusa.

    Não esconde o e-mail de quem tem o banco (sem segredo, um dicionário reverte
    o hash), só evita guardar o texto digitado, que às vezes é a própria senha.
    """
    return hashlib.sha256(normalizar_email(email).encode()).hexdigest()


def chave_do_ip(ip: str | None) -> str | None:
    """O IP que conta para o limite, ou None se não há IP.

    No IPv6, cada cliente costuma ter uma rede /64 inteira e pode trocar de
    endereço a cada pedido: o limite vale para a rede. IPv4 escrito como IPv6
    (::ffff:a.b.c.d) vira o IPv4. O que não é IP fica como veio.

    Sem IP (o servidor ASGI não informou quem conectou), não há chave: se todas
    essas requisições dividissem uma só, 20 falhas de qualquer uma bloqueariam
    todas as outras.
    """
    if not ip:
        return None
    try:
        endereco = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if isinstance(endereco, ipaddress.IPv6Address):
        if endereco.ipv4_mapped:
            return str(endereco.ipv4_mapped)
        return str(ipaddress.IPv6Network(f"{endereco}/64", strict=False))
    return str(endereco)


class LimiteDeTentativas:
    """Registra as tentativas de login e diz quando elas passaram do limite.

    A tentativa é gravada numa transação própria, que já termina antes de a senha
    ser conferida: as requisições simultâneas precisam vê-la. Sem isso, cem
    tentativas disparadas juntas leriam zero falhas e passariam todas. ``zerar``
    também usa uma transação própria, para a falha sair assim que a senha é
    conferida, mesmo que abrir a sessão dê erro depois.

    Efeito colateral: enquanto a senha é conferida, a tentativa já conta como
    falha para as requisições simultâneas. Com 4 falhas no e-mail e 2 tentativas
    chegando juntas, as duas podem receber 429, inclusive a que tinha a senha
    certa. O erro fica do lado seguro (ninguém passa do limite) e a pessoa só
    precisa tentar de novo depois do Retry-After.
    """

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def registrar(self, email: str, ip: str | None, agora: datetime):
        """Grava a tentativa como falha, até o login dar certo e chamar ``zerar``.

        Se o limite já tinha sido atingido, a tentativa é desfeita (não conta como
        falha, senão um ataque contínuo deixaria a conta bloqueada para sempre) e
        dá MuitasTentativas.
        """
        email_hash, ip = hash_do_email(email), chave_do_ip(ip)
        with Session(self.sessao.get_bind()) as propria:
            self._apagar_antigas(propria, agora)
            tentativa = TentativaDeLogin(email_hash=email_hash, ip=ip, data_hora=agora)
            propria.add(tentativa)
            propria.flush()
            # Lido antes do commit: depois dele o SQLAlchemy buscaria a linha de novo.
            tentativa_id = tentativa.id
            propria.commit()

            espera = self._espera(
                propria,
                TentativaDeLogin.email_hash == email_hash,
                LIMITE_POR_EMAIL,
                tentativa_id,
                agora,
            )
            if ip is not None:
                espera = max(
                    espera,
                    self._espera(
                        propria,
                        TentativaDeLogin.ip == ip,
                        LIMITE_POR_IP,
                        tentativa_id,
                        agora,
                    ),
                )
            if espera > timedelta(0):
                propria.execute(
                    delete(TentativaDeLogin).where(TentativaDeLogin.id == tentativa_id)
                )
                propria.commit()
                raise MuitasTentativas(espera)

    def zerar(self, email: str):
        """Login certo: apaga as falhas deste e-mail, que deixam de contar também
        para o IP de onde vieram. As falhas do IP com outros e-mails continuam.

        Grava numa transação própria, logo depois de a senha ser conferida: se
        abrir a sessão der erro em seguida, quem acertou a senha não fica com
        uma falha na contagem.
        """
        with Session(self.sessao.get_bind()) as propria:
            propria.execute(
                delete(TentativaDeLogin).where(
                    TentativaDeLogin.email_hash == hash_do_email(email)
                )
            )
            propria.commit()

    @staticmethod
    def _espera(
        sessao: Session,
        mesma_chave: ColumnElement[bool],
        limite: int,
        tentativa_id: int,
        agora: datetime,
    ) -> timedelta:
        """Quanto falta para a chave voltar a ficar abaixo do limite (0 se já está).

        Conta as outras tentativas da chave, inclusive as que ainda estão
        conferindo a senha. Se há ``limite`` delas na janela, esta passaria do
        limite: só depois que a ``limite``-ésima mais recente sair da janela
        sobram ``limite - 1``.
        """
        data_hora = sessao.scalar(
            select(TentativaDeLogin.data_hora)
            .where(
                mesma_chave,
                TentativaDeLogin.id != tentativa_id,
                TentativaDeLogin.data_hora > agora - JANELA,
            )
            .order_by(TentativaDeLogin.data_hora.desc())
            .offset(limite - 1)
            .limit(1)
        )
        if data_hora is None:
            return timedelta(0)
        return data_hora + JANELA - agora

    @staticmethod
    def _apagar_antigas(sessao: Session, agora: datetime):
        """Falhas fora da janela não contam mais: não precisam ficar na tabela.

        Pula as linhas travadas por outra transação (um ``zerar`` ou outra
        limpeza): esperar por elas poderia dar deadlock, e a próxima limpeza as
        pega.

        Roda em todo login (um SELECT ... FOR UPDATE SKIP LOCKED e um DELETE, pelo
        índice de ``data_hora``). Com o volume do projeto o custo é pequeno; se um
        dia pesar, a limpeza pode sair do caminho da requisição (uma tarefa
        periódica, por exemplo).
        """
        antigas = (
            select(TentativaDeLogin.id)
            .where(TentativaDeLogin.data_hora <= agora - JANELA)
            .with_for_update(skip_locked=True)
        )
        sessao.execute(delete(TentativaDeLogin).where(TentativaDeLogin.id.in_(antigas)))
