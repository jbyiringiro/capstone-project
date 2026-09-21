#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <SD.h>
#include <vector>

struct Cell { String key, label, image, category; uint8_t position; };

class Board {
 public:
  bool load(const char* dir) {
    JsonDocument p;
    File f = SD.open(String(dir) + "/profile.json"); if (!f) return false;
    deserializeJson(p, f); f.close();
    code_ = p["code"].as<String>(); rows_ = p["grid_rows"] | 4; cols_ = p["grid_cols"] | 5;
    mode_ = p["board_mode"] | "static"; token_ = p["token"] | "";
    JsonDocument b;
    File g = SD.open(String(dir) + "/board.json"); if (!g) return false;
    deserializeJson(b, g); g.close();
    cells_.clear();
    for (JsonObject c : b.as<JsonArray>())
      cells_.push_back({c["key"].as<String>(), c["label_rw"].as<String>(), c["image"].as<String>(),
                        c["category"].as<String>(), (uint8_t)(c["position"] | 0)});
    return true;
  }
  std::vector<Cell> visible() const {
    std::vector<Cell> out;
    for (const Cell& c : cells_) if (category_.isEmpty() ? c.category == "home" : c.category == category_) out.push_back(c);
    return out;
  }
  std::vector<String> categories() const {
    std::vector<String> out;
    for (const Cell& c : cells_) { bool seen = false; for (auto& s : out) if (s == c.category) seen = true; if (!seen && c.category != "home") out.push_back(c.category); }
    return out;
  }
  void setCategory(const String& c) { category_ = c; }
  String profileCode() const { return code_; }
  String mode() const { return mode_; }
  String token() const { return token_; }
  uint8_t rows() const { return rows_; }
  uint8_t cols() const { return cols_; }

 private:
  std::vector<Cell> cells_;
  String code_, mode_, token_, category_;
  uint8_t rows_ = 4, cols_ = 5;
};
