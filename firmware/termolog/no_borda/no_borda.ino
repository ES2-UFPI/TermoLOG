#include <Adafruit_Sensor.h>
#include <DHT.h>
#include <IRac.h>
#include <IRremoteESP8266.h>
#include <IRutils.h>
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

// Ar-condicionado (#161): o LED infravermelho fica no GPIO 17 (TX2), ligado em nível alto.
// O protocolo é o nome de um decode_type_t da IRremoteESP8266 (COOLIX, GREE, MIDEA...) e vem
// do build, como o SENSOR_ID (-D AC_PROTOCOLO=COOLIX). Sem ele, a placa não tem
// ar-condicionado: ignora os comandos, e o backend os expira.
#ifndef AC_PROTOCOLO
#define AC_PROTOCOLO UNKNOWN
#endif
// Alguns protocolos têm variantes por modelo (ver IRac.h); -1 é o modelo padrão do protocolo.
#ifndef AC_MODELO
#define AC_MODELO -1
#endif
// Velocidade do ventilador enviada em todo comando: o nome de um stdAc::fanspeed_t (kAuto,
// kLow, kMedium, kHigh...), também do build (-D AC_VENTILADOR=kLow).
#ifndef AC_VENTILADOR
#define AC_VENTILADOR kAuto
#endif
// Luz do painel do aparelho em todo comando (-D AC_LUZ=1). No GREE, ela faz parte do estado, e
// sem ela cada comando apagava o display. Deixe 0 nos protocolos em que a luz é um comando que
// alterna o display (COOLIX, por exemplo): com 1, ele piscaria a cada envio.
#ifndef AC_LUZ
#define AC_LUZ 0
#endif
const uint16_t PINO_IR = 17;
const decode_type_t PROTOCOLO_DO_AR = decode_type_t::AC_PROTOCOLO;
const stdAc::fanspeed_t VENTILADOR_DO_AR = stdAc::fanspeed_t::AC_VENTILADOR;

// SÓ PARA DEMONSTRAÇÃO (-D MODO_DEMONSTRACAO=1, ambiente sensor_1_demonstracao): o nó não
// dorme e deixa o rádio ouvindo o tempo todo, para o comando do painel chegar em segundos, e
// não no fim da janela de envio. Gasta a bateria em horas: na sala, o nó fica em deep sleep.
#ifndef MODO_DEMONSTRACAO
#define MODO_DEMONSTRACAO 0
#endif

// Faixa aceita no ajuste (Contrato de API, 1.3). "Ligar" manda a última temperatura ajustada,
// porque o controle remoto do ar-condicionado sempre envia o estado completo.
const uint8_t TEMPERATURA_MIN_C = 16;
const uint8_t TEMPERATURA_MAX_C = 30;
const uint8_t TEMPERATURA_PADRAO_C = 22;

// Depois do ack, o nó continua ouvindo o rádio por este tempo à espera de um comando, e de
// novo depois de cada comando aplicado (o nó central manda um por vez).
const unsigned long JANELA_COMANDO_MS = 500;
const int MAX_COMANDOS_POR_CONTATO = 4;

// Parâmetros do rádio. Têm que ser iguais aos do nó central (no_central.ino).
const long LORA_FREQUENCIA_HZ = 915E6;  // faixa de 915 MHz usada no Brasil
const uint8_t LORA_SYNC_WORD = 0x54;    // separa a rede do TermoLOG de outras redes LoRa
// Só na demonstração: potência mínima do PA_BOOST, suficiente para placas na mesma sala.
const int LORA_POTENCIA_DEMONSTRACAO_DBM = 2;

// Fim da transmissão: flag TxDone do RegIrqFlags do SX1276. 12 bytes em SF7 levam ~40 ms no ar.
const uint8_t REG_IRQ_FLAGS_LORA = 0x12;
const uint8_t IRQ_TX_DONE_LORA = 0x08;
const unsigned long LIMITE_TX_MS = 500;

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

// A última temperatura ajustada também fica na NVS, para o "ligar" depois de uma queda de
// energia não voltar à temperatura padrão.
const char* NVS_CHAVE_TEMPERATURA = "ar_temp_c";

// Último comando aplicado. Se a confirmação dele se perder no rádio, o nó central o entrega de
// novo, e o nó só confirma, sem emitir outra vez.
RTC_DATA_ATTR uint32_t ultimoComandoAplicado = 0;

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

DHT dht(DHT_PIN, DHT_TYPE);
Preferences preferencias;
IRac ar(PINO_IR);
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
#if MODO_DEMONSTRACAO
  // Na bancada, com as placas a centímetros, os +17 dBm padrão travavam o rádio vizinho.
  LoRa.setTxPower(LORA_POTENCIA_DEMONSTRACAO_DBM);
#endif
  loraIniciado = true;
  return true;
}

// Lê um registrador do rádio direto pelo SPI (a biblioteca não expõe essa leitura), do mesmo
// jeito que ela faz: 8 MHz, modo 0, NSS em nível baixo durante a transação.
uint8_t lerRegistroLora(uint8_t registro) {
  SPI.beginTransaction(SPISettings(8E6, MSBFIRST, SPI_MODE0));
  digitalWrite(LORA_PINO_NSS, LOW);
  SPI.transfer(registro & 0x7F);
  uint8_t valor = SPI.transfer(0x00);
  digitalWrite(LORA_PINO_NSS, HIGH);
  SPI.endTransaction();
  return valor;
}

// Transmite um pacote com limite de tempo. O LoRa.endPacket() comum espera para sempre o fim da
// transmissão, e um rádio travado congelava a placa (e, fora da demonstração, a impedia de voltar
// ao deep sleep). Se o fim não vier a tempo, o módulo é reiniciado e o envio conta como falho.
bool transmitir(const void* dados, size_t tamanho) {
  if (!LoRa.beginPacket()) return false;
  LoRa.write(static_cast<const uint8_t*>(dados), tamanho);
  LoRa.endPacket(true);  // não bloqueia: o fim é conferido abaixo
  unsigned long inicio = millis();
  while ((lerRegistroLora(REG_IRQ_FLAGS_LORA) & IRQ_TX_DONE_LORA) == 0) {
    if (millis() - inicio >= LIMITE_TX_MS) {
      // Modo 0x80 (sleep) aqui quer dizer que o rádio nem saiu do sleep: costuma ser alimentação
      // ou oscilador do módulo, não o firmware.
      Serial.printf("Rádio LoRa não terminou de transmitir (modo 0x%02X, IRQ 0x%02X): módulo "
                    "reiniciado\n",
                    lerRegistroLora(0x01), lerRegistroLora(REG_IRQ_FLAGS_LORA));
      LoRa.end();
      loraIniciado = false;
      iniciarLora();
      return false;
    }
    delay(1);
  }
  return true;  // a biblioteca limpa a flag no próximo beginPacket() ou parsePacket()
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

// ---------------------------------------------------------------------------------------
// Ar-condicionado (#161)
//
// O nó não decide nada: só repete o comando que o painel mandou. O nó central entrega um
// comando por vez, logo depois do ack da leitura. O nó emite o código infravermelho e devolve
// PACOTE_COMANDO_APLICADO; aí o nó central manda o próximo, se houver, e informa o id à API em
// comandos_concluidos. O infravermelho não confirma o efeito no equipamento.
// ---------------------------------------------------------------------------------------

bool temArCondicionado() {
  return IRac::isProtocolSupported(PROTOCOLO_DO_AR);
}

bool temperaturaValida(uint8_t t) {
  return t >= TEMPERATURA_MIN_C && t <= TEMPERATURA_MAX_C;
}

// A temperatura que o aparelho de fato recebe. O COOLIX só vai de 17 a 30 °C: a biblioteca
// troca 16 por 17 sem avisar, então o nó faz a troca antes, para registrar e guardar o valor
// que foi emitido.
uint8_t temperaturaDoProtocolo(uint8_t t) {
  if (PROTOCOLO_DO_AR == decode_type_t::COOLIX) return max(t, kCoolixTempMin);
  return t;
}

uint8_t ultimaTemperatura() {
  preferencias.begin(NVS_NAMESPACE, true);
  uint8_t salva = preferencias.getUChar(NVS_CHAVE_TEMPERATURA, TEMPERATURA_PADRAO_C);
  preferencias.end();
  return temperaturaValida(salva) ? salva : TEMPERATURA_PADRAO_C;
}

void guardarTemperatura(uint8_t t) {
  if (t == ultimaTemperatura()) return;  // não desgasta a flash à toa
  preferencias.begin(NVS_NAMESPACE, false);
  preferencias.putUChar(NVS_CHAVE_TEMPERATURA, t);
  preferencias.end();
}

const char* nomeDaAcao(uint8_t acao) {
  switch (acao) {
    case ACAO_LIGAR: return "ligar";
    case ACAO_DESLIGAR: return "desligar";
    case ACAO_AJUSTAR: return "ajustar";
    default: return "desconhecida";
  }
}

// Emite o estado completo do ar-condicionado: refrigeração, o ventilador do build e a
// temperatura do ajuste (ou a última ajustada, no ligar e no desligar).
bool emitir(const PacoteComando& comando) {
  bool ajuste = comando.acao == ACAO_AJUSTAR;
  if (comando.acao != ACAO_LIGAR && comando.acao != ACAO_DESLIGAR && !ajuste) return false;
  if (ajuste && !temperaturaValida(comando.temperaturaC)) return false;
  uint8_t temperatura = temperaturaDoProtocolo(ajuste ? comando.temperaturaC : ultimaTemperatura());
  if (ajuste && temperatura != comando.temperaturaC) {
    Serial.printf("%u C fora da faixa do %s: emite %u C\n", comando.temperaturaC,
                  typeToString(PROTOCOLO_DO_AR).c_str(), temperatura);
  }

  IRac::initState(&ar.next);
  ar.next.protocol = PROTOCOLO_DO_AR;
  ar.next.model = AC_MODELO;
  ar.next.power = comando.acao != ACAO_DESLIGAR;
  ar.next.mode = stdAc::opmode_t::kCool;
  ar.next.celsius = true;
  ar.next.degrees = temperatura;
  ar.next.fanspeed = VENTILADOR_DO_AR;
  ar.next.light = AC_LUZ;
  if (!ar.sendAc()) return false;
  if (ajuste) guardarTemperatura(temperatura);
  return true;
}

// Confere uma vez se chegou um comando para este nó, sem esperar.
bool lerComando(PacoteComando& comando) {
  if (LoRa.parsePacket() != sizeof(PacoteComando)) return false;
  LoRa.readBytes(reinterpret_cast<uint8_t*>(&comando), sizeof(comando));
  return comando.versao == PROTOCOLO_VERSAO && comando.tipo == PACOTE_COMANDO &&
         comando.sensorId == ID_DO_SENSOR;
}

bool esperarComando(PacoteComando& comando) {
  unsigned long inicio = millis();
  while (millis() - inicio < JANELA_COMANDO_MS) {
    if (lerComando(comando)) return true;
  }
  return false;
}

void confirmarComando(uint32_t comandoId) {
  PacoteComandoAplicado pacote = {PROTOCOLO_VERSAO, PACOTE_COMANDO_APLICADO, ID_DO_SENSOR,
                                  comandoId};
  transmitir(&pacote, sizeof(pacote));
}

// Emite o comando e o confirma ao nó central. Um comando que não pôde ser emitido fica sem
// confirmação (devolve false): o nó central o entrega de novo no próximo contato, até ele expirar.
bool aplicarComando(const PacoteComando& comando) {
  if (comando.comandoId == ultimoComandoAplicado) {
    Serial.printf("Comando %lu repetido: já aplicado, só confirma\n", comando.comandoId);
  } else if (emitir(comando)) {
    ultimoComandoAplicado = comando.comandoId;
    if (comando.acao == ACAO_AJUSTAR) {
      Serial.printf("Comando %lu (ajustar para %u C) emitido por infravermelho\n",
                    comando.comandoId, comando.temperaturaC);
    } else {
      Serial.printf("Comando %lu (%s) emitido por infravermelho\n", comando.comandoId,
                    nomeDaAcao(comando.acao));
    }
  } else {
    Serial.printf("Comando %lu (ação %u, %u C) não emitido: inválido ou protocolo sem suporte\n",
                  comando.comandoId, comando.acao, comando.temperaturaC);
    return false;
  }
  confirmarComando(comando.comandoId);
  return true;
}

// Chamada logo depois do ack, com o rádio ainda ligado.
void receberComandos() {
  if (!temArCondicionado()) return;
  for (int i = 0; i < MAX_COMANDOS_POR_CONTATO; i++) {
    PacoteComando comando;
    if (!esperarComando(comando) || !aplicarComando(comando)) return;
  }
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
    if (transmitir(&pacote, sizeof(pacote)) && esperarAck(pacote.sequencia)) {
      // Sem demora entre o ack e a escuta: o comando chega logo atrás do ack.
      receberComandos();
      return true;
    }
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
    // No modo de demonstração o rádio já está ligado desde o setup().
    if (!loraIniciado && !iniciarLora()) {
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
    if (temArCondicionado()) {
      Serial.printf("Ar-condicionado: protocolo %s, LED infravermelho no GPIO %u\n",
                    typeToString(PROTOCOLO_DO_AR).c_str(), PINO_IR);
    } else {
      Serial.println("Sem ar-condicionado (AC_PROTOCOLO não definido): comandos ignorados");
    }
    delay(ESTABILIZACAO_DHT_MS);
  }

#if MODO_DEMONSTRACAO
  Serial.println("MODO DE DEMONSTRAÇÃO: sem deep sleep, rádio sempre ouvindo. Não usar na sala.");
  if (!iniciarLora()) Serial.println("Falha ao iniciar o módulo LoRa!");
  return;  // segue no loop()
#endif

  lerSensor();
  if (leiturasFeitas >= LEITURAS_POR_JANELA) fecharJanela();

  dormir();
}

#if MODO_DEMONSTRACAO
// Só no modo de demonstração: as leituras seguem o mesmo espaçamento da janela, mas contadas
// pelo millis(), e entre uma e outra o nó aplica qualquer comando que o nó central mandar.
unsigned long ultimaLeituraMs = 0;
bool leuAlguma = false;

void loop() {
  unsigned long espacoMs = janelaEnvioS * 1000UL / LEITURAS_POR_JANELA;
  if (!leuAlguma || millis() - ultimaLeituraMs >= espacoMs) {
    ultimaLeituraMs = millis();
    leuAlguma = true;
    lerSensor();
    if (leiturasFeitas >= LEITURAS_POR_JANELA) fecharJanela();
  }
  PacoteComando comando;
  if (loraIniciado && temArCondicionado() && lerComando(comando)) aplicarComando(comando);
}
#else
// Nunca executa: setup() sempre termina em deep sleep.
void loop() {}
#endif
