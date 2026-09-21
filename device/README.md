# Secondary talker device (optional, weeks 5-8)

Target: ESP32-S3 with a 5-inch capacitive touch display, or Raspberry Pi Zero 2 W as fallback.
Electronics under USD 60, total materials under USD 100 (NFR6).

Scope for the capstone is a working prototype that
1. shows one profile's board from a synced JSON bundle (symbols, layout, audio file names),
2. plays recorded clips from an SD card or flash,
3. runs the exported Kneser-Ney trigram (`ml/artifacts/kn_trigram.json`) for three suggestions,
4. logs all-action events locally and uploads them over BLE or Wi-Fi when an adult requests it.

The neural models are **not** expected to fit here (proposal 3.3.4); a compact n-gram is the
device model. Firmware starts after the PWA prediction milestone (week 5).

```
device/
  firmware/      ESP-IDF or Arduino project (to be added)
  bundle_format.md   JSON bundle exchanged with the app
```
