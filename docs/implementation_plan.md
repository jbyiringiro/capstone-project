# Implementation plan (from the accepted proposal timeline)

Course weeks: W1 = 31 Aug 2026. Proposal submitted W3. This plan starts at W4 (21 Sept 2026).
Grading anchors: implementation review 15%, report draft 26%, defense W12 20%, final report W13.

| Week | Dates | Deliverable in this repository | Done when |
|---|---|---|---|
| W4 | 21-25 Sept | `ml/`: corpus pinned, lexicon v0, mapping, split, unigram + KN trigram, metrics; `app/`: board scaffold with all-action log; `vocab/`: core list drafted with collaborators | `pytest ml/tests api/tests` green; `prepare_data.py` runs on the full corpus and reports exclusion counts; first recordings started |
| W5 | 28 Sept-2 Oct | Prediction in the PWA (`predictor.js` with exported artefact, suggestion row, vocabulary mask); GRU training script; first demo link | Top-3 accuracy of KN trigram on validation recorded in `docs/results_log.md`; PWA installable offline on the test tablet |
| W6 | 5-9 Oct | REC submission; FastAPI + PostgreSQL in Docker, JWT roles, sync endpoint, dashboard summary; second demo link | Compose stack up; sync round-trip from tablet verified; REC form submitted |
| W7 | 12-16 Oct | Transformer fine-tune (KinyaBERT, AfriBERTa fallback), quantised export, latency benchmark on the tablet; talker firmware skeleton | Model comparison table on validation; 95th-percentile latency measured; REC approval expected |
| W8 | 19-23 Oct | Model selection frozen; one test-set evaluation; interviews and vocabulary validation; final iteration link; keyguard printed | `docs/results_log.md` has the frozen test numbers; consent materials printed |
| W8-10 | 19 Oct-6 Nov | Acceptance study, n >= 20 adults, counterbalanced static vs predictive; SUS | Raw logs exported and de-identified; analysis notebook produces participant-level bootstrap CI |
| W9-11 | 26 Oct-13 Nov | Report chapters 4-6 | Draft to supervisor |
| W12 | 16-20 Nov | Defense | Slides, live demo on tablet and (if delivered) talker |
| W13 | 23-27 Nov | Final report | Submitted |

## Rules carried over from the proposal that the code enforces

- Draft message is stored before its first event; every task action (select, navigate, correct, speak)
  is one event; only select carries a symbol. Tap totals include Speak. (`app/src/db.js`, `api/app/main.py`)
- Upload happens only after an adult asks and the device is online. (`syncPending`)
- The test partition is evaluated once: `vuga_ml.evaluate` refuses `--split test` without `--final`.
- Study models are frozen: `model_versions.is_frozen`; the API serves only the configured artefact.
- Symbol-sequence groups never straddle partitions; the split seed and lexicon hash are recorded in
  `ml/data/processed/split_manifest.json`.
- Exclusions are counted by reason, never dropped silently (`exclusions.json`).

## Open items to resolve with the supervisor and partner site

1. Partnership confirmation with Autisme Rwanda (fallback HVP Gatagara) before REC submission.
2. Two native-speaker content collaborators for translation and recordings (week 4).
3. Test tablet model for the study (fixes NFR2 latency target device).
4. Whether Common Voice speech is used at all in the capstone (optional TTS track).
