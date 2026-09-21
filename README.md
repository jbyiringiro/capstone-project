# Vuga AAC

A Kinyarwanda-first predictive picture-to-speech communication system for minimally verbal
children, built as Milestone 1 of an open assistive-technology platform for Rwanda.
ALU Mission Capstone, BSc Software Engineering (Machine Learning), Josue Byiringiro,
supervisor Junior Turatsinze. The accepted proposal is in `../proposal/`.

## What is being built

| Part | Folder | Status |
|---|---|---|
| Next-symbol prediction: data pipeline, unigram and Kneser-Ney baselines, metrics, GRU and transformer (weeks 5-7) | `ml/` | pipeline and baselines done, tested |
| Offline PWA: symbol board, recorded Kinyarwanda audio, all-action logging, suggestions | `app/` | scaffold with board, log and on-device trigram |
| REST API: auth, pseudonymous profiles, vocabulary, sync, dashboard summary, prediction | `api/` | endpoints and tests done |
| Kinyarwanda core vocabulary, lexicon, recordings | `vocab/` | seed entries; real list from week 4 |
| Secondary talker device (ESP32-S3 / Pi Zero 2 W) | `device/` | planned, week 5-8 |
| Keyguard, stand, enclosure (3D print / laser) | `hardware/` | planned, week 5 |
| Plan, results log, decisions | `docs/` | |

## Quick start

```bash
# machine learning
pip install -e ./ml[dev]
pytest ml/tests
python ml/scripts/fetch_corpus.py                       # pins the sentence corpus (~90 MB)
python ml/scripts/prepare_data.py --lexicon vocab/lexicon.csv
python -m vuga_ml.evaluate --data ml/data/processed     # validation only; test needs --final

# API (SQLite by default; PostgreSQL via docker compose)
pip install -e ./api[dev]
cd api && uvicorn app.main:app --reload                 # http://localhost:8000/docs
pytest api/tests

# PWA
cd app && npm install && npm run dev                    # http://localhost:5173
```

`docker compose up --build` starts PostgreSQL and the API together.

## Licences

Code MIT. Original vocabulary translations and recordings CC BY 4.0 (with collaborators'
permission). ARASAAC pictograms are CC BY-NC-SA 4.0 and are attributed in the app.
Training text: Digital Umuganda Common Voice Kinyarwanda sentence corpus, MPL-2.0, pinned by
commit in `ml/data/raw/digital_umuganda/PROVENANCE.json`.
