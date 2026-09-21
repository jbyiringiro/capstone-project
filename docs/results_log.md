# Results log

Every number reported in the final report is recorded here first, with the command that produced
it, the data manifest hash and the date. Validation results may be updated; the test-set section is
written once.

## Data preparation

| Date | Corpus commit | Lexicon sha256 | Lines read | Mapped | Unique | Train / Val / Test | Top exclusion reasons |
|---|---|---|---|---|---|---|---|
| 2026-09-21 | 2ff83be5 | 77e830a3 (27 seed entries) | 1,698,086 | 17 | 13 | 11 / 2 / 0 | low_core_ratio 1,210,439; too_long 481,418; too_short 6,169 |
| 2026-09-21 | 2ff83be5 | d18c4d4a (draft v1: 168 symbols, 2,440 rows) | 1,698,086 | 902 | 675 | 541 / 67 / 67 | low_core_ratio 1,207,855; too_long 481,418; unmapped_token 1,692; ambiguous 4; empty_after_drop 4 |

| 2026-09-21 | 2ff83be5 | 7c543941 (draft v2: 176 symbols, 2,603 rows; infinitives, irregular know/be, agreement forms) | 1,698,086 | 2,768 | 2,084 | 1,674 / 204 / 206 | see exclusions.json; near misses now: tom 812, rwose 551, hari 493, nshobora 415, ikintu 409, mfite/ufite/afite, nari/yari, munsi, buri |

**Split v2** = lexicon 7c543941, seed 20260921, 1,933 groups. Draft v3 lemmas (have/can/must statives, be-past, thing, day, every) are queued in lemmas.csv for the next `run_pipeline.py` iteration.

**Split v1** = lexicon d18c4d4a, seed 20260921, 623 symbol-sequence groups. All validation numbers
below marked v1 refer to it. Near-miss tokens (unknown words blocking otherwise mappable sentences,
`near_misses.csv`): bare infinitives (kuvuga 160, gukora 142, kugira 128), irregular know/be (nzi 246,
sinzi 103, ndi 102), adjective and demonstrative agreement (byiza 174, mwiza 102, byose 147, ibi 257,
iyi 121), and proper names from Bible-like partner text (tom 282, mariya 159, uwiteka 110). Names are
left unmapped on purpose: mapping them to DROP would silently delete content. The other classes were
added to lemmas.csv the same day (draft v2, pending review).

Command: `python ml/scripts/prepare_data.py --lexicon vocab/lexicon.csv`. Smoke run only: the seed
lexicon is a placeholder, so the retained count is meaningless; the exclusion counters and timing
(about 2 min for the full corpus) are what this row records.

### Token coverage of short sentences (2-8 tokens), 2026-09-21

`python ml/scripts/token_frequency.py`: 1,210,457 short sentences, 6,685,768 token occurrences,
345,945 distinct surface forms. Coverage by the most frequent surface forms: top 100 = 25.7%,
top 300 = 37.3%, top 500 = 43.4%, top 1,000 = 52.0%, top 2,000 = 60.7%. The 30 most frequent are
function words and particles (mu, ko, ku, ni, na, kandi, muri, cyane, ya, n, ngo, ntabwo, ari, ...).

Implication for the lexicon (week 4): Kinyarwanda inflection spreads one lemma over many surface
forms, so one symbol needs many `surface` rows (all common conjugations of *gushaka*, for example)
and the frequent function words need explicit DROP rows. Without that, the 80% core-ratio filter
retains very few sentences. Options to evaluate on validation data, in order: (1) enumerate
surface forms per lemma with the collaborators, seeded from `token_frequency.csv`; (2) add a
rule-based prefix stripper for subject/tense markers; (3) use a morphological analyser if a
Kinyarwanda one with a compatible licence is found. The retained-sentence count after each step is
logged here.

## Validation results (development)

| Date | Split | Model | top-1 | top-3 | top-5 | Perplexity | Size | Notes |
|---|---|---|---|---|---|---|---|---|
| 2026-09-21 | v1 | Unigram frequency | 0.125 | 0.276 | 0.366 | 40.1 | 2 kB | 232 prediction events; `vuga_ml.evaluate` |
| 2026-09-21 | v1 | Kneser-Ney trigram (d=0.75) | 0.207 | 0.461 | 0.603 | 22.7 | 28 kB | top-3 vs unigram +0.185, paired bootstrap 95% CI [0.118, 0.250] |
| 2026-09-21 | v1 | GRU 128 (3 seeds) | 0.231 ± 0.026 | 0.484 ± 0.007 | 0.596 ± 0.014 | 18.38 ± 0.02 | 410 kB (ONNX 406 kB) | early stopping at 28-32 epochs; 2-4 s per seed on RTX 5070; `train_neural.py --family gru` |
| 2026-09-21 | v1 | AfriBERTa-small fine-tune (seed 0) | failed | | | | | crashed: validation contained a symbol absent from training and the neural vocabularies were built from training only (the GRU had silently ignored such targets). Fixed the same day: output slots for the full symbol list. Rerun on split v2. |

| 2026-09-21 | v2 | Unigram frequency | 0.109 | 0.230 | 0.330 | 39.0 | 3 kB | 808 prediction events |
| 2026-09-21 | v2 | Kneser-Ney trigram (d=0.75) | 0.257 | 0.480 | 0.589 | 17.0 | 71 kB | top-3 vs unigram +0.250, paired bootstrap 95% CI [0.219, 0.281] |
| 2026-09-21 | v2 | GRU 128 (3 seeds) | 0.260 ± 0.004 | 0.466 ± 0.010 | 0.591 ± 0.007 | 15.61 ± 0.20 | 443 kB (ONNX) | epochs 26/21/25; 12.4/7.0/8.1 s per seed |
| 2026-09-21 | v2 | AfriBERTa-small (3 seeds, 8 epochs max) | see below | | | | | |

These numbers exist to prove the pipeline and are far below the proposal targets because split v1 has
541 training sentences. They are not reported as findings.

### Latency, local screen (laptop CPU, `bench_latency.py`, 300 calls after warm-up)

| Artefact | Size | Median | p95 |
|---|---|---|---|
| KN trigram JSON, Python | 27.8 kB | 0.68 ms | 0.98 ms |
| GRU ONNX, onnxruntime CPU | 406 kB | 0.08 ms | 0.11 ms |

Tablet numbers come from the PWA footer `bench` button and are recorded separately when the study tablet is chosen.

### Study analysis dry run (`analyse_study.py --simulate 20`, planted 28% mean reduction)

Recovered mean reduction 31.4%, bootstrap 95% CI [28.5, 34.2], paired t p < 0.001, Wilcoxon p < 0.001,
SUS mean 75.4; MDE at n = 20 with the simulated SD of 6.6 points is 3.8 points. The pipeline from
trial CSV to the pre-specified report works end to end; the numbers are synthetic.

## Test results (frozen, written once)

_Not yet run._
