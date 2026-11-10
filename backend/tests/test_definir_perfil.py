"""Comandos de perfil: administrador padrão e concessão de administrador.
Precisam de um PostgreSQL (DATABASE_URL).
"""

import pytest

from usuarios.admin_padrao import EMAIL_ADMIN_PADRAO
from usuarios.admin_padrao import main as admin_padrao
from usuarios.definir_perfil import main as definir_perfil
from usuarios.service import (
    UltimoAdministrador,
    UsuarioNaoEncontrado,
    UsuarioService,
    senha_confere,
)


@pytest.fixture
def com_senha(monkeypatch):
    monkeypatch.setenv("SENHA", "senha-forte-123")


def perfil_de(sessao, email):
    sessao.expire_all()
    return UsuarioService(sessao).buscar_por_email(email).perfil


# Administrador padrão


def test_administrador_padrao_e_criado_com_o_perfil_e_a_senha_pedida(sessao, com_senha):
    assert admin_padrao() == 0

    admin = UsuarioService(sessao).buscar_por_email("termolog@exemplo.com")
    assert EMAIL_ADMIN_PADRAO == "termolog@exemplo.com"
    assert admin.perfil == "administrador"
    assert senha_confere(admin.senha_hash, "senha-forte-123")


def test_administrador_padrao_e_idempotente_e_mantem_a_senha(
    sessao, com_senha, monkeypatch
):
    admin_padrao()
    monkeypatch.setenv("SENHA", "outra-senha-456")

    assert admin_padrao() == 0

    admin = UsuarioService(sessao).buscar_por_email(EMAIL_ADMIN_PADRAO)
    assert senha_confere(admin.senha_hash, "senha-forte-123")


def test_administrador_padrao_promove_quem_ja_existia_como_visualizador(sessao):
    UsuarioService(sessao).cadastrar("TermoLOG", EMAIL_ADMIN_PADRAO, "senha-forte-123")
    sessao.commit()

    assert admin_padrao() == 0

    assert perfil_de(sessao, EMAIL_ADMIN_PADRAO) == "administrador"


def test_administrador_padrao_recusa_senha_curta(sessao, monkeypatch):
    monkeypatch.setenv("SENHA", "curta")

    with pytest.raises(SystemExit, match="pelo menos 8"):
        admin_padrao()

    assert UsuarioService(sessao).buscar_por_email(EMAIL_ADMIN_PADRAO) is None


# Conceder e retirar o perfil de administrador


def test_concede_e_retira_o_perfil(sessao):
    servico = UsuarioService(sessao)
    servico.cadastrar("Ana", "ana@exemplo.com", "senha-forte-123", "administrador")
    servico.cadastrar("Vera", "vera@exemplo.com", "senha-forte-123")
    sessao.commit()
    assert perfil_de(sessao, "vera@exemplo.com") == "visualizador"

    assert (
        definir_perfil(["--email", "VERA@exemplo.com", "--perfil", "administrador"])
        == 0
    )
    assert perfil_de(sessao, "vera@exemplo.com") == "administrador"

    assert (
        definir_perfil(["--email", "vera@exemplo.com", "--perfil", "visualizador"]) == 0
    )
    assert perfil_de(sessao, "vera@exemplo.com") == "visualizador"


def test_usuario_inexistente(sessao):
    with pytest.raises(SystemExit, match="Não existe usuário"):
        definir_perfil(["--email", "ninguem@exemplo.com", "--perfil", "administrador"])


def test_perfil_desconhecido_e_recusado(sessao):
    with pytest.raises(SystemExit):
        definir_perfil(["--email", "ana@exemplo.com", "--perfil", "root"])


def test_nao_tira_o_perfil_do_ultimo_administrador(sessao):
    UsuarioService(sessao).cadastrar(
        "Ana", "ana@exemplo.com", "senha-forte-123", "administrador"
    )
    sessao.commit()

    with pytest.raises(SystemExit, match="único administrador"):
        definir_perfil(["--email", "ana@exemplo.com", "--perfil", "visualizador"])

    assert perfil_de(sessao, "ana@exemplo.com") == "administrador"


def test_tira_o_perfil_quando_ha_outro_administrador(sessao):
    servico = UsuarioService(sessao)
    servico.cadastrar("Ana", "ana@exemplo.com", "senha-forte-123", "administrador")
    servico.cadastrar("Bia", "bia@exemplo.com", "senha-forte-123", "administrador")
    sessao.commit()

    assert (
        definir_perfil(["--email", "ana@exemplo.com", "--perfil", "visualizador"]) == 0
    )

    assert perfil_de(sessao, "ana@exemplo.com") == "visualizador"
    with pytest.raises(UltimoAdministrador):
        servico.definir_perfil("bia@exemplo.com", "visualizador")


def test_service_recusa_perfil_invalido_e_usuario_inexistente(sessao):
    servico = UsuarioService(sessao)

    with pytest.raises(ValueError, match="perfil inválido"):
        servico.definir_perfil("ana@exemplo.com", "root")
    with pytest.raises(UsuarioNaoEncontrado):
        servico.definir_perfil("ana@exemplo.com", "administrador")


def test_o_novo_perfil_vale_na_proxima_requisicao_sem_novo_login(
    client, visualizador, sessao
):
    assert visualizador.post("/salas", json={"nome": "Sala"}).status_code == 403

    definir_perfil(["--email", "vera@exemplo.com", "--perfil", "administrador"])
    sessao.expire_all()

    assert visualizador.post("/salas", json={"nome": "Sala"}).status_code == 201
