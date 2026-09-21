# Testing plan (feeds Chapter 4 of the final report)

Goal: every component is tested before the vocabulary and the study data arrive, so that the
weeks after REC approval are spent on data, participants and writing, not on debugging.

## Levels, tools and status

| Level | What | Tool / command | Status 21 Sept |
|---|---|---|---|
| Unit | normalisation, lexicon, mapping exclusions, grouped split, n-gram maths, mask, reranker, metrics, KSR simulator | `pytest ml/tests/test_pipeline.py` | 9 pass |
| Unit | morphology rules (stems, nasal and Dahl rules, glides, negatives) | `pytest ml/tests/test_morphology.py` | written |
| Unit | GRU and transformer train / predict / persist / ONNX parity on a toy grammar | `pytest ml/tests/test_neural.py` | written |
| Unit | study analysis: real effect detected, null not declared, incomplete pairs disclosed, SUS, Holm, sensitivity | `pytest ml/tests/test_study.py` | written |
| Unit | JS predictor parity with Python (top-3 with and without mask over fixture prefixes) | `cd app && npm test` | written; fixture from `export_artifacts.py` |
| Integration | API: register, login, roles, profiles, vocabulary, sync idempotency, ownership, summary, select-needs-symbol | `pytest api/tests` | 3 pass |
| Integration | data pipeline end to end on the pinned corpus (exclusion counters, manifest) | `prepare_data.py` | runs, 2 min |
| Integration | artefact export -> PWA load -> suggestions shown; -> API `/predict` | `export_artifacts.py`, `/health` shows `model_loaded` | to run |
| System | PWA offline install on the test tablet; compose stack; tablet -> API sync round trip | manual checklist below | week 5 target |
| System | latency: local screen (`bench_latency.py`) then on-tablet `bench` button (median, p95) | scripts | to run |
| System | device: bundle load, suggestion lookup, log write, sync button | bench firmware on dev board | week 5-6 |
| Load | 20 tablets syncing 200 messages each within a minute | Locust against compose stack | week 6 |
| Acceptance | adult study protocol dry run with 3 colleagues: counterbalancing, timing, export, analysis script | `analyse_study.py --simulate`, then real dry run | dry run week 6 |
| Analysis | frozen test evaluation happens once | `vuga_ml.evaluate --split test --final` | week 8 only |

## Manual system checklist (tablet)

1. Install the PWA from the served build; switch to airplane mode; reload; board loads, audio plays, suggestions appear.
2. Compose 5 messages in static and 5 in predictive mode; open the dashboard; pending count shows 10; press Sync while offline: refused; connect: uploaded; summary shows both modes with taps per message including Speak.
3. Run the footer `bench` 3 times; record median and p95 in `docs/results_log.md` with the tablet model.
4. Kill the app mid-message; reopen; the draft message exists in IndexedDB without a Speak event and is excluded from the summary.

## Accelerated schedule

| Original week | Work | Now targeted |
|---|---|---|
| W5 | PWA prediction, GRU script, demo link | W4 (this week): all code written; demo link once vocabulary v1 exists |
| W6 | API + PostgreSQL + Docker, second link | W4: done locally; compose verified when Docker is installed |
| W7 | transformer, quantised export, latency | W5: runs on the RTX 5070 as soon as the split is meaningful |
| W8 | keyguard printed, talker firmware | W5-6: keyguard SCAD ready to print once the tablet is chosen; firmware HAL after the panel arrives |
| W8-10 | study | unchanged (needs REC approval, W7) but the protocol dry run moves to W6 |

What cannot move: REC approval (W7), interviews and the study (after approval), the single test-set
evaluation (after model selection is frozen).
