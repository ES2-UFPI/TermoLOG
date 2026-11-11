"""Registro dos acessos negados às rotas Admin (US24, trilha de auditoria)."""

from sqlalchemy.orm import Session

from auth.models import TAMANHO_DA_ROTA, AcessoNegado


def registrar_acesso_negado(
    sessao: Session, usuario_id: int, metodo: str, rota: str
) -> None:
    """Grava o 403 numa transação própria, já com commit.

    A requisição recusada termina em erro, e a sessão dela desfaz (rollback) tudo o
    que não foi gravado: o registro não pode ir junto. A data e a hora vêm do banco.
    Quem chama deve soltar a conexão da sessão da requisição antes (rollback): esta
    função pede outra ao pool.

    Se a gravação falhar, a exceção sobe e a resposta é 500 em vez de 403: a
    tentativa nunca fica sem registro.
    """
    with Session(sessao.get_bind()) as propria:
        propria.add(
            AcessoNegado(
                usuario_id=usuario_id,
                metodo=metodo,
                # O caminho vem do cliente. O PostgreSQL recusa o caractere nulo (%00)
                # em texto, e a coluna tem tamanho: sem tratar, os dois derrubariam
                # o 403 com um erro 500.
                rota=rota.replace("\x00", "\N{REPLACEMENT CHARACTER}")[
                    :TAMANHO_DA_ROTA
                ],
            )
        )
        propria.commit()
