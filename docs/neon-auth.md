# Render and Neon email accounts

This configuration uses two hosted providers: Render for the React app and Python API, and Neon for PostgreSQL and Managed Better Auth. Use only their Free plans. The Neon migration is under validation; a successful local build does not mean the public deployment has changed.

## Authentication flow

The browser submits account requests to the Vuga API over HTTPS. The API forwards the required email, name, password or verification code to the configured Neon Auth endpoint. Passwords and codes are not stored or logged by Vuga. Neon manages password credentials and sessions.

Vuga returns an authenticated, encrypted session envelope to the browser. Only the API can open it. For protected requests the API also checks the current session with Neon; locally decoding a bearer token is not sufficient. This avoids relying on third-party browser cookies between the Render frontend and Neon, including on Safari. Account ownership remains tied to immutable Vuga and provider identifiers, not to an email address alone.

The child's board, custom pictures/voices, predictions and local caregiver PIN continue to work on the device without cloud authentication. The cloud account password and local PIN remain separate.

## Configure a test branch first

1. In the existing Neon project, create `vuga-auth-test` from `production`, using **Current data**. Do not change the live API's database connection to this test branch.
2. On the test branch, open **Better Auth**, enable Auth, and copy the **Auth Base URL** from Configuration. This public HTTPS URL is different from the secret PostgreSQL connection string.
3. Enable email signup and sign-in. Enable **Verify at Sign-up** and select **Verification code**.
4. Enable **Revoke sessions on password reset**. It is off by default; successful reset must invalidate earlier sessions.
5. Add the app origin to trusted domains. For the hosted app it is `https://vuga-app.onrender.com`. Configure the API's `VUGA_NEON_AUTH_ORIGIN` to match a trusted origin. Allow localhost only on the test branch when needed for development.
6. Keep the shared Neon email sender for the two-provider test. Confirm that a code arrives in an inbox you control, verification succeeds, and password recovery works.

### Shared email limitation

Neon documents its shared sender as suitable for development/testing and calls for a custom sender for production. Shared email supports verification **codes** and password reset; signup verification **links** require custom SMTP. The documentation checked on 5 November 2026 did not publish an exact shared-sender daily quota. The Auth monthly-active-user allowance is not an email quota.

Under the strict two-provider constraint, this deployment uses the shared sender and must be assessed as a capstone/test deployment. Do not claim production email delivery, availability or capacity has been guaranteed. No additional email provider is configured here.

Sources: [production email requirements](https://neon.com/docs/auth/production-checklist), [email OTP](https://neon.com/docs/auth/guides/plugins/email-otp), [password reset and session revocation](https://neon.com/docs/auth/guides/password-reset).

## Environment variables

Set the API variables in Render's **vuga-api → Environment**. Retain the existing production database URL and JWT secret.

| Variable | Value |
|---|---|
| `VUGA_EMAIL_AUTH_PROVIDER` | `neon` |
| `VUGA_NEON_AUTH_URL` | Auth Base URL for the intended branch |
| `VUGA_NEON_AUTH_ORIGIN` | `https://vuga-app.onrender.com` for hosted Vuga |
| `VUGA_NEON_DELETE_ENABLED` | `false` until account deletion is verified on a disposable test account; then `true` |
| `VUGA_CORS_ORIGINS` | `["https://vuga-app.onrender.com"]` |
| `VUGA_SMS_LOG_ENABLED` | `false` |
| `VUGA_DATABASE_URL` | Existing secret Neon production PostgreSQL URL |
| `VUGA_JWT_SECRET` | Existing persistent secret; also protects session envelopes |

The frontend needs `VITE_API_BASE=https://vuga-api.onrender.com` and `VITE_EMAIL_AUTH_PROVIDER=neon`. It does not need a Neon management API key or database URL. The Blueprint passes the provider selector from the API to the frontend build. Rebuild the frontend when changing these values.

The earlier Firebase implementation remains available in source for a controlled rollback. Selecting Neon disables Firebase authentication and outbound legacy SMS in this deployment. The Neon Blueprint does not request Firebase or Africa's Talking credentials. Remove unused credentials from hosted environments after the migration is verified.

## Preserve existing accounts

Schema changes are additive. Existing account IDs, child ownership, backups and local device data must remain intact. Existing Firebase accounts do not automatically become Neon accounts. Matching email addresses alone must never link or transfer an account. A device linked to an old identity must not accept a different identity for PIN recovery or deletion.

If an existing cloud account needs migration, prove ownership of both identities before transferring its provider mapping. A successful new Neon signup alone is not that proof. Export any device backup before changing a linked account. Do not delete old provider accounts or their records merely to make a new login succeed.

## Release checks

Validate signup, incorrect/expired code handling, resend cooldown, unverified-login refusal, successful login, logout/reload, password reset and rejection of prior sessions. Check caregiver name, PIN recovery against the same account, child editing/deletion, backup isolation and an offline board reload.

Confirm self-service account deletion on the actual Neon branch using a disposable account. An OpenAPI `/delete-user` entry alone does not prove the feature is enabled. A response saying that a verification email was sent is not proof of completed deletion. Keep deletion disabled for real accounts until this check succeeds. Once enabled, a confirmed deletion request permanently erases Vuga cloud data first and records an identity tombstone before contacting Neon. Provider cleanup failure is explicitly reported as pending. Confirmed provider completion is saved so retrying does not require an already-deleted session. If Neon's response is lost, operator confirmation may be needed; an expired session alone is not proof of provider deletion. Local child data and the device PIN are retained.

Before the production cutover, create a recovery copy of the production database, enable and configure Better Auth on the production branch, then use that branch's Auth URL. Deploy the API before rebuilding the frontend. Do not point the live application at the disposable test branch. Record the deployed commit and actual live checks.

Render's free API can sleep and both providers enforce free-plan usage limits. The service runs independently of the developer's PC, but this is not an always-on availability guarantee. See [Render Free](https://render.com/docs/free) and [Neon pricing](https://neon.com/pricing).
