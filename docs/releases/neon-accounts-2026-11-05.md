# Neon account release — 5 November 2026

**Implemented and locally tested; not deployed.** This supersedes the prepared Firebase release. The public app continues to run the preceding deployment.

## Changes

Render serves the React PWA and Python API. Neon supplies PostgreSQL and Managed Better Auth. Both services remain on free plans. Account requests go through the Vuga API, so browsers do not depend on third-party Neon cookies. Passwords and verification codes are forwarded over HTTPS and never stored or logged by Vuga.

- Named email signup, six-digit verification codes, resend, login and password recovery.
- Encrypted session tokens tied to the configured Neon branch; current provider sessions are checked on protected requests.
- Password reset revokes sessions and handles a successful password change followed by failed cleanup without reusing the consumed code.
- Device PIN, local child data and account ownership remain separate from cloud credentials. Accounts are not merged by matching email.
- Account deletion is disabled until managed-provider support is confirmed with a disposable account. After enabling it, local cloud erasure is durable and provider cleanup may be reported as pending. Confirmed deletion is recorded for safe retries.
- Neon mode rejects Firebase tokens and disables outbound SMS. Previous adapters remain available for controlled rollback.

## Validation

| Check | Result |
|---|---|
| Frontend unit/integration tests (`npm.cmd test`) | 245 passed, 32 files |
| API regression (`pytest api/tests`) | 163 passed; 5 PostgreSQL checks skipped in this SQLite run |
| PostgreSQL 17.11 migration | 5 passed separately using isolated schemas on a disposable local server |
| Neon browser checks | 13 passed with simulated API responses, including 320px and 390px layouts |
| Local Neon API health | `status: ok`, `model_loaded: true`, `sms: off`, `email: neon` |
| Production-mode frontend build | Passed with hosted API URL and Neon provider; existing large-chunk warning remains (526 kB JavaScript, 163 kB gzip) |
| Real Neon integration | Public routes respond; account actions currently blocked by `INVALID_ORIGIN` until trusted domains are configured |

Evidence: [check summary](../evidence/neon-accounts-2026-11-05/checks.json), [API results](../evidence/neon-accounts-2026-11-05/api.xml), [PostgreSQL results](../evidence/neon-accounts-2026-11-05/postgresql.xml), [browser results](../evidence/neon-accounts-2026-11-05/browser.json).

The browser checks did not create accounts or send email. Real signup, email receipt, password recovery, session-cookie behavior and managed account deletion are still unverified. Passing mocked tests is not evidence of email delivery or hosted availability.

## Remaining rollout steps

1. On `vuga-auth-test`, enable email signup/sign-in, verification codes at signup, session revocation on reset, and the intended trusted origin.
2. Use a disposable account to test real code delivery, wrong/expired codes, login, reset, old-session rejection and deletion. Confirm the actual provider response before enabling deletion for real users.
3. Resolve any existing cloud identity migration using proof of both identities. Preserve Vuga ownership and device data.
4. Create a recoverable production database copy and configure Auth on the production branch. Use its Auth Base URL, never the disposable branch URL.
5. Apply the [Neon environment settings](../neon-auth.md), deploy the API first, then rebuild the frontend. Keep the existing JWT secret and database URL.
6. Record the deployed commit and actual hosted checks before describing the migration as live.

Neon's shared email sender is documented for development/testing. This two-provider free configuration is suitable for the capstone test; production email delivery has not been established. See the [provider limitation and setup](../neon-auth.md#shared-email-limitation).
