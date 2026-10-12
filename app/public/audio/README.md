# Vuga Kinyarwanda audio and local recordings

The working app's interface and speech are in Kinyarwanda. There is no English speech choice or fallback. Old English-demo settings migrate to Kinyarwanda; the former demo assets are not in the app or repository.

## Bundled speech

`rw/` contains 181 synthetic WAV clips, one for each exact `label_rw` in `vocab/symbols.csv`. They were generated locally with Meta AI's pinned `facebook/mms-tts-kin` model. The [bundle README](rw/README.md) explains regeneration, attribution and the **CC BY-NC 4.0** licence. The [manifest](rw/manifest.json) records the model revision, input labels, file hashes, durations and signal measurements. The [licence](rw/LICENSE.txt) is included for offline reference.

The clips are synthetic and have **not** had fluent-speaker pronunciation review. This is a noncommercial research prototype; retain the attribution and licence restrictions when sharing. Model weights are not shipped in the app. Clips work offline after the production app has finished caching.

`speaker-test.wav` is a locally generated short nonverbal tone. It checks the playback path; it is not a spoken word.

## Listen or add a familiar voice

Open **Umurezi → Ijwi**. **Umva “amazi”** tests a Kinyarwanda word. **Gerageza indangururamajwi** plays the nonverbal tone. Native playback events alone do not prove that physical speakers were audible; check tab mute, device volume and output device if necessary.

Select a word to record or upload, listen to the preview, verify its meaning/pronunciation, then save. Microphone capture needs supported browser permissions and HTTPS or localhost. Clips are limited to approximately 15 seconds and 10 MB. Validation checks decoding and apparent silence, not the spoken language or correctness.

Saved clips stay in this browser's IndexedDB, apply to all its profiles and work offline. Replacing/deleting a word affects all profiles; deletion requires confirmation. Recordings are excluded from sync/export and the submission archive. Clearing browser storage removes them; retain original files separately.

A developer can install reviewed clips at `app/public/audio/SYMBOL_ID.wav` before building. The playback order is: saved recording, installed root clip, bundled `rw/` clip, then a matching Kinyarwanda system voice if available. No system voice is assumed. If audio cannot play, the message remains available through **Erekana**.

## Packaging

The repository includes only this README, the nonverbal test tone, and `rw/` WAVs plus manifest, README and licence. Custom root clips, microphone/uploaded recordings, browser databases and model weights are excluded. The bundle manifest records all 181 vocabulary texts and hashes. These records establish file integrity and coverage, not pronunciation or communication benefit.
