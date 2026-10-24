# Roda o simulador Tkinter numa tela virtual (Xvfb) exposta no navegador via noVNC,
# para funcionar igual em qualquer máquina sem instalar Tk nem servidor gráfico.
# O código entra por volume (compose.yaml), para o seed.py gravar chaves.json na pasta.
FROM debian:trixie-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        python3 python3-tk xvfb x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV DISPLAY=:0 \
    PYTHONDONTWRITEBYTECODE=1 \
    API_URL=http://host.docker.internal:8000

EXPOSE 6080
CMD ["sh", "iniciar.sh"]
