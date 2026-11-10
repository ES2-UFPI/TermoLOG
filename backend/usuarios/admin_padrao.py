"""Cria (ou promove) o administrador padrão do ambiente de desenvolvimento e teste.

Uso, de dentro da pasta backend/:

    python -m usuarios.admin_padrao

O usuário é ``termolog@exemplo.com``, com perfil de administrador. A senha é pedida
no terminal, ou vem da variável de ambiente SENHA (ver ``usuarios.criar_usuario``).
Se o usuário já existe, só ganha o perfil de administrador e a senha não muda.

Isto não roda na migration de propósito: uma migration com e-mail e senha fixos
criaria uma conta de administrador conhecida em qualquer ambiente, produção
inclusive. Aqui a senha é de quem roda o comando.
"""

import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import models  # noqa: F401  (registra os modelos para os relacionamentos)
from database import database_url
from usuarios.criar_usuario import TAMANHO_MINIMO_DA_SENHA, ler_senha
from usuarios.service import EmailJaCadastrado, UsuarioService

EMAIL_ADMIN_PADRAO = "termolog@exemplo.com"
NOME_ADMIN_PADRAO = "TermoLOG"


def main() -> int:
    engine = create_engine(database_url())
    try:
        with Session(engine) as sessao:
            servico = UsuarioService(sessao)
            if servico.buscar_por_email(EMAIL_ADMIN_PADRAO) is None:
                senha = ler_senha()
                if len(senha) < TAMANHO_MINIMO_DA_SENHA:
                    sys.exit(
                        f"A senha deve ter pelo menos {TAMANHO_MINIMO_DA_SENHA} "
                        "caracteres."
                    )
                try:
                    servico.cadastrar(
                        NOME_ADMIN_PADRAO, EMAIL_ADMIN_PADRAO, senha, "administrador"
                    )
                except EmailJaCadastrado:
                    # Outro processo criou o usuário agora há pouco.
                    sys.exit(
                        f"{EMAIL_ADMIN_PADRAO} acabou de ser criado: rode de novo."
                    )
                print(f"Administrador {EMAIL_ADMIN_PADRAO} criado.")
            else:
                servico.definir_perfil(EMAIL_ADMIN_PADRAO, "administrador")
                print(
                    f"{EMAIL_ADMIN_PADRAO} já existe: é administrador, senha mantida."
                )
            sessao.commit()
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
