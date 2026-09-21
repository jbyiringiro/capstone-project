# Review guide for the native-speaker collaborators

You are reviewing two generated files. Nothing in them is final.

## 1. `symbols_draft.csv` (one row per picture on the board)

For each row check the Kinyarwanda label (`label_rw`), the English gloss and the category.
Add rows for symbols you think children need and that are missing. Delete rows that are not
useful for children aged 4 to 12 who are minimally verbal. Aim for 300 to 500 rows in total.

## 2. `lexicon_draft.csv` (how words in text map to symbols)

Each row says: when the word `surface` appears in a sentence, it means these `symbols`.
Rows tagged `generated:...` were produced by conjugation rules and can be wrong. Please:

- Mark wrong spellings by correcting `surface` in place.
- Delete forms nobody uses.
- Add missing common forms, especially the recent past (`nashatse`, `yariye`) and forms with
  object infixes (`ndabikunda`), which the rules do not produce.
- Check that negatives (`negation = 1`) really are negative.
- Sort by `corpus_count` (highest first) and review those rows first; they matter most.
- If a word can mean two different symbols, do not pick one silently: write both in `note`
  and we will discuss it. The pipeline excludes ambiguous words rather than guessing.

## 3. Record every decision

Append one line per change to `decision_log.md`: date, file, row, what changed, why, who.
