# Vuga AAC: supervisor briefing

Josue Byiringiro, BSc Software Engineering (ML), ALU Mission Capstone. Supervisor: Junior Turatsinze.
Meeting date: 22 September 2026 (week 4). Repository: `CAPSTONE/vuga-aac`. Proposal: `CAPSTONE/proposal/`.

**In one paragraph.** Vuga is a free, offline, Kinyarwanda-first picture-to-speech app for minimally
verbal autistic children, with a machine-learning model that predicts the next picture so a child
needs fewer taps per message. Four weeks into the course, every software component planned for
weeks 4 to 8 is built and under automated test, and the first (non-final) model numbers exist.
What remains is not code: the reviewed Kinyarwanda vocabulary and recordings, the partner site,
ethics approval, the study tablet, and the adult study itself.

## 1. Problem

Children who speak little or not at all communicate through pictures, and the tools that make
this work do not exist in Kinyarwanda.

- **Language exclusion.** Rwanda's 2022 census recorded 17,852 children aged 5 to 17 with a
  communication disability. Only 8% of persons with disabilities are literate in English against
  56% in Kinyarwanda (NISR, 2025). Every reviewed AAC app is English-first; no product or study
  supports Kinyarwanda.
- **Cost and lock-in.** The effective apps cost about USD 250 (Proloquo2Go, Apple only) or need a
  subscription (TD Snap, Otsimo). Assistive-technology access is as low as 3% in low-income
  countries (WHO and UNICEF, 2022).
- **Static boards are slow and impersonal.** Prediction in existing apps is limited to keyboard
  word completion. Pictogram prediction has been studied in only eight papers and never shown to
  improve real communication (Pereira et al., 2022). Teachers without AAC training cannot
  personalise a child's vocabulary.

## 2. Solution

A web app that installs on a low-cost Android tablet and works with no internet.

- **Child side.** A board of ARASAAC pictograms with Kinyarwanda labels, colour-coded by category
  (people, actions, feelings, things, questions, social). The child taps pictures into a message
  bar and presses *Vuga*; the message is spoken with recorded Kinyarwanda audio. In predictive mode
  a row of three suggested next pictures appears above the board.
- **Prediction.** A language model trained on Kinyarwanda text, mapped to the symbol vocabulary,
  scores the next symbol. Its output is masked to the symbols enabled for that child and re-ranked
  by the child's own frequency and recency, so it never suggests a picture the child does not have.
  It runs on the device in about a millisecond.
- **Adult side.** A teacher or caregiver holds the gear icon for 1.2 seconds (no text link a child
  can tap) to reach the dashboard: child profiles (pseudonymous codes only), per-child vocabulary,
  board mode (static or predictive), explicit upload of logs, and a usage summary (taps per
  message by mode, most-used symbols).
- **Data discipline.** Every action (select, navigate, correct, speak) is logged locally; nothing
  is uploaded unless an adult presses Sync while online. No audio, video or names leave the device.
- **Beyond the tablet (secondary).** A 3D-printed keyguard (parametric OpenSCAD, ready to print)
  and a low-cost talker device (ESP32-S3 firmware skeleton) that plays the same recordings.

## 3. Approach

### Research questions and hypotheses (from the accepted proposal)

| | Question | Hypothesis / target |
|---|---|---|
| RQ1 | What communication needs and core vocabulary do teachers and caregivers identify? | Interviews and vocabulary validation with collaborators and the partner site |
| RQ2 | Does a Kinyarwanda-adapted transformer beat frequency and n-gram predictors? | H1: higher top-3 accuracy than unigram and trigram baselines; H1b (exploratory): vs GRU. Target top-3 >= 60%, p95 latency < 200 ms on the study tablet |
| RQ3 | Does the predictive board cut taps per message, and is it usable? | H2: mean participant-level reduction in all-action taps >= 25% vs static board (95% CI); SUS >= 70; n >= 20 adults |

### Data

- **Text.** Digital Umuganda Common Voice Kinyarwanda sentence corpus (MPL-2.0), pinned by git
  commit with SHA-256 hashes: 1.70 million lines.
- **Symbol mapping.** Sentences of 2 to 8 tokens are converted to symbol sequences through a
  lexicon (surface form -> lemma -> symbol, with function words dropped). A sentence is kept only if
  at least 80% of its tokens are resolved. Every exclusion is counted by reason; proper names are
  left unmapped rather than deleted.
- **Kinyarwanda morphology.** One lemma appears in dozens of inflected forms, so the lexicon is
  generated from a lemma list by a rule-based conjugator (subject prefixes, tense, negation, Dahl's
  law, nasal and glide rules) and refined from a "near-miss" report of frequent unknown words. This
  is the main engineering work of weeks 4 to 5 and the part that most needs native-speaker review.
- **Split.** Grouped, stratified 80/10/10 (seed 20260921); identical symbol sequences never
  straddle partitions. The test partition is evaluated once; the evaluation script refuses it
  without an explicit `--final` flag.

### Models and metrics

| Model | Role | Status |
|---|---|---|
| Unigram frequency | Baseline (what a static board effectively offers) | done |
| Kneser-Ney trigram | Strong classical baseline; 100 kB; runs in JS on the tablet | done; JS port numerically identical to Python (parity test) |
| GRU (PyTorch, ONNX export) | Small neural model, 440 kB | done |
| Transformer fine-tune (AfriBERTa-small; KinyaBERT if licence allows) | Proposed model (H1) | done; 338 MB, too large for on-device, needs distillation or a smaller encoder |
| Personal re-ranker | Frequency, recency and context on top of any model | done, evaluated by simulation until real logs exist |

Metrics: top-1/3/5 accuracy, perplexity, simulated keystroke savings (board-layout simulator);
paired bootstrap confidence intervals over sentences; three seeds for neural models.

### User study (weeks 8 to 10, after REC approval)

At least 20 teachers, therapists and caregivers compose the same set of messages on a static and a
predictive board, counterbalanced. Primary outcome: within-participant % reduction in all-action
taps per message (Speak counted). Bootstrap CI over participants, paired t-test, Wilcoxon as
sensitivity, Holm correction for secondaries (time, corrections), SUS afterwards. The analysis
script is written and validated on simulated data.

## 4. Progress to date (week 4, ahead of plan)

I pulled the week 5 to 8 build work forward so that the weeks after ethics approval go to data,
participants and writing rather than debugging.

| Component | Planned | State on 22 Sept |
|---|---|---|
| Data pipeline, lexicon generator, split, metrics | W4 | done; 3 lexicon iterations run |
| Unigram and KN trigram | W4 | done, exported to the app |
| PWA board with prediction, logging, offline install | W5 | done; redesigned with 180 ARASAAC pictograms |
| GRU training and ONNX export | W5 | done |
| FastAPI + PostgreSQL, JWT roles, sync, summary, Docker | W6 | done (SQLite locally; compose file ready, Docker not yet installed here) |
| Transformer fine-tune, latency benchmark | W7 | done on GPU; latency measured locally |
| Study analysis (bootstrap CI, tests, SUS, MDE) | W9 | done, dry-run on simulated data |
| Talker firmware skeleton, keyguard design | W7-8 | sources written; print once the tablet is chosen |
| Automated tests | W7 | 22 Python ML tests, 3 API tests, 3 JS tests, CI workflow; all green |

Five commits, 91 tracked files. Results and every decision are logged in `docs/results_log.md`,
`docs/implementation_plan.md`, `docs/testing_plan.md` and `vocab/decision_log.md`.

## 5. First results (validation split, lexicon draft v3, 21 Sept)

These prove the pipeline. They are not findings: the lexicon has not been reviewed by a native
speaker and only 2,621 training sentences survive the mapping so far.

| Model | Top-1 | Top-3 | Top-5 | Perplexity | Size |
|---|---|---|---|---|---|
| Unigram frequency | 0.090 | 0.220 | 0.305 | 43.4 | 3 kB |
| KN trigram | 0.220 | 0.458 | 0.592 | 17.4 | 103 kB |
| GRU 128 (3 seeds) | 0.240 +/- 0.001 | 0.466 +/- 0.004 | 0.592 +/- 0.005 | 15.3 +/- 0.1 | 442 kB |
| AfriBERTa-small (3 seeds, split v2) | 0.261 +/- 0.008 | 0.480 +/- 0.006 | 0.600 +/- 0.006 | 15.8 +/- 0.1 | 338 MB |

KN trigram vs unigram top-3: +0.238, 95% CI [0.212, 0.263]. Split: 2,621 / 319 / 327 sentences,
181 symbols. Latency on a laptop: KN 1.1 ms median, GRU (ONNX) 0.09 ms, transformer on CPU 29.6 ms.

What this says so far:

- Prediction clearly beats a static frequency ranking, doubling top-3 accuracy.
- The transformer is not yet ahead of the trigram at this data size, so H1 is open. Honest
  reporting either way is built into the plan; the study can run on whichever model is frozen.
- Top-3 stayed flat from lexicon v2 to v3 although the data grew 57%, because the new sentences add
  more symbols and longer sequences. The vocabulary must be settled with the collaborators before
  any number counts. The 60% target depends on that step.
- The study analysis dry run recovers a planted 28% effect (31.4%, CI [28.5, 34.2]); the minimum
  detectable effect at n = 20 with the simulated spread is about 4 points.

## 6. Plan, weeks 5 to 13

| Week | Dates | Work | Depends on |
|---|---|---|---|
| W5 | 28 Sep - 2 Oct | Native-speaker review of lexicon and 181 symbols; start recordings; rerun pipeline; PWA on the study tablet; latency and offline checklist; first demo link | two collaborators, tablet |
| W6 | 5 - 9 Oct | REC submission; Docker compose verified; study protocol dry run with 3 colleagues; load test of sync | partner site letter |
| W7 | 12 - 16 Oct | Transformer on reviewed data; try smaller encoder or distillation for on-device size; model comparison table; keyguard printed | REC approval expected |
| W8 | 19 - 23 Oct | Freeze model selection; single test-set evaluation; interviews and vocabulary validation (RQ1); consent materials; final iteration link | approval |
| W8-10 | 19 Oct - 6 Nov | Acceptance study, n >= 20, counterbalanced; export and de-identify logs; run pre-registered analysis | approval, participants |
| W9-11 | 26 Oct - 13 Nov | Report chapters 4 to 6 to supervisor | |
| W12 | 16 - 20 Nov | Defense: slides, live demo on tablet (and talker if built) | |
| W13 | 23 - 27 Nov | Final report | |

Fixed points that cannot move: REC approval, the interviews and study after it, and the one-time
test evaluation after the model freeze.

## 7. Decisions and help needed from you

1. **Partner site.** Autisme Rwanda is still unconfirmed; HVP Gatagara is the fallback. Can you
   help with an introduction or a letter before the REC submission in week 6?
2. **Collaborators.** Two native Kinyarwanda speakers (ideally a teacher or speech therapist) to
   review the lexicon and symbol list and record the audio in week 5. A review guide is ready.
3. **REC pack.** I would like you to look over the consent materials and protocol before
   submission (5 to 9 October).
4. **Study tablet.** Which Android tablet the study runs on fixes the latency target device and the
   keyguard dimensions. Budget estimate USD 80 to 120 if the school has none.
5. **H1 framing.** If the transformer does not beat the trigram once the vocabulary is final, I plan
   to report that as the result and run the study on the best frozen model. Please confirm this is
   acceptable.
6. **Speech data.** Whether the optional Common Voice speech / TTS track stays in scope. My
   recommendation: recorded human audio only, TTS as future work.
7. **Timeline.** Feedback on the accelerated schedule and on which demo links you want to see in
   weeks 5, 6 and 8.

## Appendix: how to see it running

```bash
cd vuga-aac/api && uvicorn app.main:app --reload      # API, http://localhost:8000/docs
cd vuga-aac/app && npm run dev                        # board, http://localhost:5173
# hold the gear icon (top-left) for 1.2 s to open the adult area
cd vuga-aac && pytest ml/tests api/tests && (cd app && npm test)
```
