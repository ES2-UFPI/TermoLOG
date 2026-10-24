#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <Preferences.h>

// Pino de dados do DHT22 (GPIO 4 do ESP32) e tipo do sensor.
#define DHT_PIN 4
#define DHT_TYPE DHT22

// Intervalo entre o início de uma leitura e o da próxima (intervalo_leitura_s do contrato).
// Vale o padrão até o gateway repassar outro valor, e os limites barram valores absurdos.
const uint32_t INTERVALO_PADRAO_S = 60;
const uint32_t INTERVALO_MIN_S = 10;
const uint32_t INTERVALO_MAX_S = 24 * 60 * 60;

// O DHT22 precisa de ~2 s após ligar antes da primeira leitura válida.
const unsigned long ESTABILIZACAO_DHT_MS = 2000;

// O intervalo fica na NVS (flash) para sobreviver à falta de energia. A cópia em RTC evita
// ler a flash a cada despertar; ela zera quando a placa liga a frio, e aí a NVS é lida de novo.
const char* NVS_NAMESPACE = "termolog";
const char* NVS_CHAVE_INTERVALO = "intervalo_s";
RTC_DATA_ATTR uint32_t intervaloLeituraS = 0;

DHT dht(DHT_PIN, DHT_TYPE);
Preferences preferencias;

bool intervaloValido(uint32_t segundos) {
  return segundos >= INTERVALO_MIN_S && segundos <= INTERVALO_MAX_S;
}

void carregarIntervalo() {
  if (intervaloLeituraS != 0) return;
  preferencias.begin(NVS_NAMESPACE, true);  // sem o namespace, getUInt devolve o padrão
  uint32_t salvo = preferencias.getUInt(NVS_CHAVE_INTERVALO, INTERVALO_PADRAO_S);
  preferencias.end();
  intervaloLeituraS = intervaloValido(salvo) ? salvo : INTERVALO_PADRAO_S;
}

// Chamada quando o gateway repassar um novo intervalo_leitura_s (#32). Só grava na flash
// se o valor mudou, para não desgastá-la.
bool definirIntervalo(uint32_t segundos) {
  if (!intervaloValido(segundos)) return false;
  if (segundos == intervaloLeituraS) return true;
  preferencias.begin(NVS_NAMESPACE, false);
  bool gravou = preferencias.putUInt(NVS_CHAVE_INTERVALO, segundos) > 0;
  preferencias.end();
  if (gravou) intervaloLeituraS = segundos;
  return gravou;
}

// Dorme o que falta do intervalo, descontando o tempo gasto acordado.
void dormir() {
  Serial.flush();  // garante que a serial terminou de enviar antes de desligar
  uint64_t intervalo = intervaloLeituraS * 1000000ULL;
  uint64_t acordado = micros();
  uint64_t sono = acordado < intervalo ? intervalo - acordado : 0;
  esp_sleep_enable_timer_wakeup(sono);
  esp_deep_sleep_start();
}
bool fora_intervalo(float temperatura, float umidade) {
  return temperatura < -40 || temperatura > 80 || umidade < 0 || umidade > 100;
}

void setup() {
  Serial.begin(115200);
  carregarIntervalo();
  dht.begin();

  // O DHT22 fica ligado no 3V3 durante o deep sleep; só precisa estabilizar quando a placa liga a frio.
  if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TIMER) {
    delay(ESTABILIZACAO_DHT_MS);
  }

  float temperatura = dht.readTemperature();
  float umidade = dht.readHumidity();

  if (isnan(temperatura) || isnan(umidade) || fora_intervalo(temperatura, umidade)) {
    Serial.println("Falha ao ler do sensor DHT22!");
  } else {
    Serial.printf("Temperatura: %.1f C | Umidade: %.1f %%\n", temperatura, umidade);
  }

  dormir();
}

// Nunca executa: setup() sempre termina em deep sleep.
void loop() {}
