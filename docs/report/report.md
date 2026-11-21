# Vuga App: Final version of the product

Technical report\
Josue Byiringiro\
BSc Software Engineering (Machine Learning)\
African Leadership University\
Supervisor: Junior Turatsinze\
5 November 2026\
[GitHub repository](https://github.com/jbyiringiro/capstone-project) · [Walkthrough video](https://drive.google.com/file/d/11ALnAjvop92pTYnx-89AKJn1B6W2rRHp/view?usp=drive_link)\
Historical snapshot: evidence cut off on 5 November 2026. Later email authentication, board changes, adult feedback and the v3 transformer rerun are outside this report. See the [current release record](https://github.com/jbyiringiro/capstone-project/blob/final-version/docs/releases/consolidated-2026-11-21.md) and [testing report](https://github.com/jbyiringiro/capstone-project/blob/final-version/docs/testing_report.md).

Vuga is an offline Kinyarwanda picture-to-speech (AAC) app for children whose disabilities make speech absent or difficult to understand. Pictures form a message, bundled audio speaks it and an on-device model suggests the next word. An optional FastAPI service stores caregiver accounts, coded children's settings and consented message uploads. This report compares the build with the revised proposal, then covers architecture, algorithms and validation.

## 1. Scope alignment and feature validation

<!-- widths: 24 21 14 -->

| Planned feature (proposal)                                           | Intended purpose                                 | Status                          | Evidence                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| *Implemented and tested in software*                                 |                                                  |                                 |                                                                                                                                                                                   |
| FR4, FR6 Category board, correction, three suggestions               | Compose a message by tapping, with fewer taps    | **Completed**                   | app/src/board/; on-device KN trigram with the same top-3 as Python on 119 prefixes; browser checks 8–11                                                                           |
| FR5 Speech in Kinyarwanda, offline                                   | The tablet speaks for the child                  | **Completed**                   | 188 clips and caregiver recordings, said as a sentence (*Ndashaka amazi*) with 1,259 generated word clips                                                                         |
| Personal re-ranker (proposal Fig. 2)                                 | Adapt suggestions to one child                   | **Completed**                   | The JavaScript version matches the Python model to 1e-9                                                                                                                           |
| FR2, FR3 Pseudonymous profiles; custom words                         | One board per child; words from the child's life | **Completed**                   | Abana supports edit/delete; deletion history prevents stale backups restoring children. Photos and voices stay on the device.                                                  |
| NFR3 4–40 cells and 2 cm keys                                        | Fit motor and visual abilities                   | **Grid configuration complete** | Hidden pictures close up before paging; key size is preserved. Keys ≥ 76 CSS px in phone emulation do not establish physical 2 cm targets or usability.                         |
| Child mode (added)                                                   | Early communicators                              | **Completed**                   | Up to 12 pictures and a finding game                                                                                                                                              |
| FR7, FR8 Action log, sync on request, summary                        | Trustworthy tap counts; data stays local         | **Completed**                   | MessageSession, SyncService and the Incamake tab                                                                                                                                  |
| FR1 Adult accounts with roles                                        | Protect synchronised data                        | **Implemented; live SMS pending** | Required caregiver name; PIN, SMS-code flow and account deletion tested with fake delivery. Real handset receipt remains unverified.                                          |
| NFR1 Offline; NFR4 privacy                                           | Rural schools; children's data                   | **Completed**                   | Offline in 9/9 configurations; the API takes only codes, generated ids, word keys and typed settings, refusing names, free text and media                                         |
| Model benchmark: unigram, KN, GRU, transformer                       | Choose the deployed predictor                    | **Below target**                | Top-3 on split v3: 22.0, 45.8, 46.6%, under the 60% target; simulated tap saving 14.4% (target 30%). Earlier split v2 only: transformer = KN, 48.0%                               |
| NFR2 Prediction < 200 ms, audio < 300 ms                             | Responsive on low-end tablets                    | **Met in emulation**            | Prediction p95 ≤ 1.9 ms; audio 92–146 ms at 4–6× CPU (Table 1)                                                                                                                    |
| 300–500 words with 600–1,000 human recordings                        | Words and voices fitted to Rwanda                | **Planned cut**                 | 188 words, synthetic speech plus caregiver recordings (proposal 1.5)                                                                                                              |
| FR10 Retrain and publish model versions                              | Improve from consented logs                      | **Partial**                     | Reproducible pipeline and ModelRegistry; no administrator interface                                                                                                               |
| NFR5 English interface; FR9 talker and keyguard                      | Other adults; low-cost hardware                  | **Not built**                   | English dropped after design review; hardware waits for the study tablet                                                                                                          |
| *Pending validation with people, a physical tablet and a real phone* |                                                  |                                 |                                                                                                                                                                                   |
| Vocabulary validation (RQ1); adult study (n ≥ 20, SUS)               | Suitable words; tap reduction and usability      | **Approved, not run**           | REC approval SEPT26-BSE-048 (valid six months); sessions 10–20 Nov; analysis scripts ready; test split sealed                                                                     |
| Native-speaker review                                                | Correct speech, sentences and text               | **Not yet done**                | 188 clips, 1,259 generated words, sentence rules                                                                                                                                  |
| Physical Android tablet; SMS to a real phone                         | Install, touch targets, speech start; delivery   | **Not yet run**                 | In-app benchmark ready; the SMS client is tested against a stand-in only                                                                                                          |

**Scope decisions.** The final iteration completed custom words, configurable grids and personal ranking, and added optional child mode. The deployed trigram is about 100 KB: the transformer only tied it on split v2 at 338 MB, while the GRU improved top-3 by 0.8 points. Human recordings, vocabulary expansion and hardware were deferred; accounts use one PIN and SMS verification, while cloud copies contain coded profiles and settings only.

<!-- keep -->
<!-- widths: 44 19 -->

| Milestone (proposal Figure 1 and objectives)         | Planned            | Actual                                   |
| ---------------------------------------------------- | ------------------ | ---------------------------------------- |
| Interface, navigation, prediction, backend, database | Weeks 4–6 (9 Oct)  | 21 Sep, with baselines and neural models |
| Ethics (REC) submission and decision                 | Weeks 6–7 (16 Oct) | Prepared 22–23 Oct; approved 2 Nov       |
| Testing, final iteration, model benchmark            | Weeks 7–8 (23 Oct) | 22 Oct; revised 23 Oct and 2 Nov         |
| Vocabulary validation; adult study                   | 23 Oct; 6 Nov      | Planned for 10–20 Nov                    |

**Delays.** Research milestones slipped by two to three weeks. Ethics documents were prepared on 22–23 October; ALU REC approval arrived on 2 November (SEPT26-BSE-048, valid six months). Adult sessions moved to 10–20 November; results remain pending.

## 2. Technical functionality and architecture

The app has four layers: the React board; plain-JavaScript domain modules (prediction, speech, symbols, the message session), tested in Node; Dexie/IndexedDB storage on the device; and an optional FastAPI service (routers, services and SQLAlchemy models on SQLite or PostgreSQL, documented in Swagger).

**Front end and back end.** The service worker precaches the model, pictures and speech for offline use after caching completes. The optional account flow requires the caregiver's name, Rwandan mobile number and a six-digit SMS code stored as an HMAC digest for 10 minutes. The PIN unlocks locally and authenticates online; changing it invalidates older sessions. Ohereza uploads up to 1,000 completed messages with tap events. SyncService validates the batch before writing and detects duplicate uploads.

**Data handling.** MessageSession creates a draft before logging select, page-turn, correction and Speak actions. Custom words and recordings remain local. Account copies accept coded profiles, word keys and typed settings, excluding child names and media. Revision conflicts return HTTP 409. Deletion records advance that revision, preventing stale devices from restoring a deleted child; dependent records and the active draft are cleared together. Caregiver account erasure requires the current PIN.

## 3. Code quality and OOP

<!-- widths: 24 -->

| Principle                          | Where it is applied                                                                                                                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Abstraction, polymorphism          | Predictor (JavaScript) and the Python Predictor base class define scores(); KneserNeyTrigram and PersonalReranker are interchangeable; four AudioSource classes implement resolve(). |
| Inheritance, open/closed           | InstalledClipSource extends ClipSource; new model types register in ModelRegistry; ServiceError subclasses (NotFound, Conflict, StaleBackup) map to HTTP codes in one handler.       |
| Encapsulation                      | MessageSession and PersonalHistory keep their state in private fields; the PIN is stored only as a PBKDF2 digest on the device and a bcrypt hash on the server.                      |
| Decorator, chain of responsibility | PersonalReranker wraps any predictor; SpeechPlanner tries each audio source in turn.                                                                                                 |
| Separation of concerns, injection  | Thin routers; services take an injected database session and SMS sender; 11 app feature folders with one storage module per store; tests inject fakes.                               |

**Refactoring.** Dashboard.jsx delegates to one module per tab; api/app/main.py wires routers and services; IndexedDB access lives in focused storage modules. Parent access, board speech and shared busy/error hooks are separate. Tests inject fake SMS and databases. Names are consistent, comments explain decisions, and GitHub Actions run pytest, Vitest and the build.

## 4. Algorithms and technical problem solving

- **Kneser-Ney trigram** with absolute discounting and continuation counts. The first browser port re-summed each context for every candidate word; context totals are now computed once at load, so a suggestion is O(V): the median fell from 2.23 to 0.090 ms and p95 from 6.50 to 0.155 ms.
- **Sentence building.** Word by word, njye + gushaka + amazi is not Kinyarwanda. A rule-based realiser walks the message once, carrying the subject across clauses: subject and verb become one inflected word, a name before a request becomes a call (*Mama, ngwino hano*), and “where” agrees with the noun class (*Umusarani uri he?*). Before an object it takes the form the corpus prefers (*ndashaka amazi* 4,476 times, *nshaka* 1,505); anything uncovered falls back to word by word. All 23 study messages come out as printed on their cards.
- **Top-k and masking.** A bounded min-heap selects the top three in O(V log k), with ties broken by key so the browser and Python agree (checked against a full sort on 300 random distributions); a vocabulary mask with a floor covers enabled words the model never saw.
- **Personal re-ranker**: log p(s|prefix) + 0.3·log(1+count) + 0.3·e<sup>−Δt/τ</sup> + 0.5·log(1+bigram), then a softmax computed with log-sum-exp to avoid overflow; a history replay rebuilds the message at each selection from the event log.
- **Speech start.** At 6× CPU, profiling showed most of the delay came before playback (clip lookups, service-worker fetches, a full redraw). The board now prepares the speech while the child composes and redraws once the sound starts. The earlier 778 ms also counted 240–460 ms of the test driver's own work, which the new timing leaves out, so the two figures are not directly comparable.
- **Concurrency and sync.** Conditional SQL consumes an SMS code once and counts failed attempts; a durable reservation limits sends across workers. Account saves and deletion revisions share a database transaction. PIN changes revoke old sessions. Set-based validation reduced a 4,000-message sync to about 5–7 s.
- **Grid paging** filters hidden pictures before splitting sections into columns × rows. Short pages are padded, preserving key sizes; page numbers are clamped after a change and rows fit the free screen height.
- **Picture-finding game**: targets are drawn by weighted sampling (more often for pictures missed before, never the same twice in a row), with an errorless-learning hint after two misses.
- **Keystroke simulator**: dynamic programming over the board's section pages, with the same totals as the study-card script.

## 5. Testing strategies and results

Regression checks updated 5 November; raw results: docs/evidence/final-2026-11-05/. Browser/API accounts use fake SMS; real delivery and PostgreSQL concurrency remain pending.

<!-- widths: 17 30 13 -->

| Strategy                      | Why and how                                                                                      |              Result | Improvement made afterwards                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ------------------: | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit and reference            | Pure logic decides what the child sees and hears; Vitest with Python-exported fixtures           |          170 passed | Showed the frozen re-ranker weights cannot surface a new custom word; documented, not tuned                                                 |
| Python unit and integration   | Pipeline and models; the API through TestClient; hosting settings                                |           148 passed | Each failed before its fix: a PIN reset during sign-in or a PIN change, a save told another device's revision, free text in a setting       |
| End-to-end                    | Production build in headless Edge: storage, service worker, media, layout                        |               75/75 | Fixed a one-row 3×3 page and delete-like page icons; a two-device check that an older copy never replaces a newer one                       |
| Sequential batch              | 20 tablets × 200 messages, one request at a time                                                 |           437 msg/s | 5 Nov sequential run (p95 148.8 ms); concurrent load is not measured                                                                           |
| Compatibility and performance | 3 engines; desktop, tablet and phone; 4× and 6× CPU with Fast 3G; offline by stopping the server | 7/9 full, 2 partial | WebKit without audio reported as partial; speech prepared while composing: 146 ms at 6× CPU after optimisation and timing-method correction |

**Different inputs.** Tests include wrong, expired, reused and simultaneous SMS codes; provider refusals/timeouts; PIN lockout/reset; stale backups and deleted active children; blank names; malformed uploads; silent or missing audio; empty boards; offline reload and a 1,001-message backlog. Errors appear in Kinyarwanda. Fake SMS validates logic, not handset receipt.

<!-- keep -->

| Configuration             | Cold (ms) | Offline | Tap p95 | Speech | fps | Heap (MB) |
| ------------------------- | --------: | ------: | ------: | -----: | --: | --------: |
| Edge desktop              |       398 |     391 |      42 |     53 |  99 |      12.7 |
| Edge, Galaxy Tab S4       |       494 |     329 |      37 |     53 | 110 |      12.3 |
| Edge, Pixel 5             |       480 |     289 |      40 |     60 | 128 |       9.1 |
| Edge, Tab S4, 4× CPU, 3G  |     3,129 |   1,179 |     156 |     92 |  36 |       7.7 |
| Edge, Pixel 5, 6× CPU, 3G |     3,479 |   1,797 |     299 |    146 |  44 |      19.0 |
| Firefox desktop           |       743 |     287 |      28 |    5\* |  59 |         – |
| Firefox, phone size       |     1,070 |     261 |      30 |    5\* |  64 |         – |
| WebKit, iPad              |       595 |     890 |     203 |     –† | 13‡ |         – |
| WebKit, iPhone 13         |       435 |     482 |     188 |     –† | 29‡ |         – |

**Table 1.** Production build on one laptop (Intel Core Ultra 7 255H), fresh profile per run, 2 November 2026; times in ms. Low-end rows use Chromium CPU throttling and Fast 3G for the cold load. Speech: from the press to the media's playing event. Prediction p95 is at most 1.9 ms in every configuration. \* Firefox signals playback almost at once. † No audio output in headless WebKit on Windows; Erekana was offered. ‡ Software rendering, not representative of Safari.

**Analysis.** The 2 November matrix met the prediction budget; measured audio-start events were below 300 ms. WebKit audio remains unverified. Under emulated slow hardware, rendering takes 156–299 ms p95 at 36–44 fps and first load over Fast 3G takes 3.1–3.5 s. Physical hardware and audible timing still need measurement.

## 6. Limits and next steps

- All measurements are headless on one laptop. A physical Android tablet (offline installation, touch targets, speech start) and a text sent to a real phone are still to be tested.
- No child or adult has used the app, and no SUS or tap-reduction result is claimed. The approved study (10–20 November) and a native speaker's review of the speech, sentences and interface text come next; the sentence rules do not yet cover object pronouns or adjective agreement.
- Regression tests cover simultaneous SMS-code use, resends and failed attempts, interrupted delivery, PIN changes and deletion propagation. These run on SQLite; PostgreSQL concurrency remains untested.
- Counting page turns, the study's two message sets match only on 12-key pages, so the study grid or the sets must be fixed before the sessions.
- Then: one sealed test-set evaluation, a cold-start prior so custom words can be suggested, and the HTTPS pilot in docs/deployment_plan.md.
