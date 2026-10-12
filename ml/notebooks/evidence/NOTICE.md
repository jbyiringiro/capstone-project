# Model notebook evidence snapshot

These are the **existing draft-v3 training and validation symbol sequences**, not generated
examples or AAC participant records. The `sentence` field has been removed. Sequence order,
duplicates within each partition, and partition membership are preserved. Test examples are
neither copied nor read; the test count in the split manifest is historical metadata.

Source: Digital Umuganda's `common_voice_dataset_rw`, commit
`2ff83be588a4b08204d2b15fbb2b0ba0a9bb1f36`, accessed 2026-09-21 according to the original
local provenance record. The source record identifies MPL-2.0; its complete license is
retained in [LICENSE.corpus](LICENSE.corpus). Corpus-derived material retains that notice
separately from the repository's MIT code license. Source files are available at
https://github.com/Digital-Umuganda/common_voice_dataset_rw/tree/2ff83be588a4b08204d2b15fbb2b0ba0a9bb1f36.

`PROVENANCE.json` records capture time, transformations, source and snapshot SHA-256 hashes.
`split_manifest.json` and `exclusions.json` are recorded preprocessing evidence.
`baselines_validation.json`, `gru_validation.json`, and `gru_seed0.json` are original local
training/evaluation records, not new training runs. The notebook freshly refits both statistical
models using these sequences. It labels historical neural results separately and re-evaluates
the GRU ONNX export only when a local matching model is available.

The current lexicon contains automatically generated forms awaiting native-speaker review.
These results demonstrate the pipeline and do not establish clinical effectiveness, child
usability, validated Kinyarwanda mappings, or final held-out performance.
