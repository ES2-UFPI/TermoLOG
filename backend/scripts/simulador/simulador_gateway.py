#!/usr/bin/env python3
"""Simulador de gateways: envia lotes de leituras para POST /gateways/{id}/leituras.

Carrega gateways, salas e sensores da API e mostra uma interface Tkinter
agrupada por sala -> sensor, onde dá para ajustar temperatura, umidade e o
intervalo de envio. Cada gateway envia só as leituras dos seus sensores, com a
própria chave de API (Bearer), que a API só devolve na criação do gateway;
as chaves gravadas pelo seed.py em chaves.json são preenchidas sozinhas.

Uso: python3 simulador_gateway.py [URL_BASE]   (padrão: http://localhost:8000)
"""

import json
import queue
import sys
import threading
import tkinter as tk
import urllib.error
import urllib.request
import uuid
from datetime import UTC, datetime
from pathlib import Path
from tkinter import ttk

URL_PADRAO = "http://localhost:8000"
# Chaves de API gravadas pelo seed.py: {"gateway_id": "chave"}.
ARQUIVO_CHAVES = Path(__file__).with_name("chaves.json")


def requisitar(metodo, url, corpo=None, token=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(url, data=dados, method=metodo)
    req.add_header("Accept", "application/json")
    if dados is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as erro:
        texto = erro.read().decode(errors="replace")
        try:
            return erro.code, json.loads(texto)
        except ValueError:
            return erro.code, texto


def ler_chaves():
    try:
        return {int(g): c for g, c in json.loads(ARQUIVO_CHAVES.read_text()).items()}
    except (OSError, ValueError):
        return {}


def carregar_dados(base):
    """Retorna (gateways, salas, sensores_por_sala)."""
    status, gateways = requisitar("GET", f"{base}/gateways")
    if status != 200:
        raise RuntimeError(f"GET /gateways -> {status}: {gateways}")
    status, salas = requisitar("GET", f"{base}/salas")
    if status != 200:
        raise RuntimeError(f"GET /salas -> {status}: {salas}")
    sensores = {}
    for sala in salas:
        status, lista = requisitar("GET", f"{base}/salas/{sala['id']}/sensores")
        if status != 200:
            raise RuntimeError(f"GET /salas/{sala['id']}/sensores -> {status}: {lista}")
        sensores[sala["id"]] = lista
    return gateways, salas, sensores


class FrameRolavel(ttk.Frame):
    def __init__(self, pai):
        super().__init__(pai)
        canvas = tk.Canvas(self, highlightthickness=0)
        barra = ttk.Scrollbar(self, orient="vertical", command=canvas.yview)
        self.interno = ttk.Frame(canvas)
        self.interno.bind(
            "<Configure>", lambda _: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        janela = canvas.create_window((0, 0), window=self.interno, anchor="nw")
        canvas.bind(
            "<Configure>", lambda e: canvas.itemconfigure(janela, width=e.width)
        )
        canvas.configure(yscrollcommand=barra.set)
        canvas.pack(side="left", fill="both", expand=True)
        barra.pack(side="right", fill="y")
        for evento, passo in (("<Button-4>", -1), ("<Button-5>", 1)):
            canvas.bind_all(evento, lambda _, p=passo: canvas.yview_scroll(p, "units"))
        canvas.bind_all(
            "<MouseWheel>", lambda e: canvas.yview_scroll(-e.delta // 120, "units")
        )


class Simulador(tk.Tk):
    def __init__(self, base):
        super().__init__()
        self.title("Simulador de gateways")
        self.geometry("1024x768")

        self.base = tk.StringVar(value=base)
        self.intervalo = tk.DoubleVar(value=5.0)
        self.tokens = {}  # gateway_id -> StringVar
        self.sensores = {}  # sensor_id -> {"gateway_id", "temperatura", "umidade", "enviar"}
        self.versao_config = {}  # gateway_id -> int
        self.respostas = queue.Queue()
        self.agendamento = None
        self.enviando = False

        self._montar_topo()
        self.conteudo = ttk.Frame(self)
        self.conteudo.pack(fill="both", expand=True, padx=8)
        self.log = tk.Text(self, height=8, state="disabled")
        self.log.pack(fill="x", padx=8, pady=(4, 8))

        self.after(200, self._ler_respostas)
        self.recarregar()

    def _montar_topo(self):
        topo = ttk.Frame(self)
        topo.pack(fill="x", padx=8, pady=8)
        ttk.Label(topo, text="API:").pack(side="left")
        ttk.Entry(topo, textvariable=self.base, width=28).pack(side="left", padx=4)
        ttk.Button(topo, text="Recarregar", command=self.recarregar).pack(side="left")
        ttk.Label(topo, text="Intervalo (s):").pack(side="left", padx=(16, 4))
        ttk.Spinbox(
            topo,
            from_=0.5,
            to=3600,
            increment=0.5,
            textvariable=self.intervalo,
            width=7,
        ).pack(side="left")
        self.botao = ttk.Button(topo, text="Iniciar", command=self.alternar)
        self.botao.pack(side="left", padx=8)
        ttk.Button(topo, text="Enviar agora", command=self.enviar).pack(side="left")

    def escrever(self, texto):
        hora = datetime.now().strftime("%H:%M:%S")
        self.log.configure(state="normal")
        self.log.insert("end", f"[{hora}] {texto}\n")
        self.log.see("end")
        self.log.configure(state="disabled")

    def recarregar(self):
        base = self.base.get().rstrip("/")
        try:
            gateways, salas, sensores_por_sala = carregar_dados(base)
        except (OSError, RuntimeError) as erro:
            self.escrever(f"Erro ao carregar: {erro}")
            return

        # Chave digitada na janela vale mais que a do arquivo.
        chaves = ler_chaves() | {g: v.get() for g, v in self.tokens.items() if v.get()}
        for filho in self.conteudo.winfo_children():
            filho.destroy()
        self.tokens.clear()
        self.sensores.clear()

        caixa_gw = ttk.LabelFrame(self.conteudo, text="Gateways (chave de API)")
        caixa_gw.pack(fill="x", pady=(0, 8))
        for linha, gw in enumerate(gateways):
            estado = "online" if gw["online"] else "offline"
            ttk.Label(caixa_gw, text=f"#{gw['id']} {gw['nome']} ({estado})").grid(
                row=linha, column=0, sticky="w", padx=6, pady=2
            )
            var = tk.StringVar(value=chaves.get(gw["id"], ""))
            ttk.Entry(caixa_gw, textvariable=var, show="•", width=50).grid(
                row=linha, column=1, sticky="ew", padx=6, pady=2
            )
            self.tokens[gw["id"]] = var
            self.versao_config.setdefault(gw["id"], 0)
        caixa_gw.columnconfigure(1, weight=1)

        rolavel = FrameRolavel(self.conteudo)
        rolavel.pack(fill="both", expand=True)
        for sala in salas:
            caixa = ttk.LabelFrame(
                rolavel.interno, text=f"Sala {sala['nome']} (#{sala['id']})"
            )
            caixa.pack(fill="x", pady=4, padx=2)
            lista = sensores_por_sala.get(sala["id"], [])
            if not lista:
                ttk.Label(caixa, text="Sem sensores").pack(anchor="w", padx=6)
            for sensor in lista:
                self._linha_sensor(caixa, sensor)

        self.escrever(
            f"{len(gateways)} gateways, {len(salas)} salas, {len(self.sensores)} sensores carregados"
        )

    def _linha_sensor(self, pai, sensor):
        linha = ttk.Frame(pai)
        linha.pack(fill="x", padx=6, pady=2)
        enviar = tk.BooleanVar(value=sensor["ativo"])
        temperatura = tk.DoubleVar(value=25.0)
        umidade = tk.DoubleVar(value=60.0)

        rotulo = f"Sensor #{sensor['id']} (gw {sensor['gateway_id']})"
        if not sensor["ativo"]:
            rotulo += " inativo"
        ttk.Checkbutton(linha, text=rotulo, variable=enviar, width=26).pack(side="left")
        for texto, var, minimo, maximo in (
            ("Temp °C", temperatura, -40, 85),
            ("Umid %", umidade, 0, 100),
        ):
            ttk.Label(linha, text=texto).pack(side="left", padx=(8, 2))
            ttk.Scale(
                linha,
                from_=minimo,
                to=maximo,
                variable=var,
                command=lambda v, var=var: var.set(round(float(v), 1)),
            ).pack(side="left", fill="x", expand=True)
            ttk.Spinbox(
                linha, from_=minimo, to=maximo, increment=0.1, textvariable=var, width=6
            ).pack(side="left", padx=2)

        self.sensores[sensor["id"]] = {
            "gateway_id": sensor["gateway_id"],
            "temperatura": temperatura,
            "umidade": umidade,
            "enviar": enviar,
        }

    def alternar(self):
        if self.enviando:
            self.enviando = False
            if self.agendamento:
                self.after_cancel(self.agendamento)
                self.agendamento = None
            self.botao.configure(text="Iniciar")
            self.escrever("Envio parado")
        else:
            self.enviando = True
            self.botao.configure(text="Parar")
            self.escrever("Envio iniciado")
            self._ciclo()

    def _ciclo(self):
        if not self.enviando:
            return
        self.enviar()
        try:
            segundos = max(0.5, float(self.intervalo.get()))
        except (tk.TclError, ValueError):
            segundos = 5.0
        self.agendamento = self.after(int(segundos * 1000), self._ciclo)

    def enviar(self):
        """Monta um lote por gateway com os valores atuais e envia em segundo plano."""
        agora = datetime.now(UTC).isoformat(timespec="milliseconds")
        lotes = {}
        for sensor_id, s in self.sensores.items():
            if not s["enviar"].get():
                continue
            try:
                leitura = {
                    "sensor_id": sensor_id,
                    "temperatura": float(s["temperatura"].get()),
                    "umidade": float(s["umidade"].get()),
                    "data_hora": agora,
                }
            except (tk.TclError, ValueError):
                self.escrever(f"Sensor #{sensor_id}: valor inválido, ignorado")
                continue
            lotes.setdefault(s["gateway_id"], []).append(leitura)

        base = self.base.get().rstrip("/")
        for gateway_id, leituras in lotes.items():
            token = self.tokens.get(gateway_id, tk.StringVar()).get().strip()
            if not token:
                self.escrever(
                    f"Gateway #{gateway_id}: sem chave de API, lote não enviado"
                )
                continue
            # A API aceita no máximo 100 leituras por lote.
            for i in range(0, len(leituras), 100):
                corpo = {
                    "lote_id": str(uuid.uuid4()),
                    "versao_config": self.versao_config.get(gateway_id, 0),
                    "comandos_concluidos": [],
                    "leituras": leituras[i : i + 100],
                }
                threading.Thread(
                    target=self._postar,
                    args=(base, gateway_id, token, corpo),
                    daemon=True,
                ).start()

    def _postar(self, base, gateway_id, token, corpo):
        try:
            status, resposta = requisitar(
                "POST", f"{base}/gateways/{gateway_id}/leituras", corpo, token
            )
        except OSError as erro:
            status, resposta = None, str(erro)
        self.respostas.put((gateway_id, len(corpo["leituras"]), status, resposta))

    def _ler_respostas(self):
        while not self.respostas.empty():
            gateway_id, total, status, resposta = self.respostas.get()
            if status in (200, 201) and isinstance(resposta, dict):
                texto = f"aceitas {resposta.get('aceitas')}/{total}"
                if resposta.get("rejeitadas"):
                    texto += f", rejeitadas {resposta['rejeitadas']}"
                config = resposta.get("config")
                if isinstance(config, dict) and isinstance(config.get("versao"), int):
                    self.versao_config[gateway_id] = config["versao"]
                if resposta.get("comandos"):
                    texto += f", comandos {resposta['comandos']}"
            else:
                texto = f"erro {status}: {resposta}"
            self.escrever(f"Gateway #{gateway_id}: {texto}")
        self.after(200, self._ler_respostas)


if __name__ == "__main__":
    Simulador(sys.argv[1] if len(sys.argv) > 1 else URL_PADRAO).mainloop()
