#include <LoRa.h>
#include <SPI.h>

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

// Leitura já decodificada, nos campos do item de leituras do lote (Contrato de API, POST
// /gateways/{id}/leituras). A data_hora será a do recebimento, com o relógio do nó central
// sincronizado por NTP (#33): o nó de borda não tem relógio confiável.
struct Leitura {
  uint32_t sensorId;
  float temperatura;
  float umidade;
};

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

bool decodificar(const PacoteLeitura& pacote, Leitura& leitura) {
  if (pacote.versao != PROTOCOLO_VERSAO || pacote.tipo != PACOTE_LEITURA) return false;
  leitura.sensorId = pacote.sensorId;
  leitura.temperatura = pacote.temperaturaDecimos / 10.0f;
  leitura.umidade = pacote.umidadeDecimos / 10.0f;
  return true;
}

void enviarAck(const PacoteLeitura& pacote) {
  PacoteAck ack = {PROTOCOLO_VERSAO, PACOTE_ACK, pacote.sensorId, pacote.sequencia};
  LoRa.beginPacket();
  LoRa.write(reinterpret_cast<const uint8_t*>(&ack), sizeof(ack));
  LoRa.endPacket();
}

// Por enquanto a leitura só é mostrada na serial. A fila e o envio em lote para a API
// entram com a #33.
void registrar(const Leitura& leitura, uint16_t seq, int rssi, float snr) {
  Serial.printf("Leitura recebida | sensor %lu | seq %u | %.1f C | %.1f %% | RSSI %d dBm | SNR %.1f dB\n",
                leitura.sensorId, seq, leitura.temperatura, leitura.umidade, rssi, snr);
}

void setup() {
  Serial.begin(115200);
  LoRa.setPins(LORA_PINO_NSS, LORA_PINO_RST, LORA_PINO_DIO0);
  if (!LoRa.begin(LORA_FREQUENCIA_HZ)) {
    Serial.println("Falha ao iniciar o módulo LoRa!");
    while (true) delay(1000);
  }
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();  // o rádio descarta sozinho pacotes corrompidos no ar
  Serial.println("Nó central ouvindo os nós de borda por LoRa.");
}

void loop() {
  int tamanho = LoRa.parsePacket();
  if (tamanho == 0) return;

  if (tamanho != sizeof(PacoteLeitura)) {
    Serial.printf("Pacote ignorado: %d bytes, esperado %u\n", tamanho, sizeof(PacoteLeitura));
    while (LoRa.available()) LoRa.read();
    return;
  }

  PacoteLeitura pacote;
  LoRa.readBytes(reinterpret_cast<uint8_t*>(&pacote), sizeof(pacote));

  Leitura leitura;
  if (!decodificar(pacote, leitura)) {
    Serial.printf("Pacote ignorado: versão %u, tipo %u\n", pacote.versao, pacote.tipo);
    return;
  }

  // Lidos antes do ack: transmitir apaga do rádio os dados do pacote recebido.
  int rssi = LoRa.packetRssi();
  float snr = LoRa.packetSnr();

  // Confirma mesmo a leitura repetida: se ela voltou, é porque o ack anterior se perdeu.
  enviarAck(pacote);

  if (leituraNova(leitura.sensorId, pacote.sequencia)) {
    registrar(leitura, pacote.sequencia, rssi, snr);
  } else {
    Serial.printf("Leitura repetida do sensor %lu (seq %u), já registrada\n", leitura.sensorId,
                  pacote.sequencia);
  }
}
