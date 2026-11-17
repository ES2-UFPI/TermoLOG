"""Cria um usuário do painel. O cadastro pelo painel ainda não existe (contrato).

Uso, de dentro da pasta backend/:

    python -m usuarios.criar_usuario --nome "Ana" --email ana@exemplo.com
        [--perfil administrador]

O perfil é ``visualizador`` (só as rotas de leitura e as dos alertas) se não for
informado, ou ``administrador`` (usa todas as rotas; contrato, 2.1). Para mudar o
perfil de quem já existe: ``python -m usuarios.definir_perfil``.

A senha é pedida no terminal, sem aparecer na tela nem ficar no histórico do
shell. Para rodar sem terminal (ex.: num script), a senha vem da variável de
ambiente SENHA. Exporte a variável antes (ex.: com ``read -rs SENHA``) em vez de
escrever ``SENHA=...`` no comando, que deixaria a senha no histórico.
"""

import argparse
import os
import sys
from getpass import getpass

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import models  # noqa: F401  (registra os modelos para os relacionamentos)
from database import database_url
from usuarios.models import PERFIS
from usuarios.service import EmailJaCadastrado, UsuarioService

TAMANHO_MINIMO_DA_SENHA = 8


def ler_senha() -> str:
    if senha := os.environ.get("SENHA"):
        return senha
    senha = getpass("Senha: ")
    if getpass("Repita a senha: ") != senha:
        sys.exit("As senhas não conferem.")
    return senha


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Cria um usuário do painel.")
    parser.add_argument("--nome", required=True)
    parser.add_argument("--email", required=True)
    # Sem --perfil o usuário é visualizador: administrador só quando pedido.
    parser.add_argument("--perfil", choices=PERFIS, default="visualizador")
    args = parser.parse_args(argv)

    nome = args.nome.strip()
    if not nome or len(nome) > 100:
        sys.exit("O nome deve ter de 1 a 100 caracteres.")
    try:
        TypeAdapter(EmailStr).validate_python(args.email.strip())
    except ValidationError:
        sys.exit(f"E-mail inválido: {args.email}")

    senha = ler_senha()
    if len(senha) < TAMANHO_MINIMO_DA_SENHA:
        sys.exit(f"A senha deve ter pelo menos {TAMANHO_MINIMO_DA_SENHA} caracteres.")

    engine = create_engine(database_url())
    try:
        with Session(engine) as sessao:
            try:
                usuario = UsuarioService(sessao).cadastrar(
                    nome, args.email, senha, args.perfil
                )
            except EmailJaCadastrado:
                sys.exit(f"Já existe um usuário com o e-mail {args.email}.")
            sessao.commit()
            print(f"Usuário {usuario.id} criado: {usuario.email} ({usuario.perfil}).")
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
