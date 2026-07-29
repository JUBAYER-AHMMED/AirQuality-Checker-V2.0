/* =====================================================================
   AirWatch — ESP8266 multi-sensor firmware
   ---------------------------------------------------------------------
   One sketch for all six sensors. You physically connect ONE sensor at a
   time. The board asks the backend "which sensor is active and should I
   be sending?" and reads the matching sensor accordingly.

   Flow:
     1. Frontend: user enters a Location and picks the connected Sensor,
        then presses "Start session". Backend begins a preheat countdown.
     2. This board polls GET /api/session/config every few seconds to learn
        the active sensor + whether the server is storing yet.
     3. The board reads that sensor and POSTs the value to /api/air-quality.
        - During preheat: backend shows it as a live preview (not stored).
        - After preheat (state = collecting): backend stores it.
     4. When the session is idle, the board still reads but the backend
        ignores the value. (You can also skip sending while idle.)

   Wiring (single sensor at a time):
     ── Analog gas sensors (MQ-135 / MQ-5 / MQ-7 / MQ-8) ──
       Sensor AOUT -> ESP8266 A0
       Sensor VCC  -> 5V  (MQ heaters need 5V; A0 max is 1.0V on bare
                           ESP8266, 3.3V on NodeMCU which has a divider —
                           see note below)
       Sensor GND  -> GND

     ── MH-Z19B (NDIR CO2, UART) ──
       Sensor TX -> ESP8266 D7 (GPIO13)  [SoftwareSerial RX]
       Sensor RX -> ESP8266 D8 (GPIO15)  [SoftwareSerial TX]
       Sensor VCC -> 5V,  GND -> GND

     ── DHT11 (temp + humidity) ──
       Sensor DATA -> ESP8266 D5 (GPIO14)
       Sensor VCC  -> 3.3V,  GND -> GND

   IMPORTANT ADC NOTE:
     - NodeMCU / Wemos D1 mini boards have an onboard divider so A0 accepts
       0–3.3V. Bare ESP8266 modules accept only 0–1.0V on A0 — add your own
       divider on the MQ analog output if you use a bare module.
     - MQ analog output can swing toward VCC. Keep it within your A0 range.

   Libraries (install via Arduino Library Manager):
     - ESP8266WiFi, ESP8266HTTPClient (bundled with ESP8266 core)
     - ArduinoJson  (Benoit Blanchon)
     - DHT sensor library (Adafruit) + Adafruit Unified Sensor
     - SoftwareSerial (bundled)
   ===================================================================== */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <ArduinoJson.h>
#include <SoftwareSerial.h>
#include <DHT.h>

/* ----------------------- USER CONFIG ----------------------- */
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Your backend base URL (no trailing slash), e.g. from Render.
// Must include /api at the end.
const char* API_BASE = "https://airquality-checker-v2-0.onrender.com/api";

// How often to ask the backend what to do (ms).
const unsigned long CONFIG_INTERVAL = 4000;
// How often to send a reading (ms).
const unsigned long SEND_INTERVAL   = 2000;

/* ----------------------- PINS ----------------------- */
#define MQ_ANALOG_PIN   A0        // all MQ sensors share A0 (one at a time)
#define DHT_PIN         D5        // DHT11 data
#define MHZ_RX_PIN      D7        // ESP RX  <- MH-Z19B TX
#define MHZ_TX_PIN      D8        // ESP TX  -> MH-Z19B RX

#define DHTTYPE DHT11
DHT dht(DHT_PIN, DHTTYPE);

SoftwareSerial mhz(MHZ_RX_PIN, MHZ_TX_PIN); // RX, TX

/* ----------------------- STATE ----------------------- */
String activeSensor = "";     // which sensor the backend wants
String sessionState = "idle"; // idle | preheating | collecting
bool   serverStoring = false;

unsigned long lastConfig = 0;
unsigned long lastSend   = 0;

WiFiClientSecure secureClient; // for https backends (Render)
WiFiClient plainClient;        // for http backends (local testing)

bool isHttps() {
  return String(API_BASE).startsWith("https");
}

/* ----------------------- MQ CALIBRATION ----------------------- *
 * MQ sensors give an analog voltage, not ppm directly. Turning raw ADC
 * into a real ppm needs Ro calibration in clean air and the datasheet
 * curve. For a controlled dataset you often log the raw/ratio and convert
 * later. Here we provide a simple, transparent mapping you can refine:
 *   - read the ADC
 *   - convert to an approximate ppm via a linear scale you calibrate
 * Replace `mqToPpm` with your calibrated curve when ready.
 * -------------------------------------------------------------- */
float readMQppm() {
  // Average several samples to reduce noise.
  const int N = 16;
  long acc = 0;
  for (int i = 0; i < N; i++) {
    acc += analogRead(MQ_ANALOG_PIN);
    delay(4);
  }
  float raw = acc / (float)N;            // 0..1023

  // Simple placeholder mapping. CALIBRATE for your board/sensor:
  //   many projects log `raw` and compute ppm offline.
  // This gives a monotonic ppm-like value so the dashboard is meaningful.
  float ppm = raw * (1000.0 / 1023.0);   // maps 0..1023 -> 0..1000
  return ppm;
}

/* ----------------------- MH-Z19B READ ----------------------- */
int readMHZ19() {
  // Standard read command
  byte cmd[9] = {0xFF, 0x01, 0x86, 0, 0, 0, 0, 0, 0x79};
  byte resp[9];

  // flush
  while (mhz.available()) mhz.read();

  mhz.write(cmd, 9);
  delay(10);

  unsigned long start = millis();
  int idx = 0;
  while (idx < 9 && millis() - start < 1000) {
    if (mhz.available()) resp[idx++] = mhz.read();
  }
  if (idx < 9 || resp[0] != 0xFF || resp[1] != 0x86) {
    return -1; // read failed
  }
  // checksum
  byte checksum = 0;
  for (int i = 1; i < 8; i++) checksum += resp[i];
  checksum = 0xFF - checksum + 1;
  if (checksum != resp[8]) return -1;

  int co2 = resp[2] * 256 + resp[3];
  return co2;
}

/* ----------------------- WIFI ----------------------- */
void connectWiFi() {
  Serial.printf("Connecting to %s", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.printf("\nWiFi connected. IP: %s\n", WiFi.localIP().toString().c_str());
}

/* ----------------------- HTTP HELPERS ----------------------- */
// GET /session/config -> update activeSensor / sessionState / serverStoring
void fetchConfig() {
  HTTPClient http;
  String url = String(API_BASE) + "/session/config";
  bool ok;
  if (isHttps()) {
    secureClient.setInsecure(); // skip cert validation (simplest for Render)
    ok = http.begin(secureClient, url);
  } else {
    ok = http.begin(plainClient, url);
  }
  if (!ok) { Serial.println("config begin failed"); return; }

  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, payload);
    if (!err) {
      sessionState  = String((const char*)(doc["state"] | "idle"));
      serverStoring = doc["storing"] | false;
      const char* s = doc["sensor"] | "";
      activeSensor  = String(s);
      Serial.printf("[config] state=%s sensor=%s storing=%d\n",
                    sessionState.c_str(),
                    activeSensor.c_str(),
                    serverStoring ? 1 : 0);
    } else {
      Serial.println("config JSON parse error");
    }
  } else {
    Serial.printf("config GET failed: %d\n", code);
  }
  http.end();
}

// POST /air-quality { sensor, value, humidity? }
void sendReading(const String& sensor, float value, float humidity, bool hasHumidity) {
  HTTPClient http;
  String url = String(API_BASE) + "/air-quality";
  bool ok;
  if (isHttps()) {
    secureClient.setInsecure();
    ok = http.begin(secureClient, url);
  } else {
    ok = http.begin(plainClient, url);
  }
  if (!ok) { Serial.println("send begin failed"); return; }

  http.addHeader("Content-Type", "application/json");

  StaticJsonDocument<192> doc;
  doc["sensor"] = sensor;
  doc["value"]  = value;
  if (hasHumidity) doc["humidity"] = humidity;

  String body;
  serializeJson(doc, body);

  int code = http.POST(body);
  if (code > 0) {
    String resp = http.getString();
    Serial.printf("[send] %s value=%.1f -> HTTP %d %s\n",
                  sensor.c_str(), value, code, resp.c_str());
  } else {
    Serial.printf("[send] POST failed: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

/* ----------------------- READ ACTIVE SENSOR ----------------------- */
// Returns true if a reading was produced. Fills value/humidity.
bool readActiveSensor(float& value, float& humidity, bool& hasHumidity) {
  hasHumidity = false;

  if (activeSensor == "MQ-135" || activeSensor == "MQ-5" ||
      activeSensor == "MQ-7"   || activeSensor == "MQ-8") {
    value = readMQppm();
    return true;
  }

  if (activeSensor == "MH-Z19B") {
    int co2 = readMHZ19();
    if (co2 < 0) { Serial.println("MH-Z19B read failed"); return false; }
    value = co2;
    return true;
  }

  if (activeSensor == "DHT11") {
    float t = dht.readTemperature(); // °C
    float h = dht.readHumidity();
    if (isnan(t) || isnan(h)) { Serial.println("DHT read failed"); return false; }
    value = t;
    humidity = h;
    hasHumidity = true;
    return true;
  }

  return false; // no/unknown active sensor
}

/* ----------------------- SETUP / LOOP ----------------------- */
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\nAirWatch ESP8266 multi-sensor starting...");

  dht.begin();
  mhz.begin(9600); // MH-Z19B uses 9600 baud

  connectWiFi();

  // Prime config immediately.
  fetchConfig();
  lastConfig = millis();
}

void loop() {
  unsigned long now = millis();

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  // Periodically refresh what the backend wants.
  if (now - lastConfig >= CONFIG_INTERVAL) {
    lastConfig = now;
    fetchConfig();
  }

  // Send readings when a session is active and a sensor is chosen.
  if (now - lastSend >= SEND_INTERVAL) {
    lastSend = now;

    if (sessionState != "idle" && activeSensor.length() > 0) {
      float value = 0, humidity = 0;
      bool hasHumidity = false;
      if (readActiveSensor(value, humidity, hasHumidity)) {
        sendReading(activeSensor, value, humidity, hasHumidity);
      }
    } else {
      // idle: nothing armed. Skip sending to save bandwidth.
      Serial.println("[idle] no active session; waiting.");
    }
  }
}
