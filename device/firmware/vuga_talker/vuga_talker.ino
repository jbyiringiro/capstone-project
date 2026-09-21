/*
 * Vuga talker: secondary, optional AAC device (proposal FR9, NFR6).
 * Target: ESP32-S3 dev board + 5" capacitive touch TFT + I2S DAC/amp + microSD.
 *
 * Skeleton for weeks 5-8. The display driver, touch driver and I2S player are behind small
 * interfaces (Display, Touch, Audio) so that the chosen panel (e.g. a 800x480 RGB panel via
 * LovyanGFX, or a smaller SPI ILI9488) is a single-file swap. Suggestions come from the compact
 * bigram table exported by ml/scripts/export_artifacts.py (device/bundle/suggestions.json).
 *
 * Libraries: ArduinoJson 7, SD (or SD_MMC), WiFi, HTTPClient, LovyanGFX (display), ESP8266Audio
 * or the ESP-IDF I2S API for WAV playback.
 */
#include <Arduino.h>
#include <ArduinoJson.h>
#include <SD.h>
#include <WiFi.h>
#include <HTTPClient.h>

#include "board.h"
#include "hal.h"      // Display, Touch, Audio interfaces + pin map for the chosen panel
#include "ngram.h"    // compact suggestion lookup

static const char* API_BASE = "http://192.168.4.1:8000";  // set by the adult in settings.json
static const int SYNC_BUTTON_PIN = 0;                       // physical sync button (adult only)

Board board;
Ngram ngram;
Display display;
Touch touch;
Audio audio;

struct Message {
  String id;
  uint32_t startedMs = 0;
  uint16_t actionIndex = 0;
  String keys[12];
  uint8_t len = 0;
  bool open = false;
} msg;

String uuid4() {
  char buf[37];
  uint32_t r[4] = {esp_random(), esp_random(), esp_random(), esp_random()};
  snprintf(buf, sizeof buf, "%08lx-%04lx-4%03lx-%04lx-%04lx%08lx", r[0], r[1] >> 16, r[1] & 0xfff,
           (r[2] >> 16 & 0x3fff) | 0x8000, r[2] & 0xffff, r[3]);
  return String(buf);
}

// One CSV row per task action; draft row written before the first event (mirrors app/src/db.js).
void logEvent(const char* type, const String& key, bool suggested, const String& ctx) {
  if (!msg.open) {
    msg.id = uuid4(); msg.startedMs = millis(); msg.actionIndex = 0; msg.len = 0; msg.open = true;
    File f = SD.open("/log/messages.csv", FILE_APPEND);
    if (f) { f.printf("%s,%s,%lu,%s\n", msg.id.c_str(), board.profileCode().c_str(), msg.startedMs, board.mode().c_str()); f.close(); }
  }
  File f = SD.open("/log/events.csv", FILE_APPEND);
  if (f) {
    f.printf("%s,%s,%u,%s,%s,%d,%s,%lu\n", uuid4().c_str(), msg.id.c_str(), msg.actionIndex, type,
             key.c_str(), suggested ? 1 : 0, ctx.c_str(), millis());
    f.close();
  }
  msg.actionIndex++;
}

void onSelect(const String& key, bool suggested) {
  logEvent("select", key, suggested, "");
  if (msg.len < 12) msg.keys[msg.len++] = key;
  display.drawStrip(msg.keys, msg.len);
  if (board.mode() == "predictive") display.drawSuggestions(ngram.suggest(msg.keys, msg.len));
}

void onNavigate(const String& category) { logEvent("navigate", "", false, category); board.setCategory(category); display.drawGrid(board); }

void onCorrect() { if (!msg.len) return; logEvent("correct", "", false, ""); msg.len--; display.drawStrip(msg.keys, msg.len); }

void onSpeak() {
  if (!msg.len) return;
  logEvent("speak", "", false, "");
  for (uint8_t i = 0; i < msg.len; i++) audio.playWav("/bundle/audio/" + msg.keys[i] + ".wav");
  File f = SD.open("/log/messages.csv", FILE_APPEND);
  if (f) { f.printf("%s,speak,%u,%lu\n", msg.id.c_str(), msg.actionIndex, millis() - msg.startedMs); f.close(); }
  msg.open = false; msg.len = 0;
  board.setCategory(""); display.drawGrid(board); display.drawStrip(msg.keys, 0);
}

// Upload only on an explicit adult action while connected (FR7).
void syncNow() {
  if (WiFi.status() != WL_CONNECTED) { display.toast("Offline"); return; }
  HTTPClient http;
  http.begin(String(API_BASE) + "/sync");
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + board.token());
  String body = buildSyncJson();  // reads /log/*.csv into the API's SyncRequest shape
  int code = http.POST(body);
  display.toast(code == 200 ? "Synced" : "Sync failed " + String(code));
  if (code == 200) archiveLogs();
  http.end();
}

void setup() {
  Serial.begin(115200);
  pinMode(SYNC_BUTTON_PIN, INPUT_PULLUP);
  if (!SD.begin()) { Serial.println("SD init failed"); }
  board.load("/bundle");          // profile.json + board.json
  ngram.load("/bundle/suggestions.json");
  display.begin(); touch.begin(); audio.begin();
  display.drawGrid(board);
}

void loop() {
  TouchEvent e;
  if (touch.poll(e)) {
    Hit h = display.hitTest(e.x, e.y, board);
    switch (h.kind) {
      case Hit::CELL: onSelect(h.key, false); break;
      case Hit::SUGGESTION: onSelect(h.key, true); break;
      case Hit::CATEGORY: onNavigate(h.key); break;
      case Hit::CORRECT: onCorrect(); break;
      case Hit::SPEAK: onSpeak(); break;
      default: break;
    }
  }
  if (digitalRead(SYNC_BUTTON_PIN) == LOW) { delay(50); if (digitalRead(SYNC_BUTTON_PIN) == LOW) syncNow(); while (digitalRead(SYNC_BUTTON_PIN) == LOW) delay(10); }
  delay(5);
}
