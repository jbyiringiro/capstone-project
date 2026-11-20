# Email accounts with Firebase Spark

> Legacy Firebase configuration retained for rollback. The selected Render + Neon setup is in [neon-auth.md](neon-auth.md); do not use this guide for the Neon deployment.

**Development configuration verified, 5 November 2026:** `vuga-sms-test` is configured in the ignored local API/frontend environment files. Google's public configuration endpoint accepted the supplied web app ID; its numeric project identifier and default domain match the supplied Firebase configuration. The local API reports `email: "firebase"`, the configured production build succeeds, and the signup form/CORS checks pass. Existing local database records were preserved through startup after a backup. See [configured browser check](evidence/email-accounts-2026-11-05/configured-browser-check.json) and [public project check](evidence/email-accounts-2026-11-05/firebase-project-check.json). The project owner subsequently confirmed that Email/Password is enabled and that verification email works, arriving within two minutes. This is a user-reported result, not a measured delivery benchmark. Render deployment, live reset/deletion and second-device checks remain pending.

Vuga now offers email accounts first. The adult supplies their name, email and a password, opens Firebase's verification email, then signs in and chooses a separate device PIN. The password authenticates the cloud account; the 4–6 digit PIN opens caregiver settings offline. Existing phone accounts remain available through **Ubundi buryo bwo kwinjira → Koresha konti ya nimero ya telefoni**. A phone account is not automatically merged into an email account.

This implementation uses Firebase Authentication's **Email/Password** provider and its REST API. It does not need Blaze billing, SMS, Firestore, Firebase Hosting, Cloud Functions or a service-account private key. Spark has usage limits; see [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) and [Authentication limits](https://firebase.google.com/docs/auth/limits).

## 1. Set up Firebase

1. Open the existing **Vuga SMS Test** Firebase project. Its display name can remain unchanged.
2. Open **Authentication** (use the product search if needed), choose **Get started**, then **Sign-in method → Email/Password**. Enable the **Email/Password** switch and save. The email-link/passwordless option is not used by Vuga.
3. Open **Project settings → General** and note the **Project ID**. Under **Your apps**, add a web app (`</>`) called `Vuga` if none exists. Firebase Hosting and Analytics are not needed for this integration.
4. In that web app's configuration, copy `projectId` and `apiKey`. Use these same two values for the API and frontend below. The web API key is public app configuration, not an administrative secret; never substitute a service-account key.
5. Under **Authentication → Templates**, check the verification and password-reset emails. The standard Firebase action handler is used; after following the email link, the caregiver returns to Vuga to sign in. No custom email handler is required.

Reference: [Firebase Email/Password setup](https://firebase.google.com/docs/auth/web/password-auth), [REST authentication API](https://firebase.google.com/docs/reference/rest/auth).

## 2. Configure the app and API

| Where | Variable | Value |
|---|---|---|
| API / Render `vuga-api` | `VUGA_FIREBASE_PROJECT_ID` | `vuga-sms-test` (confirmed project ID) |
| API / Render `vuga-api` | `VUGA_FIREBASE_API_KEY` | Firebase web config `apiKey` |
| Frontend / Render `vuga-app` | `VITE_FIREBASE_PROJECT_ID` | `vuga-sms-test` |
| Frontend / Render `vuga-app` | `VITE_FIREBASE_API_KEY` | The same `apiKey` |

For local development, copy the repository's `.env.example` to `.env` in the directory from which you launch the API, and copy `app/.env.example` to `app/.env.local`. Fill in the Firebase values. When launching the API from the repository root, use `VUGA_MODEL_DIR=ml/artifacts`. Restart the API and Vite after configuration changes. These local environment files are ignored by Git.

For Render:

1. Back up the Neon database before deploying the schema change. Email support makes the existing phone/PIN columns nullable and adds email/Firebase identity columns and a deletion ledger. Existing phone rows and child ownership are retained. Migration runs automatically at API startup; it can also run explicitly with `python -m app.migrations` from `api/`, using the normal database environment. SQLite migration is exercised by automated tests; the PostgreSQL DDL still needs validation on a disposable Neon branch before a production upgrade.
2. Commit and push the reviewed source to the branch Render deploys. Local working-tree changes do not reach Render. Confirm the service branch in Render before deployment.
3. In **vuga-api → Environment**, add the two `VUGA_FIREBASE_*` variables, save and deploy that source revision. Retain the existing database/JWT/CORS variables. Keep `VUGA_SMS_LOG_ENABLED=false`.
4. Sync the updated Blueprint. It references the API's Firebase values into the static site's `VITE_FIREBASE_*` variables. Existing `sync: false` API values must be entered in the dashboard; Blueprint sync does not fill them in. If managing services manually, set both frontend variables directly. See [Render's environment-variable rules](https://render.com/docs/blueprint-spec#prompting-for-secret-values).
5. **Rebuild and deploy vuga-app** after setting the variables. Vite embeds them at build time; restarting the API alone is insufficient. Reload the installed PWA after its new version is ready.
6. Check `/health`: `email: "firebase"` means both API configuration values are present; `email: "off"` means one is missing. This is a configuration check, not proof of email delivery or valid credentials.

## 3. Verify using an adult test account

These are live checks to perform after configuration, not results claimed by the automated suite.

1. Open **Umurezi** and choose email signup. Enter the adult's name, an email you control and a password of at least eight characters. For an existing local PIN, open **Kwinjira** to link an account.
2. Confirm that attempting to sign in before verification is refused. Open the verification email (check spam), follow its link, return to Vuga and select **Nemeje email, komeza** to sign in. Choose a device PIN, or enter the existing device PIN when linking. Write down the recovery code shown on first setup.
3. Create a test child identified by a code such as `P-01`. In **Ohereza**, confirm the account copy saves. Sign in with the same verified email on another browser/device, choose that device's PIN and check the child's settings restore.
4. Use **Nibagiwe ijambo ry’ibanga** on the email login form. Confirm the reset email arrives and the new password works. The device PIN must remain unchanged. Reset messages intentionally do not disclose whether an email exists.
5. Test **Nibagiwe umubare w’ibanga → Konti ya Vuga** using the linked email password. Only that exact linked account can reset the local PIN. The written recovery code remains the offline option.
6. With disposable data only, use **Kwinjira → Siba konti yanjye**, confirm and enter the account password. Verify the Firebase user and Vuga cloud data are removed; local children, recordings and PIN remain. Old cloud sessions must be refused.
7. Disconnect the internet and check the downloaded board, speech and caregiver PIN still work. Cloud sign-in, reset emails, sync and deletion require internet.

## How it works and practical limits

- Verification uses an emailed **link**, not a numeric code. The separate waiting screen shows the destination and a spam-folder hint. **Ongera wohereze email** becomes available after a 60-second UI cooldown; resending requires the account password. This cooldown discourages repeated requests and does not promise delivery within 60 seconds or replace Firebase's limits. A successful send response confirms the provider accepted the request, not that the message reached the inbox. No automatic resend loop is used.
- `app/src/server/email-auth.js` calls Google's REST endpoints directly for signup, verification, password reset and password authentication. Passwords and refresh tokens are not saved by Vuga. Only the short-lived ID token and linked identity are stored on the device.
- `POST /auth/email/session` verifies the signed token and current Google account state before creating/linking a Vuga user. All protected API requests verify the intended Firebase project, issuer, signature, expiry, verified email, provider and current account state. Supplying an email address alone never grants access.
- Firebase UIDs and Vuga user IDs bind ownership. Re-registering a deleted email creates a different account; it does not restore deleted access or recover the former account's device PIN.
- Cloud tokens expire after about an hour. Vuga asks for the email password again when needed; the local PIN and offline board continue working. Changing/resetting the cloud password revokes older cloud sessions without changing device PINs.
- Cloud account deletion removes Vuga data first, then deletes the Firebase account. A minimal ledger retains project ID, Firebase UID, former Vuga user ID and deletion time to prevent stale requests from recreating the account. It contains no email, name, PIN or child data. A transient provider failure shows a retry message; retry in the same open page while the fresh deletion credential is retained briefly in memory. **Hagarika guhuza iki gikoresho na konti** only unlinks the device and does not finish cloud deletion.
- Existing phone accounts keep their original SMS/PIN behavior. Email signup creates a separate account. Linking to it does not migrate the former phone account's server history. Keep needed data/export before changing which account a device uses.
- If Firebase values are absent, email signup is unavailable with an explanation; **Komeza nta konti** still sets up a local PIN. No production verification bypass or logged email code is provided.

Automated tests mock Google's responses and use generated signing keys and disposable databases. They validate app logic and rejection paths, not real email receipt. Record live signup/reset/deletion and second-device results separately after Firebase and Render are configured.
