# Vuga project guide

Updated 10 October 2026. The working app is fully in Kinyarwanda, including its board, caregiver interface, validation/error messages and speech path. Communication cards use licensed online images, and a local parent PIN separates child communication from caregiver controls. Research scope, picture recognition, native-speaker review and participant benefit remain provisional. See the [current implementation](licensed_images_parent_access_2026-10-10.md), [preceding language implementation](design_implementation_2026-10-06.md) and historical [28 September verification](verification_2026-09-28.md).

## Start the app on Windows

From `vuga-aac/app`, with Node.js/npm installed:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run preview -- --host 127.0.0.1
```

Open `http://localhost:4173`. Production preview is needed for service-worker/offline tests. No API account is required for the board or local caregiver setup.

Choose pictures and use **Siba**, **Byose**, **Erekana**, and **Vuga** to compose, correct, display and speak a message. The 181-symbol draft vocabulary and real local predictor remain connected to the design. A phone uses two columns; communication words use licensed online images bundled for offline use, and simple action controls retain icons. Missing photos fall back to existing pictograms.

The child board opens without a PIN. Hold **Umurezi** or activate it with the keyboard to open the separate parent access screen. On first use, the parent creates and confirms a four-to-six-digit PIN; **Subira ku kibaho** dismisses setup so communication remains available. Subsequent visits require the PIN before any caregiver controls are mounted. There is no default PIN. **Abana** creates/selects a device profile; **Amashusho** configures its vocabulary. **Ikibaho** controls **Amagambo afasha**, **Amashusho anyeganyega buhoro**, **Amashusho manini cyane**, and **Amafoto afatika**. The photo preference defaults on; turning it off restores pictograms for that profile. Appearance is saved per profile; system reduced-motion takes precedence. Returning to the board preserves its draft. Changing profile or prediction mode resets it; browser-reload draft recovery is not claimed.

**Kwinjira** changes the parent PIN after checking the current PIN. Returning to the child board, reloading, backgrounding the app, or five minutes without input locks the parent session. Five incorrect attempts trigger a 30-second cooldown that survives reload. The PIN is stored only as a salted PBKDF2-derived credential; unlocked sessions are never persisted. This local guard prevents unintended settings changes but does not authenticate an adult's identity or protect against someone with browser-storage access. There is no child-facing reset; clearing browser storage removes the PIN and other local data. Keep the chosen PIN separately.

**Incamake** reports actual completed spoken messages and has an empty state. **Ohereza** provides explicit JSON export and optional authenticated server sync. Profiles, settings and activity remain in this browser unless a supported export/sync is explicitly requested.

## Assets and Kinyarwanda speech

The asset set contains the small trigram artifact, licensed online images for the 181 communication words, fallback pictograms, original design SVGs and 181 synthetic Kinyarwanda speech clips. [Source, author, licence and hash records](../app/public/photos/manifest.json) accompany the optimized offline images. Retain each image's attribution and applicable licence conditions. The images are not project participant photographs. Git ignores some derived assets. A fresh clone may need to restore those assets. The current implementation record identifies the final verified archive.

After Python setup, recreate the predictor from the portable development snapshot:

```powershell
.venv\Scripts\python.exe ml/scripts/export_artifacts.py --data ml/notebooks/evidence
```

Use `ml/scripts/fetch_pictograms.py` for ARASAAC images with their attribution/licence.

The bundled `app/public/audio/rw/` clips speak the exact Kinyarwanda labels in `vocab/symbols.csv`. They were generated with Meta AI's `facebook/mms-tts-kin` model pinned to revision `71d00a03419b9bfd203a6bfa4d6bc565cbe3c4e0`. They are synthetic and **not pronunciation-reviewed**. This research/noncommercial bundle retains the model's **CC BY-NC 4.0** attribution and restrictions; the code's MIT licence does not override them. Read the [audio provenance/licensing README](../app/public/audio/rw/README.md) and [manifest](../app/public/audio/rw/manifest.json).

Open **Umurezi → Ijwi**:

1. Select **Umva “amazi”** for a Kinyarwanda word or **Gerageza indangururamajwi** for a nonverbal test tone. If nothing is heard, check tab mute, device volume and output device.
2. Choose a word and record it or select a file. Microphone capture needs browser support, permission, and HTTPS or localhost. Clips are limited to approximately 15 seconds and 10 MB; empty, undecodable and apparently silent files are rejected.
3. Listen and confirm the word before saving. Saved recordings work offline and are shared across this browser's profiles. Deleting a recording requires confirmation and affects the word across profiles.

The speech order is: saved recording, custom installation clip at `/audio/SYMBOL.wav`, bundled `/audio/rw/SYMBOL.wav`, then an available matching Kinyarwanda system voice. No English speech choice or fallback exists; old English-demo settings migrate to Kinyarwanda. Missing audio preserves the message and offers **Erekana**.

Successful playback completes a message record; it does not prove correct pronunciation or an understood exchange. Have a fluent Kinyarwanda speaker review the labels and clips with intended partners. No matching system voice is assumed to be installed.

Recordings stay in IndexedDB and are excluded from export/sync and the repository. Clearing browser storage removes them; keep originals separately. Custom installation clips are also excluded from the repository. Only the synthetic bundle and nonverbal test tone are included; file-integrity checks are not human language review. See [audio setup and regeneration](../app/public/audio/README.md).

## Python environment and notebook

From `vuga-aac`, using Python 3.11+:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e "./ml[dev,notebook]" -e "./api[dev]"
.venv\Scripts\python.exe ml/notebooks/run_notebook.py
```

Open [the executed notebook](../ml/notebooks/vuga_model.ipynb) or [HTML report](../ml/notebooks/vuga_model.html). The portable snapshot contains 2,621 training and 319 validation sequences, requiring no corpus download. Recorded neural results are separated from optional fresh ONNX inference. This language conversion does not retrain the predictor or evaluate held-out test data.

## Optional backend

From `vuga-aac`, in another terminal:

```powershell
$env:VUGA_MODEL_DIR = (Resolve-Path ml/artifacts).Path
$env:VUGA_CORS_ORIGINS = '["http://localhost:5173","http://localhost:4173"]'
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir api --host 127.0.0.1 --port 8000
```

Swagger is at `http://localhost:8000/docs`. SQLite is the default; vocabulary is seeded at startup. Public registration cannot create administrators. Create server profiles through the API or app and explicitly fetch them under **Ohereza**. Upload sends completed messages only for the signed-in account's owned server profiles; it does not convert local profiles.

Use a private random `VUGA_JWT_SECRET` of at least 32 characters for persistent sessions/multiple workers. Without it, development tokens expire after restart. The PostgreSQL/API Docker option requires that secret and has not been exercised here.

## Source and design evidence

| Layer | Source | Demonstration |
|---|---|---|
| Kinyarwanda UI | `app/src/Board.jsx`, `Dashboard.jsx`, `App.jsx`, styles | Responsive composition, caregiver flows, labels and form/error messages |
| Device storage | `db.js`, `message-session.js` | Profiles, vocabulary, preferences, ordered actions and export |
| Parent access | `ParentAccess.jsx`, `parent-access.js` | PIN setup/unlock/change, persisted attempt cooldown and automatic session locking |
| Speech | `VoiceSettings.jsx`, `AudioSettings.jsx`, `speech.js`, `audio-preferences.js` | Kinyarwanda-only playback, bundled speech and local recordings |
| Prediction | `app/src/predictor.js` | Enabled-vocabulary constrained local trigram |
| API/schema | `api/app/main.py`, `schemas.py`, `models.py` | Auth, owned profiles, vocabulary, sync, predictions and summaries |
| ML evidence | `ml/vuga_ml/`, `ml/notebooks/` | Data engineering, architecture and development metrics |
| Visual references | [Local design pack](../design/README.md) | Earlier layouts, style guide, tokens and SVG/PNG imports |

The silent design preview is separate sample content. Its earlier bilingual copy and illustrated cards are superseded by the app's Kinyarwanda copy, licensed pictures and parent gate; it is retained as a visual design reference. SVGs are not a native `.fig` file or a verified account prototype. Current app screenshots are in `docs/screenshots/licensed-2026-10-10/`; the generated-picture screenshots dated 6 October are historical. Browser checks do not establish target-device suitability or learner outcomes. Stakeholder research with a school or caregivers is still outstanding.

## Deployment, verification and packaging

Use the local production preview for the demonstration. Hosted deployment would serve `app/dist` over HTTPS with a persistent API database, backups, strong signing secret and correct CORS. Set `VITE_API_BASE` at build time. No public deployment is claimed; earlier dependency advisories are not resolved by translation.

See the [current implementation record](licensed_images_parent_access_2026-10-10.md) for the final executed checks, build result and screenshot evidence. The suites verify image sources/licences/hashes, offline image and audio use, child communication, parent PIN setup/unlock/change, wrong-PIN rejection, persisted cooldown, draft retention, reload/background/idle locking and corrupt-storage rejection. Reports for the earlier generated-picture, illustrated and English-interface/audio versions are historical.

`.gitignore` decides what the repository contains. Environments, dependencies, model weights, private/custom recordings, credentials (including the local parent PIN credential), databases, participant logs, raw corpora and held-out test examples are excluded. The superseded generated PNG sources are not in the repository. The repository uses compact licensed online images with source, author, licence and hash records. Included audio is limited to the 181 synthetic Kinyarwanda WAVs, their provenance/licence files and the nonverbal speaker-test WAV.

A real GitHub URL and the recorded 5–10 minute video remain outstanding. No fresh dependency installation, school validation or production hardening is claimed.
