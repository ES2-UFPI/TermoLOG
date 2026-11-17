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
const uint8_t PACOTE_COMANDO = 3;           // nó central -> nó de borda
const uint8_t PACOTE_COMANDO_APLICADO = 4;  // nó de borda -> nó central

const uint8_t ACAO_LIGAR = 1;
const uint8_t ACAO_DESLIGAR = 2;
const uint8_t ACAO_AJUSTAR = 3;

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

struct __attribute__((packed)) PacoteComando {
  uint8_t versao;
  uint8_t tipo;
  uint32_t sensorId;
  uint32_t comandoId;    // id do comando no backend
  uint8_t acao;          // ACAO_*
  uint8_t temperaturaC;  // só no ajuste; 0 nas outras ações
};

struct __attribute__((packed)) PacoteComandoAplicado {
  uint8_t versao;
  uint8_t tipo;
  uint32_t sensorId;
  uint32_t comandoId;
};
static_assert(sizeof(PacoteComandoAplicado) != sizeof(PacoteLeitura),
              "o loop separa a leitura da confirmação de comando pelo tamanho");

// ---------------------------------------------------------------------------------------
// Comandos de climatização (#161, Contrato de API 1.3)
//
// A API manda em cada resposta 201 todos os comandos pendentes dos sensores deste gateway, e
// continua mandando até o id voltar em comandos_concluidos. Por isso a fila fica só na
// memória: depois de reiniciar, o nó central a recebe de novo no primeiro contato. Cada
// comando é entregue ao nó de borda logo depois do ack de uma leitura dele, que é quando o
// rádio do nó está ligado. O nó confirma com PACOTE_COMANDO_APLICADO, e o id vai para
// `concluidos` até a API confirmar o lote que o informou.
// ---------------------------------------------------------------------------------------

struct Comando {
  uint32_t id;
  uint32_t sensorId;
  uint8_t acao;
  uint8_t temperaturaC;
  uint32_t expiraEm;  // segundos desde 1970, UTC; 0 se não deu para ler
};

const size_t MAX_COMANDOS = 32;
// O nó de borda volta a ouvir o rádio logo depois de ler o ack; a folga garante que ele já
// está ouvindo quando o comando sai.
const uint32_t ESPERA_ANTES_DO_COMANDO_MS = 50;

std::vector<Comando> comandos;     // pendentes, na ordem da API (por id)
std::vector<uint32_t> concluidos;  // aplicados pelo nó, ainda não informados à API
// Usados pelo loop (entrega por LoRa) e pela tarefa de envio (resposta da API).
SemaphoreHandle_t mutexComandos;
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

enum ResultadoEnvio { LOTE_ENVIADO, LOTE_DESCARTADO, ENVIO_FALHOU };

// Backoff (Contrato de API, 1.1): com a API recusando o gateway (401, 403 ou outro 4xx que não
// seja 422), não insiste a cada ciclo. A espera dobra a cada recusa (30 s, 1, 2, 4 min) até
// 5 min, e volta ao normal na primeira resposta que não seja uma recusa. A fila continua
// na flash durante a espera.
const uint32_t BACKOFF_MAXIMO_MS = 5 * 60 * 1000UL;
uint32_t backoffMs = 0;  // 0 = sem backoff
uint32_t recusadoEmMs = 0;
uint32_t inicioDoCicloMs = 0;

bool recusaDeConfiguracao(int status) {
  return status >= 400 && status < 500 && status != 422;
}

// A espera conta do início do ciclo da recusa, com 1 s de folga, para cair certinho num
// ciclo (30 s de backoff = o próximo ciclo, e não o seguinte).
bool emBackoff() {
  return backoffMs != 0 && millis() - recusadoEmMs + 1000 < backoffMs;
}

WiFiClient clienteHttp;
WiFiClientSecure clienteHttps;

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

// Última sequência gravada de cada sensor, para não contar duas vezes a mesma leitura
// quando o nó de borda reenvia porque o ack se perdeu. Uma duplicata não pode ser apagada
// depois (as leituras são imutáveis, #25), então a tabela tem folga para muitos sensores.
const int MAX_SENSORES = 64;
struct UltimaSequencia {
  uint32_t sensorId;
  uint16_t sequencia;
  uint32_t vistoEmMs;
};
UltimaSequencia ultimas[MAX_SENSORES];
int totalSensores = 0;

bool leituraRepetida(uint32_t sensorId, uint16_t seq) {
  for (int i = 0; i < totalSensores; i++) {
    if (ultimas[i].sensorId == sensorId) return ultimas[i].sequencia == seq;
  }
  return false;
}

// Chamada só depois de a leitura ser guardada: se a gravação falhar, o reenvio do nó de
// borda tem que ser aceito como leitura nova.
void registrarSequencia(uint32_t sensorId, uint16_t seq) {
  uint32_t agora = millis();
  for (int i = 0; i < totalSensores; i++) {
    if (ultimas[i].sensorId == sensorId) {
      ultimas[i].sequencia = seq;
      ultimas[i].vistoEmMs = agora;
      return;
    }
  }
  if (totalSensores < MAX_SENSORES) {
    ultimas[totalSensores++] = {sensorId, seq, agora};
    return;
  }
  // Tabela cheia: sai o sensor visto há mais tempo. Ele só teria uma leitura duplicada se
  // reenviasse agora a mesma sequência, o que acontece só nos segundos seguintes ao envio.
  int maisAntigo = 0;
  for (int i = 1; i < MAX_SENSORES; i++) {
    if (agora - ultimas[i].vistoEmMs > agora - ultimas[maisAntigo].vistoEmMs) maisAntigo = i;
  }
  Serial.printf("Mais de %d sensores neste nó central: o sensor %lu sai do controle de "
                "leituras repetidas (um reenvio dele pode ser gravado duas vezes)\n",
                MAX_SENSORES, ultimas[maisAntigo].sensorId);
  ultimas[maisAntigo] = {sensorId, seq, agora};
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
  // O lote atual é fechado ao chegar a 100 leituras. Se o rename tiver falhado, tenta de novo;
  // sem conseguir, não grava: um atual.bin com mais de 100 leituras seria recusado pela API.
  if (leiturasNoLoteAtual() >= MAX_LEITURAS_POR_LOTE && fecharLoteAtual() == 0) {
    Serial.println("Lote atual cheio e não foi possível fechá-lo: leitura não gravada");
    return false;
  }

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
bool guardar(const RegistroLeitura& registro) {
  xSemaphoreTake(mutexFila, portMAX_DELAY);
  bool gravou = armazenar(registro);
  xSemaphoreGive(mutexFila);
  if (!gravou) Serial.printf("Falha ao gravar na flash a leitura do sensor %lu\n", registro.sensorId);
  return gravou;
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
  // Roda a cada volta do loop: com a flash falhando, tenta no máximo a cada 5 s.
  static bool tentou = false;
  static uint32_t ultimaTentativaMs = 0;
  if (tentou && millis() - ultimaTentativaMs < 5000) return;
  tentou = true;
  ultimaTentativaMs = millis();
  uint32_t agora = time(nullptr);
  uint32_t agoraMs = millis();
  // Essas leituras já tiveram ack: a que não for gravada fica na memória e tenta de novo.
  int restantes = 0;
  for (int i = 0; i < totalSemHora; i++) {
    RegistroLeitura registro = leiturasSemHora[i].registro;
    registro.dataHora = agora - (agoraMs - leiturasSemHora[i].recebidaEmMs) / 1000;
    if (!guardar(registro)) leiturasSemHora[restantes++] = leiturasSemHora[i];
  }
  Serial.printf("Relógio acertado: %d leituras recebidas antes disso foram gravadas\n",
                totalSemHora - restantes);
  totalSemHora = restantes;
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
// Comandos de climatização
// ---------------------------------------------------------------------------------------

// "2026-11-15T13:11:14.457900Z" ou "...+00:00" em segundos desde 1970, UTC. Devolve 0 se o
// texto não estiver nesse formato.
uint32_t lerDataHora(const char* texto) {
  if (texto == nullptr) return 0;
  int ano, mes, dia, hora, minuto, segundo, lidos = 0;
  if (sscanf(texto, "%4d-%2d-%2dT%2d:%2d:%2d%n", &ano, &mes, &dia, &hora, &minuto, &segundo,
             &lidos) != 6 ||
      ano < 1970 || mes < 1 || mes > 12 || dia < 1 || dia > 31) {
    return 0;
  }
  const char* resto = texto + lidos;
  if (*resto == '.') {
    resto++;
    while (isdigit(static_cast<unsigned char>(*resto))) resto++;
  }
  long deslocamento = 0;
  if (*resto == '+' || *resto == '-') {
    int h, m;
    if (sscanf(resto + 1, "%2d:%2d", &h, &m) != 2) return 0;
    deslocamento = (h * 3600L + m * 60L) * (*resto == '-' ? -1 : 1);
  } else if (*resto != 'Z') {
    return 0;
  }
  // Dias desde 1970-01-01 no calendário gregoriano (algoritmo days_from_civil).
  int y = ano - (mes <= 2);
  int era = y / 400;
  unsigned anoDaEra = y - era * 400;
  unsigned diaDoAno = (153 * (mes + (mes > 2 ? -3 : 9)) + 2) / 5 + dia - 1;
  unsigned diaDaEra = anoDaEra * 365 + anoDaEra / 4 - anoDaEra / 100 + diaDoAno;
  long dias = era * 146097L + diaDaEra - 719468;
  return dias * 86400L + hora * 3600L + minuto * 60L + segundo - deslocamento;
}

uint8_t acaoDoTexto(const char* acao) {
  if (acao == nullptr) return 0;
  if (strcmp(acao, "ligar") == 0) return ACAO_LIGAR;
  if (strcmp(acao, "desligar") == 0) return ACAO_DESLIGAR;
  if (strcmp(acao, "ajustar") == 0) return ACAO_AJUSTAR;
  return 0;
}

bool jaConcluido(uint32_t id) {  // com o mutexComandos tomado
  return std::find(concluidos.begin(), concluidos.end(), id) != concluidos.end();
}

// Substitui a fila pelos comandos da resposta da API. Um comando que o nó já aplicou, mas que a
// API ainda não recebeu em comandos_concluidos, volta na resposta e fica de fora.
void atualizarComandos(JsonArrayConst lista) {
  std::vector<Comando> novos;
  for (JsonObjectConst item : lista) {
    const char* tipo = item["tipo"];
    if (tipo == nullptr || strcmp(tipo, "climatizacao") != 0) continue;
    Comando comando = {item["id"].as<uint32_t>(), item["sensor_id"].as<uint32_t>(),
                       acaoDoTexto(item["acao"]), 0, lerDataHora(item["expira_em"])};
    if (comando.id == 0 || comando.sensorId == 0 || comando.acao == 0) continue;
    if (comando.acao == ACAO_AJUSTAR) {
      int temperatura = item["temperatura_c"] | 0;
      if (temperatura < 16 || temperatura > 30) continue;
      comando.temperaturaC = temperatura;
    }
    if (novos.size() == MAX_COMANDOS) {
      Serial.printf("Mais de %u comandos pendentes: os demais vêm nas próximas respostas\n",
                    MAX_COMANDOS);
      break;
    }
    novos.push_back(comando);
  }

  xSemaphoreTake(mutexComandos, portMAX_DELAY);
  novos.erase(std::remove_if(novos.begin(), novos.end(),
                             [](const Comando& c) { return jaConcluido(c.id); }),
              novos.end());
  for (const Comando& c : novos) {
    bool conhecido = std::any_of(comandos.begin(), comandos.end(),
                                 [&](const Comando& atual) { return atual.id == c.id; });
    if (!conhecido) {
      Serial.printf("Comando %lu recebido da API para o sensor %lu (acao %u, %u C)\n", c.id,
                    c.sensorId, c.acao, c.temperaturaC);
    }
  }
  comandos = novos;
  xSemaphoreGive(mutexComandos);
}

std::vector<uint32_t> copiarConcluidos() {
  xSemaphoreTake(mutexComandos, portMAX_DELAY);
  std::vector<uint32_t> copia = concluidos;
  xSemaphoreGive(mutexComandos);
  return copia;
}

// A API confirmou o lote que levava estes ids: eles saem da lista.
void esquecerConcluidos(const std::vector<uint32_t>& informados) {
  if (informados.empty()) return;
  xSemaphoreTake(mutexComandos, portMAX_DELAY);
  concluidos.erase(std::remove_if(concluidos.begin(), concluidos.end(),
                                  [&](uint32_t id) {
                                    return std::find(informados.begin(), informados.end(), id) !=
                                           informados.end();
                                  }),
                   concluidos.end());
  xSemaphoreGive(mutexComandos);
}

bool temConcluidos() {
  xSemaphoreTake(mutexComandos, portMAX_DELAY);
  bool tem = !concluidos.empty();
  xSemaphoreGive(mutexComandos);
  return tem;
}

// Entrega ao nó de borda o comando pendente mais antigo dele, se houver. Chamada logo depois do
// ack da leitura e de cada comando aplicado, enquanto o nó está ouvindo o rádio. Comando vencido
// é descartado aqui (sem o relógio acertado, a validade fica a cargo da API).
void entregarComando(uint32_t sensorId) {
  Comando comando;
  bool achou = false;
  uint32_t agora = relogioCerto() ? time(nullptr) : 0;
  xSemaphoreTake(mutexComandos, portMAX_DELAY);
  for (auto it = comandos.begin(); it != comandos.end();) {
    if (agora != 0 && it->expiraEm != 0 && it->expiraEm <= agora) {
      Serial.printf("Comando %lu expirou sem ser entregue ao sensor %lu; descartado\n", it->id,
                    it->sensorId);
      it = comandos.erase(it);
      continue;
    }
    if (it->sensorId == sensorId) {
      comando = *it;
      achou = true;
      break;
    }
    ++it;
  }
  xSemaphoreGive(mutexComandos);
  if (!achou) return;

  delay(ESPERA_ANTES_DO_COMANDO_MS);
  PacoteComando pacote = {PROTOCOLO_VERSAO, PACOTE_COMANDO, sensorId,       comando.id,
                          comando.acao,     comando.temperaturaC};
  LoRa.beginPacket();
  LoRa.write(reinterpret_cast<const uint8_t*>(&pacote), sizeof(pacote));
  LoRa.endPacket();
  Serial.printf("Comando %lu enviado ao sensor %lu; esperando a confirmação do nó\n", comando.id,
                sensorId);
}

void registrarComandoAplicado(const PacoteComandoAplicado& pacote) {
  xSemaphoreTake(mutexComandos, portMAX_DELAY);
  comandos.erase(std::remove_if(comandos.begin(), comandos.end(),
                                [&](const Comando& c) { return c.id == pacote.comandoId; }),
                 comandos.end());
  if (!jaConcluido(pacote.comandoId)) concluidos.push_back(pacote.comandoId);
  xSemaphoreGive(mutexComandos);
  Serial.printf("Comando %lu aplicado pelo sensor %lu: vai em comandos_concluidos no próximo "
                "envio\n",
                pacote.comandoId, pacote.sensorId);
  entregarComando(pacote.sensorId);  // o próximo, se houver
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

String montarCorpo(const String& loteId, const std::vector<RegistroLeitura>& leituras,
                   const std::vector<uint32_t>& comandosConcluidos) {
  JsonDocument doc;
  doc["lote_id"] = loteId;
  doc["versao_config"] = VERSAO_CONFIG;
  JsonArray idsConcluidos = doc["comandos_concluidos"].to<JsonArray>();
  for (uint32_t id : comandosConcluidos) idsConcluidos.add(id);
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

// Com o 201, a API já registrou os comandos_concluidos que foram no lote e manda os comandos
// pendentes de novo.
void tratarComandosDaResposta(const String& resposta, const std::vector<uint32_t>& informados) {
  esquecerConcluidos(informados);
  JsonDocument doc;
  if (deserializeJson(doc, resposta)) return;
  atualizarComandos(doc["comandos"].as<JsonArrayConst>());
}

// Faz o POST do lote, com os comandos já aplicados pelos nós. Devolve o status HTTP, ou um
// código negativo do HTTPClient quando não houve resposta.
int postarLote(const String& loteId, const std::vector<RegistroLeitura>& leituras,
               String& resposta) {
  std::vector<uint32_t> informados = copiarConcluidos();
  String corpo = montarCorpo(loteId, leituras, informados);
  String url = API_URL;
  while (url.endsWith("/")) url.remove(url.length() - 1);  // "http://host:8000/" também vale
  url += String("/gateways/") + GATEWAY_ID + "/leituras";
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
    tratarComandosDaResposta(resposta, informados);
  }
  if (recusaDeConfiguracao(status)) {
    backoffMs = backoffMs == 0 ? CICLO_ENVIO_S * 1000UL : std::min(backoffMs * 2, BACKOFF_MAXIMO_MS);
    recusadoEmMs = inicioDoCicloMs;
    Serial.printf("API recusou o gateway (HTTP %d): confira API_URL, GATEWAY_ID e a chave no "
                  "segredos.h. Próxima tentativa em %lu s; a fila fica na flash\n",
                  status, backoffMs / 1000);
  } else if (status > 0 && backoffMs != 0) {
    backoffMs = 0;
    Serial.println("API voltou a aceitar o gateway: fim do backoff");
  }
  return status;
}

void enviarHeartbeat() {
  char loteId[TAMANHO_LOTE_ID + 1];
  gerarLoteId(loteId);
  String resposta;
  int status = postarLote(loteId, {}, resposta);
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
  int status = postarLote(loteId, leituras, resposta);

  Serial.printf("Lote %lu (%s, %u leituras): ", numero, loteId.c_str(), leituras.size());
  if (status == 201) {
    Serial.println("confirmado pela API");
    registrarRespostaDoLote(resposta);
    return LOTE_ENVIADO;
  }
  if (status == 422) {
    // Único descarte previsto no contrato: o lote está malformado, e reenviar daria o mesmo
    // erro. O FastAPI responde 422 até para JSON inválido, então nenhum outro 4xx vem da API.
    Serial.printf("recusado pela API (422), descartado: %s\n", resposta.c_str());
    return LOTE_DESCARTADO;
  }
  if (status < 0) {
    Serial.printf("sem resposta da API (%s)\n", resposta.c_str());
  } else if (recusaDeConfiguracao(status)) {
    // 401/403 (chave ou GATEWAY_ID errados), 404/405 (API_URL errada), 400/413 (proxy no
    // caminho)...: é configuração, não o lote. Descartar apagaria a fila inteira, um lote por
    // ciclo, então ela fica na flash, em backoff, até o segredos.h (ou o proxy) ser corrigido.
    Serial.printf("recusado com HTTP %d, lote mantido na flash: %s\n", status, resposta.c_str());
  } else {
    // 5xx ou outra resposta: passageiro, tenta de novo no próximo ciclo.
    Serial.printf("falhou com HTTP %d: %s\n", status, resposta.c_str());
  }
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
  inicioDoCicloMs = millis();
  xSemaphoreTake(mutexFila, portMAX_DELAY);
  std::vector<uint32_t> pendentes = listarPendentes();
  size_t noAtual = leiturasNoLoteAtual();
  xSemaphoreGive(mutexFila);

  if (emBackoff()) {
    Serial.printf("Em backoff após recusa da API: %u lotes pendentes e %u leituras no lote atual "
                  "esperam na flash\n",
                  pendentes.size(), noAtual);
    return;
  }

  if (pendentes.empty() && noAtual == 0) {
    bool heartbeatVencido = !jaContatou || millis() - ultimoContatoMs >= INTERVALO_HEARTBEAT_MS;
    // Comando aplicado não espera o heartbeat: o painel mostra a entrega no ciclo seguinte.
    if ((heartbeatVencido || temConcluidos()) && conectarWifi()) enviarHeartbeat();
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
  mutexComandos = xSemaphoreCreateMutex();

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

  if (tamanho == sizeof(PacoteComandoAplicado)) {
    PacoteComandoAplicado aplicado;
    LoRa.readBytes(reinterpret_cast<uint8_t*>(&aplicado), sizeof(aplicado));
    if (aplicado.versao == PROTOCOLO_VERSAO && aplicado.tipo == PACOTE_COMANDO_APLICADO) {
      registrarComandoAplicado(aplicado);
    } else {
      Serial.printf("Pacote ignorado: versão %u, tipo %u\n", aplicado.versao, aplicado.tipo);
    }
    return;
  }

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
  if (leituraRepetida(registro.sensorId, pacote.sequencia)) {
    enviarAck(pacote);
    entregarComando(registro.sensorId);
    Serial.printf("Leitura repetida do sensor %lu (seq %u), já registrada\n", registro.sensorId,
                  pacote.sequencia);
    return;
  }

  // O ack só sai depois de a leitura estar guardada: se a gravação falhar, o nó de borda não
  // recebe o ack e reenvia. A gravação leva milissegundos, bem dentro da janela de 1 s em que
  // o nó de borda espera o ack.
  bool guardada;
  bool semHora = !relogioCerto();
  if (semHora) {
    esperarRelogio(registro);  // na memória, até o NTP responder
    guardada = true;
  } else {
    registro.dataHora = time(nullptr);
    guardada = guardar(registro);
  }
  if (guardada) {
    registrarSequencia(registro.sensorId, pacote.sequencia);
    enviarAck(pacote);
    // Logo depois do ack, enquanto o nó de borda ainda está ouvindo (o log fica para depois).
    entregarComando(registro.sensorId);
  }

  Serial.printf("Leitura recebida | sensor %lu | seq %u | %.1f C | %.1f %% | RSSI %d dBm | SNR %.1f dB\n",
                registro.sensorId, pacote.sequencia, registro.temperaturaDecimos / 10.0f,
                registro.umidadeDecimos / 10.0f, rssi, snr);
  if (!guardada) {
    Serial.println("  não foi gravada: sem ack, o nó de borda vai reenviar");
  } else if (semHora) {
    Serial.println("  relógio ainda sem NTP: leitura em espera na memória");
  }
}
