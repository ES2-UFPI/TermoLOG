"""Nome do bot descoberto pelo token (US17)."""

from types import SimpleNamespace

import pytest

from notificacoes import canais
from notificacoes.canais import (
    ESPERA_APOS_FALHA_DO_GETME_S,
    BotIndisponivel,
    nome_do_bot,
)
from notificacoes.telegram_bot import comando_start

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
    monkeypatch.setattr(canais, "_nome_descoberto", None)
    monkeypatch.setattr(canais, "_falha_ao_descobrir", None)


@pytest.fixture
def api(monkeypatch):
    falsa = ApiFalsa()
    monkeypatch.setattr(canais, "chamar_api_telegram", falsa)
    return falsa


@pytest.fixture
def relogio(monkeypatch):
    """O tempo do cache de falhas, na mão: ``relogio.agora += 31`` espera 31 s."""
    marcador = SimpleNamespace(agora=1000.0)
    monkeypatch.setattr(
        canais, "time", SimpleNamespace(monotonic=lambda: marcador.agora)
    )
    return marcador


def test_o_nome_configurado_vale_e_nao_chama_o_telegram(api, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "  @meu_bot ")

    assert nome_do_bot() == "meu_bot"
    assert api.chamadas == []


def test_sem_nome_pergunta_ao_telegram_e_guarda_a_resposta(api):
    assert nome_do_bot() == "clinica_bot"
    assert nome_do_bot() == "clinica_bot"

    assert api.metodos() == ["getMe"]  # a segunda vez veio da memória


def test_outro_token_descobre_de_novo(api, monkeypatch):
    assert nome_do_bot() == "clinica_bot"
    api.respostas["getMe"] = {"ok": True, "result": {"username": "outro_bot"}}
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "999:outro-token")

    assert nome_do_bot() == "outro_bot"


def test_sem_nome_e_sem_token_nao_ha_como_saber(api, monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN")

    with pytest.raises(BotIndisponivel, match="não configurado"):
        nome_do_bot()
    assert api.chamadas == []


def test_falha_do_telegram_nao_leva_o_token(api):
    api.erros["getMe"] = "falha ao chamar a API do Telegram: URLError"

    with pytest.raises(BotIndisponivel) as erro:
        nome_do_bot()

    assert TOKEN not in str(erro.value)


def test_falha_e_lembrada_por_um_tempo_e_depois_tenta_de_novo(api, relogio):
    api.erros["getMe"] = "falha ao chamar a API do Telegram: URLError"
    with pytest.raises(BotIndisponivel):
        nome_do_bot()

    # Dentro da espera: nada de nova chamada (o tempo limite não se repete a cada pedido).
    relogio.agora += ESPERA_APOS_FALHA_DO_GETME_S - 1
    with pytest.raises(BotIndisponivel, match="URLError"):
        nome_do_bot()
    assert api.metodos() == ["getMe"]

    # Passada a espera, com o Telegram de volta, o nome é descoberto e guardado.
    del api.erros["getMe"]
    relogio.agora += 2
    assert nome_do_bot() == "clinica_bot"
    assert api.metodos() == ["getMe", "getMe"]


def test_a_falha_lembrada_e_do_token_que_falhou(api, relogio, monkeypatch):
    api.erros["getMe"] = "API do Telegram respondeu 401: Unauthorized"
    with pytest.raises(BotIndisponivel):
        nome_do_bot()

    del api.erros["getMe"]
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "999:token-corrigido")

    assert nome_do_bot() == "clinica_bot"  # token novo: não herda a falha do antigo


@pytest.mark.parametrize(
    "resposta",
    [
        {"ok": True, "result": None},
        {"ok": True, "result": {}},
        {"ok": True, "result": {"username": ""}},
        {"ok": True, "result": {"username": 7}},
        {"ok": True},
    ],
)
def test_resposta_do_getme_fora_do_formato_nao_vira_nome(api, resposta):
    api.respostas["getMe"] = resposta

    with pytest.raises(BotIndisponivel):
        nome_do_bot()


def start_em_grupo(texto):
    return {"message": {"chat": {"id": -5}, "text": texto}}


def test_start_de_grupo_com_o_telegram_fora_do_ar_consulta_o_nome_uma_vez(api, relogio):
    """O polling não espera o tempo limite do getMe a cada ``/start@bot``."""
    api.erros["getMe"] = "falha ao chamar a API do Telegram: URLError"

    for _ in range(3):
        # Sem o nome não dá para comparar: o comando é tratado como nosso.
        assert comando_start(start_em_grupo("/start@qualquer_bot abc")) == ("-5", "abc")

    assert api.metodos() == ["getMe"]


def test_start_sem_arroba_nao_consulta_o_nome(api):
    assert comando_start(start_em_grupo("/start abc")) == ("-5", "abc")
    assert api.chamadas == []


def test_start_de_grupo_compara_com_o_nome_descoberto(api):
    assert comando_start(start_em_grupo("/start@Clinica_Bot abc")) == ("-5", "abc")
    assert comando_start(start_em_grupo("/start@outro_bot abc")) is None
