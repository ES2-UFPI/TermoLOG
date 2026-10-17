"""Faixas da sala no banco. Precisa de um PostgreSQL (DATABASE_URL)."""

import pytest
from sqlalchemy.exc import IntegrityError

from salas.models import Sala


def test_cada_sala_guarda_a_sua_faixa(sessao):
    camara = Sala(nome="Câmara fria", temperatura_min=2, temperatura_max=8)
    estoque = Sala(nome="Estoque", umidade_min=30, umidade_max=60)
    sessao.add_all([camara, estoque])
    sessao.flush()
    sessao.expire_all()

    assert (camara.temperatura_min, camara.temperatura_max) == (2, 8)
    assert (estoque.umidade_min, estoque.umidade_max) == (30, 60)
    assert estoque.temperatura_min is None


@pytest.mark.parametrize(
    ("campos", "restricao"),
    [
        ({"temperatura_min": 8, "temperatura_max": 2}, "ck_salas_faixa_temperatura"),
        ({"temperatura_min": 5, "temperatura_max": 5}, "ck_salas_faixa_temperatura"),
        ({"umidade_min": 70, "umidade_max": 40}, "ck_salas_faixa_umidade"),
        ({"umidade_min": 50, "umidade_max": 50}, "ck_salas_faixa_umidade"),
    ],
)
def test_banco_recusa_faixa_com_minimo_maior_ou_igual_ao_maximo(
    sessao, campos, restricao
):
    sessao.add(Sala(nome="Inválida", **campos))

    with pytest.raises(IntegrityError, match=restricao):
        sessao.flush()
