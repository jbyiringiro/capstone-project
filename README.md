# Vuga AAC

**An offline Kinyarwanda picture-to-speech communication board for children with complex communication needs, with machine-learning next-symbol suggestions.**

ALU Mission Capstone, BSc Software Engineering (Machine Learning). Author: Josue Byiringiro. Supervisor: Junior Turatsinze.

GitHub repository: _add the repository URL here_

## Description

**Problem.** Some children cannot rely on speech to ask for help, make a choice, refuse something or join in a conversation. Rwanda's child census identifies children with communication difficulties ([NISR children report](https://beta.statistics.gov.rw/file/14175/download?token=zQsSYuB4)). Augmentative and alternative communication (AAC) tools can help ([ASHA AAC overview](https://www.asha.org/Practice-Portal/Professional-Issues/Augmentative-and-Alternative-Communication/)). Most AAC apps, however, are English-first, paid, or need a constant internet connection.

**Solution.** Vuga ("speak" in Kinyarwanda) is a progressive web app that runs on an ordinary Android tablet or phone and works fully offline after the first load.

- A child taps picture cards to build a message, then shows it on screen with **Erekana** ("show") or speaks it aloud in Kinyarwanda with **Vuga**.
- There are 181 everyday words, each with a licensed picture and a bundled Kinyarwanda speech clip.
- Caregivers open **Umurezi** ("caregiver") behind a parent PIN. There they manage child profiles, vocabulary, picture style, speech (including their own recordings), an activity summary, and explicit export or sync.
- All data stays on the device unless a caregiver chooses to sync it.

**Machine learning.** A next-symbol predictor suggests likely next words in a separate row, so the main board's layout never moves. The notebook compares three models trained on Kinyarwanda sentences mapped to the board vocabulary:

| Model | Validation top-3 accuracy |
|---|---|
| Frequency baseline | 21.96% |
| Kneser-Ney trigram | 45.78% |
| GRU | 46.92% |

The app ships the small trigram model because it is almost as accurate as the GRU, runs instantly offline, and is only about 100 KB.

**Architecture.**
- **App:** React + Vite PWA with Dexie (IndexedDB) storage and a service-worker cache.
- **API (optional):** FastAPI with Swagger, SQLAlchemy over SQLite or PostgreSQL, JWT authentication, sync, summaries and `/predict`.
- **ML package and notebook:** in `ml/`.
- **Deployment:** see the [deployment plan](docs/deployment_plan.md).

**Status (12 October 2026).** This is an initial demonstration.
- The interface, pictures, speech, parent access and prediction work, and are covered by automated and browser tests.
- The speech is synthetic (Meta MMS-TTS) and has not yet been reviewed by a native speaker.
- No school, caregiver or therapist has evaluated the app yet, and no participant findings are claimed.

The app's labels, dialogs, accessible names and messages are in Kinyarwanda. Developer documentation is in English. Further detail: [project guide](docs/project_guide.md), [current implementation and screenshots](docs/licensed_images_parent_access_2026-10-10.md), [executed model notebook](ml/notebooks/vuga_model.ipynb), [designs](design/README.md).

## Repository layout

| Folder | Contents |
|---|---|
| `app/` | React PWA: the communication board and caregiver screens |
| `api/` | FastAPI backend and its tests |
| `ml/` | Prediction models, training scripts, notebook and tests |
| `vocab/` | The 181-word Kinyarwanda vocabulary and lexicon |
| `design/` | Design pack: style foundations, tokens, icons, Figma-import SVGs and previews |
| `docs/` | Project guide, deployment plan, verification records and screenshots |
| `hardware/`, `device/` | Keyguard and device scaffolds (not yet fabricated) |
| `scripts/` | Asset generation (pictures, speech) |

## Run the app

Requires Node.js/npm. From `vuga-aac/app`:

```sh
npm ci
npm test
npm run build
npm run preview -- --host 127.0.0.1
```

Open `http://localhost:4173`. Use production preview for offline/service-worker checks. For editing, run `npm run dev` at `http://localhost:5173`. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm`.

The board opens directly and needs no server account or PIN. Hold **Umurezi** or activate it by keyboard. On first use, a parent chooses and confirms a four-to-six-digit PIN on this device; setup can be dismissed without blocking the child. Later visits require that PIN. Parent tabs are **Abana**, **Amashusho**, **Ikibaho**, **Ijwi**, **Incamake**, **Ohereza**, and **Kwinjira**. The last tab changes the PIN after verifying the current one. See the [project guide](docs/project_guide.md).

Returning to the board, reloading, leaving the app in the background, or five minutes without input locks parent access. Five failed PIN attempts cause a persisted 30-second cooldown. Only a salted PBKDF2-derived credential is stored; parent sessions remain in memory. This is a local guard against unintended settings changes, not a server account or protection against someone who can alter browser storage. No default PIN or child-facing reset exists. Clearing browser storage removes the PIN together with other local data.

The asset set covers 181 communication words with licensed online images, fallback pictograms, the small trigram model and the bundled speech described below. Consult the current implementation record for verification. Git ignores some derived assets. To recreate the statistical predictor from the development snapshot:

```sh
python -m venv .venv
# Activate .venv, or use its Python executable directly.
python -m pip install -e "./ml[dev,notebook]" -e "./api[dev]"
python ml/scripts/export_artifacts.py --data ml/notebooks/evidence
```

The communication cards use licensed online images bundled locally in `app/public/photos/`, so the child does not need a network connection after caching. The same picture follows a word through categories, suggestions, composition and caregiver views. The [photo manifest](app/public/photos/manifest.json) records source pages, authors, applicable licences and hashes. Retain the asset-specific attribution and licence conditions when sharing or adapting the pictures. They are not photographs collected from project participants. **Umurezi → Ikibaho → Amafoto afatika** restores pictograms for a profile when preferred. Fetch fallback ARASAAC images with `python ml/scripts/fetch_pictograms.py` when needed; their separate licence applies. The original SVGs remain for simple interface controls and the historical design reference.

## Kinyarwanda speech

The app uses **181 bundled synthetic Kinyarwanda WAV clips**, generated from the exact `label_rw` entries in `vocab/symbols.csv` with Meta AI's pinned `facebook/mms-tts-kin` model. Clips play offline after the app finishes caching. This is synthetic Kinyarwanda speech, not a reviewed native-speaker recording. No installed Kinyarwanda system voice is assumed. The former English demo choice and runtime clips have been removed; legacy language settings migrate to Kinyarwanda.

Playback priority is: a caregiver's saved recording, an installation's `/audio/SYMBOL.wav`, the bundled `/audio/rw/SYMBOL.wav`, then a matching Kinyarwanda system voice if available. English is never a fallback. Speech failure preserves the message and offers **Erekana**; a completed playback records a spoken message without asserting an understood exchange.

In **Umurezi → Ijwi**, **Umva “amazi”** plays the word and **Gerageza indangururamajwi** plays a short nonverbal test tone. A caregiver can record/upload, preview, save or delete a word recording. Saved recordings are shared across profiles on this browser/device and excluded from message export, sync and the repository. See [audio setup](app/public/audio/README.md), [bundle provenance](app/public/audio/rw/manifest.json) and [speech licensing and generation](app/public/audio/rw/README.md).

**Review and licence:** the speech model is CC BY-NC 4.0; this research/noncommercial bundle retains the model attribution and restrictions. The MIT code licence does not replace model/asset licences. Check suitability and pronunciation with a fluent Kinyarwanda speaker and intended partners before relying on it with learners. A successful media event does not establish audible physical speakers, accurate pronunciation or clinical benefit.

## Components and evidence

| Component | Location | Scope |
|---|---|---|
| Kinyarwanda board and caregiver UI | `app/src/` | Responsive layout, message actions, accessible labels, validation and error handling |
| Profiles, vocabulary and messages | `db.js`, `message-session.js` | IndexedDB persistence, ordered actions, summaries and explicit export/sync |
| Parent access | `ParentAccess.jsx`, `parent-access.js` | Local PIN setup/unlock/change, attempt cooldown, memory-only adult session and automatic locking |
| Speech and recording management | `VoiceSettings.jsx`, `AudioSettings.jsx`, `speech.js` | Bundled Kinyarwanda, local override recordings, speaker test and cancellation |
| Next-symbol prediction | `app/src/predictor.js` | Local trigram, constrained to enabled vocabulary |
| Python ML evidence | `ml/` | Development notebook and training/validation snapshot; no new learner-outcome claim |
| REST API | `api/` | Auth, profiles, vocabulary, sync, summary and prediction |
| Vocabulary | `vocab/` | 181 draft symbols and 2,701 generated lexicon rows, awaiting language review |
| Design references | [Design pack](design/README.md) | Earlier visual reference; its bilingual sample copy is superseded by the Kinyarwanda app |
| Physical access candidate | `hardware/`, `device/` | Keyguard/firmware scaffolds; no fabricated or fitted device claimed |

The local SVGs support import into Figma but are not a native `.fig` file or a verified account prototype. Their separate silent preview uses sample content; the app uses real vocabulary, predictor and device storage.

## Notebook and optional API

With Python dependencies installed:

```sh
python ml/notebooks/run_notebook.py
python -m pytest ml/tests api/tests
python -m uvicorn app.main:app --app-dir api --host 127.0.0.1 --port 8000
```

Open the [notebook HTML](ml/notebooks/vuga_model.html) and Swagger at `http://localhost:8000/docs`. The notebook does not download the corpus or retrain neural models automatically. Optional neural tests need `ml[neural]`.

Set `VUGA_MODEL_DIR` to `ml/artifacts` and configure `VUGA_CORS_ORIGINS` for the app origin. Use a private `VUGA_JWT_SECRET` of at least 32 characters for persistent sessions or multiple workers. Without it, local development uses a temporary key. Detailed setup is in the [project guide](docs/project_guide.md).

## Verification

The [current implementation record](docs/licensed_images_parent_access_2026-10-10.md) records the final executed checks and current screenshots for licensed images and parent access. Verification covers asset provenance and hashes, offline image/audio use, child communication, PIN setup/unlock/change, cooldown persistence, draft preservation and automatic locking. Reports for the earlier generated-picture, illustrated and English-interface versions are historical. API/ML results remain historical; these interface changes do not retrain the predictor.

The demonstrated deployment option is local production preview. For hosting, serve `app/dist` over HTTPS and host FastAPI with persistent storage, backups, correct CORS and a strong signing secret. Set `VITE_API_BASE` at build time. The Docker configuration has not been exercised here; public hosting is not claimed. The full [deployment plan](docs/deployment_plan.md) covers hosting choices, configuration, rollout phases, checks, rollback, privacy and cost.

This repository includes the bundled pictures, Kinyarwanda speech, the trigram model and the executed notebook, but not dependencies (`node_modules`, `.venv`), model weights or private data. Install those with the setup steps above. Stakeholder validation and target-device review remain outstanding.

## Licences

Code: MIT. Online picture licences and required attribution are recorded per asset in the photo manifest; educational use must follow those conditions. Original vocabulary translations and separately permitted human recordings: CC BY 4.0. **Synthetic Kinyarwanda speech uses Meta AI MMS-TTS under CC BY-NC 4.0**; its provenance and licence notice are included with the bundle. ARASAAC pictograms use CC BY-NC-SA 4.0. Original design icons still need recognition/content review.

Training text: Digital Umuganda Common Voice Kinyarwanda sentence corpus, MPL-2.0, pinned by commit. The portable snapshot retains its [source notice](ml/notebooks/evidence/NOTICE.md), licence and hashes. No held-out test examples or participant data are included.
