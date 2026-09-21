# Vuga AAC

A Kinyarwanda-first predictive picture-to-speech communication system for minimally verbal
children, built as Milestone 1 of an open assistive-technology platform for Rwanda.
ALU Mission Capstone, BSc Software Engineering (Machine Learning), Josue Byiringiro,
supervisor Junior Turatsinze. The accepted proposal is in `../proposal/`.

## What is being built

| Part | Folder | Status |
|---|---|---|
| Next-symbol prediction: data pipeline, morphology-based lexicon builder, unigram and Kneser-Ney baselines, GRU, transformer fine-tune, ONNX export, metrics, study analysis | `ml/` | all code written and tested; first validation numbers in `docs/results_log.md` |
| Offline PWA: symbol board, recorded Kinyarwanda audio, all-action logging, suggestions, teacher dashboard, explicit sync, on-tablet latency bench | `app/` | builds; JS predictor parity-tested against Python |
| REST API: auth, pseudonymous profiles, vocabulary, sync, dashboard summary, prediction | `api/` | endpoints and tests done |
| Kinyarwanda core vocabulary, lexicon, recordings | `vocab/` | 168-symbol draft + 2,440-row generated lexicon awaiting native-speaker review (`REVIEW_GUIDE.md`) |
| Secondary talker device (ESP32-S3 / Pi Zero 2 W) | `device/` | firmware skeleton, bundle format, compact suggestion table exported |
| Keyguard, stand, enclosure (3D print / laser) | `hardware/` | parametric keyguard SCAD ready; print once the tablet is chosen |
| Plan, results log, decisions | `docs/` | |

## Quick start

```bash
# machine learning
pip install -e ./ml[dev]
pytest ml/tests
python ml/scripts/fetch_corpus.py                       # pins the sentence corpus (~90 MB)
python ml/scripts/token_frequency.py --top 60000        # which surface forms matter
python ml/scripts/build_lexicon.py                      # lemmas.csv -> lexicon_draft.csv, symbols_draft.csv
python ml/scripts/prepare_data.py --lexicon vocab/lexicon_draft.csv
(cd ml && python -m vuga_ml.evaluate --data data/processed)   # validation only; test needs --final
python ml/scripts/train_neural.py --family gru --seeds 0 1 2
python ml/scripts/train_neural.py --family transformer --seeds 0 1 2
python ml/scripts/export_artifacts.py --gru ml/artifacts/gru_h128_seed0
python ml/scripts/bench_latency.py
python ml/scripts/analyse_study.py --simulate 20        # study analysis dry run

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
