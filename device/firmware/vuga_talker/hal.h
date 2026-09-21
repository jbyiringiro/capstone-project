#pragma once
#include <Arduino.h>
#include <vector>
#include "board.h"

// Hardware abstraction to be implemented for the chosen panel in week 5.
// Keep this header stable; swap hal_<panel>.cpp.

struct TouchEvent { int16_t x, y; };
struct Hit { enum Kind { NONE, CELL, SUGGESTION, CATEGORY, CORRECT, SPEAK } kind = NONE; String key; };

class Display {
 public:
  void begin();
  void drawGrid(const Board& b);
  void drawStrip(const String* keys, uint8_t len);
  void drawSuggestions(const std::vector<String>& keys);
  void toast(const String& text);
  Hit hitTest(int16_t x, int16_t y, const Board& b);
};

class Touch {
 public:
  void begin();
  bool poll(TouchEvent& e);   // true once per new touch-down
};

class Audio {
 public:
  void begin();
  void playWav(const String& path);   // blocking playback of a 22 kHz mono PCM file
};

String buildSyncJson();
void archiveLogs();
