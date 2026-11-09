import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from auth.models import SessaoDeLogin
from auth.tentativas import LimiteDeTentativas
from usuarios.models import Usuario
from usuarios.service import UsuarioService

# A sessão expira depois desse tempo sem requisições (contrato, 2.1).
TEMPO_DE_INATIVIDADE = timedelta(minutes=30)


class CredenciaisInvalidas(Exception):
    pass


class NaoAutenticado(Exception):
    pass


def hash_do_token(token: str) -> str:
    # O token é aleatório e longo (não é uma senha escolhida por alguém), então um
    # SHA-256 sem salt basta e permite buscar a sessão direto pelo hash.
    return hashlib.sha256(token.encode()).hexdigest()


def expira_em(sessao_de_login: SessaoDeLogin) -> datetime:
    # Em UTC (contrato), qualquer que seja o fuso da conexão com o banco.
    return (sessao_de_login.ultimo_uso + TEMPO_DE_INATIVIDADE).astimezone(UTC)


class AuthService:
    """Login, logout e validação das sessões. A transação (commit) é de quem chama.

    Remoções e renovações usam DELETE e UPDATE diretos no banco: se outra
    requisição já apagou a sessão (logout ou limpeza das expiradas), elas afetam
    zero linhas em vez de dar erro.
    """

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def entrar(
        self, email: str, senha: str, ip: str | None, agora: datetime | None = None
    ) -> tuple[SessaoDeLogin, str]:
        """Abre uma sessão e devolve o token, que não fica guardado.

        Antes de conferir a senha, passa pelo limite de tentativas, que pode dar
        MuitasTentativas. A tentativa já fica gravada como falha (numa transação
        própria); com a senha certa, as falhas do e-mail são apagadas logo em
        seguida, também numa transação própria, antes de abrir a sessão. ``ip``
        é None quando o servidor não informa quem conectou: aí vale só o limite
        por e-mail.
        """
        agora = agora or datetime.now(UTC)
        limite = LimiteDeTentativas(self.sessao)
        limite.registrar(email, ip, agora)
        usuario = UsuarioService(self.sessao).conferir_credenciais(email, senha)
        if usuario is None:
            raise CredenciaisInvalidas
        limite.zerar(email)
        return self.abrir_sessao(usuario, agora)

    def abrir_sessao(
        self, usuario: Usuario, agora: datetime | None = None
    ) -> tuple[SessaoDeLogin, str]:
        """Abre uma sessão para o usuário já identificado e devolve o token."""
        agora = agora or datetime.now(UTC)
        self._apagar_expiradas(agora)
        token = secrets.token_urlsafe(32)
        sessao_de_login = SessaoDeLogin(
            token_hash=hash_do_token(token),
            usuario=usuario,
            criada_em=agora,
            ultimo_uso=agora,
        )
        self.sessao.add(sessao_de_login)
        self.sessao.flush()
        return sessao_de_login, token

    def autenticar(
        self, token: str, renovar: bool = True, agora: datetime | None = None
    ) -> SessaoDeLogin:
        """A sessão do token, com o último uso renovado (se ``renovar``).

        Token desconhecido, de sessão encerrada ou parada há 30 minutos ou mais
        dá NaoAutenticado.
        """
        agora = agora or datetime.now(UTC)
        sessao_de_login = self._buscar(token)
        if sessao_de_login is None:
            raise NaoAutenticado
        if agora >= expira_em(sessao_de_login):
            self._apagar(sessao_de_login.id)
            raise NaoAutenticado
        if renovar:
            renovada = self.sessao.execute(
                update(SessaoDeLogin)
                .where(
                    SessaoDeLogin.id == sessao_de_login.id,
                    SessaoDeLogin.ultimo_uso > agora - TEMPO_DE_INATIVIDADE,
                )
                .values(ultimo_uso=agora)
            )
            # Zero linhas: a sessão foi encerrada entre a busca e a renovação.
            if renovada.rowcount == 0:
                raise NaoAutenticado
        return sessao_de_login

    def sair(self, sessao_id: int):
        """Encerra a sessão: o token deixa de valer."""
        self._apagar(sessao_id)

    def _buscar(self, token: str) -> SessaoDeLogin | None:
        return self.sessao.scalar(
            select(SessaoDeLogin).where(
                SessaoDeLogin.token_hash == hash_do_token(token)
            )
        )

    def _apagar(self, sessao_id: int):
        self.sessao.execute(delete(SessaoDeLogin).where(SessaoDeLogin.id == sessao_id))

    def _apagar_expiradas(self, agora: datetime):
        # Sessões abandonadas sem logout não ficam acumulando na tabela.
        self.sessao.execute(
            delete(SessaoDeLogin).where(
                SessaoDeLogin.ultimo_uso <= agora - TEMPO_DE_INATIVIDADE
            )
        )
