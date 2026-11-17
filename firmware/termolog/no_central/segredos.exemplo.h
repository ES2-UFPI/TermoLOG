// Modelo das configurações locais do nó central. Copie para segredos.h, que fica fora do git,
// e preencha. Não coloque a senha do Wi-Fi nem a chave da API neste arquivo.
#pragma once

#define WIFI_SSID "nome-da-rede"
#define WIFI_SENHA "senha-da-rede"

// URL base da API, sem barra no fim. http:// só em rede local ou VPN de desenvolvimento.
#define API_URL "http://192.168.0.10:8000"

// ID e chave do gateway, devolvidos por POST /gateways. A chave aparece só nessa resposta.
#define GATEWAY_ID 1
#define CHAVE_API_GATEWAY "cole-a-chave-aqui"

// Certificado raiz (PEM) que assina o certificado da API. Só é usado com https://, e sem ele a
// conexão HTTPS falha: o nó central não aceita servidor sem verificar o certificado.
#define API_CA_CERT ""
