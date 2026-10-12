# Licensed photographs and parent access — 10 October 2026

This update replaces the generated communication pictures with online photographs carrying explicit reuse licences, and separates the child's board from parent controls. The board, parent forms, settings and speech remain in Kinyarwanda. The earlier [generated-picture record](realistic_images_2026-10-06.md) is historical.

## Photographs

All 181 word cards use a locally bundled WebP, drawn from 116 distinct photographs. The [photo manifest](../app/public/photos/manifest.json) records each word's original title, creator, source page, download URL, exact licence/link, source hash, runtime hash and modifications. The [credits page](../app/public/photos/credits.html), linked from the parent area, provides attribution next to each picture. Related abstract words can share a contextual photograph; the manifest notes the limits of those representations.

Photos are resized to fit a 480 × 480 cream canvas without cropping or generative editing. Local copies and credits are precached so the child does not need an internet connection after installation. An unavailable photo falls back to its existing pictogram. Parents can choose pictograms for an entire profile with **Ikibaho → Amafoto afatika**.

`scripts/prepare_licensed_photos.py` checks complete vocabulary coverage, source hashes and required attribution before replacing runtime assets. The previous `app/scripts/prepare-photos.mjs` now calls that importer and cannot restore the generated PNGs. Original source downloads are outside the app bundle; `--download` can restore missing originals from the manifest's pinned URLs, subject to matching hashes. This preparation step requires Pillow.

The photographs retain their individual licences, including attribution and ShareAlike where applicable. Their licences do not replace the separate noncommercial terms for ARASAAC fallback pictograms and MMS-TTS speech. People depicted in online photos are illustrative subjects, not Vuga participants, and their inclusion does not indicate a disability or endorsement.

## Child and parent access

- The app opens on the child's communication board. It requires no PIN to compose, display or speak messages.
- **Umurezi** opens a separate adult access screen labelled for a parent or caregiver. On first use, an adult sets and confirms a four-to-six-digit PIN; there is no default PIN. Set it before handing the device to a child.
- The parent area contains profiles, vocabulary, board preferences, recordings, summaries, export/sync and PIN changes. It mounts only after successful local PIN verification.
- Returning to the child's board, reloading, moving the app into the background or five minutes of inactivity locks parent access. A normal parent visit preserves the board's draft; profile/mode changes start a new message session.
- Five incorrect entries trigger a persisted 30-second cooldown. The PIN is stored as a salted PBKDF2 digest; the unlocked session stays in memory. PIN material is excluded from message exports and server sync.
- **Kwinjira** changes the PIN and requires the existing PIN. There is no child-facing reset or default bypass.

This is a local gate against accidental child access, not separate encrypted accounts or protection against someone controlling browser storage. Clearing site data removes both the PIN and other local app data. Optional API account authentication remains separate.

## Verification

**35 unit tests across eight files, the production build and 34 browser checks passed.** The [25-check workflow report](screenshots/licensed-2026-10-10/browser-report.json) verifies all 181 photo hashes, native decoding, complete precaching, offline reload, attribution coverage and missing-photo fallback. It also exercises the existing profiles, predictions, message composition, all 181 Kinyarwanda clips, native playback/cancellation, recording uploads, export and responsive layouts. Eighteen interface-language audits found none of the known former English UI strings. There were no uncaught JavaScript errors or unexpected native media errors.

The separate [nine-check parent-access report](screenshots/licensed-2026-10-10/parent-access-report.json) covers setup confirmation, incorrect PINs, credential changes, a cooldown that survives reload, return/reload locking, idle/background locking, offline unlock, corrupt-storage handling, mobile layout, and the alternate empty-board/audio-error entry routes. Backgrounding is simulated and the browser clock is advanced for timeout checks. Both reports run against the same local production preview in isolated browser contexts.

The [asset audit](screenshots/licensed-2026-10-10/asset-audit.json) verifies downloaded and runtime hashes, complete vocabulary coverage and **zero remaining generated runtime pictures**. The 181 optimized files total 5,472,134 bytes. Licences comprise CC BY 2.0/3.0/4.0, CC BY-SA 2.0/3.0/4.0, CC0 and public domain. Eight [contact sheets](screenshots/licensed-2026-10-10/catalog/index.json) received developer visual review. The build contains 58 modules, 56.54 kB of CSS, 339.35 kB of JavaScript and 1,155 precache entries (12,609.69 KiB).

| Current screen | Evidence |
|---|---|
| Child board | [Desktop](screenshots/licensed-2026-10-10/board-desktop.png), [offline phone](screenshots/licensed-2026-10-10/board-mobile-offline.png) |
| Parent access | [First setup](screenshots/licensed-2026-10-10/parent-first-setup.png), [unlock](screenshots/licensed-2026-10-10/parent-unlock.png), [phone](screenshots/licensed-2026-10-10/parent-unlock-mobile.png) |
| Parent controls | [Profiles](screenshots/licensed-2026-10-10/caregiver-profiles.png), [vocabulary](screenshots/licensed-2026-10-10/caregiver-vocabulary.png), [preferences](screenshots/licensed-2026-10-10/caregiver-preferences.png), [audio](screenshots/licensed-2026-10-10/caregiver-voice.png) |

Earlier October reports describe earlier app versions. Developer visual checks do not establish child recognition; identical context photos may not distinguish abstract meanings. No school visit, participant evaluation, fluent-speaker review, physical speaker test or public deployment is claimed. Kinyarwanda speech remains synthetic and separately licensed under CC BY-NC 4.0.
