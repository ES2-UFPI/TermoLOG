#!/usr/bin/env python3
"""Cadastra gateways, salas e sensores de exemplo pela API.

Grava a chave de API de cada gateway criado em chaves.json, que o simulador lê
para preencher os campos sozinho. Rodar de novo cadastra outro conjunto.

Uso: python3 seed.py [URL_BASE]   (padrão: $API_URL ou http://localhost:8000)
"""

import json
import os
import sys

from simulador_gateway import ARQUIVO_CHAVES, URL_PADRAO, ler_chaves, requisitar

GATEWAYS = ["Gateway Bloco A", "Gateway Bloco B"]

# (nome, faixa, índice do gateway em GATEWAYS, quantidade de sensores)
SALAS = [
    (
        "Laboratório de Redes",
        {
            "temperatura_min": 18,
            "temperatura_max": 24,
            "umidade_min": 40,
            "umidade_max": 60,
        },
        0,
        2,
    ),
    (
        "Sala de Servidores",
        {
            "temperatura_min": 16,
            "temperatura_max": 22,
            "umidade_min": 30,
            "umidade_max": 55,
        },
        0,
        3,
    ),
    ("Almoxarifado", {"temperatura_max": 30, "umidade_max": 70}, 1, 1),
]


def criar(base, caminho, corpo):
    status, resposta = requisitar("POST", f"{base}{caminho}", corpo)
    if status != 201:
        sys.exit(f"POST {caminho} -> {status}: {resposta}")
    return resposta


def main():
    padrao = os.environ.get("API_URL", URL_PADRAO)
    base = (sys.argv[1] if len(sys.argv) > 1 else padrao).rstrip("/")
    chaves = ler_chaves()

    gateways = []
    for nome in GATEWAYS:
        gateway = criar(base, "/gateways", {"nome": nome})
        chaves[gateway["id"]] = gateway["chave_api"]
        gateways.append(gateway["id"])
        print(f"Gateway #{gateway['id']} {nome}")
    # Salva antes das salas: a chave não pode ser recuperada depois.
    ARQUIVO_CHAVES.write_text(json.dumps(chaves, indent=2) + "\n")

    for nome, faixa, indice, quantidade in SALAS:
        sala = criar(base, "/salas", {"nome": nome, "faixa": faixa})
        for _ in range(quantidade):
            sensor = criar(
                base, f"/salas/{sala['id']}/sensores", {"gateway_id": gateways[indice]}
            )
            print(f"Sala #{sala['id']} {nome}: sensor #{sensor['id']}")

    print(f"Chaves de API salvas em {ARQUIVO_CHAVES.name}")


if __name__ == "__main__":
    main()
