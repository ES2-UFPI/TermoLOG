#!/bin/sh
set -e

Xvfb :0 -screen 0 1024x768x24 -nolisten tcp &
sleep 1
x11vnc -display :0 -forever -shared -nopw -quiet -localhost &
websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &

echo "Simulador em http://localhost:6080/vnc.html?autoconnect=1&resize=scale"
# Fechar a janela do simulador encerra o contêiner.
exec python3 simulador_gateway.py "$API_URL"
