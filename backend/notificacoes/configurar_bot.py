"""Confere e configura o bot do Telegram de uma instalação (US17).

Uso, de dentro da pasta backend/ (ou com ``docker compose run``, ver o README):

    python -m notificacoes.configurar_bot [--nome NOME] [--descricao TEXTO]
                                          [--descricao-curta TEXTO]

Criar o bot é um passo manual no @BotFather (``/newbot``): o Telegram não oferece uma
API para isso. Com o token em TELEGRAM_BOT_TOKEN, este comando faz o resto:

- confere o token (``getMe``) e mostra o nome de usuário do bot, que a API descobre
  sozinha (TELEGRAM_BOT_USERNAME só é preciso para forçar um nome, e o comando avisa se
  ele não for o do bot do token);
- avisa se há um webhook registrado (a API o remove ao iniciar, ver o README);
- cadastra o comando ``/start``, que é o do vínculo do chat;
- muda o nome, a descrição e a descrição curta do bot, se pedidos.

O token vem só do ambiente, nunca de um argumento: um argumento ficaria no histórico do
shell e na lista de processos. Nenhuma saída o mostra.

Cada passo é independente: se um falha (o Telegram limita quantas vezes o nome e as
descrições podem mudar), os outros ainda rodam, o comando diz o que deu certo e o que
não deu e sai com erro. Rodar de novo repete tudo, então use só as opções que faltam.
"""

import argparse
import os
import sys
from collections.abc import Callable, Sequence

from notificacoes.canais import chamar_api_telegram

# Limites da Bot API para cada texto.
LIMITE_DO_NOME = 64
LIMITE_DA_DESCRICAO = 512
LIMITE_DA_DESCRICAO_CURTA = 120

COMANDOS = [{"command": "start", "description": "Vincular este chat ao TermoLOG"}]


class ErroDeUso(Exception):
    """Argumento inválido ou ambiente incompleto: vai para a saída de erro."""


def _limitar(texto: str | None, limite: int, rotulo: str) -> str | None:
    if texto is None:
        return None
    texto = texto.strip()
    if not texto:
        raise ErroDeUso(f"{rotulo} não pode ficar vazio")
    if len(texto) > limite:
        raise ErroDeUso(f"{rotulo} passa de {limite} caracteres ({len(texto)})")
    return texto


def _resultado(resposta: dict) -> dict:
    """O ``result`` da resposta, se for um objeto; senão, vazio (o formato é do Telegram)."""
    resultado = resposta.get("result")
    return resultado if isinstance(resultado, dict) else {}


def configurar(
    nome: str | None = None,
    descricao: str | None = None,
    descricao_curta: str | None = None,
    imprimir: Callable[[str], None] = print,
) -> list[str]:
    """Confere o bot e aplica a configuração. Devolve os passos que falharam.

    Levanta ErroDeUso (entrada ou ambiente inválido) ou RuntimeError (token recusado:
    sem token válido, nenhum passo faria sentido).
    """
    nome = _limitar(nome, LIMITE_DO_NOME, "o nome")
    descricao = _limitar(descricao, LIMITE_DA_DESCRICAO, "a descrição")
    descricao_curta = _limitar(
        descricao_curta, LIMITE_DA_DESCRICAO_CURTA, "a descrição curta"
    )
    if not (os.getenv("TELEGRAM_BOT_TOKEN") or "").strip():
        raise ErroDeUso(
            "TELEGRAM_BOT_TOKEN não configurado: crie o bot no @BotFather "
            "(/newbot) e coloque o token no .env"
        )

    bot = _resultado(chamar_api_telegram("getMe", {}))
    usuario = bot.get("username")
    if not isinstance(usuario, str) or not usuario:
        raise RuntimeError("o Telegram não devolveu o nome de usuário do bot")
    imprimir(f"Token válido. Bot: @{usuario} ({bot.get('first_name', '?')})")

    # Um TELEGRAM_BOT_USERNAME esquecido de outro bot faria o link do vínculo apontar
    # para ele, mesmo com o token novo.
    forcado = (os.getenv("TELEGRAM_BOT_USERNAME") or "").strip().removeprefix("@")
    if forcado and forcado.lower() != usuario.lower():
        imprimir(
            f"Aviso: TELEGRAM_BOT_USERNAME é @{forcado}, mas o token é do bot "
            f"@{usuario}. O link do vínculo usaria @{forcado}: corrija ou apague a "
            "variável (a API descobre o nome pelo token)."
        )

    # Só informa: se esta consulta falhar, a configuração segue.
    try:
        if _resultado(chamar_api_telegram("getWebhookInfo", {})).get("url"):
            imprimir(
                "Aviso: há um webhook registrado para este bot. A API o remove ao "
                "iniciar, porque o vínculo usa getUpdates."
            )
    except RuntimeError as erro:
        imprimir(f"Aviso: não deu para consultar o webhook ({erro}).")

    passos = [
        ("comando /start", "setMyCommands", {"commands": COMANDOS}, True),
        ("nome", "setMyName", {"name": nome}, nome),
        ("descrição", "setMyDescription", {"description": descricao}, descricao),
        (
            "descrição curta",
            "setMyShortDescription",
            {"short_description": descricao_curta},
            descricao_curta,
        ),
    ]
    falhas = []
    for rotulo, metodo, dados, pedido in passos:
        if not pedido:
            continue
        try:
            chamar_api_telegram(metodo, dados)
        except RuntimeError as erro:
            imprimir(f"Falhou: {rotulo} ({erro})")
            falhas.append(rotulo)
        else:
            imprimir(f"Feito: {rotulo}")

    imprimir(f"Link do bot: https://t.me/{usuario}")
    if falhas:
        imprimir("Não aplicado: " + ", ".join(falhas) + ". Tente de novo mais tarde.")
    elif not forcado:
        imprimir(
            "TELEGRAM_BOT_USERNAME não é necessário: a API descobre o nome pelo token."
        )
    return falhas


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m notificacoes.configurar_bot", description=__doc__.split("\n")[0]
    )
    parser.add_argument("--nome", help=f"nome do bot (até {LIMITE_DO_NOME} caracteres)")
    parser.add_argument(
        "--descricao",
        help=f"texto da tela inicial do bot (até {LIMITE_DA_DESCRICAO} caracteres)",
    )
    parser.add_argument(
        "--descricao-curta",
        help=f"texto do perfil do bot (até {LIMITE_DA_DESCRICAO_CURTA} caracteres)",
    )
    argumentos = parser.parse_args(argv)
    try:
        falhas = configurar(
            argumentos.nome, argumentos.descricao, argumentos.descricao_curta
        )
    except ErroDeUso as erro:
        print(f"erro: {erro}", file=sys.stderr)
        return 2
    except RuntimeError as erro:
        # A mensagem da API não leva o token (ver chamar_api_telegram).
        print(f"erro: {erro}", file=sys.stderr)
        return 1
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
