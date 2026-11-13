"""Comando que confere e configura o bot do Telegram (US17)."""

import pytest

from notificacoes import configurar_bot
from notificacoes.configurar_bot import (
    COMANDOS,
    LIMITE_DA_DESCRICAO,
    LIMITE_DA_DESCRICAO_CURTA,
    LIMITE_DO_NOME,
    configurar,
    main,
)

TOKEN = "123456:segredo-do-bot"


class ApiFalsa:
    """Chamadas à Bot API simuladas: guarda (método, dados) e devolve o combinado."""

    def __init__(self):
        self.chamadas = []
        self.respostas = {
            "getMe": {
                "ok": True,
                "result": {"username": "clinica_bot", "first_name": "Clínica"},
            },
            "getWebhookInfo": {"ok": True, "result": {"url": ""}},
        }
        self.erros = {}

    def __call__(self, metodo, dados, timeout=10):
        self.chamadas.append((metodo, dados))
        if metodo in self.erros:
            raise RuntimeError(self.erros[metodo])
        return self.respostas.get(metodo, {"ok": True, "result": True})

    def metodos(self):
        return [m for m, _ in self.chamadas]


@pytest.fixture(autouse=True)
def ambiente(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", TOKEN)
    monkeypatch.delenv("TELEGRAM_BOT_USERNAME", raising=False)


@pytest.fixture
def api(monkeypatch):
    falsa = ApiFalsa()
    monkeypatch.setattr(configurar_bot, "chamar_api_telegram", falsa)
    return falsa


# --- configurar_bot ------------------------------------------------------------------


def rodar(**opcoes):
    saida = []
    falhas = configurar(imprimir=saida.append, **opcoes)
    return "\n".join(saida), falhas


def test_sem_opcoes_confere_o_token_e_cadastra_so_o_comando_start(api):
    saida, falhas = rodar()

    assert api.metodos() == ["getMe", "getWebhookInfo", "setMyCommands"]
    assert api.chamadas[2][1] == {"commands": COMANDOS}
    assert COMANDOS[0]["command"] == "start"
    assert falhas == []
    assert "@clinica_bot" in saida
    assert "https://t.me/clinica_bot" in saida
    assert "não é necessário" in saida  # sem TELEGRAM_BOT_USERNAME no ambiente
    assert TOKEN not in saida


def test_com_opcoes_muda_nome_e_descricoes(api):
    saida, falhas = rodar(
        nome="TermoLOG Clínica", descricao="Alertas.", descricao_curta="Curta"
    )

    assert falhas == []
    assert dict(api.chamadas)["setMyName"] == {"name": "TermoLOG Clínica"}
    assert dict(api.chamadas)["setMyDescription"] == {"description": "Alertas."}
    assert dict(api.chamadas)["setMyShortDescription"] == {"short_description": "Curta"}
    assert "Feito: nome" in saida


def test_avisa_do_webhook_registrado(api):
    api.respostas["getWebhookInfo"] = {"ok": True, "result": {"url": "https://x/hook"}}

    saida, _ = rodar()

    assert "webhook" in saida
    assert "https://x/hook" not in saida  # a URL pode levar segredo: não é mostrada


def test_falha_ao_consultar_o_webhook_nao_impede_a_configuracao(api):
    api.erros["getWebhookInfo"] = "API do Telegram respondeu 429: Too Many Requests"

    saida, falhas = rodar(nome="Clínica")

    assert falhas == []
    assert "não deu para consultar o webhook" in saida
    assert "setMyCommands" in api.metodos() and "setMyName" in api.metodos()


@pytest.mark.parametrize("result", [None, [], "texto", 7, ["username"]])
def test_result_que_nao_e_objeto_nao_derruba_o_comando(api, result):
    api.respostas["getWebhookInfo"] = {"ok": True, "result": result}

    _, falhas = rodar()

    assert falhas == []  # o webhook é só um aviso


def test_getme_com_result_que_nao_e_objeto_e_erro_limpo(api, capsys):
    api.respostas["getMe"] = {"ok": True, "result": ["não é objeto"]}

    assert main([]) == 1
    assert "nome de usuário" in capsys.readouterr().err


def test_um_passo_que_falha_nao_impede_os_outros_e_o_comando_diz_qual(api, capsys):
    api.erros["setMyName"] = "API do Telegram respondeu 429: Too Many Requests"

    assert (
        main(["--nome", "Clínica", "--descricao", "Alertas", "--descricao-curta", "C"])
        == 1
    )

    saida = capsys.readouterr().out
    assert "Falhou: nome" in saida and "429" in saida
    assert "Feito: comando /start" in saida
    assert "Feito: descrição" in saida and "Feito: descrição curta" in saida
    assert "Não aplicado: nome" in saida
    assert api.metodos()[-3:] == [
        "setMyName",
        "setMyDescription",
        "setMyShortDescription",
    ]


def test_username_forcado_diferente_do_bot_do_token_e_avisado(api, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "@bot_antigo")

    saida, falhas = rodar()

    assert falhas == []
    assert "@bot_antigo" in saida and "@clinica_bot" in saida
    assert "corrija ou apague" in saida


def test_username_forcado_igual_ao_do_bot_nao_gera_aviso(api, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "Clinica_Bot")

    saida, _ = rodar()

    assert "corrija ou apague" not in saida
    assert "não é necessário" not in saida


def test_sem_token_pede_para_criar_o_bot_e_nao_chama_o_telegram(
    api, monkeypatch, capsys
):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN")

    assert main([]) == 2
    assert "@BotFather" in capsys.readouterr().err
    assert api.chamadas == []


@pytest.mark.parametrize(
    "opcao,tamanho",
    [
        ("--nome", LIMITE_DO_NOME),
        ("--descricao", LIMITE_DA_DESCRICAO),
        ("--descricao-curta", LIMITE_DA_DESCRICAO_CURTA),
    ],
)
def test_texto_maior_que_o_limite_e_recusado_antes_de_chamar_o_telegram(
    api, capsys, opcao, tamanho
):
    assert main([opcao, "x" * (tamanho + 1)]) == 2
    assert "passa de" in capsys.readouterr().err
    assert api.chamadas == []


def test_texto_no_limite_e_aceito(api):
    rodar(nome="x" * LIMITE_DO_NOME)

    assert len(dict(api.chamadas)["setMyName"]["name"]) == LIMITE_DO_NOME


def test_texto_so_com_espacos_e_recusado(api, capsys):
    assert main(["--nome", "   "]) == 2
    assert "vazio" in capsys.readouterr().err


def test_token_invalido_sai_com_erro_sem_mostrar_o_token(api, capsys):
    api.erros["getMe"] = "API do Telegram respondeu 401: Unauthorized"

    assert main([]) == 1
    erro = capsys.readouterr().err
    assert "401" in erro
    assert TOKEN not in erro
    assert api.metodos() == ["getMe"]  # nada é configurado com um token inválido


def test_bot_sem_username_e_erro(api, capsys):
    api.respostas["getMe"] = {"ok": True, "result": {"first_name": "Sem nome"}}

    assert main([]) == 1
    assert "nome de usuário" in capsys.readouterr().err


def test_o_comando_com_tudo_certo_sai_com_zero(api):
    assert main(["--nome", "Clínica"]) == 0
