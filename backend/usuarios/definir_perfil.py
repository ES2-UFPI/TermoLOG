"""Concede ou retira o perfil de administrador de um usuário que já existe.

Uso, de dentro da pasta backend/:

    python -m usuarios.definir_perfil --email ana@exemplo.com --perfil administrador

Vale na próxima requisição do usuário, sem ele precisar entrar de novo. Não tira
o perfil do último administrador.
"""

import argparse
import sys

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

import models  # noqa: F401  (registra os modelos para os relacionamentos)
from database import database_url
from usuarios.models import PERFIS
from usuarios.service import UltimoAdministrador, UsuarioNaoEncontrado, UsuarioService


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Define o perfil de um usuário.")
    parser.add_argument("--email", required=True)
    parser.add_argument("--perfil", required=True, choices=PERFIS)
    args = parser.parse_args(argv)

    engine = create_engine(database_url())
    try:
        with Session(engine) as sessao:
            try:
                usuario = UsuarioService(sessao).definir_perfil(args.email, args.perfil)
            except UsuarioNaoEncontrado:
                sys.exit(f"Não existe usuário com o e-mail {args.email}.")
            except UltimoAdministrador:
                sys.exit(
                    f"{args.email} é o único administrador: dê o perfil a outra "
                    "pessoa antes de tirá-lo."
                )
            sessao.commit()
            print(f"{usuario.email} agora é {usuario.perfil}.")
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(main())
