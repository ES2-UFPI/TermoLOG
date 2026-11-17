from threading import BoundedSemaphore

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from usuarios.models import PERFIS, Perfil, Usuario

# argon2id com os parâmetros recomendados pela biblioteca (RFC 9106).
_hasher = PasswordHasher()

# Cada hash do argon2id ocupa 64 MiB de memória. O login é público, então sem esse
# limite uma rajada de tentativas simultâneas esgota a memória do contêiner. As
# tentativas além do limite esperam a vez, sem alocar nada.
HASHES_SIMULTANEOS = 4
_vagas_para_hash = BoundedSemaphore(HASHES_SIMULTANEOS)

TAMANHO_MAXIMO_DO_EMAIL = 254


class EmailJaCadastrado(Exception):
    pass


class UsuarioNaoEncontrado(Exception):
    pass


class UltimoAdministrador(Exception):
    """Tirar o perfil do último administrador deixaria o painel sem quem o configure."""


def normalizar_email(email: str) -> str:
    return email.strip().lower()


def hash_da_senha(senha: str) -> str:
    """Hash com salt aleatório: duas pessoas com a mesma senha têm hashes diferentes."""
    with _vagas_para_hash:
        return _hasher.hash(senha)


def senha_confere(senha_hash: str, senha: str) -> bool:
    with _vagas_para_hash:
        try:
            return _hasher.verify(senha_hash, senha)
        except (VerificationError, InvalidHashError):
            return False


# Calculado já na importação: se ficasse para a primeira tentativa com e-mail
# inexistente, essa resposta levaria um hash a mais e denunciaria o e-mail.
_HASH_FALSO = hash_da_senha("senha de nenhum usuário")


class UsuarioService:
    """Regras de negócio dos usuários. A transação (commit) é de quem chama."""

    def __init__(self, sessao: Session):
        self.sessao = sessao

    def cadastrar(
        self, nome: str, email: str, senha: str, perfil: Perfil = "visualizador"
    ) -> Usuario:
        # Antes de ir ao banco: um perfil inválido também violaria o CHECK, e esse
        # IntegrityError seria confundido com o e-mail repetido logo abaixo.
        if perfil not in PERFIS:
            raise ValueError(f"perfil inválido: {perfil!r}")
        usuario = Usuario(
            nome=nome.strip(),
            email=normalizar_email(email),
            senha_hash=hash_da_senha(senha),
            perfil=perfil,
        )
        # A unicidade é conferida pelo banco, e não por uma consulta antes, para
        # dois cadastros simultâneos do mesmo e-mail não passarem os dois. O
        # savepoint mantém a transação de quem chamou utilizável depois do erro.
        try:
            with self.sessao.begin_nested():
                self.sessao.add(usuario)
        except IntegrityError:
            raise EmailJaCadastrado
        return usuario

    def definir_perfil(self, email: str, perfil: Perfil) -> Usuario:
        """Muda o perfil do usuário. Vale já na próxima requisição dele: o perfil é
        lido do banco a cada chamada, então não é preciso encerrar a sessão.

        Não deixa o sistema sem administrador: tirar o perfil do último dá
        UltimoAdministrador.
        """
        if perfil not in PERFIS:
            raise ValueError(f"perfil inválido: {perfil!r}")
        usuario = self.buscar_por_email(email)
        if usuario is None:
            raise UsuarioNaoEncontrado(email)
        if perfil != "administrador":
            # Trava as linhas dos administradores: duas trocas simultâneas não
            # podem, juntas, tirar o perfil dos dois últimos.
            administradores = list(
                self.sessao.scalars(
                    select(Usuario.id)
                    .where(Usuario.perfil == "administrador")
                    .with_for_update()
                )
            )
            if administradores == [usuario.id]:
                raise UltimoAdministrador(email)
        usuario.perfil = perfil
        self.sessao.flush()
        return usuario

    def buscar_por_email(self, email: str) -> Usuario | None:
        email = normalizar_email(email)
        # Um e-mail que não caberia na coluna, ou com caractere nulo (que o
        # PostgreSQL recusa em texto), não pode existir: nem vai ao banco.
        if len(email) > TAMANHO_MAXIMO_DO_EMAIL or "\x00" in email:
            return None
        return self.sessao.scalar(select(Usuario).where(Usuario.email == email))

    def conferir_credenciais(self, email: str, senha: str) -> Usuario | None:
        """O usuário dono do e-mail, se a senha conferir. Se não, None.

        Com e-mail inexistente, confere a senha contra um hash qualquer, para a
        resposta levar o mesmo tempo e não revelar quais e-mails estão cadastrados.
        """
        usuario = self.buscar_por_email(email)
        if usuario is None:
            senha_confere(_HASH_FALSO, senha)
            return None
        if not senha_confere(usuario.senha_hash, senha):
            return None
        if _hasher.check_needs_rehash(usuario.senha_hash):
            usuario.senha_hash = hash_da_senha(senha)
        return usuario
