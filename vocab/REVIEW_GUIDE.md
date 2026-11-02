# Review guide for the native-speaker collaborators

You are reviewing two generated files. Nothing in them is final.

## 1. `symbols_draft.csv` (one row per picture on the board)

For each row check the Kinyarwanda label (`label_rw`), the English gloss and the category.
Add rows for symbols you think children need and that are missing. Delete rows that are not
useful for children aged 4 to 12 who are minimally verbal. The proposal aims for 300 to 500 rows in
a later milestone; the study keeps the current 181, so write words you would add in `decision_log.md`
instead of adding rows now.

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

## 4. Review with study participants (research question 1)

After ethics approval, participants review the 32 words in `review_words.csv` on the paper vocabulary
review sheet. Show each word with the app's review screen (Umurezi, then Amashusho, then
"Suzuma amagambo rimwe rimwe"): it follows the sheet's order, plays each word's voice and stores
nothing.

1. Transcribe the sheets into `study/vocab_reviews.csv`, starting from
   `python ml/scripts/analyse_vocabulary_review.py --template study/vocab_reviews.csv`
   (one copy of the 32 rows per participant code).
2. Put the post-task "hard to find or understand" answers (`kind` = `hard`, item = symbol_id) and the
   "words to add first" answers (`kind` = `add`, item = the word) in `study/vocab_mentions.csv`.
3. Run `python ml/scripts/analyse_vocabulary_review.py --reviews study/vocab_reviews.csv
   --mentions study/vocab_mentions.csv --out study/vocab_review.json --log-out study/draft_decisions.md`.
4. Discuss each drafted row with both native speakers, then copy the final decision (accepted,
   revised, excluded or unresolved, and who decided) into `decision_log.md`.

Six to eight interviews validate this vocabulary; they do not establish what all children need, so
needs that adults describe are reported only as context.

## 5. Sentences the app speaks

The app now joins the pictures into a Kinyarwanda sentence (njye + gushaka + amazi is said
"Ndashaka amazi"). The words it can produce are listed in `grammar_forms_review.csv`, one row per
verb, person and form, plus each noun's "where" phrase, call form and place phrase.

1. Read the rows for the most common verbs first (WANT, LIKE, NEED, GO, COME, EAT, DRINK, PLAY,
   HELP, HURT, TIRED, HUNGRY) and mark `correct?` yes or no, with a `better form` when needed.
2. Check `grammar_nouns.csv`: the noun class (it decides `uri he` / `iri he` / `riri he`), the call
   form (`nshuti`) and the place phrase (`mu rugo`, `ku ishuri`). Rows with a note are uncertain.
3. Corrections to rules go in `ml/vuga_ml/sentences.py` or `morphology.py`, to nouns in
   `grammar_nouns.csv`. Then run `python ml/scripts/export_grammar.py` and
   `python scripts/generate_kinyarwanda_audio.py --forms`, and record the change in
   `decision_log.md`.
