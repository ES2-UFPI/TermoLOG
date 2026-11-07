"""Hash de senha. Não precisa de banco."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor

from usuarios import service
from usuarios.service import HASHES_SIMULTANEOS, hash_da_senha, senha_confere


def test_senha_confere_so_com_a_senha_certa():
    senha_hash = hash_da_senha("senha-forte-123")

    assert senha_confere(senha_hash, "senha-forte-123")
    assert not senha_confere(senha_hash, "senha-errada")
    assert not senha_confere("nao-e-um-hash", "senha-forte-123")


def test_limita_quantos_hashes_rodam_ao_mesmo_tempo(monkeypatch):
    rodando = 0
    maximo = 0
    trava = threading.Lock()

    class HasherLento:
        def hash(self, senha):
            nonlocal rodando, maximo
            with trava:
                rodando += 1
                maximo = max(maximo, rodando)
            time.sleep(0.05)
            with trava:
                rodando -= 1
            return "hash"

    monkeypatch.setattr(service, "_hasher", HasherLento())

    with ThreadPoolExecutor(max_workers=HASHES_SIMULTANEOS * 3) as pool:
        list(pool.map(hash_da_senha, ["senha"] * HASHES_SIMULTANEOS * 3))

    assert maximo == HASHES_SIMULTANEOS
