# Simulador de gateways

Envia leituras falsas para `POST /gateways/{id}/leituras`, sem precisar da placa. Carrega da API os gateways, as salas e os sensores e mostra uma janela agrupada por sala e sensor, onde dá para mudar a temperatura, a umidade e o intervalo de envio.

Roda num contêiner e abre no navegador, então só precisa do Docker.

## Como rodar

1. Suba a API e o banco e aplique as migrations (na raiz do repositório):

   ```bash
   docker compose up -d --build
   docker compose run --rm -w /code/backend web alembic upgrade head
   ```

2. Crie um usuário do painel, se ainda não tiver um ([README principal](../../../README.md#criar-um-usuário-do-painel)). O simulador entra com ele para carregar as listas de gateways, salas e sensores, que são rotas do painel e exigem login.

3. Opcional: cadastre dados de exemplo (2 gateways, 3 salas e 6 sensores). Cada execução cadastra um conjunto novo. O `seed.py` pede o e-mail e a senha do usuário do painel.

   ```bash
   docker compose -f backend/scripts/simulador/compose.yaml run --rm simulador python3 seed.py
   ```

4. Suba o simulador:

   ```bash
   docker compose -f backend/scripts/simulador/compose.yaml up --build
   ```

5. Abra <http://localhost:6080/vnc.html?autoconnect=1&resize=scale>, preencha o e-mail e a senha do painel e clique em **Recarregar**.

6. Ajuste os valores e clique em **Enviar agora**, ou em **Iniciar** para enviar a cada intervalo. As respostas da API aparecem no log embaixo.

Para parar: `docker compose -f backend/scripts/simulador/compose.yaml down`. Fechar a janela do simulador também encerra o contêiner.

## Login no painel

Para não digitar o login a cada vez, exporte `PAINEL_EMAIL` e `PAINEL_SENHA` antes dos comandos acima. O `seed.py` usa as duas sem perguntar, e a janela já abre com os campos preenchidos. Para a senha não ficar no histórico do shell, leia com `read -rs PAINEL_SENHA && export PAINEL_SENHA`.

O login só serve para carregar as listas e cadastrar no `seed.py`. O envio de leituras usa apenas a chave de API de cada gateway.

## Chaves de API

O envio exige a chave de API de cada gateway, que a API só mostra no cadastro (`POST /gateways`). O `seed.py` grava as chaves em `chaves.json`, nesta pasta, e a janela as preenche sozinha. Para gateways cadastrados de outro jeito, cole a chave no campo do gateway. Gateway sem chave não envia nada.

## Outra API

O padrão é a API do Compose principal, acessada de dentro do contêiner por `http://host.docker.internal:8000`. Para usar outra, troque no campo da janela ou defina `API_URL`:

```bash
API_URL=http://192.168.0.10:8000 docker compose -f backend/scripts/simulador/compose.yaml up --build
```

A página do noVNC não tem senha, por isso a porta 6080 só aceita conexões da própria máquina.
