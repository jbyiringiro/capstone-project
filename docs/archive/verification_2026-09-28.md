# Prototype verification: 28 September 2026

Scope: existing Vuga candidate while final project direction is reconsidered. No participant data were collected.

| Check | Result |
|---|---|
| Frontend unit/regression tests | 13 passed: predictor parity/masking, local persistence, ownership-filtered and bounded sync, ordered event logging, speech fallback |
| API tests | 14 passed: authentication/roles, seeded symbols, vocabulary validation, sync ownership/idempotency, timing, prediction mask |
| ML tests | 17 passed, 2 skipped because optional neural training dependencies are absent |
| Production frontend build | Passed; service worker generated |
| Browser workflow | Five checks passed in headless Microsoft Edge using an isolated synthetic profile |
| Notebook | 10 code cells executed, three figures, no errors; validation only |
| ZIP | Integrity passed; clean extraction installed 380 npm packages and built the app successfully; 10/10 notebook code cells contained outputs and no errors |

Browser checks covered persistent empty vocabulary, predictive suggestions, rapid taps and preserved message on unavailable audio, offline reload with the predictor and caregiver area, and no page-level overflow at a 390px viewport. There were no uncaught page errors. [Machine-readable browser result](screenshots/browser-checks.json).

Screenshots: [desktop board](screenshots/board-desktop.png), [caregiver vocabulary](screenshots/caregiver-vocabulary.png), [visual message](screenshots/message-display.png), [mobile offline board](screenshots/board-mobile-offline.png).

The ML snapshot contains 2,621 training and 319 validation symbol sequences. Fresh statistical top-3 results: frequency 21.96%, trigram 45.78%; optional evaluation of the existing GRU ONNX seed-0 artifact produced 46.92%. See the notebook for provenance and separation from historical three-seed results. The test partition was not opened.

Not verified: real speech playback with reviewed Kinyarwanda audio; physical device fit; a target Android tablet; native installation across browsers; PostgreSQL/Docker deployment; public hosting; participant usability or communication gains. The Vite/Vitest development dependency audit still has six advisories; do not describe the toolchain as production-hardened. These limits remain visible in the project guide.

The clean-extraction smoke check used a new temporary workspace folder and removed it afterwards. The archive contains train/validation evidence but no held-out test examples, real `.env`, database or credential file. `.env.example` is a placeholder template. Final packaging also includes the same small statistical model artifacts under `ml/artifacts` for the optional API's documented model directory.
