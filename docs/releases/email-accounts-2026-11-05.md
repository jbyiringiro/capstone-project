# Email account release — 5 November 2026

**Prepared and tested; not yet deployed.** The public app and API currently serve the preceding release. Render/Neon account access, a production backup and the hosted environment update are still required.

## Changes

- Firebase Email/Password caregiver accounts with names, verification links, password reset and account deletion. The offline device PIN remains separate.
- Shorter signup/login screens, password visibility controls, separate verification guidance and a manual resend countdown. Existing phone accounts remain accessible under alternative sign-in options.
- Child profile editing/deletion, account backup deletion handling, and compact board layouts after hiding pictures.
- Production CORS allows `https://vuga-app.onrender.com`. Firebase settings are supplied to both services through the Blueprint.
- Idempotent PostgreSQL upgrade with one transaction/advisory lock covering existing and fresh databases. Testing reproduced and fixed a simultaneous-startup race.

## Validation

| Check | Result |
|---|---|
| Release frontend unit/integration tests | 218 passed, 31 files |
| Release API regression | 133 passed; the 5 opt-in PostgreSQL checks skip in this SQLite run |
| Real PostgreSQL 17.11 migration | 5 passed separately, plus 26 email/SQLite regressions |
| Production frontend build | Passed with hosted API URL and Firebase configuration |
| Latest development browser checks | 63 passed before release preparation; signup/login/verification at 320px and 390px |

Machine-readable evidence: [release checks](../evidence/cloud-email-release-2026-11-05/checks.json), [API regression](../evidence/cloud-email-release-2026-11-05/api.xml), [PostgreSQL/email tests](../evidence/cloud-email-release-2026-11-05/postgresql-and-email.xml). Authentication tests mock external providers and use disposable data. The owner separately reported real verification-email receipt within two minutes; this is not a measured delivery benchmark.

The production build still reports Vite's existing large-chunk warning (approximately 514 kB JavaScript / 160 kB gzip). The release excludes ignored local models/media, environment files, databases, dependencies, generated builds and unrelated report/ML changes.

## Rollout

1. In Neon, take a recoverable backup/branch of the current production database before upgrading. No Neon data has been accessed or changed during release preparation.
2. In Render `vuga-api`, retain the existing `VUGA_DATABASE_URL` and `VUGA_JWT_SECRET`. Set `VUGA_FIREBASE_PROJECT_ID=vuga-sms-test` and `VUGA_FIREBASE_API_KEY` to the Firebase web configuration's API key. Keep `VUGA_SMS_LOG_ENABLED=false` and `VUGA_CORS_ORIGINS=["https://vuga-app.onrender.com"]`.
3. Advance `deploy/vuga-cloud` to the reviewed release and sync the Blueprint. The API key is `sync: false`; enter it in the dashboard because a Blueprint update does not populate it. Keep the free API plan and existing static site.
4. Deploy `vuga-api` first. Check startup/migration logs, `/health` (`email: "firebase"`, `model_loaded: true`), and `/symbols` before rebuilding the frontend.
5. Rebuild/deploy `vuga-app` with `VITE_API_BASE=https://vuga-api.onrender.com`, `VITE_FIREBASE_PROJECT_ID=vuga-sms-test`, and the same public web key in `VITE_FIREBASE_API_KEY`. The Blueprint references the API's Firebase values. Builds embed these variables; restarting only the API is insufficient.
6. Check the public board, browser CORS, verification/login, and account persistence. Refresh the installed PWA so its service worker picks up the release. Record actual deployed commit and results here.

Automatic deployment is off. A GitHub commit alone does not establish that the hosted update succeeded. See [Firebase setup](../email-accounts.md) and [hosting guide](../hosting.md).
