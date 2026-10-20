#include <Adafruit_Sensor.h>
#include <DHT.h>

#define DHTPIN 4        // GPIO do ESP32 ligado ao pino de dados
#define DHTTYPE DHT22

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t) || isnan(h)) { Serial.println("falha DHT"); }
  else { Serial.printf("%.1f C  %.1f %%\n", t, h); }
  delay(2000);
}
