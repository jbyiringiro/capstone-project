# Earlier Vuga design and Kinyarwanda implementation — 6 October 2026

**Historical implementation record.** This document and its 23-check browser report describe the illustrated version before realistic picture cards were introduced. For the current app, screenshots and verification, use the [realistic picture implementation](realistic_images_2026-10-06.md). The preceding measurements below are retained with their original scope.

The working Vuga app now uses Kinyarwanda throughout its interface and speech. Its local cream-and-teal visual design connects to real profiles, vocabulary, prediction and browser storage. The project remains an initial communication-kit demonstration; school needs, wording, symbol recognition, pronunciation and user benefit still require review. No participant findings are claimed.

## Recorded design and behavior

The source visual direction is the [local design pack](../design/README.md): [silent preview](../design/preview.html), [foundations](../design/foundations.html), [tokens](../design/tokens.json), [icons](../design/assets/icons-contact-sheet.svg) and [handoff](../design/HANDOFF.md). These HTML/SVG/PNG files are local import references, not a native `.fig` document or verified account prototype. Their earlier bilingual sample copy is historical; use the running app for the current Kinyarwanda copy.

| Design intent | Implemented behavior |
|---|---|
| Cream surfaces, teal actions, rounded illustrated tiles | Applied to the real board and caregiver interface; 25 custom SVGs cover selected symbols/controls |
| Direct communication | The board opens without a mandatory account; all 181 vocabulary entries remain configurable |
| Consistent choices | Stable category/grid order; optional real trigram suggestions have a separate area |
| Kinyarwanda throughout | Visible text, accessible names, tooltips, dialogs, forms, validation, failures and caregiver tabs are translated; English subtitles and speech choices removed |
| Responsive access | Two-column phone board, larger-tile option, visible focus and profile-scoped preferences |
| Optional motion | Brief interaction feedback; caregiver and operating-system reduced-motion controls |
| Draft retention | A caregiver visit preserves composition; profile/mode changes reset it; reload draft recovery is not claimed |
| Kinyarwanda speech | 181 synthetic clips, local recording overrides and matching-system-voice fallback only |
| Message completion | Successful Kinyarwanda playback records a completed message; errors preserve the message and **Erekana** |
| Caregiver control | **Abana**, **Amashusho**, **Ikibaho**, **Ijwi**, **Incamake**, **Ohereza** use actual local or explicit server workflows |

Literal vocabulary sequences such as `njye / gushaka / amazi` are not grammatically corrected sentences. These labels and illustrations remain draft content.

## Speech source and boundaries

The app bundles 181 synthetic Kinyarwanda word clips generated from exact `label_rw` strings using Meta AI's `facebook/mms-tts-kin`, pinned at `71d00a03419b9bfd203a6bfa4d6bc565cbe3c4e0`. The [manifest](../app/public/audio/rw/manifest.json), [README](../app/public/audio/rw/README.md) and [licence](../app/public/audio/rw/LICENSE.txt) retain attribution, **CC BY-NC 4.0**, generation parameters, hashes and review status. The bundle is distributed for noncommercial research under those terms. Weights/dependencies are kept outside the app and repository.

All 181 clips passed exact vocabulary/hash and nonzero 16,000 Hz mono PCM16 checks: 4,914,972 bytes and 153.344 seconds total. Automated checks do not review pronunciation. The speech is synthetic, not a human recording or evidence of native-speaker validation.

Playback uses a caregiver-saved clip first, then a custom installation clip, bundled speech, and finally an available matching Kinyarwanda voice. English is never substituted. Old English-demo preferences migrate to Kinyarwanda. The English runtime pack is removed; the earlier English browser results are superseded.

**Umurezi → Ijwi** offers **Umva “amazi”** and a separate nonverbal **Gerageza indangururamajwi** tone. Local recording/upload includes preview, save and confirmed deletion. Clips are shared across profiles on this browser, excluded from sync/export and lost if browser storage is cleared. Native recording permissions/file selection remain browser-owned dialogs. Saved uploads cannot be automatically verified as the correct language or word.

## Preceding technical verification: illustrated version

- **29 app unit tests passed across seven files.**
- **Production build passed:** 55 modules; 52.43 kB CSS; 328.88 kB JavaScript. The service worker generated 791 precache entries totaling 6,864.38 KiB, including Kinyarwanda audio and the speaker-test tone.
- **Audio bundle validation passed:** all 181 exact Kinyarwanda labels, pinned model provenance, file hashes and nonzero PCM; model attribution and full licence included.
- **23 Kinyarwanda browser checks passed**, with ten screenshots, eighteen language-audited views, no uncaught JavaScript errors and no native media errors. The report completed at 13:09 Africa/Kigali on 6 October 2026 in headless Microsoft Edge against `http://127.0.0.1:4175/`. Earlier English-interface/audio reports are historical and do not verify this build.

The [browser report](screenshots/kinyarwanda-2026-10-06/browser-report.json) verifies Kinyarwanda controls/validation and legacy-setting migration; profiles, vocabulary and appearance persistence; real predictions and ordered composition; dialog/focus behavior; local summary/export; reduced motion; and the two-column 390×844 phone layout. All 181 bundled clips decoded to nonzero samples. Three native playback completions produced exactly one completed message; Stop retained the draft without success. Word/tone tests, silent/corrupt upload rejection, saved override playback, confirmed deletion and fallback, offline reload/playback and missing-clip handling passed. No English audio was requested or cached.

The ten captures below come from the running production React app with isolated synthetic P-01/P-02 profiles. Desktop views use 1280×900; phone views use 390×844. The saved-recording image is a region capture. These are not participant records or captures of the separate design preview.

The suite observed the unchanged native HTMLMediaElement playback methods, hid installed system voices, and used a generated 0.65-second 440 Hz tone for upload/storage tests. It deliberately deleted one WATER entry from its isolated offline cache to verify unavailable-audio handling; this is why the final report shows 180 remaining cached speech files. The shipped bundle has all 181. The run observed 12 native media completions across reloads and five completed synthetic-test messages; the tone is not Kinyarwanda pronunciation evidence.

| Communication | Caregiver |
|---|---|
| [Desktop board](screenshots/kinyarwanda-2026-10-06/board-desktop.png) | [Profile dialog](screenshots/kinyarwanda-2026-10-06/profile-dialog.png) |
| [Displayed message](screenshots/kinyarwanda-2026-10-06/message-display.png) | [Profiles](screenshots/kinyarwanda-2026-10-06/caregiver-profiles.png) |
| [Offline phone board](screenshots/kinyarwanda-2026-10-06/board-mobile-offline.png) | [Vocabulary](screenshots/kinyarwanda-2026-10-06/caregiver-vocabulary.png) |
| [Unavailable audio](screenshots/kinyarwanda-2026-10-06/missing-audio.png) | [Preferences](screenshots/kinyarwanda-2026-10-06/caregiver-preferences.png) |
| [Speech settings](screenshots/kinyarwanda-2026-10-06/caregiver-voice.png) | [Saved test recording](screenshots/kinyarwanda-2026-10-06/saved-recording.png) |

Browser playback events and sample checks do not establish physical-speaker audibility, pronunciation quality, screen-reader behavior, target-tablet access or understood communication. Microphone capture and fluent-speaker listening review remain separate checks.

## Evidence map

| Requirement | Artifact |
|---|---|
| Frontend and responsive behavior | `app/src/App.jsx`, `Board.jsx`, `Dashboard.jsx`, CSS and runtime icons |
| Audio implementation | `speech.js`, `VoiceSettings.jsx`, `AudioSettings.jsx`, bundled manifest/licence |
| Backend/data model | `api/app/main.py`, `schemas.py`, `models.py`; device storage in `app/src/db.js` |
| ML notebook and metrics | [Executed notebook](../ml/notebooks/vuga_model.ipynb), [HTML](../ml/notebooks/vuga_model.html), portable validation evidence |
| Deployment and video outline | [Project guide](project_guide.md), [deployment plan](deployment_plan.md) |

The predictor was not retrained during this change. Earlier notebook execution had 10 code cells/three figures and development-only top-3 scores of 21.96% unigram, 45.78% trigram and 46.92% existing GRU seed-0 ONNX. These are historical technical measurements, not new evaluation or learner outcomes. [September API/ML verification](verification_2026-09-28.md) is similarly historical.

The repository includes current source, notebook/evidence, design assets, current Kinyarwanda screenshots/report, 181 speech clips with provenance/licence and the nonverbal test tone. The earlier visual design pack is clearly labelled as a reference; obsolete October English screenshots/audio reports are excluded. Private/custom recordings, pretrained speech-model weights, environments, credentials, databases, participant logs, raw corpora and held-out examples are excluded.

A new clean dependency installation is not claimed.

A real GitHub URL, required 5–10 minute video, any public hosting and school validation remain outstanding. Requirements still need to be established with a school or caregiver partner. The archive is an initial demonstration, not a validated final assistive product.
