#include <Adafruit_Sensor.h>
#include <DHT.h>

// Pino de dados do DHT22 (GPIO 4 do ESP32) e tipo do sensor.
#define DHT_PIN 4
#define DHT_TYPE DHT22

// Tempo dormindo entre leituras. Cada despertar reinicia o setup() do zero.
const uint64_t TEMPO_SONO_US = 60ULL * 1000000ULL;  // 60 s

// O DHT22 precisa de ~2 s após ligar antes da primeira leitura válida.
const unsigned long ESTABILIZACAO_DHT_MS = 2000;

// Variáveis RTC_DATA_ATTR sobrevivem ao deep sleep (não a um reset ou falta de energia).
RTC_DATA_ATTR uint32_t falhasSeguidas = 0;

DHT dht(DHT_PIN, DHT_TYPE);

void dormir() {
  Serial.flush();  // garante que a serial terminou de enviar antes de desligar
  esp_sleep_enable_timer_wakeup(TEMPO_SONO_US);
  esp_deep_sleep_start();
}

void setup() {
  Serial.begin(115200);
  dht.begin();
  delay(ESTABILIZACAO_DHT_MS);

  float temperatura = dht.readTemperature();
  float umidade = dht.readHumidity();

  if (isnan(temperatura) || isnan(umidade)) {
    Serial.println("Falha ao ler do sensor DHT22!");
    falhasSeguidas++;
    dormir();
  }

  falhasSeguidas = 0;
  Serial.printf("Temperatura: %.1f C | Umidade: %.1f %%\n", temperatura, umidade);
  dormir();
}

// Nunca executa: setup() sempre termina em deep sleep.
void loop() {}
