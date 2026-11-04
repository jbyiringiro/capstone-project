# Vuga project guide

Updated 2 November 2026. The working app is fully in Kinyarwanda, including its board, caregiver interface, validation/error messages and speech path. Communication cards use licensed online images, and a caregiver PIN, tied to the caregiver's mobile number once they link one, separates child communication from caregiver controls. Research scope, picture recognition, native-speaker review and participant benefit remain provisional. The adult study and vocabulary validation were approved by the ALU Research Ethics Committee on 2 November 2026 (approval code SEPT26-BSE-048, valid for six months) and are planned for 10–20 November. The [testing report](testing_report.md) records the checks run on this version; the [10 October](archive/licensed_images_parent_access_2026-10-10.md) and [6 October](archive/design_implementation_2026-10-06.md) implementation records and the [28 September verification](archive/verification_2026-09-28.md) are historical.

## Start the app on Windows

From the repository's `app` folder, with Node.js/npm installed:

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

Open `http://127.0.0.1:4175`. Production preview is needed for service-worker/offline tests. The board needs no account, and the caregiver area can be set up without one.

Choose pictures and use **Siba**, **Siba byose**, **Erekana**, and **Vuga** to compose, correct, display and speak a message. The 188-word draft vocabulary uses licensed online images bundled for offline use, and simple action controls retain icons. Missing photos fall back to existing pictograms. The grid fills the screen with keys of at least 2 cm, so a phone shows fewer, larger keys than a tablet. A new board shows the section tabs, starting at **Ingenzi**, and three suggested next words (**Birashoboka**) from the local trigram; a caregiver can turn either off.

The child board opens without a PIN. Hold **Umurezi** or activate it with the keyboard to open the separate parent access screen. On first use, the caregiver types their Rwandan mobile number, Vuga texts a six-digit code, and the caregiver chooses and confirms a four-to-six-digit PIN. That PIN opens the caregiver area on this device, offline too, and signs in to the caregiver's account with the number on another device, which then gets the account's backup. A number that already has an account signs in with its PIN instead. Without internet, **Komeza nta nimero** keeps the PIN on this device only; the number can be linked later in **Kwinjira**. **Subira ku kibaho** dismisses setup so communication remains available. Subsequent visits require the PIN before any caregiver controls are mounted. There is no default PIN. **Abana** creates/selects a device profile; **Amashusho** configures its vocabulary. **Ikibaho** holds the board settings: the section tabs and the section the child sees, words on the pictures, **Amagambo afasha** (suggestions) and personal suggestions, page swiping, sentence speech, saying each picture on tap, board size, **Amashusho anyeganyega buhoro**, **Amashusho manini cyane**, and **Amafoto afatika**. The photo preference defaults on; turning it off restores pictograms for that profile. Settings are saved per profile; system reduced-motion takes precedence. Returning to the board preserves its draft. Changing profile or prediction mode resets it; browser-reload draft recovery is not claimed.

**Kwinjira** shows the linked number, or links one, and changes the PIN after checking the current one; on a linked device the account's PIN changes too, so that needs internet. A new or reset PIN ends the account's sessions on every other device, which then asks for the new PIN in **Ohereza**. Returning to the child board, reloading, backgrounding the app, or five minutes without input locks the parent session. Five incorrect PINs on the device trigger a 30-second cooldown that survives reload; five wrong PINs when signing in with the number lock that number on the server for 15 minutes, and a texted code lifts the lock. The device stores the PIN only as a salted PBKDF2-derived credential and the server keeps a bcrypt hash; unlocked sessions are never persisted. The device check prevents unintended settings changes but does not protect against someone with browser-storage access. Setting the PIN shows a one-time recovery code (16 letters and digits) to write down; it is stored only as a second PBKDF2-derived credential. **Nibagiwe umubare w’ibanga** on the PIN screen sets a new PIN with that code (wrong codes count towards the same cooldown), or with a code texted to the linked number, which changes the account's PIN too; both keep every child's data and show a new recovery code. **Kwinjira** makes a new recovery code with the current PIN. There is no child-facing reset; without a recovery code or a linked number, clearing browser storage removes the PIN and the local data that is not on the account backup.

**Incamake** reports actual completed spoken messages and has an empty state. **Ohereza** provides explicit JSON export, sign-in to the linked account with the PIN, optional server sync of completed messages, and the account backup of the device's set-up. Messages and activity remain on this device unless a supported export or sync is explicitly requested. The backup holds each child known by a code (such as P-01) with their words and settings; a child the family calls by name, custom words and their photos, recordings, messages and the PIN stay on the device, and the API refuses them. When another device has saved newer changes, **Ohereza** lists what differs, by child, and the caregiver keeps the account's copy or this device's; a device that changed nothing takes the newer copy itself.

## Assets and Kinyarwanda speech

The asset set contains the small trigram artifact, licensed online images for the 188 communication words, fallback pictograms, original design SVGs, 188 synthetic Kinyarwanda word clips and 1,259 generated clips of inflected words for spoken sentences. [Source, author, licence and hash records](../app/public/photos/manifest.json) accompany the optimized offline images. Retain each image's attribution and applicable licence conditions. The images are not project participant photographs. Git ignores some derived assets. A fresh clone may need to restore those assets.

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

Recordings stay in IndexedDB and are excluded from export/sync, the account backup and the repository. Clearing browser storage removes them; keep originals separately. Custom installation clips are also excluded from the repository. Only the synthetic bundle and nonverbal test tone are included; file-integrity checks are not human language review. See [audio setup and regeneration](../app/public/audio/README.md).

## Python environment and notebook

From the repository root, using Python 3.11+:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -e "./ml[dev,notebook]" -e "./api[dev]"
.venv\Scripts\python.exe ml/notebooks/run_notebook.py
```

Open [the executed notebook](../ml/notebooks/vuga_model.ipynb) or [HTML report](../ml/notebooks/vuga_model.html). The portable snapshot contains 2,621 training and 319 validation sequences, requiring no corpus download. Recorded neural results are separated from optional fresh ONNX inference. This language conversion does not retrain the predictor or evaluate held-out test data.

## Optional backend

From the repository root, in another terminal:

```powershell
$env:VUGA_MODEL_DIR = (Resolve-Path ml/artifacts).Path
$env:VUGA_CORS_ORIGINS = '["http://localhost:5173","http://127.0.0.1:4175"]'
.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir api --host 127.0.0.1 --port 8000
```

Swagger is at `http://localhost:8000/docs`. SQLite is the default; vocabulary is seeded at startup. An account is opened with a Rwandan mobile number, confirmed by a six-digit code texted through Africa's Talking, and the caregiver's PIN. Without `VUGA_AFRICASTALKING_API_KEY` the API sends no text and writes each code to its log instead (`SMS to +250…`), which suits local runs only. Public registration cannot create administrators. Create server profiles through the API or app and explicitly fetch them under **Ohereza**. Upload sends completed messages only for the signed-in account's owned server profiles; it does not convert local profiles.

Use a private random `VUGA_JWT_SECRET` of at least 32 characters for persistent sessions/multiple workers. Without it, development tokens and texted codes stop working after a restart. The PostgreSQL/API Docker option requires that secret and has not been exercised here.

## Source and design evidence

| Layer | Source | Demonstration |
|---|---|---|
| Child board | `app/src/board/` (Board, SymbolCell, grid pages, MessageSession, suggestions hook) | Responsive composition, stable tiles, fixed 4–40 cell pages, ordered action log |
| Caregiver area | `app/src/caregiver/` (Dashboard shell, one component per tab) | Profiles, vocabulary, custom words, board settings, speech, summary, sync |
| Device storage | `app/src/storage/` (one module per IndexedDB store) | Profiles, vocabulary, messages, recordings, custom words, board preferences, export, device backup |
| Parent access | `app/src/parent-access/` | Account by mobile number (AccountLink), PIN setup/unlock/change, recovery code and SMS reset, persisted attempt cooldown and automatic session locking |
| Child mode | `app/src/child/` | Caregiver-chosen board of up to 12 pictures and the Shakisha picture-finding game |
| Sentence speech | `app/src/grammar/` | Pictures joined into a Kinyarwanda sentence, spoken with generated word clips |
| Server client | `app/src/server/` | API client, mobile numbers and SMS codes, adult-requested sync and the account backup |
| Speech | `app/src/speech/` (audio source chain, SpeechPlanner, player, warm-up), `caregiver/VoiceSettings.jsx`, `caregiver/AudioSettings.jsx` | Kinyarwanda-only playback, bundled speech, installed clips and local recordings |
| Prediction | `app/src/prediction/` (Predictor, KneserNeyTrigram, PersonalReranker, top-k) | Enabled-vocabulary constrained local trigram with optional personal re-ranking |
| API/schema | `api/app/routers/`, `api/app/services/`, `schemas.py`, `models.py` | Accounts by mobile number (SMS codes, PIN lock, sessions ended by a new PIN), owned profiles, vocabulary, sync, account backup with revisions, predictions and summaries |
| ML evidence | `ml/vuga_ml/`, `ml/notebooks/` | Data engineering, architecture and development metrics |
| Visual references | [Local design pack](../design/README.md) | Earlier layouts, style guide, tokens and SVG/PNG imports |

The silent design preview is separate sample content. Its earlier bilingual copy and illustrated cards are superseded by the app's Kinyarwanda copy, licensed pictures and parent gate; it is retained as a visual design reference. SVGs are not a native `.fig` file or a verified account prototype. Current app screenshots are in `docs/screenshots/final-2026-10-22/`, regenerated on 2 November 2026 for this version; the 10 October and 6 October folders are historical. Browser checks do not establish target-device suitability or learner outcomes. Stakeholder research with a school or caregivers is still outstanding.

## Deployment, verification and packaging

Use the local production preview for the demonstration. Hosted deployment would serve `app/dist` over HTTPS with a persistent API database, backups, strong signing secret, Africa's Talking credentials and correct CORS ([deployment plan](deployment_plan.md)). Set `VITE_API_BASE` at build time. No public deployment is claimed; earlier dependency advisories are not resolved by translation.

See the [testing report](testing_report.md) for the executed checks, their results and the screenshot evidence. The browser suites verify image sources/licences/hashes, offline image and audio use, child communication and child mode, custom words, grid pages, places, next words and sentence speech, the account by mobile number with its SMS reset and lock, parent PIN setup/unlock/change, the recovery code, wrong-PIN rejection, persisted cooldown, draft retention, reload/background/idle locking and corrupt-storage rejection. Reports for the earlier generated-picture, illustrated and English-interface/audio versions are historical.

`.gitignore` decides what the repository contains. Environments, dependencies, model weights, private/custom recordings, credentials (including the local parent PIN credential), databases, participant logs, raw corpora and held-out test examples are excluded. The superseded generated PNG sources are not in the repository. The repository uses compact licensed online images with source, author, licence and hash records. Included audio is limited to the 188 synthetic Kinyarwanda WAVs, the 1,259 generated MP3 word forms, their provenance/licence files and the nonverbal speaker-test WAV.

The [walkthrough video](https://drive.google.com/file/d/11ALnAjvop92pTYnx-89AKJn1B6W2rRHp/view?usp=drive_link) is on Google Drive and linked at the top of the README. No fresh dependency installation, school validation or production hardening is claimed.
