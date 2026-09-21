#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <SD.h>
#include <vector>

// Compact suggestion lookup: top-3 per bigram context from suggestions.json.
// Memory: ~40 bytes per context; a 300-symbol vocabulary rarely exceeds 20k observed contexts.
class Ngram {
 public:
  bool load(const char* path) {
    File f = SD.open(path);
    if (!f) return false;
    DeserializationError err = deserializeJson(doc_, f);
    f.close();
    return !err;
  }

  // prefix = message so far; returns up to 3 keys, using "<s>" padding like the Python model.
  std::vector<String> suggest(const String* keys, uint8_t len) const {
    String w1 = len >= 2 ? keys[len - 2] : "<s>";
    String w2 = len >= 1 ? keys[len - 1] : "<s>";
    JsonVariantConst ctx = doc_["contexts"][w1 + " " + w2];
    JsonArrayConst arr = ctx.isNull() ? doc_["fallback"].as<JsonArrayConst>() : ctx.as<JsonArrayConst>();
    std::vector<String> out;
    for (JsonVariantConst v : arr) { out.push_back(v.as<String>()); if (out.size() == 3) break; }
    return out;
  }

 private:
  JsonDocument doc_;
};
