#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <LittleFS.h>
#include <LoRa.h>
#include <Preferences.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include <algorithm>
#include <vector>

// Wi-Fi, URL da API e credenciais do gateway ficam fora do git (ver segredos.exemplo.h).
#if __has_include("segredos.h")
#include "segredos.h"
#else
#error "Copie segredos.exemplo.h para segredos.h e preencha o Wi-Fi, a API e a chave do gateway."
#endif

// Ciclo de envio: as leituras recebidas por LoRa vão sendo guardadas na flash e, a cada ciclo,
// o nó central envia à API todos os lotes pendentes. Pode vir do build (-D CICLO_ENVIO_S=300).
#ifndef CICLO_ENVIO_S
#define CICLO_ENVIO_S 30
#endif
static_assert(CICLO_ENVIO_S >= 10, "CICLO_ENVIO_S tem que ser de pelo menos 10 s");

// Módulo LoRa SX1276/RFM95 no SPI padrão do ESP32 (SCK 18, MISO 19, MOSI 23).
const int LORA_PINO_NSS = 5;
const int LORA_PINO_RST = 4;
const int LORA_PINO_DIO0 = 2;

// Parâmetros do rádio. Têm que ser iguais aos do nó de borda (no_borda.ino).
const long LORA_FREQUENCIA_HZ = 915E6;  // faixa de 915 MHz usada no Brasil
const uint8_t LORA_SYNC_WORD = 0x54;    // separa a rede do TermoLOG de outras redes LoRa

// Formato dos pacotes LoRa. Tem que ser idêntico ao do nó de borda (no_borda.ino).
const uint8_t PROTOCOLO_VERSAO = 1;
const uint8_t PACOTE_LEITURA = 1;
const uint8_t PACOTE_ACK = 2;

struct __attribute__((packed)) PacoteLeitura {
  uint8_t versao;
  uint8_t tipo;
  uint32_t sensorId;
  uint16_t sequencia;
  int16_t temperaturaDecimos;  // °C x 10 (resolução do DHT22)
  uint16_t umidadeDecimos;     // % x 10
};

struct __attribute__((packed)) PacoteAck {
  uint8_t versao;
  uint8_t tipo;
  uint32_t sensorId;
  uint16_t sequencia;
};

// ---------------------------------------------------------------------------------------
// Fila de lotes na flash (LittleFS)
//
// Cada lote é um arquivo em /lotes: o lote_id (UUID, 36 caracteres) seguido das leituras,
// 12 bytes cada. As leituras novas entram em atual.bin. No ciclo de envio, ou quando ele chega
// a 100 leituras (o máximo do contrato), atual.bin vira um lote pendente numerado
// (00000001.bin, 00000002.bin...). Estar em /lotes com número é o que marca o lote como não
// enviado: ele só é apagado quando a API confirma com 201. O lote_id fica gravado no arquivo
// porque um lote reenviado tem que manter o mesmo ID (Contrato de API, 1.2), mesmo que o nó
// central reinicie entre o envio e a resposta.
// ---------------------------------------------------------------------------------------

const char* DIRETORIO_LOTES = "/lotes";
const char* ARQUIVO_ATUAL = "/lotes/atual.bin";
const char* ARQUIVO_TEMPORARIO = "/lotes/tmp.bin";
const size_t TAMANHO_LOTE_ID = 36;
const size_t MAX_LEITURAS_POR_LOTE = 100;

// Acima deste uso da flash, os lotes pendentes mais antigos são descartados para caber as
// leituras novas: depois de uma queda longa, o que mais importa é o estado atual das salas.
const float USO_MAXIMO_FLASH = 0.85;

struct __attribute__((packed)) RegistroLeitura {
  uint32_t sensorId;
  uint32_t dataHora;  // segundos desde 1970, UTC
  int16_t temperaturaDecimos;
  uint16_t umidadeDecimos;
};

// O próximo número de lote fica na NVS para os nomes não se repetirem depois de reiniciar.
const char* NVS_NAMESPACE = "termolog";
const char* NVS_CHAVE_PROXIMO_LOTE = "prox_lote";
Preferences preferencias;
uint32_t proximoLote = 1;

// A fila é usada pelo loop (grava as leituras do LoRa) e pela tarefa de envio (lê e apaga os
// lotes), que rodam em núcleos diferentes.
SemaphoreHandle_t mutexFila;

// ---------------------------------------------------------------------------------------
// Envio para a API
// ---------------------------------------------------------------------------------------

const uint32_t TIMEOUT_HTTP_MS = 30000;  // Contrato de API, 1.2
const uint32_t ESPERA_WIFI_MS = 15000;

// O backend ainda não versiona a configuração (US03): manda sempre 0 e ignora o campo config.
const uint32_t VERSAO_CONFIG = 0;

// Heartbeat: sem nada para enviar por 60 s, manda um lote vazio, para o backend saber que o
// gateway está online e para receber configuração e comandos (Contrato de API, 1.2).
const uint32_t INTERVALO_HEARTBEAT_MS = 60000;
uint32_t ultimoContatoMs = 0;
bool jaContatou = false;  // depois de ligar, faz contato no primeiro ciclo

WiFiClient clienteHttp;
WiFiClientSecure clienteHttps;

enum ResultadoEnvio { LOTE_ENVIADO, LOTE_DESCARTADO, ENVIO_FALHOU };

// ---------------------------------------------------------------------------------------
// Leituras recebidas antes de o relógio estar certo
//
// A data_hora da leitura é a do recebimento, pelo relógio do nó central acertado por NTP. Se ele
// reiniciar sem internet, ainda não sabe a hora: as leituras esperam aqui, com o millis() do
// recebimento, e são gravadas com a hora corrigida assim que o NTP responde.
// ---------------------------------------------------------------------------------------

const uint32_t RELOGIO_VALIDO_A_PARTIR_DE = 1700000000;  // nov/2023: antes disso não sincronizou
const int MAX_LEITURAS_SEM_HORA = 256;

struct LeituraSemHora {
  RegistroLeitura registro;
  uint32_t recebidaEmMs;
};
LeituraSemHora leiturasSemHora[MAX_LEITURAS_SEM_HORA];
int totalSemHora = 0;

// ---------------------------------------------------------------------------------------
// Leituras repetidas pelo LoRa
// ---------------------------------------------------------------------------------------

// Última sequência recebida de cada sensor, para não contar duas vezes a mesma leitura
// quando o nó de borda reenvia porque o ack se perdeu.
const int MAX_SENSORES = 32;
struct UltimaSequencia {
  uint32_t sensorId;
  uint16_t sequencia;
};
UltimaSequencia ultimas[MAX_SENSORES];
int totalSensores = 0;

// Devolve true se a leitura é nova e atualiza a última sequência do sensor.
bool leituraNova(uint32_t sensorId, uint16_t seq) {
  for (int i = 0; i < totalSensores; i++) {
    if (ultimas[i].sensorId == sensorId) {
      if (ultimas[i].sequencia == seq) return false;
      ultimas[i].sequencia = seq;
      return true;
    }
  }
  if (totalSensores < MAX_SENSORES) ultimas[totalSensores++] = {sensorId, seq};
  return true;
}

// ---------------------------------------------------------------------------------------
// Fila de lotes: funções chamadas com o mutexFila já tomado
// ---------------------------------------------------------------------------------------

void caminhoDoLote(uint32_t numero, char* caminho, size_t tamanho) {
  snprintf(caminho, tamanho, "%s/%08lu.bin", DIRETORIO_LOTES, static_cast<unsigned long>(numero));
}

size_t leiturasNoArquivo(size_t tamanhoArquivo) {
  return tamanhoArquivo < TAMANHO_LOTE_ID ? 0
                                          : (tamanhoArquivo - TAMANHO_LOTE_ID) / sizeof(RegistroLeitura);
}

// Números dos lotes pendentes, do mais antigo para o mais novo.
std::vector<uint32_t> listarPendentes() {
  std::vector<uint32_t> numeros;
  File diretorio = LittleFS.open(DIRETORIO_LOTES);
  if (!diretorio) return numeros;
  for (File arquivo = diretorio.openNextFile(); arquivo; arquivo = diretorio.openNextFile()) {
    const char* nome = arquivo.name();
    char* fim;
    unsigned long numero = strtoul(nome, &fim, 10);
    if (fim != nome && strcmp(fim, ".bin") == 0) numeros.push_back(numero);
    arquivo.close();
  }
  std::sort(numeros.begin(), numeros.end());
  return numeros;
}

// Descarta os lotes pendentes mais antigos até o uso da flash voltar ao limite.
void liberarEspaco() {
  while (LittleFS.usedBytes() > LittleFS.totalBytes() * USO_MAXIMO_FLASH) {
    std::vector<uint32_t> pendentes = listarPendentes();
    if (pendentes.empty()) return;
    char caminho[32];
    caminhoDoLote(pendentes.front(), caminho, sizeof(caminho));
    File arquivo = LittleFS.open(caminho);
    size_t descartadas = arquivo ? leiturasNoArquivo(arquivo.size()) : 0;
    arquivo.close();
    LittleFS.remove(caminho);
    Serial.printf("Flash cheia: lote %s descartado sem envio (%u leituras perdidas)\n", caminho,
                  descartadas);
  }
}

void gerarLoteId(char* saida) {  // saida com TAMANHO_LOTE_ID + 1 bytes
  uint8_t b[16];
  esp_fill_random(b, sizeof(b));
  b[6] = (b[6] & 0x0F) | 0x40;  // UUID versão 4
  b[8] = (b[8] & 0x3F) | 0x80;  // variante RFC 4122
  snprintf(saida, TAMANHO_LOTE_ID + 1,
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", b[0], b[1], b[2],
           b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
}

size_t leiturasNoLoteAtual() {
  File atual = LittleFS.open(ARQUIVO_ATUAL);
  if (!atual) return 0;
  size_t leituras = leiturasNoArquivo(atual.size());
  atual.close();
  return leituras;
}

// Transforma atual.bin em um lote pendente e devolve o número dele. Um lote sem leituras
// continua sendo o atual, e aí devolve 0.
uint32_t fecharLoteAtual() {
  size_t leituras = leiturasNoLoteAtual();
  if (leituras == 0) return 0;

  uint32_t numero = proximoLote;
  char caminho[32];
  caminhoDoLote(numero, caminho, sizeof(caminho));
  if (!LittleFS.rename(ARQUIVO_ATUAL, caminho)) {
    Serial.printf("Falha ao fechar o lote atual em %s\n", caminho);
    return 0;
  }
  proximoLote++;
  preferencias.begin(NVS_NAMESPACE, false);
  preferencias.putUInt(NVS_CHAVE_PROXIMO_LOTE, proximoLote);
  preferencias.end();
  Serial.printf("Lote %s fechado com %u leituras\n", caminho, leituras);
  return numero;
}

bool armazenar(const RegistroLeitura& registro) {
  if (!LittleFS.exists(ARQUIVO_ATUAL)) {
    liberarEspaco();
    File novo = LittleFS.open(ARQUIVO_ATUAL, FILE_WRITE);
    if (!novo) return false;
    char loteId[TAMANHO_LOTE_ID + 1];
    gerarLoteId(loteId);
    novo.write(reinterpret_cast<const uint8_t*>(loteId), TAMANHO_LOTE_ID);
    novo.close();
  }

  File atual = LittleFS.open(ARQUIVO_ATUAL, FILE_APPEND);
  if (!atual) return false;
  bool gravou = atual.write(reinterpret_cast<const uint8_t*>(&registro), sizeof(registro)) ==
                sizeof(registro);
  size_t leituras = leiturasNoArquivo(atual.size());
  atual.close();

  if (leituras >= MAX_LEITURAS_POR_LOTE) fecharLoteAtual();
  return gravou;
}

// Se faltou energia no meio de uma gravação, atual.bin pode terminar com uma leitura pela
// metade, e as próximas ficariam desalinhadas. Na partida, mantém só as leituras inteiras.
void recuperarLoteAtual() {
  File atual = LittleFS.open(ARQUIVO_ATUAL);
  if (!atual) return;
  size_t tamanho = atual.size();
  if (tamanho < TAMANHO_LOTE_ID) {
    atual.close();
    LittleFS.remove(ARQUIVO_ATUAL);
    return;
  }
  size_t inteiro = TAMANHO_LOTE_ID + leiturasNoArquivo(tamanho) * sizeof(RegistroLeitura);
  if (inteiro == tamanho) {
    atual.close();
    return;
  }

  File copia = LittleFS.open(ARQUIVO_TEMPORARIO, FILE_WRITE);
  uint8_t bloco[128];
  for (size_t restante = inteiro; restante > 0;) {
    size_t lidos = atual.read(bloco, std::min(restante, sizeof(bloco)));
    if (lidos == 0) break;
    copia.write(bloco, lidos);
    restante -= lidos;
  }
  atual.close();
  copia.close();
  LittleFS.remove(ARQUIVO_ATUAL);
  LittleFS.rename(ARQUIVO_TEMPORARIO, ARQUIVO_ATUAL);
  Serial.printf("Lote atual recuperado: %u bytes de uma leitura incompleta descartados\n",
                tamanho - inteiro);
}

// Lê um lote pendente inteiro. Devolve false se o arquivo estiver corrompido.
bool lerLote(uint32_t numero, String& loteId, std::vector<RegistroLeitura>& leituras) {
  char caminho[32];
  caminhoDoLote(numero, caminho, sizeof(caminho));
  File arquivo = LittleFS.open(caminho);
  if (!arquivo || arquivo.size() < TAMANHO_LOTE_ID) return false;

  char id[TAMANHO_LOTE_ID + 1] = {};
  arquivo.read(reinterpret_cast<uint8_t*>(id), TAMANHO_LOTE_ID);
  loteId = id;
  leituras.resize(leiturasNoArquivo(arquivo.size()));
  size_t bytes = leituras.size() * sizeof(RegistroLeitura);
  bool ok = arquivo.read(reinterpret_cast<uint8_t*>(leituras.data()), bytes) == bytes;
  arquivo.close();
  return ok && !leituras.empty() && leituras.size() <= MAX_LEITURAS_POR_LOTE;
}

void apagarLote(uint32_t numero) {
  char caminho[32];
  caminhoDoLote(numero, caminho, sizeof(caminho));
  LittleFS.remove(caminho);
}

// Grava uma leitura na fila, tomando o mutex.
void guardar(const RegistroLeitura& registro) {
  xSemaphoreTake(mutexFila, portMAX_DELAY);
  bool gravou = armazenar(registro);
  xSemaphoreGive(mutexFila);
  if (!gravou) Serial.printf("Falha ao gravar na flash a leitura do sensor %lu\n", registro.sensorId);
}

// ---------------------------------------------------------------------------------------
// Relógio
// ---------------------------------------------------------------------------------------

bool relogioCerto() {
  return time(nullptr) >= RELOGIO_VALIDO_A_PARTIR_DE;
}

void formatarDataHora(uint32_t segundos, char* saida, size_t tamanho) {
  time_t t = segundos;
  struct tm utc;
  gmtime_r(&t, &utc);
  strftime(saida, tamanho, "%Y-%m-%dT%H:%M:%SZ", &utc);
}

// Grava as leituras que esperavam o NTP, com a hora em que foram recebidas.
void gravarLeiturasSemHora() {
  if (totalSemHora == 0 || !relogioCerto()) return;
  uint32_t agora = time(nullptr);
  uint32_t agoraMs = millis();
  for (int i = 0; i < totalSemHora; i++) {
    RegistroLeitura registro = leiturasSemHora[i].registro;
    registro.dataHora = agora - (agoraMs - leiturasSemHora[i].recebidaEmMs) / 1000;
    guardar(registro);
  }
  Serial.printf("Relógio acertado: %d leituras recebidas antes disso foram gravadas\n",
                totalSemHora);
  totalSemHora = 0;
}

void esperarRelogio(const RegistroLeitura& registro) {
  if (totalSemHora == MAX_LEITURAS_SEM_HORA) {
    // Sem NTP por muito tempo: descarta a mais antiga para guardar a nova.
    memmove(leiturasSemHora, leiturasSemHora + 1, sizeof(LeituraSemHora) * (MAX_LEITURAS_SEM_HORA - 1));
    totalSemHora--;
    Serial.println("Relógio ainda sem NTP: leitura mais antiga em espera descartada");
  }
  leiturasSemHora[totalSemHora++] = {registro, static_cast<uint32_t>(millis())};
}

// ---------------------------------------------------------------------------------------
// Envio dos lotes (tarefa no núcleo 0, separada do LoRa)
// ---------------------------------------------------------------------------------------

bool conectarWifi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_SENHA);
  unsigned long inicio = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - inicio < ESPERA_WIFI_MS) delay(250);
  return WiFi.status() == WL_CONNECTED;
}

String montarCorpo(const String& loteId, const std::vector<RegistroLeitura>& leituras) {
  JsonDocument doc;
  doc["lote_id"] = loteId;
  doc["versao_config"] = VERSAO_CONFIG;
  doc["comandos_concluidos"].to<JsonArray>();
  JsonArray itens = doc["leituras"].to<JsonArray>();
  for (const RegistroLeitura& r : leituras) {
    JsonObject item = itens.add<JsonObject>();
    item["sensor_id"] = r.sensorId;
    // Uma casa decimal, como o DHT22 mede; um float puro sairia como 23.39999962.
    char numero[12];
    snprintf(numero, sizeof(numero), "%.1f", r.temperaturaDecimos / 10.0f);
    item["temperatura"] = serialized(String(numero));
    snprintf(numero, sizeof(numero), "%.1f", r.umidadeDecimos / 10.0f);
    item["umidade"] = serialized(String(numero));
    char dataHora[24];
    formatarDataHora(r.dataHora, dataHora, sizeof(dataHora));
    item["data_hora"] = dataHora;
  }
  String corpo;
  serializeJson(doc, corpo);
  return corpo;
}

void registrarRespostaDoLote(const String& resposta) {
  JsonDocument doc;
  if (deserializeJson(doc, resposta)) return;
  Serial.printf("  aceitas: %d | rejeitadas: %u\n", doc["aceitas"].as<int>(),
                doc["rejeitadas"].size());
  for (JsonObject rejeitada : doc["rejeitadas"].as<JsonArray>()) {
    Serial.printf("  rejeitada: índice %d, sensor %d, motivo %s\n", rejeitada["indice"].as<int>(),
                  rejeitada["sensor_id"].as<int>(), rejeitada["motivo"].as<const char*>());
  }
}

// Faz o POST do lote. Devolve o status HTTP, ou um código negativo do HTTPClient quando não
// houve resposta.
int postarLote(const String& corpo, String& resposta) {
  String url = String(API_URL) + "/gateways/" + GATEWAY_ID + "/leituras";
  HTTPClient http;
  http.setTimeout(TIMEOUT_HTTP_MS);
  http.setConnectTimeout(TIMEOUT_HTTP_MS);
  bool usaHttps = url.startsWith("https://");
  if (!(usaHttps ? http.begin(clienteHttps, url) : http.begin(clienteHttp, url))) {
    resposta = "URL da API inválida: " + url;
    return HTTPC_ERROR_CONNECTION_REFUSED;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + CHAVE_API_GATEWAY);
  int status = http.POST(corpo);
  resposta = status > 0 ? http.getString() : http.errorToString(status);
  http.end();
  if (status == 201) {
    ultimoContatoMs = millis();
    jaContatou = true;
  }
  return status;
}

void enviarHeartbeat() {
  char loteId[TAMANHO_LOTE_ID + 1];
  gerarLoteId(loteId);
  String resposta;
  int status = postarLote(montarCorpo(loteId, {}), resposta);
  if (status == 201) {
    Serial.println("Heartbeat confirmado pela API");
  } else {
    Serial.printf("Heartbeat falhou (%d): %s\n", status, resposta.c_str());
  }
}

// Respostas conforme o Contrato de API, 1.1 e 1.2.
ResultadoEnvio enviarLote(uint32_t numero) {
  String loteId;
  std::vector<RegistroLeitura> leituras;
  xSemaphoreTake(mutexFila, portMAX_DELAY);
  bool lido = lerLote(numero, loteId, leituras);
  xSemaphoreGive(mutexFila);
  if (!lido) {
    Serial.printf("Lote %lu corrompido na flash; descartado\n", numero);
    return LOTE_DESCARTADO;
  }

  String resposta;
  int status = postarLote(montarCorpo(loteId, leituras), resposta);

  Serial.printf("Lote %lu (%s, %u leituras): ", numero, loteId.c_str(), leituras.size());
  if (status == 201) {
    Serial.println("confirmado pela API");
    registrarRespostaDoLote(resposta);
    return LOTE_ENVIADO;
  }
  if (status < 0) {
    Serial.printf("sem resposta da API (%s)\n", resposta.c_str());
    return ENVIO_FALHOU;
  }
  // 401/403 (chave ou GATEWAY_ID errados) se resolvem corrigindo o segredos.h, e 408/429 são
  // passageiros: o lote fica para o próximo ciclo, como num 5xx.
  bool temporario = status >= 500 || status == 401 || status == 403 || status == 408 || status == 429;
  if (status >= 400 && !temporario) {
    // 422 (lote malformado), 400, 413...: reenviar o mesmo lote daria o mesmo erro e travaria
    // a fila para sempre, então ele é descartado e os seguintes seguem.
    Serial.printf("recusado pela API (%d), descartado: %s\n", status, resposta.c_str());
    return LOTE_DESCARTADO;
  }
  Serial.printf("falhou com HTTP %d: %s\n", status, resposta.c_str());
  return ENVIO_FALHOU;
}

// Envia um lote pendente e o apaga se a API confirmou (ou recusou de vez). Devolve false se
// ele tem que ficar na flash para o próximo ciclo.
bool enviarEApagar(uint32_t numero) {
  if (enviarLote(numero) == ENVIO_FALHOU) return false;
  xSemaphoreTake(mutexFila, portMAX_DELAY);
  apagarLote(numero);
  xSemaphoreGive(mutexFila);
  return true;
}

// A cada ciclo: reenvia os lotes pendentes, do mais antigo para o mais novo, e depois fecha e
// envia o lote atual. No primeiro envio que falhar, para: os pendentes ficam na flash com o
// mesmo lote_id, e o lote atual continua aberto recebendo leituras (até 100) em vez de virar
// um lote pequeno a cada ciclo, o que encheria a flash rápido durante uma queda de internet.
void cicloDeEnvio() {
  xSemaphoreTake(mutexFila, portMAX_DELAY);
  std::vector<uint32_t> pendentes = listarPendentes();
  size_t noAtual = leiturasNoLoteAtual();
  xSemaphoreGive(mutexFila);

  if (pendentes.empty() && noAtual == 0) {
    bool heartbeatVencido = !jaContatou || millis() - ultimoContatoMs >= INTERVALO_HEARTBEAT_MS;
    if (heartbeatVencido && conectarWifi()) enviarHeartbeat();
    return;
  }

  if (!conectarWifi()) {
    Serial.printf("Sem Wi-Fi: %u lotes pendentes e %u leituras no lote atual ficam na flash\n",
                  pendentes.size(), noAtual);
    return;
  }

  for (uint32_t numero : pendentes) {
    if (!enviarEApagar(numero)) {
      Serial.println("Envio interrompido: o restante vai no próximo ciclo");
      return;
    }
  }

  xSemaphoreTake(mutexFila, portMAX_DELAY);
  uint32_t numero = fecharLoteAtual();
  xSemaphoreGive(mutexFila);
  if (numero != 0 && !enviarEApagar(numero)) {
    Serial.println("Lote atual não confirmado: fica pendente para o próximo ciclo");
  }
}

void tarefaEnvio(void*) {
  TickType_t ultimoCiclo = xTaskGetTickCount();
  for (;;) {
    vTaskDelayUntil(&ultimoCiclo, pdMS_TO_TICKS(CICLO_ENVIO_S * 1000UL));
    cicloDeEnvio();
  }
}

// ---------------------------------------------------------------------------------------
// Recepção LoRa (loop, núcleo 1)
// ---------------------------------------------------------------------------------------

bool decodificar(const PacoteLeitura& pacote, RegistroLeitura& registro) {
  if (pacote.versao != PROTOCOLO_VERSAO || pacote.tipo != PACOTE_LEITURA) return false;
  registro.sensorId = pacote.sensorId;
  registro.dataHora = 0;  // preenchida no recebimento
  registro.temperaturaDecimos = pacote.temperaturaDecimos;
  registro.umidadeDecimos = pacote.umidadeDecimos;
  return true;
}

void enviarAck(const PacoteLeitura& pacote) {
  PacoteAck ack = {PROTOCOLO_VERSAO, PACOTE_ACK, pacote.sensorId, pacote.sequencia};
  LoRa.beginPacket();
  LoRa.write(reinterpret_cast<const uint8_t*>(&ack), sizeof(ack));
  LoRa.endPacket();
}

void setup() {
  Serial.begin(115200);

  if (!LittleFS.begin(true)) {  // formata na primeira vez
    Serial.println("Falha ao montar a flash (LittleFS)!");
    while (true) delay(1000);
  }
  LittleFS.mkdir(DIRETORIO_LOTES);
  recuperarLoteAtual();
  preferencias.begin(NVS_NAMESPACE, true);
  proximoLote = preferencias.getUInt(NVS_CHAVE_PROXIMO_LOTE, 1);
  preferencias.end();
  // Se faltou energia entre fechar um lote e salvar o próximo número na NVS, o número salvo
  // é o de um lote que já existe, e o rename do LittleFS o sobrescreveria sem ele ter sido
  // enviado. O próximo número nunca pode ser menor que o do lote pendente mais novo + 1.
  std::vector<uint32_t> pendentesNaPartida = listarPendentes();
  if (!pendentesNaPartida.empty() && pendentesNaPartida.back() >= proximoLote) {
    proximoLote = pendentesNaPartida.back() + 1;
    Serial.printf("Próximo número de lote corrigido para %lu\n", proximoLote);
  }
  mutexFila = xSemaphoreCreateMutex();

  LoRa.setPins(LORA_PINO_NSS, LORA_PINO_RST, LORA_PINO_DIO0);
  if (!LoRa.begin(LORA_FREQUENCIA_HZ)) {
    Serial.println("Falha ao iniciar o módulo LoRa!");
    while (true) delay(1000);
  }
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();  // o rádio descarta sozinho pacotes corrompidos no ar

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_SENHA);
  configTime(0, 0, "pool.ntp.org", "time.google.com");  // acerta sozinho quando houver rede
  clienteHttps.setCACert(API_CA_CERT);

  Serial.printf("Nó central ouvindo os nós de borda por LoRa. Ciclo de envio: %d s. "
                "Lotes pendentes na flash: %u\n",
                CICLO_ENVIO_S, listarPendentes().size());

  // O envio fica no núcleo 0, junto da pilha do Wi-Fi, para o HTTPS não travar a recepção
  // LoRa, que segue no loop (núcleo 1) mesmo durante um ciclo de envio longo.
  xTaskCreatePinnedToCore(tarefaEnvio, "envio_lotes", 16384, nullptr, 1, nullptr, 0);
}

void loop() {
  gravarLeiturasSemHora();

  int tamanho = LoRa.parsePacket();
  if (tamanho == 0) return;

  if (tamanho != sizeof(PacoteLeitura)) {
    Serial.printf("Pacote ignorado: %d bytes, esperado %u\n", tamanho, sizeof(PacoteLeitura));
    while (LoRa.available()) LoRa.read();
    return;
  }

  PacoteLeitura pacote;
  LoRa.readBytes(reinterpret_cast<uint8_t*>(&pacote), sizeof(pacote));

  RegistroLeitura registro;
  if (!decodificar(pacote, registro)) {
    Serial.printf("Pacote ignorado: versão %u, tipo %u\n", pacote.versao, pacote.tipo);
    return;
  }

  // Lidos antes do ack: transmitir apaga do rádio os dados do pacote recebido.
  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  // Confirma mesmo a leitura repetida: se ela voltou, é porque o ack anterior se perdeu.
  enviarAck(pacote);

  if (!leituraNova(registro.sensorId, pacote.sequencia)) {
    Serial.printf("Leitura repetida do sensor %lu (seq %u), já registrada\n", registro.sensorId,
                  pacote.sequencia);
    return;
  }

  Serial.printf("Leitura recebida | sensor %lu | seq %u | %.1f C | %.1f %% | RSSI %d dBm | SNR %.1f dB\n",
                registro.sensorId, pacote.sequencia, registro.temperaturaDecimos / 10.0f,
                registro.umidadeDecimos / 10.0f, rssi, snr);

  if (relogioCerto()) {
    registro.dataHora = time(nullptr);
    guardar(registro);
  } else {
    esperarRelogio(registro);
    Serial.println("  relógio ainda sem NTP: leitura em espera na memória");
  }
}
