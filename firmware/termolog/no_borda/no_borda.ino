#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <LoRa.h>
#include <Preferences.h>
#include <SPI.h>

// ID do sensor gerado pelo backend no cadastro (POST /salas/{id}/sensores). Cada placa
// é gravada com o ID do seu sensor, que vem do build e não do código: um ambiente por placa
// no platformio.ini (-D SENSOR_ID=12) ou --build-property no arduino-cli (ver README).
// Sem ele a compilação falha, para nenhuma placa sair com um ID repetido por esquecimento.
#ifndef SENSOR_ID
#error "Defina o SENSOR_ID da placa no build (ver README, 'Como compilar e gravar o firmware')."
#endif
static_assert(SENSOR_ID > 0, "SENSOR_ID tem que ser o ID positivo gerado pelo backend");
const uint32_t ID_DO_SENSOR = SENSOR_ID;

// Pino de dados do DHT22 (GPIO 22 do ESP32) e tipo do sensor.
#define DHT_PIN 22
#define DHT_TYPE DHT22

// Módulo LoRa SX1276/RFM95 no SPI padrão do ESP32 (SCK 18, MISO 19, MOSI 23).
const int LORA_PINO_NSS = 5;
const int LORA_PINO_RST = 4;
const int LORA_PINO_DIO0 = 2;

// Parâmetros do rádio. Têm que ser iguais aos do nó central (no_central.ino).
const long LORA_FREQUENCIA_HZ = 915E6;  // faixa de 915 MHz usada no Brasil
const uint8_t LORA_SYNC_WORD = 0x54;    // separa a rede do TermoLOG de outras redes LoRa

// Depois de enviar, o nó ouve o rádio por ~1 s esperando o ack do nó central (Contrato de
// API, 1.3). Sem ack, reenvia a mesma leitura até o limite de tentativas.
const unsigned long JANELA_ACK_MS = 1000;
const int TENTATIVAS_ENVIO = 3;

// Janela de envio: a cada janela o nó faz LEITURAS_POR_JANELA leituras espaçadas por igual,
// dormindo entre elas, e envia a média ao nó central no fim. Com 60 s e 5 leituras, lê a cada
// 12 s e envia uma média por minuto. A janela é o intervalo_leitura_s do contrato, porque é o
// intervalo das leituras que chegam ao backend. Os dois valores podem vir do build, como o
// SENSOR_ID (-D JANELA_ENVIO_S=120); a janela vale até o gateway repassar outra (US03).
#ifndef JANELA_ENVIO_S
#define JANELA_ENVIO_S 60
#endif
#ifndef LEITURAS_POR_JANELA
#define LEITURAS_POR_JANELA 5
#endif
const uint32_t JANELA_PADRAO_S = JANELA_ENVIO_S;
const uint32_t JANELA_MIN_S = 10;
const uint32_t JANELA_MAX_S = 24 * 60 * 60;

// O DHT22 não entrega leituras novas com menos de 2 s entre elas.
const uint32_t ESPACO_MIN_ENTRE_LEITURAS_MS = 2000;
static_assert(LEITURAS_POR_JANELA >= 1 && LEITURAS_POR_JANELA <= 255,
              "LEITURAS_POR_JANELA tem que ficar entre 1 e 255");
static_assert(JANELA_ENVIO_S >= JANELA_MIN_S && JANELA_ENVIO_S <= JANELA_MAX_S,
              "JANELA_ENVIO_S fora dos limites");
static_assert(JANELA_ENVIO_S * 1000 / LEITURAS_POR_JANELA >= ESPACO_MIN_ENTRE_LEITURAS_MS,
              "Leituras demais para a janela: o DHT22 precisa de 2 s entre leituras");

// O DHT22 precisa de ~2 s após ligar antes da primeira leitura válida.
const unsigned long ESTABILIZACAO_DHT_MS = 2000;

// A janela fica na NVS (flash) para sobreviver à falta de energia. A cópia em RTC evita
// ler a flash a cada despertar; ela zera quando a placa liga a frio, e aí a NVS é lida de novo.
const char* NVS_NAMESPACE = "termolog";
const char* NVS_CHAVE_JANELA = "janela_s";
RTC_DATA_ATTR uint32_t janelaEnvioS = 0;

// Leituras acumuladas na janela atual. Ficam na RTC para sobreviver ao deep sleep entre uma
// leitura e outra; se a placa ligar a frio no meio da janela, ela recomeça do zero.
RTC_DATA_ATTR float somaTemperatura = 0;
RTC_DATA_ATTR float somaUmidade = 0;
RTC_DATA_ATTR uint8_t leiturasFeitas = 0;   // inclui as que falharam
RTC_DATA_ATTR uint8_t leiturasValidas = 0;  // entram na média

// Número de sequência da leitura, guardado na RTC para sobreviver ao deep sleep. O nó
// central usa para descartar a mesma leitura reenviada quando o ack se perde.
RTC_DATA_ATTR uint16_t sequencia = 0;

// Formato dos pacotes LoRa. Tem que ser idêntico ao do nó central (no_central.ino).
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

DHT dht(DHT_PIN, DHT_TYPE);
Preferences preferencias;
bool loraIniciado = false;

bool janelaValida(uint32_t segundos) {
  return segundos >= JANELA_MIN_S && segundos <= JANELA_MAX_S &&
         segundos * 1000 / LEITURAS_POR_JANELA >= ESPACO_MIN_ENTRE_LEITURAS_MS;
}

void carregarJanela() {
  if (janelaEnvioS != 0) return;
  preferencias.begin(NVS_NAMESPACE, true);  // sem o namespace, getUInt devolve o padrão
  uint32_t salva = preferencias.getUInt(NVS_CHAVE_JANELA, JANELA_PADRAO_S);
  preferencias.end();
  janelaEnvioS = janelaValida(salva) ? salva : JANELA_PADRAO_S;
}

// Chamada quando o gateway repassar um novo intervalo_leitura_s (US03). Só grava na flash
// se o valor mudou, para não desgastá-la.
bool definirJanela(uint32_t segundos) {
  if (!janelaValida(segundos)) return false;
  if (segundos == janelaEnvioS) return true;
  preferencias.begin(NVS_NAMESPACE, false);
  bool gravou = preferencias.putUInt(NVS_CHAVE_JANELA, segundos) > 0;
  preferencias.end();
  if (gravou) janelaEnvioS = segundos;
  return gravou;
}

bool fora_intervalo(float temperatura, float umidade) {
  return temperatura < -40 || temperatura > 80 || umidade < 0 || umidade > 100;
}

bool iniciarLora() {
  LoRa.setPins(LORA_PINO_NSS, LORA_PINO_RST, LORA_PINO_DIO0);
  if (!LoRa.begin(LORA_FREQUENCIA_HZ)) return false;
  LoRa.setSyncWord(LORA_SYNC_WORD);
  LoRa.enableCrc();  // o rádio descarta sozinho pacotes corrompidos no ar
  loraIniciado = true;
  return true;
}

// Espera o ack desta leitura até o fim da janela. Pacotes de outro sensor ou de outra
// sequência (ack atrasado de um envio anterior) são ignorados.
bool esperarAck(uint16_t seq) {
  unsigned long inicio = millis();
  while (millis() - inicio < JANELA_ACK_MS) {
    if (LoRa.parsePacket() != sizeof(PacoteAck)) continue;
    PacoteAck ack;
    LoRa.readBytes(reinterpret_cast<uint8_t*>(&ack), sizeof(ack));
    if (ack.versao == PROTOCOLO_VERSAO && ack.tipo == PACOTE_ACK && ack.sensorId == ID_DO_SENSOR &&
        ack.sequencia == seq) {
      return true;
    }
  }
  return false;
}

bool enviarLeitura(float temperatura, float umidade) {
  PacoteLeitura pacote = {
      PROTOCOLO_VERSAO,
      PACOTE_LEITURA,
      ID_DO_SENSOR,
      ++sequencia,
      static_cast<int16_t>(lroundf(temperatura * 10)),
      static_cast<uint16_t>(lroundf(umidade * 10)),
  };

  for (int tentativa = 1; tentativa <= TENTATIVAS_ENVIO; tentativa++) {
    LoRa.beginPacket();
    LoRa.write(reinterpret_cast<const uint8_t*>(&pacote), sizeof(pacote));
    LoRa.endPacket();  // bloqueia até terminar de transmitir
    if (esperarAck(pacote.sequencia)) return true;
    Serial.printf("Sem ack do nó central (tentativa %d de %d)\n", tentativa, TENTATIVAS_ENVIO);
    delay(random(50, 300));  // espera aleatória para não colidir de novo com outro nó
  }
  return false;
}

// Lê o sensor e soma na janela atual. Leitura com falha conta como feita, mas fica fora da
// média, para a janela não se estender quando o sensor falha.
void lerSensor() {
  float temperatura = dht.readTemperature();
  float umidade = dht.readHumidity();
  leiturasFeitas++;

  if (isnan(temperatura) || isnan(umidade) || fora_intervalo(temperatura, umidade)) {
    Serial.printf("Leitura %u de %u: falha ao ler do sensor DHT22!\n", leiturasFeitas,
                  LEITURAS_POR_JANELA);
    return;
  }
  somaTemperatura += temperatura;
  somaUmidade += umidade;
  leiturasValidas++;
  Serial.printf("Leitura %u de %u: %.1f C | %.1f %%\n", leiturasFeitas, LEITURAS_POR_JANELA,
                temperatura, umidade);
}

// Fim da janela: envia a média das leituras válidas e zera a janela para a próxima.
void fecharJanela() {
  if (leiturasValidas == 0) {
    Serial.println("Nenhuma leitura válida na janela; nada enviado.");
  } else {
    float temperatura = somaTemperatura / leiturasValidas;
    float umidade = somaUmidade / leiturasValidas;
    Serial.printf("Média de %u leituras: %.1f C | %.1f %%\n", leiturasValidas, temperatura,
                  umidade);
    if (!iniciarLora()) {
      Serial.println("Falha ao iniciar o módulo LoRa!");
    } else if (enviarLeitura(temperatura, umidade)) {
      Serial.printf("Média %u enviada ao nó central (sensor %lu)\n", sequencia, ID_DO_SENSOR);
    } else {
      Serial.println("Média não confirmada pelo nó central.");
    }
  }
  somaTemperatura = 0;
  somaUmidade = 0;
  leiturasFeitas = 0;
  leiturasValidas = 0;
}

// Dorme até a próxima leitura da janela, descontando o tempo gasto acordado.
void dormir() {
  // O módulo continua alimentado; em sleep consome ~0,2 µA. Só fala com ele se foi iniciado
  // neste despertar: nas leituras do meio da janela o SPI nem foi ligado, e o rádio já está
  // em sleep desde o último envio.
  if (loraIniciado) LoRa.sleep();
  Serial.flush();  // garante que a serial terminou de enviar antes de desligar
  uint64_t espaco = janelaEnvioS * 1000000ULL / LEITURAS_POR_JANELA;
  uint64_t acordado = micros();
  uint64_t sono = acordado < espaco ? espaco - acordado : 0;
  esp_sleep_enable_timer_wakeup(sono);
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  carregarJanela();
  dht.begin();

  // O DHT22 fica ligado no 3V3 durante o deep sleep; só precisa estabilizar quando a placa liga a frio.
  if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TIMER) {
    delay(ESTABILIZACAO_DHT_MS);
  }

  lerSensor();
  if (leiturasFeitas >= LEITURAS_POR_JANELA) fecharJanela();

  dormir();
}

// Nunca executa: setup() sempre termina em deep sleep.
void loop() {}
