# Consolidated release review — 21 November 2026

The standard communication board keeps **oya**, **gufasha**, **kubabara** and **umusarani** available after vocabulary changes, including clear-all and a fixed category with tabs disabled. Existing picture positions remain fixed when other pictures are hidden. Child mode retains its deliberately limited caregiver selection.

The release now includes the **187 ARASAAC fallback pictograms** referenced by the catalogue. These files previously existed locally but were ignored by Git, leaving the deployed fallback unavailable when a photo failed. Their existing attribution and CC BY-NC-SA 4.0 licence are retained. The remaining catalogue word has no declared pictogram and uses the existing generic fallback. A packaging regression checks every declared pictogram and its attribution.

The tap-saving simulator preserves hidden-word positions and skips wholly empty pages, matching the board. A regression covers mixed and empty pages. The added transformer and error-audit files are **validation evidence**, not new sealed-test results. Re-inference from the seven existing checkpoints reproduced the archived groups and overlap counts; no retraining or sealed-test evaluation was performed in this review.

The release includes the earlier authentication improvements: explicit verification-code requests, password validation, name editing and deletion, a separate device-PIN step after password sign-in, and the fixed authentication header. The API source is unchanged from the deployed `d9d9c52` version. Hosting remains the existing Render services with Neon; this release does not change authentication environment settings.

## Verification

| Check | Result |
| --- | --- |
| Existing frontend unit suite | 336 passed |
| New catalogue asset regression | 1 passed, covering all 187 declared pictograms |
| ML pipeline regression | 9 passed |
| Browser functional checks | 85 passed across board, accounts, child mode, speech and offline use |
| Production build | Passed; existing main-chunk size warning remains |
| Historical technical report | Still 5 pages after the dated clarification |

The browser checks ran headlessly on Windows. Account tests used mocked responses and sent no emails. Slow local installation caused early readiness timeouts; the harness now permits an explicit, bounded install wait while retaining its functional assertions. The subsequent fallback failure led to the asset fix above. These checks do not establish physical-device performance.

The broad local Python attempts did not complete amid filesystem/import delays and are not reported as successful runs. The existing [GitHub CI workflow](https://github.com/jbyiringiro/capstone-project/actions/workflows/ci.yml) runs ML/API tests, frontend tests and the production build after each push. Deployment is gated on successful Python and web jobs at the exact release commit. [Recorded local checks](../evidence/consolidated-2026-11-21/checks.json) distinguish completed checks from these earlier attempts.

## Evidence and documentation

The three 5 November evidence folders are historical records, including before/after failures used to document fixes. They are not new results from this release. The technical report retains its 5 November evidence cutoff; a clarification was added and the PDF regenerated on 21 November, so its current hash differs from the original historical verification file. The retained API load fixture keeps its own recorded date and figures; local test attempts do not replace it.

README, deployment notes, physical-device guidance, testing notes, the model results log and submission-packaging instructions were reviewed for current versus historical claims. Credentials, private configuration, temporary builds and local deployment tools are excluded from the repository release.
