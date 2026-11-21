# Email account validation — 5 November 2026

These results cover the uncommitted email-account update in `final-version`. Firebase calls and browser API responses were mocked; Python tests used generated signing keys and disposable SQLite databases. No real email or SMS was sent, no production database was migrated, and nothing was deployed.

| Check | Result | Evidence |
|---|---|---|
| Frontend unit/integration tests | 218 passed, 31 files | [frontend.json](frontend.json) |
| API regression suite | 131 passed: 107 existing + initial 24 email tests | [api-regression.xml](api-regression.xml) |
| Final focused email API suite | 26 passed, including two additional identity-policy cases | [api-email.xml](api-email.xml) |
| Existing browser scenarios | 75 passed: 25 board/speech, 17 caregiver access, 24 final features, 9 child mode | [legacy-browser/](legacy-browser/) |
| New email browser scenarios | 13 passed | [email-accounts-report.json](email-accounts-report.json), [mobile account settings](email-account-mobile.png) |
| Production build | Passed; final guarded JS bundle approximately 513 kB / 160 kB gzip, above Vite's 500 kB warning threshold | Vite build run against isolated output directory |
| Backend style checks | Ruff passed the 12 changed backend Python files | Agent verification |

API coverage totals **133 distinct tests** across the regression and final focused runs; the overlapping email tests must not be counted twice. Browser coverage totals **88 unique checks**. The email suite was repeated after the recovery/session fixes and the final pending-phone-request navigation guard; 17 caregiver-access checks were also repeated after the recovery fix. Other existing browser scenarios were not changed by those fixes. [verification.json](verification.json) identifies the final tested bundle.

New coverage includes verification gates, password reset, rejection of wrong projects/issuers/tenants/algorithms, revoked/disabled accounts, name requirements, deletion retries, immutable ownership, concurrent provisioning/deletion, existing SQLite migration, recovery during account/PIN changes, and switching accounts during backup or login. Stale 401 responses cannot clear a newer session.

Follow-up: the project owner confirmed Email/Password enablement and verification-email receipt within two minutes. This is user-reported, not an automated delivery measurement. Still pending: live reset email receipt, real provider account deletion, PostgreSQL migration on a disposable Neon branch, hosted deployment, and physical-device checks. Browser mobile viewports are emulation, not physical-device evidence. The earlier technical report describes the preceding phone-account milestone.

## Configuration follow-up

The supplied Firebase web configuration has now been saved locally in Git-ignored files. A [read-only Google configuration request](firebase-project-check.json) returned 200 with the expected numeric project identifier and default auth domain, accepting the supplied web app ID. This does not expose whether Email/Password is enabled.

The [configured API startup check](configured-startup-check.json) passed on a disposable copy first. The actual local database was then backed up and migrated during startup; integrity, foreign keys and existing record counts were preserved. The [configured browser check](configured-browser-check.json) confirms the live local API health, email-session CORS and visible email/name/password signup fields in the rebuilt app. It submitted no authentication requests and sent no email. These configuration checks supplement the earlier mocked suites; the Render deployment and PostgreSQL database remain unchanged.

To rerun email browser checks, first build a test copy of the app with nonempty dummy `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_API_KEY` values and `VITE_API_BASE=http://localhost:8000`. Serve that build with Vite preview, then run `npm run test:email` from `app/`. Set `VUGA_PREVIEW_URL` if preview is not at `http://127.0.0.1:4175/`. The script intercepts every external request and uses isolated browser storage. Never use that dummy-config build as a production deployment.
