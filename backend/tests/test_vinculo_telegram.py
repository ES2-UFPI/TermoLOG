"""Vínculo do chat do Telegram por link com código (US17, #116). Precisa de PostgreSQL."""

import hashlib
import json
import threading
import urllib.request
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from database import database_url
from notificacoes import telegram_bot
from notificacoes.models import CanalDoUsuario, VinculoTelegram
from notificacoes.service import (
    VALIDADE_DO_VINCULO,
    ResultadoDoVinculo,
    VinculoTelegramService,
)
from notificacoes.telegram_bot import (
    BotTelegram,
    comando_start,
    iniciar,
    polling_ligado,
    processar_atualizacao,
)

ROTA = "/auth/me/canais/telegram/vinculo"


@pytest.fixture(autouse=True)
def ambiente(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "termolog_bot")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:token")
    monkeypatch.delenv("TELEGRAM_POLLING", raising=False)


class ApiFalsa:
    """O Telegram simulado: devolve as atualizações combinadas e guarda as chamadas."""

    def __init__(self):
        self.chamadas = []  # (método, dados)
        self.atualizacoes = []  # entregues no próximo getUpdates
        self.erros = {}  # método -> exceção a levantar
        self.ao_buscar = None  # chamada a cada getUpdates

    def mensagens(self):
        return [d for m, d in self.chamadas if m == "sendMessage"]

    def metodos(self):
        return [m for m, _ in self.chamadas]


@pytest.fixture
def api(monkeypatch):
    falsa = ApiFalsa()

    class Resposta:
        def __init__(self, corpo):
            self.corpo = json.dumps(corpo).encode()

        def __enter__(self):
            return self

        def __exit__(self, *erro):
            return False

        def read(self, *args):
            return self.corpo

    def urlopen(requisicao, timeout):
        metodo = requisicao.full_url.rsplit("/", 1)[1]
        assert requisicao.full_url.startswith("https://api.telegram.org/bot123:token/")
        falsa.chamadas.append((metodo, json.loads(requisicao.data)))
        if metodo == "getUpdates" and falsa.ao_buscar:
            falsa.ao_buscar()
        if metodo in falsa.erros:
            raise falsa.erros[metodo]
        if metodo == "getUpdates":
            entregues, falsa.atualizacoes = falsa.atualizacoes, []
            return Resposta({"ok": True, "result": entregues})
        return Resposta({"ok": True, "result": True})

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return falsa


@pytest.fixture
def banco(sessao):
    """Engine do banco de teste (o engine() da aplicação guarda o do primeiro uso)."""
    engine = create_engine(database_url())
    yield engine
    engine.dispose()


@pytest.fixture
def bot(banco):
    return BotTelegram(nova_sessao=lambda: Session(banco))


def atualizacao(texto, chat_id=555, update_id=1):
    return {
        "update_id": update_id,
        "message": {"chat": {"id": chat_id, "type": "private"}, "text": texto},
    }


def canais(sessao):
    sessao.expire_all()
    return list(sessao.scalars(select(CanalDoUsuario).order_by(CanalDoUsuario.id)))


def codigo_novo(client):
    return client.post(ROTA).json()["codigo"]


def entrega(api, bot, *atualizacoes):
    """O Telegram entrega as atualizações e o bot trata (uma rodada)."""
    api.atualizacoes = list(atualizacoes)
    return bot.rodada(0)


def respostas(api):
    return [m["text"] for m in api.mensagens()]


# --- POST /auth/me/canais/telegram/vinculo


def test_gera_codigo_e_link_do_bot(client, sessao):
    resposta = client.post(ROTA)

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["link"] == f"https://t.me/termolog_bot?start={corpo['codigo']}"
    assert len(corpo["codigo"]) >= 16
    expira = datetime.fromisoformat(corpo["expira_em"])
    esperado = datetime.now(UTC) + VALIDADE_DO_VINCULO
    assert abs(expira - esperado) < timedelta(seconds=30)
    # O banco guarda só o hash: o código não aparece nele.
    (vinculo,) = sessao.scalars(select(VinculoTelegram))
    assert vinculo.codigo_hash == hashlib.sha256(corpo["codigo"].encode()).hexdigest()
    assert corpo["codigo"] not in vinculo.codigo_hash


def test_arroba_no_nome_do_bot_e_ignorada(client, monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_USERNAME", "@termolog_bot")

    assert client.post(ROTA).json()["link"].startswith("https://t.me/termolog_bot?")


def test_sem_bot_configurado_da_503_e_nao_gera_codigo(client, monkeypatch, sessao):
    monkeypatch.delenv("TELEGRAM_BOT_USERNAME")

    resposta = client.post(ROTA)

    assert resposta.status_code == 503
    assert resposta.json() == {"detail": "Telegram não configurado"}
    assert sessao.scalar(select(VinculoTelegram)) is None


def test_novo_pedido_invalida_o_codigo_anterior(client, sessao):
    antigo = codigo_novo(client)
    novo = codigo_novo(client)

    assert antigo != novo
    assert len(list(sessao.scalars(select(VinculoTelegram)))) == 1
    resultado = VinculoTelegramService(sessao).vincular(antigo, "555")
    assert resultado == ResultadoDoVinculo.CODIGO_INVALIDO


def test_pedido_sem_login_da_401(cliente_anonimo):
    assert cliente_anonimo.post(ROTA).status_code == 401


# --- O bot trata o /start


def test_start_com_codigo_cria_o_canal_e_confirma_no_chat(
    client, sessao, usuario, api, bot
):
    codigo = codigo_novo(client)

    entrega(api, bot, atualizacao(f"/start {codigo}", chat_id=555))

    (canal,) = canais(sessao)
    assert (canal.usuario_id, canal.tipo, canal.destino, canal.ativo) == (
        usuario.id,
        "telegram",
        "555",
        True,
    )
    assert sessao.scalar(select(VinculoTelegram)) is None  # uso único
    (mensagem,) = api.mensagens()
    assert mensagem["chat_id"] == "555"
    assert "vinculado" in mensagem["text"]
    # E o GET do contrato já mostra o canal.
    assert client.get("/auth/me/canais").json() == [
        {"tipo": "telegram", "destino": "555", "ativo": True}
    ]


def test_o_codigo_so_vale_uma_vez(client, sessao, api, bot):
    codigo = codigo_novo(client)
    entrega(api, bot, atualizacao(f"/start {codigo}"))

    entrega(api, bot, atualizacao(f"/start {codigo}", chat_id=777))

    assert [c.destino for c in canais(sessao)] == ["555"]
    assert "inválido" in respostas(api)[-1]


def test_codigo_vencido_nao_vincula(client, sessao, api, bot):
    codigo = codigo_novo(client)
    sessao.expire_all()
    sessao.scalar(select(VinculoTelegram)).expira_em = datetime.now(UTC) - timedelta(
        seconds=1
    )
    sessao.commit()

    entrega(api, bot, atualizacao(f"/start {codigo}"))

    assert canais(sessao) == []
    assert "expirado" in respostas(api)[0]


def test_codigo_desconhecido_nao_vincula(sessao, api, bot):
    entrega(api, bot, atualizacao("/start qualquer-coisa"))

    assert canais(sessao) == []
    assert len(api.mensagens()) == 1


def test_start_sem_codigo_explica_como_vincular(sessao, api, bot):
    entrega(api, bot, atualizacao("/start"))

    assert canais(sessao) == []
    assert "painel" in respostas(api)[0]


def test_start_em_grupo_vincula_o_chat_negativo(client, sessao, api, bot):
    codigo = codigo_novo(client)

    entrega(
        api,
        bot,
        atualizacao(f"/start@termolog_bot {codigo}", chat_id=-1001234567890),
    )

    assert [c.destino for c in canais(sessao)] == ["-1001234567890"]


def test_vincular_de_novo_o_mesmo_chat_reativa_sem_duplicar(client, sessao, api, bot):
    client.put(
        "/auth/me/canais",
        json=[{"tipo": "telegram", "destino": "555", "ativo": False}],
    )
    codigo = codigo_novo(client)

    entrega(api, bot, atualizacao(f"/start {codigo}", chat_id=555))

    (canal,) = canais(sessao)
    assert canal.ativo is True


def test_vinculo_acrescenta_aos_canais_que_o_usuario_ja_tem(client, sessao, api, bot):
    client.put(
        "/auth/me/canais", json=[{"tipo": "email", "destino": "ana@exemplo.com"}]
    )
    codigo = codigo_novo(client)

    entrega(api, bot, atualizacao(f"/start {codigo}"))

    assert [(c.tipo, c.destino) for c in canais(sessao)] == [
        ("email", "ana@exemplo.com"),
        ("telegram", "555"),
    ]


def test_limite_de_canais_nao_cria_o_canal_nem_gasta_o_codigo(client, sessao, api, bot):
    client.put(
        "/auth/me/canais",
        json=[{"tipo": "email", "destino": f"u{i}@exemplo.com"} for i in range(10)],
    )
    codigo = codigo_novo(client)

    entrega(api, bot, atualizacao(f"/start {codigo}"))

    assert len(canais(sessao)) == 10
    assert "limite" in respostas(api)[-1]
    # Com um canal a menos, o mesmo link vale.
    client.put(
        "/auth/me/canais",
        json=[{"tipo": "email", "destino": f"u{i}@exemplo.com"} for i in range(9)],
    )
    entrega(api, bot, atualizacao(f"/start {codigo}"))
    assert len(canais(sessao)) == 10
    assert canais(sessao)[-1].tipo == "telegram"


def test_no_limite_o_chat_que_ja_e_canal_e_reativado(client, sessao, api, bot):
    outros = [{"tipo": "email", "destino": f"u{i}@exemplo.com"} for i in range(9)]
    client.put(
        "/auth/me/canais",
        json=[*outros, {"tipo": "telegram", "destino": "555", "ativo": False}],
    )
    codigo = codigo_novo(client)

    entrega(api, bot, atualizacao(f"/start {codigo}"))

    assert len(canais(sessao)) == 10
    assert canais(sessao)[-1].ativo is True
    assert "vinculado" in respostas(api)[-1]


@pytest.mark.parametrize(
    "corpo",
    [
        {},
        [],
        "texto",
        None,
        {"update_id": 1},
        {"message": {"chat": {"id": 555}}},  # sem texto (foto, adesivo...)
        {"message": {"chat": {"id": 555}, "text": "oi"}},
        {"message": {"chat": {"id": True}, "text": "/start abc"}},
        {"message": {"chat": {"id": 0}, "text": "/start abc"}},
        {"message": {"chat": {"id": "555"}, "text": "/start abc"}},
        {"message": {"chat": {"id": 555}, "text": 7}},
        {"message": [], "text": "/start abc"},
        {"edited_message": {"chat": {"id": 555}, "text": "/start abc"}},
    ],
)
def test_atualizacao_que_nao_e_um_start_valido_e_ignorada(corpo):
    assert comando_start(corpo) is None


def start_em_grupo(texto):
    return {"message": {"chat": {"id": -5}, "text": texto}}


def test_start_de_outro_bot_no_grupo_e_ignorado(monkeypatch):
    assert comando_start(start_em_grupo("/start@outro_bot abc")) is None
    assert comando_start(start_em_grupo("/start@Termolog_Bot abc")) == ("-5", "abc")
    monkeypatch.delenv("TELEGRAM_BOT_USERNAME")  # sem o nome, não dá para comparar
    assert comando_start(start_em_grupo("/start@outro_bot abc")) == ("-5", "abc")


@pytest.mark.parametrize("codigo", ["\ud800x", "a" * 65, "com espaço!", "é"])
def test_codigo_fora_do_formato_e_invalido_sem_erro(sessao, codigo):
    resultado = VinculoTelegramService(sessao).vincular(codigo, "555")

    assert resultado == ResultadoDoVinculo.CODIGO_INVALIDO
    assert processar_atualizacao(atualizacao(f"/start {codigo}"), sessao) is not None


# --- O loop do bot


def test_a_rodada_pede_so_mensagens_e_avanca_o_offset(api, bot):
    api.atualizacoes = [
        atualizacao("oi", update_id=41),
        atualizacao("oi", update_id=42),
    ]

    proximo = bot.rodada(10)

    assert proximo == 43
    ((metodo, dados),) = api.chamadas
    assert metodo == "getUpdates"
    assert dados["offset"] == 10 and dados["allowed_updates"] == ["message"]
    assert api.mensagens() == []  # só o /start recebe resposta


def test_sem_atualizacoes_o_offset_fica(api, bot):
    assert bot.rodada(10) == 10


def test_resposta_do_telegram_fora_do_formato_e_ignorada(api, bot):
    api.atualizacoes = [[], "texto", {"update_id": "1"}, {"update_id": True}, None]

    assert bot.rodada(5) == 5


def test_falha_ao_tratar_uma_atualizacao_nao_trava_as_outras(
    client, sessao, api, bot, caplog
):
    codigo = codigo_novo(client)
    api.erros["sendMessage"] = OSError("sem rede")

    proximo = entrega(
        api,
        bot,
        atualizacao(f"/start {codigo}", update_id=7),
        atualizacao("oi", update_id=8),
    )

    assert proximo == 9  # avançou mesmo com a falha
    assert [c.destino for c in canais(sessao)] == ["555"]  # o vínculo já valeu
    assert "falha ao tratar a atualização 7" in caplog.text
    assert codigo not in caplog.text and "123:token" not in caplog.text


def test_erro_da_api_no_getupdates_sobe_sem_o_token(api, bot):
    api.erros["getUpdates"] = OSError("sem rede")

    with pytest.raises(RuntimeError, match="OSError") as erro:
        bot.rodada(0)
    assert "123:token" not in str(erro.value)


def test_buscar_remove_o_webhook_antes_de_buscar_e_tenta_de_novo_apos_erro(
    api, bot, caplog
):
    parar = threading.Event()
    api.erros["getUpdates"] = OSError("sem rede")
    api.ao_buscar = parar.set  # uma busca (que falha) e o loop termina

    bot._buscar(parar)

    assert api.metodos() == ["deleteWebhook", "getUpdates"]
    assert "bot do Telegram" in caplog.text and "123:token" not in caplog.text


def test_so_um_processo_busca_as_mensagens(banco, bot, monkeypatch):
    monkeypatch.setattr(telegram_bot, "engine", lambda: banco)
    monkeypatch.setattr(telegram_bot, "ESPERA_SEM_A_VEZ_S", 0.05)
    buscas = []
    monkeypatch.setattr(bot, "_buscar", lambda parar, manter=None: buscas.append(1))
    parar = threading.Event()

    with banco.connect() as outro:
        outro.execute(
            text("SELECT pg_advisory_lock(:k)"), {"k": telegram_bot.CHAVE_DO_LOCK}
        )
        thread = threading.Thread(target=bot.rodar, args=(parar,))
        thread.start()
        thread.join(timeout=0.5)
        assert buscas == []  # outro processo já busca: este espera
        outro.execute(
            text("SELECT pg_advisory_unlock(:k)"), {"k": telegram_bot.CHAVE_DO_LOCK}
        )
        # Livre, o lock é pego e o bot passa a buscar.
        for _ in range(100):
            if buscas:
                break
            threading.Event().wait(0.05)
    parar.set()
    thread.join(timeout=5)

    assert buscas
    assert not thread.is_alive()


def test_ao_terminar_o_bot_solta_a_vez(banco, bot, monkeypatch):
    monkeypatch.setattr(telegram_bot, "engine", lambda: banco)
    monkeypatch.setattr(bot, "_buscar", lambda parar, manter: parar.set())
    parar = threading.Event()

    bot.rodar(parar)  # busca (e para) uma vez

    # Outro engine: a conexão do pool do bot reentraria no próprio lock e esconderia
    # um lock que ficou preso nela.
    outro = create_engine(database_url())
    try:
        with outro.connect() as conexao:
            pegou = conexao.scalar(
                text("SELECT pg_try_advisory_lock(:k)"),
                {"k": telegram_bot.CHAVE_DO_LOCK},
            )
    finally:
        outro.dispose()
    assert pegou


def test_conexao_do_lock_que_cai_encerra_a_busca_para_disputar_a_vez(api, bot):
    parar = threading.Event()

    def conexao_morta():
        raise OSError("conexão perdida")

    with pytest.raises(OSError, match="conexão perdida"):
        bot._buscar(parar, conexao_morta)
    assert api.metodos() == ["deleteWebhook"]  # nem chegou a buscar


def test_falha_ao_remover_o_webhook_nao_busca_e_nao_vaza_o_token(api, bot, caplog):
    api.erros["deleteWebhook"] = OSError("sem rede")

    bot._buscar(threading.Event(), lambda: None)

    assert api.metodos() == ["deleteWebhook"]
    assert "bot do Telegram" in caplog.text and "123:token" not in caplog.text


def test_buscar_dobra_a_espera_apos_erros_e_volta_ao_normal(api, bot, monkeypatch):
    parar = threading.Event()
    esperas = []
    monkeypatch.setattr(parar, "wait", lambda segundos: esperas.append(segundos))
    resultados = iter(
        [OSError("a"), OSError("b"), OSError("c"), None, OSError("d"), None]
    )

    def ao_buscar():
        r = next(resultados, "fim")
        if r == "fim":
            parar.set()
        elif r is None:
            api.erros.pop("getUpdates", None)
        else:
            api.erros["getUpdates"] = r

    api.ao_buscar = ao_buscar
    bot._buscar(parar)

    # Dobra a cada erro (1, 2, 4); o acerto zera, e o erro seguinte volta a 1.
    assert esperas == [1, 2, 4, 1]


def test_o_bot_so_liga_com_token_e_sem_o_desligamento(monkeypatch):
    assert polling_ligado()
    monkeypatch.setenv("TELEGRAM_POLLING", "false")
    assert not polling_ligado()
    monkeypatch.setenv("TELEGRAM_POLLING", "true")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "  ")
    assert not polling_ligado()


def test_ligado_sobe_a_thread_do_bot_e_ela_para_com_o_evento(monkeypatch):
    chamou = threading.Event()
    monkeypatch.setattr(BotTelegram, "rodar", lambda self, parar: chamou.set())
    parar = threading.Event()

    thread = iniciar(parar)

    assert thread is not None and thread.daemon
    thread.join(timeout=5)
    assert chamou.is_set()


def test_lifespan_da_aplicacao_sobe_e_para_o_bot(monkeypatch):
    from fastapi.testclient import TestClient

    from main import app

    eventos = []

    def iniciar_falso(parar):
        eventos.append(parar)

    monkeypatch.setattr(telegram_bot, "iniciar", iniciar_falso)
    with TestClient(app) as cliente:
        assert cliente.get("/health").status_code == 200
        (parar,) = eventos
        assert not parar.is_set()
    assert parar.is_set()  # o encerramento da aplicação manda o bot parar


def test_desligado_nao_sobe_thread(monkeypatch):
    monkeypatch.setenv("TELEGRAM_POLLING", "false")

    assert iniciar(threading.Event()) is None


# --- Concorrência (sessões independentes)


class DuasSessoes:
    """Sessões independentes no banco de teste, para os casos de concorrência."""

    def __enter__(self):
        self.engine = create_engine(database_url())
        return self

    def nova(self):
        return Session(self.engine)

    def __exit__(self, *erro):
        self.engine.dispose()


def em_outra_thread(funcao):
    resultado = {}

    def corpo():
        try:
            resultado["valor"] = funcao()
        except Exception as erro:  # noqa: BLE001
            resultado["erro"] = erro

    thread = threading.Thread(target=corpo)
    thread.start()
    return thread, resultado


def test_dois_start_com_o_mesmo_codigo_vinculam_uma_vez(client, sessao):
    codigo = codigo_novo(client)
    with DuasSessoes() as banco, banco.nova() as a, banco.nova() as b:
        primeiro = VinculoTelegramService(a).vincular(codigo, "111")  # segura a trava
        thread, segundo = em_outra_thread(
            lambda: (VinculoTelegramService(b).vincular(codigo, "222"), b.commit())[0]
        )
        thread.join(timeout=0.5)
        assert thread.is_alive()  # b espera o usuário ser liberado por a
        a.commit()
        thread.join(timeout=10)

    assert primeiro == ResultadoDoVinculo.VINCULADO
    assert segundo["valor"] == ResultadoDoVinculo.CODIGO_INVALIDO
    assert [c.destino for c in canais(sessao)] == ["111"]


def test_gerar_novo_codigo_durante_o_vinculo_nao_trava_nem_derruba(client, sessao):
    """Mesma ordem de travas nos dois: sem deadlock, o gerar só espera e segue."""
    codigo = codigo_novo(client)
    with DuasSessoes() as banco, banco.nova() as a, banco.nova() as b:
        VinculoTelegramService(a).vincular(codigo, "111")
        usuario_id = a.scalar(select(CanalDoUsuario.usuario_id))

        def gerar():
            novo = VinculoTelegramService(b).gerar(usuario_id)
            b.commit()
            return novo

        thread, gerado = em_outra_thread(gerar)
        thread.join(timeout=0.5)
        assert thread.is_alive()
        a.commit()
        thread.join(timeout=10)

    assert "erro" not in gerado
    assert [c.destino for c in canais(sessao)] == ["111"]
    assert len(list(sessao.scalars(select(VinculoTelegram)))) == 1
