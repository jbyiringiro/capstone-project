# Render and Neon email accounts

**Account management release, 21 November 2026:** both hosted services run `527a84e`. Name editing and confirmed cloud-account deletion are enabled. Validation: 261 frontend tests, 248 API tests, 13 real isolated Neon API checks, a production disposable-user deletion, seven hosted API checks and 24 live browser checks. See the [release and evidence](releases/account-management-2026-11-21.md) for scope and limits.

**Dashboard update, 20 November 2026:** the frontend now runs `73ec88c`; the API and authentication configuration remain at `5d5388b`. The release passed 245 frontend tests and 25 live browser checks. See [deployment results](evidence/dashboard-hosted-2026-11-20/checks.json). The authentication setup and dated 17 November record below remain applicable.

This configuration uses two hosted providers: Render for the React app and Python API, and Neon for PostgreSQL and Managed Better Auth. Both remain on their Free plans.

**Hosted release, 17 November 2026:** the app and API are live at `5d5388b`. Eight live API checks and 11 browser navigation checks passed, with no observed browser errors. The production database URL and JWT secret were retained; a ready recovery branch was created before enabling production Auth. Hosted signup, email delivery, successful login, password reset and session revocation have not yet been tested end to end, and `VUGA_NEON_DELETE_ENABLED=false`. See the [hosted release record](releases/neon-hosted-2026-11-17.md) for deployed services and evidence.

Production Auth uses branch `br-dawn-tooth-b97xsvmu` and the public base URL `https://ep-summer-credit-b9q6kaz6.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth`. The earlier `vuga-auth-test` branch is no longer present; its old Auth URL must not be used for the hosted app. Accounts created on that test Auth branch do not automatically exist on production. The test-branch instructions below describe how to set up a new isolated test when needed.

## Authentication flow

The browser submits account requests to the Vuga API over HTTPS. The API forwards the required email, name, password or verification code to the configured Neon Auth endpoint. Passwords and codes are not stored or logged by Vuga. Neon manages password credentials and sessions.

Vuga returns an authenticated, encrypted session envelope to the browser. Only the API can open it. For protected requests the API also checks the current session with Neon; locally decoding a bearer token is not sufficient. This avoids relying on third-party browser cookies between the Render frontend and Neon, including on Safari. Account ownership remains tied to immutable Vuga and provider identifiers, not to an email address alone.

The child's board, custom pictures/voices, predictions and local caregiver PIN continue to work on the device without cloud authentication. The cloud account password and local PIN remain separate.

## Account settings

These account settings are available in the 21 November hosted release above. Older dated records describe earlier deployments.

In **Umurezi → Kwinjira**, a linked email account has a **Hindura izina** action. The caregiver edits their own name and selects **Bika izina**. The browser sends `PATCH /auth/me` with the current bearer session and `{ "name": "..." }`. The API updates Neon and confirms the returned identity before saving the Vuga name. The immutable account ID, email, child ownership and local backup link remain the same. An expired session prompts for the account password within the editor; it does not ask for the device PIN. Empty names, names over 120 characters and control characters are rejected. A failed or interrupted save does not replace the local name with an unconfirmed value.

**Siba konti yanjye** opens the deletion confirmation, which asks for the account password. The user must then choose **Siba konti burundu**. The API requires fresh authentication and checks that the identity owns the account being deleted. The browser removes its account link, session and cloud-backup link only after an HTTP 204 deletion response. Device profiles, words, recordings and the local PIN remain available offline.

Deletion failures have distinct responses. `ACCOUNT_DELETION_DISABLED` means no account data was deleted and the service must be configured. `ACCOUNT_DELETION_PENDING` with `vugaDataDeleted: true` means Vuga cloud data has been erased but provider cleanup is not yet confirmed. The UI offers a retry without claiming completion. Its fresh retry credential is kept only in memory for four minutes; after a reload or lost provider response, operator confirmation can still be necessary. A generic network or provider error does not establish whether deletion occurred.

### Managed Neon deletion

An isolated Neon check on 21 November found that `/update-user` accepted name updates but `/delete-user` returned HTTP 404. The managed user-deletion endpoint succeeded, and a follow-up check found neither the disposable user nor its session. This integration therefore uses `VUGA_NEON_DELETE_MODE=management`, calling `DELETE /projects/{project_id}/branches/{branch_id}/auth/users/{uid}` from the Vuga API. The hosted deployment and its separate production checks are recorded in the 21 November release above.

The API still requires the caregiver's fresh password authentication and validates ownership before deletion. It obtains the provider user ID from the verified identity, rather than accepting an arbitrary Neon user ID from the browser. Before erasing Vuga data, it checks that the configured project and branch resolve to exactly the configured Auth Base URL. A missing credential or mismatched branch must stop deletion before any Vuga account data is erased. Keep `VUGA_NEON_DELETE_ENABLED=false` until the complete flow passes isolated fixture tests and management permissions and branch binding are confirmed on the intended deployment.

`VUGA_NEON_MANAGEMENT_API_KEY` is a backend-only secret scoped to the Vuga project. Store it in Render's **vuga-api → Environment** and use `sync: false` in the Blueprint. Never put it in a `VITE_` variable, the frontend, source control, screenshots or logs. A dedicated runtime key with the same project scope is preferred. Reusing the existing project-scoped local deployment key is possible; in that case its rotation or revocation must also update the local deployment credential and the Render API variable. Project and branch IDs are public configuration, not secrets. The production IDs in `render.yaml` must be replaced with the matching test IDs when configuring an isolated test deployment.

### Local verification, 21 November 2026

The account update passed all 261 frontend unit tests across 32 files. These include name validation, identity and session changes during a request, failed saves, preservation of children and backup links, and rejection of HTTP 200 deletion responses, including a `null` body. The production build and service-worker generation also passed; Vite retained its existing warning about a JavaScript chunk above 500 KB. Fifteen browser scenarios with intercepted APIs passed against the production build, including name save/reload, cancellation, provider failure, expired-session reauthentication and deletion retry. Phone-width screenshots were checked at 320 and 390 pixels. These checks use synthetic accounts and browser emulation; they do not establish live Neon deletion, email delivery or physical-device compatibility. Deployment and provider verification are recorded separately.

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
| `VUGA_NEON_DELETE_MODE` | `management` for this Neon deployment |
| `VUGA_NEON_MANAGEMENT_API_KEY` | Secret project-scoped Neon API key, backend only |
| `VUGA_NEON_PROJECT_ID` | `broad-shape-23302181` for production; matching project ID for a test deployment |
| `VUGA_NEON_BRANCH_ID` | `br-dawn-tooth-b97xsvmu` for production; matching isolated branch ID for tests |
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

Confirm account deletion through the app on the actual Neon branch using a disposable account. An OpenAPI `/delete-user` entry alone does not prove the feature is enabled. A response saying that a verification email was sent is not proof of completed deletion. Verify the management credential, project/branch binding and fresh authentication before enabling deletion for real accounts. After these checks, a confirmed deletion request permanently erases Vuga cloud data and records an identity tombstone before requesting provider deletion. Provider cleanup failure is explicitly reported as pending. Confirmed provider completion is saved so retrying does not require an already-deleted session. If Neon's response is lost, operator confirmation may be needed; an expired session alone is not proof of provider deletion. Check that the disposable Neon user is gone and earlier sessions are refused. Local child data and the device PIN are retained.

Before the production cutover, create a recovery copy of the production database, enable and configure Better Auth on the production branch, then use that branch's Auth URL. Deploy the API before rebuilding the frontend. Do not point the live application at the disposable test branch. Record the deployed commit and actual live checks.

Render's free API can sleep and both providers enforce free-plan usage limits. The service runs independently of the developer's PC, but this is not an always-on availability guarantee. See [Render Free](https://render.com/docs/free) and [Neon pricing](https://neon.com/pricing).
