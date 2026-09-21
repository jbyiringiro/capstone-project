# Results log

Every number reported in the final report is recorded here first, with the command that produced
it, the data manifest hash and the date. Validation results may be updated; the test-set section is
written once.

## Data preparation

| Date | Corpus commit | Lexicon sha256 | Lines read | Mapped | Unique | Train / Val / Test | Top exclusion reasons |
|---|---|---|---|---|---|---|---|
| 2026-09-21 | 2ff83be5 | 77e830a3 (27 seed entries) | 1,698,086 | 17 | 13 | 11 / 2 / 0 | low_core_ratio 1,210,439; too_long 481,418; too_short 6,169 |

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

| Date | Model | top-1 | top-3 | top-5 | Perplexity | Size | Notes |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## Test results (frozen, written once)

_Not yet run._
