# Realistic picture cards — 6 October 2026

**Historical version.** The generated pictures described below were replaced by licensed online photographs on 10 October. Parent controls now require a local PIN. Use the [current implementation record](licensed_images_parent_access_2026-10-10.md) for the latest app and verification. Links to runtime manifests below now describe the replacement assets; the screenshots in this record preserve the earlier version.

The communication board now uses realistic generated images instead of decorative communication icons. The same word keeps the same picture in the board, category navigation, predictions, message strip, full-message display, caregiver vocabulary and audio settings. All labels, controls and speech remain in Kinyarwanda.

The picture set is stored in `app/public/photos/`, with one independently generated image for each of the 181 vocabulary symbols. These are synthetic photographs of fictional subjects, not pictures of research participants. The [image provenance and exact prompts](../app/public/photos/manifest.json) and [image README](../app/public/photos/README.md) accompany the app. The built-in image generation tool produced the original PNGs, preserved in the workspace's `design/photo-sources/`. Compact 480 × 480 WebP copies total 4,760,676 bytes and are packaged and cached offline.

Larger picture areas preserve the full square image without cropping meaningful hands, faces or objects. The phone board retains two columns and the existing touch controls. Functional control icons such as Speak, Back and Settings remain alongside Kinyarwanda labels.

`realisticImages` defaults to true for existing and new profiles while preserving motion and tile-size preferences. **Umurezi → Ikibaho → Amafoto afatika** lets a caregiver select the previous pictograms for that profile. Missing photos automatically fall back to the corresponding existing pictogram, and the word remains selectable. This setting does not change audio, vocabulary or prediction data.

## Verification

**30 unit tests across seven files, the production build and all 25 browser checks passed.** The final build transformed 55 modules and produced 54.62 kB CSS and 328.82 kB JavaScript. Its service worker contains 1,154 precache entries totaling 11,750.46 KiB, including all realistic pictures and Kinyarwanda speech clips.

The [current browser report](screenshots/photos-2026-10-06/browser-report.json) completed at 18:39 Africa/Kigali on 6 October 2026 in headless Microsoft Edge against `http://127.0.0.1:4175/`. It includes ten current screenshots, eighteen audited interface views, no uncaught JavaScript errors and no native media errors. All 181 WebPs matched manifest hashes, decoded natively at 480 × 480 and were already precached before requests. All 181 decoded again after an offline reload. An intentionally unavailable WATER photo fell back to its pictogram while remaining selectable in a displayed message.

The remaining checks exercise actual profiles, vocabulary and picture/motion preferences, legacy English-setting migration, local predictions, ordered composition, focus/modal behavior, export and the two-column 390 × 844 phone board. All 181 synthetic Kinyarwanda WAVs decoded to nonzero samples. Native playback, cancellation, saved recording overrides, upload rejection, deletion, missing-audio handling and offline speech passed. No English speech was requested or cached.

The suite uses isolated synthetic P-01/P-02 profiles and a generated tone upload. It observes unchanged native media playback methods and hides installed system voices. It deliberately removes one cached WATER speech file near the end to test failure handling; the report therefore ends with 180 cached speech files, while the shipped bundle contains all 181. Its 12 native media completions and five completed synthetic-test messages do not establish physical speaker audibility or language quality.

### Current app captures

| Communication | Caregiver |
|---|---|
| [Desktop board](screenshots/photos-2026-10-06/board-desktop.png) | [Profile dialog](screenshots/photos-2026-10-06/profile-dialog.png) |
| [Displayed message](screenshots/photos-2026-10-06/message-display.png) | [Profiles](screenshots/photos-2026-10-06/caregiver-profiles.png) |
| [Offline phone board](screenshots/photos-2026-10-06/board-mobile-offline.png) | [Vocabulary](screenshots/photos-2026-10-06/caregiver-vocabulary.png) |
| [Unavailable audio](screenshots/photos-2026-10-06/missing-audio.png) | [Preferences](screenshots/photos-2026-10-06/caregiver-preferences.png) |
| [Speech settings](screenshots/photos-2026-10-06/caregiver-voice.png) | [Saved test recording](screenshots/photos-2026-10-06/saved-recording.png) |

Eight [catalog sheets](screenshots/photos-2026-10-06/catalog/index.json) received developer visual review across all 181 pictures: [1](screenshots/photos-2026-10-06/catalog/pictures-01.png), [2](screenshots/photos-2026-10-06/catalog/pictures-02.png), [3](screenshots/photos-2026-10-06/catalog/pictures-03.png), [4](screenshots/photos-2026-10-06/catalog/pictures-04.png), [5](screenshots/photos-2026-10-06/catalog/pictures-05.png), [6](screenshots/photos-2026-10-06/catalog/pictures-06.png), [7](screenshots/photos-2026-10-06/catalog/pictures-07.png), [8](screenshots/photos-2026-10-06/catalog/pictures-08.png). They show labels and IDs for review; the runtime pictures contain no added captions or overlays. Developer inspection is not learner-comprehension validation. The earlier partial 18-image preview captures are not included.

The earlier [Kinyarwanda implementation record](design_implementation_2026-10-06.md) documents the preceding illustrated version. The original local Figma import pack remains a historical visual reference.

## Setup

The [project guide](project_guide.md) describes setup and the demonstration.

The repository contains all 181 optimized WebPs and their manifest, ten current screenshots and eight catalog sheets. Original generated PNGs, partial preview screenshots, private recordings, model weights, environments and participant data remain outside the repository. This interface update does not retrain or reevaluate the predictor.

## Review still needed

Caregivers and fluent Kinyarwanda speakers should review whether each picture communicates the intended word. Photographs do not inherently explain abstract words, time, pronouns or social gestures. No child-comprehension study, participant testing or clinical benefit is claimed. Kinyarwanda synthetic speech still needs a separate pronunciation review.
