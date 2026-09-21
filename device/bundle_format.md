# Talker device bundle

The app (or the API) exports one folder per profile that the talker loads from its SD card
or LittleFS partition. Nothing in it identifies the child: the profile is a code such as `P-07`.

```
/bundle/
  profile.json        {"code":"P-07","grid_rows":4,"grid_cols":5,"board_mode":"predictive"}
  board.json          [{"position":0,"key":"I","label_rw":"njye","image":"I.bmp","category":"people"}, ...]
  suggestions.json    {"fallback":["WANT","I","YOU"],"contexts":{"<s> I":["WANT","LIKE","HAVE"], ...}}
  audio/<KEY>.wav     22 kHz 16-bit mono PCM (recorded clips)
  images/<KEY>.bmp    160x160 24-bit BMP (ARASAAC, attribution in ATTRIBUTION.txt)
  ATTRIBUTION.txt
```

`suggestions.json` is the compact form of the Kneser-Ney trigram: the top-3 next symbols for every
bigram context observed in training, keyed `"<w1> <w2>"` with `<s>` for the start of message.
Lookup is two string comparisons and needs no floating point on the microcontroller. It is the
"device model" of proposal Table 6, not the neural models.

## Event log written by the device

`/log/events_<yyyymmdd>.csv`, one row per action, same fields as the API `TapEventIn` plus
`message_id`, `board_mode` and message boundaries (`speak` finalises). Uploaded over Wi-Fi to
`POST /sync` only when an adult presses the physical Sync button while a network is configured;
otherwise it stays on the card until the adult syncs through the app over BLE (later).
