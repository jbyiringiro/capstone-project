"""vuga_ml: data preparation, baselines and evaluation for next-symbol prediction.

Package layout mirrors Chapter 3 of the proposal:
  normalise  - sentence normalisation and tokenisation (3.3.2)
  lexicon    - surface form / lemma -> symbol lexicon (3.3.2)
  mapping    - sentence -> symbol sequence with exclusion reasons (3.3.2)
  splits     - deduplication and stratified 80/10/10 split (3.3.2)
  models     - unigram, Kneser-Ney trigram; neural models added in weeks 5-7 (3.3.4)
  metrics    - top-k accuracy, perplexity, simulated KSR (3.2.3, 3.2.5)
  evaluate   - command-line evaluation harness producing a JSON report
"""

__version__ = "0.1.0"

BOS = "<s>"
EOS = "</s>"
