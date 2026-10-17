import os
from collections.abc import Iterator
from functools import cache

from sqlalchemy import Engine, MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session

# Nomes determinísticos para as constraints, para que as migrations sejam estáveis.
convencao_de_nomes = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=convencao_de_nomes)


def database_url() -> str:
    """URL do banco a partir de DATABASE_URL, no formato do driver psycopg 3."""
    url = os.environ["DATABASE_URL"]
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


@cache
def engine() -> Engine:
    """Engine único da aplicação, criado no primeiro uso (importar não exige banco)."""
    return create_engine(database_url())


def get_sessao() -> Iterator[Session]:
    """Dependência do FastAPI: uma sessão por requisição. O commit é da rota."""
    with Session(engine()) as sessao:
        yield sessao
