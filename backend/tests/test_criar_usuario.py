"""Script de criação de usuário. Precisa de um PostgreSQL (DATABASE_URL)."""

import pytest
from sqlalchemy.exc import IntegrityError

from usuarios.criar_usuario import main
from usuarios.models import Usuario
from usuarios.service import EmailJaCadastrado, UsuarioService, senha_confere


@pytest.fixture
def com_senha(monkeypatch):
    monkeypatch.setenv("SENHA", "senha-forte-123")


def criar(*args):
    return main(["--nome", "Ana", "--email", "Ana@Exemplo.com", *args])


def test_cria_usuario_com_email_em_minusculas_e_hash_da_senha(sessao, com_senha):
    assert criar() == 0

    usuario = UsuarioService(sessao).buscar_por_email("ana@exemplo.com")
    assert usuario.nome == "Ana"
    assert usuario.email == "ana@exemplo.com"
    assert usuario.senha_hash != "senha-forte-123"
    assert senha_confere(usuario.senha_hash, "senha-forte-123")


def test_recusa_email_repetido(sessao, com_senha):
    criar()

    with pytest.raises(SystemExit, match="Já existe"):
        main(["--nome", "Outra Ana", "--email", "ana@exemplo.com"])


def test_recusa_email_invalido(sessao, com_senha):
    with pytest.raises(SystemExit, match="E-mail inválido"):
        main(["--nome", "Ana", "--email", "ana"])


def test_recusa_senha_curta(sessao, monkeypatch):
    monkeypatch.setenv("SENHA", "curta")

    with pytest.raises(SystemExit, match="pelo menos 8"):
        criar()


def test_service_recusa_email_repetido_com_outra_caixa(sessao):
    servico = UsuarioService(sessao)
    servico.cadastrar("Ana", "ana@exemplo.com", "senha-forte-123")

    with pytest.raises(EmailJaCadastrado):
        servico.cadastrar("Ana", "ANA@exemplo.com", "senha-forte-123")
    # O erro não estraga a transação de quem chamou.
    assert servico.buscar_por_email("ana@exemplo.com").nome == "Ana"


def test_banco_garante_email_unico(sessao):
    for _ in range(2):
        sessao.add(
            Usuario(
                nome="Ana",
                email="ana@exemplo.com",
                senha_hash="x",
            )
        )
    with pytest.raises(IntegrityError):
        sessao.flush()
