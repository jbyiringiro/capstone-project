# Neon hosted release — 17 November 2026

**App and API deployed.** Both Render services are live at reviewed commit `5d5388b` from `deploy/vuga-cloud`. Eight API checks and 11 browser navigation checks passed. This record distinguishes deployment checks from a successful caregiver signup. No hosted verification email, account registration, password reset or account deletion was performed by the deployment checks.

## Services and preserved data

| Component | Current state |
|---|---|
| Render API | `https://vuga-api.onrender.com`; commit `5d5388b`, deployment `dep-dbu9qqe1egvs73fu6arg` live at 18:33:15 UTC |
| Render frontend | `https://vuga-app.onrender.com`; commit `5d5388b`, deployment `dep-dbu9s5t9fdbs73e4iu2g` live at 18:34:42 UTC |
| Neon production branch | `br-dawn-tooth-b97xsvmu`; existing PostgreSQL database retained, Managed Better Auth enabled |
| Public production Auth URL | `https://ep-summer-credit-b9q6kaz6.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth` |
| Recovery branch | `br-spring-lab-b9he3e4m`, ready; copied before production Auth setup with no compute endpoint |
| Earlier test branch | `vuga-auth-test` is no longer present; its recorded Auth URL is not the production endpoint |
| Account deletion | `VUGA_NEON_DELETE_ENABLED=false`; pending a disposable-account provider test |
| Hosting | Render and Neon Free plans; no additional authentication or email provider |
| Deployment control | Service automatic deployments remain disabled; reviewed code is deployed explicitly |

The production database connection and persistent JWT secret were retained. Startup applies the additive account schema migration rather than replacing the database. Existing IDs, account ownership and local device data must be preserved. No account identities are merged merely because their email addresses match. Accounts created on the earlier test Auth branch do not automatically exist on production; an existing linked account requires proof of ownership before any provider mapping is changed.

The API forwards email authentication requests to production Neon Auth over HTTPS and checks provider sessions on protected requests. The browser uses the Render API; it does not require third-party provider cookies. The corrected parser handles the provider's `Partitioned` session cookie, including its encoded value. The local device PIN and communication board remain independent of cloud authentication.

## Deployment validation

- **Eight API checks passed:** health reported `status: ok`, `model_loaded: true`, `sms: off`, `email: neon`; the email routes were published; hosted-frontend CORS succeeded; an empty login returned 422 with `Cache-Control: no-store`; a synthetic nonexistent-account login returned 401 `INVALID_EMAIL_OR_PASSWORD`; unauthenticated `/auth/me` and `/profiles` returned 401; and an invalid session was rejected. [API evidence](../evidence/neon-hosted-2026-11-17/api.json).
- **Eleven live browser checks passed** in Edge 156.0.4314.58, with fresh desktop (1280 × 900) and emulated mobile (390 × 844) contexts. The board, enabled email signup, login with a separate device PIN, and code-based password-reset navigation were visible; the legacy SMS option was absent. Login also fit 320 pixels. No forms were submitted, non-read HTTP requests sent, or direct third-party authentication calls observed. There were no page exceptions, console errors, failed resources or HTTP errors during the check. Served JavaScript and CSS hashes are recorded. [Browser evidence](../evidence/neon-hosted-2026-11-17/browser.json). Mobile emulation is not physical-device testing; service workers were blocked to inspect the newly deployed bundle, so this is not an offline-cache test.
- The [earlier release record](neon-accounts-2026-11-05.md) retains the 245 frontend tests, 13 browser checks using simulated API responses, five real PostgreSQL migration checks and later 175-check API regression. These were not repeated merely to redeploy the reviewed code.
- Real verification email receipt and successful local-preview login were previously confirmed by the user after the cookie fix. Those observations are not evidence of a completed hosted signup against the production Auth branch.

## Remaining validation and limits

Complete one user-controlled hosted signup: receive the email code, verify it and sign in. Then check password reset and rejection of the original cloud session from a separate browser context. Access through the offline device PIN does not prove that a cloud session is still valid. Keep account deletion disabled until the actual provider flow succeeds on a disposable account.

Also verify hosted offline reload and the main communication tasks on physical Android and iOS devices. The deployment smoke check does not establish speech compatibility, usability, physical-device performance or persistence across a later restart.

Neon's shared email sender is intended for development/testing; this remains a capstone/test deployment with free-plan usage limits. Render's free API can sleep between requests. Neither a health response nor configured email settings guarantees mailbox delivery or always-on availability. See [Neon account setup and limitations](../neon-auth.md).

## Recovery

The ready recovery branch preserves the database state from before production Auth setup. Keep the production database URL and JWT secret stable when redeploying or rolling back code; do not destructively reverse the additive schema migration or automatically replace current production data with the recovery copy. A return to the older phone-only release would not provide access to newly created Neon email accounts. Preserve user data and assess that limitation before a rollback.
