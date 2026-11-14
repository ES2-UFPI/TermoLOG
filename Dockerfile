FROM python:3.14-slim

WORKDIR /code

COPY ./requirements.txt /code/requirements.txt

RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt

COPY ./backend /code/backend

# Dois workers: cada um é um processo com o próprio GIL, então um PDF pesado num
# deles não atrasa a ingestão dos gateways atendida pelo outro. Em troca, a memória
# ociosa e as conexões com o banco dobram, e os limites por processo também: os
# PDFs simultâneos (1 por worker, 2 no contêiner) e os hashes de senha (4 por
# worker). Não há estado em memória compartilhado entre requisições.
CMD ["fastapi", "run", "backend/main.py", "--port", "8080", "--workers", "2"]

# If running behind a proxy like Nginx or Traefik add --proxy-headers
# CMD ["fastapi", "run", "app/main.py", "--port", "8080", "--proxy-headers"]