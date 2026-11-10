"""Script de criação de usuário. Precisa de um PostgreSQL (DATABASE_URL)."""

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from usuarios.criar_usuario import main
from usuarios.models import Usuario
from usuarios.service import EmailJaCadastrado, UsuarioService, senha_confere


@pytest.fixture
def com_senha(monkeypatch):
    monkeypatch.setenv("SENHA", "senha-forte-123")


def criar(*args):
    return main(
        [
            "--nome",
            "Ana",
            "--email",
            "Ana@Exemplo.com",
            "--perfil",
            "administrador",
            *args,
        ]
    )


def test_cria_usuario_com_email_em_minusculas_e_hash_da_senha(sessao, com_senha):
    assert criar() == 0

    usuario = UsuarioService(sessao).buscar_por_email("ana@exemplo.com")
    assert usuario.nome == "Ana"
    assert usuario.email == "ana@exemplo.com"
    assert usuario.senha_hash != "senha-forte-123"
    assert senha_confere(usuario.senha_hash, "senha-forte-123")
    assert usuario.perfil == "administrador"


@pytest.mark.parametrize("perfil", ["administrador", "visualizador"])
def test_cria_usuario_com_o_perfil_pedido(sessao, com_senha, perfil):
    assert main(["--nome", "Vera", "--email", "v@exemplo.com", "--perfil", perfil]) == 0

    assert UsuarioService(sessao).buscar_por_email("v@exemplo.com").perfil == perfil


def test_sem_perfil_o_usuario_e_visualizador(sessao, com_senha):
    assert main(["--nome", "Vera", "--email", "v@exemplo.com"]) == 0

    assert UsuarioService(sessao).buscar_por_email("v@exemplo.com").perfil == (
        "visualizador"
    )


def test_recusa_perfil_desconhecido(sessao, com_senha):
    with pytest.raises(SystemExit):
        main(["--nome", "Ana", "--email", "a@exemplo.com", "--perfil", "root"])

    assert UsuarioService(sessao).buscar_por_email("a@exemplo.com") is None


def test_recusa_email_repetido(sessao, com_senha):
    criar()

    with pytest.raises(SystemExit, match="Já existe"):
        main(
            [
                "--nome",
                "Outra Ana",
                "--email",
                "ana@exemplo.com",
                "--perfil",
                "visualizador",
            ]
        )


def test_recusa_email_invalido(sessao, com_senha):
    with pytest.raises(SystemExit, match="E-mail inválido"):
        main(["--nome", "Ana", "--email", "ana", "--perfil", "visualizador"])


def test_recusa_senha_curta(sessao, monkeypatch):
    monkeypatch.setenv("SENHA", "curta")

    with pytest.raises(SystemExit, match="pelo menos 8"):
        criar()


def test_service_recusa_email_repetido_com_outra_caixa(sessao):
    servico = UsuarioService(sessao)
    servico.cadastrar("Ana", "ana@exemplo.com", "senha-forte-123", "administrador")

    with pytest.raises(EmailJaCadastrado):
        servico.cadastrar("Ana", "ANA@exemplo.com", "senha-forte-123", "administrador")
    # O erro não estraga a transação de quem chamou.
    assert servico.buscar_por_email("ana@exemplo.com").nome == "Ana"


@pytest.mark.parametrize("perfil", ["root", "Administrador", "", "admin"])
def test_banco_recusa_perfil_fora_dos_dois_valores(sessao, perfil):
    sessao.add(
        Usuario(nome="Ana", email="ana@exemplo.com", senha_hash="x", perfil=perfil)
    )

    with pytest.raises(IntegrityError, match="perfil_valido"):
        sessao.flush()


def test_service_recusa_perfil_invalido_sem_acusar_email_repetido(sessao):
    with pytest.raises(ValueError, match="perfil inválido"):
        UsuarioService(sessao).cadastrar(
            "Ana", "ana@exemplo.com", "senha-forte-123", "root"
        )


def test_perfil_padrao_e_visualizador_no_modelo_e_no_banco(sessao):
    sessao.add(Usuario(nome="Ana", email="ana@exemplo.com", senha_hash="x"))
    sessao.execute(
        text(
            "INSERT INTO usuarios (nome, email, senha_hash) "
            "VALUES ('Bia', 'bia@exemplo.com', 'x')"
        )
    )
    sessao.flush()

    perfis = sessao.scalars(select(Usuario.perfil).order_by(Usuario.id)).all()
    assert sorted(perfis) == ["visualizador", "visualizador"]


def test_banco_garante_email_unico(sessao):
    for _ in range(2):
        sessao.add(
            Usuario(
                nome="Ana",
                email="ana@exemplo.com",
                senha_hash="x",
                perfil="administrador",
            )
        )
    with pytest.raises(IntegrityError):
        sessao.flush()
