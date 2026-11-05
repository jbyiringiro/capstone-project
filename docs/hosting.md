# Free public hosting: Render + Neon

**Render + Neon migration, 5 November 2026:** the selected deployment now uses Neon Managed Better Auth with email verification codes. Follow the [Neon account setup and release checks](neon-auth.md). Implementation and live deployment status must be reported separately. Firebase and SMS instructions further below describe earlier releases and are not the selected configuration.

**Live on 4 November 2026:** [Vuga app](https://vuga-app.onrender.com) and [API](https://vuga-api.onrender.com/health), hosted on Render with Neon PostgreSQL. These public services run independently of the developer's computer.

**Verified:** the frontend and install manifest are reachable, its bundle targets `https://vuga-api.onrender.com`, `/health` returns `status: "ok"` and `model_loaded: true`, and `/symbols` returns 188 symbols.

**Desktop browser evidence, deployed commit `266dbfe`:** [hosted smoke-check results](evidence/hosted_smoke_2026-11-04.json) record the visible board, blocked browser API request and initial offline-cache progress. A fresh Edge context cached 91 files at 20 seconds and 450 at 180 seconds, with no observed download errors; installation was still in progress. Offline reload was not attempted, so this is not an offline pass or physical-device evidence. Keep the app online while its initial cache downloads, then verify a cold offline launch.

**Latest read-only check, 5 November 2026:** the frontend and API health endpoint returned 200, but the CORS preflight for `POST /auth/code` still returned 400, `Disallowed CORS origin`, with no `Access-Control-Allow-Origin`. The hosted health response also lacks the current code's `sms` field. See [raw results](evidence/hosted_check_2026-11-05.json). The local Blueprint now sets `VUGA_CORS_ORIGINS` to `["https://vuga-app.onrender.com"]`; this correction is **not active until the updated deployment branch is synced/deployed**. Live SMS setup and handset receipt remain unverified (section 4), as do hosted offline readiness, physical-device and account persistence. No SMS or account operation was performed by this check.

## Services and limits

| Component | Service | Purpose |
|---|---|---|
| React PWA | Render Static Site, free | Serves the board, pictures, audio, model and service worker over HTTPS |
| FastAPI | Render Web Service, free Docker instance | Runs accounts, sync, backup and server-side prediction |
| PostgreSQL | Neon Free project | Persists server data across API restarts and deployments |
| Email authentication | Neon Managed Better Auth, Free | Email/password accounts, verification codes and password recovery; shared sender has testing limits |

The [Render Blueprint](../render.yaml) provisions only the static site and free API. It does not create a paid service or Render database. Render's free database expires after 30 days, so use Neon for this setup.

Render's free API sleeps after 15 minutes without traffic and can take about a minute to wake. The frontend remains independently available, and the installed board's local features do not depend on the API. Render has monthly limits for compute hours, bandwidth and build minutes; services can be suspended when limits are reached. Neon advertises a free plan without a trial expiry, currently 100 CU-hours and 1 GB of storage per project, with compute scaling to zero when idle. These are capstone/demo tiers, not an availability guarantee. Check the account dashboards before deployment and monitor usage. Sources: [Render free limits](https://render.com/docs/free), [Neon pricing](https://neon.com/pricing).

## 1. Prepare the source and accounts

- Install/connect Render and Neon, or sign in to their dashboards. Use their free plans; no paid resources are needed by this configuration.
- Select `deploy/vuga-cloud` when creating the Render Blueprint. This deployment branch contains the reviewed runtime and hosting changes; the development working branch remains `final-version`. For later releases, commit and push reviewed updates to the deployment branch before deploying. Uncommitted changes are not available to Render.
- Leave Render's **Root Directory blank** for both services. The frontend imports `vocab/` outside `app/`, and the API Docker build needs `api/`, `ml/` and `vocab/`. [Render monorepo documentation](https://render.com/docs/monorepo-support).

## 2. Create the Neon database

1. Create one Free project, preferably in a European region close to the API's Frankfurt region. Use a fresh database; this deployment does not upload the local SQLite database.
2. Copy its PostgreSQL connection string from the connection dialog. Keep `sslmode=require` and any other TLS parameters. The API accepts `postgres://`, `postgresql://` and explicit `postgresql+psycopg://` URLs, using its installed psycopg driver.
3. Enter the connection string only as the API's secret environment variable `VUGA_DATABASE_URL`. Never put it in the repository, chat, screenshots, or a `VITE_` variable. All `VITE_` values are public in the browser build.

## 3. Deploy the Render Blueprint

1. Create a Blueprint from the repository and intended branch, using `render.yaml` at the repository root. Inspect the proposed resources: `vuga-api` must use **Free**, and `vuga-app` must be a static site. Stop if the dashboard proposes paid resources.
2. Set `VUGA_DATABASE_URL` to the Neon secret. The Blueprint supplies the known public app origin as `VUGA_CORS_ORIGINS`; use the exact frontend origin if deploying under a different hostname.
3. Render generates a persistent `VUGA_JWT_SECRET`. Retain it across deployments. The Docker process binds to Render's `PORT`, and startup creates/seeds the schema in the fresh database.
4. Sync the updated Blueprint and deploy the API so `VUGA_CORS_ORIGINS=["https://vuga-app.onrender.com"]` takes effect. This public value is managed in `render.yaml`, since `sync: false` does not update existing variables during Blueprint syncs. For an immediate dashboard correction, open **vuga-api → Environment**, set that value and select **Save and deploy**. If the hostname changes, update the Blueprint too. Use no trailing slash. See [Render's Blueprint environment-variable rules](https://render.com/docs/blueprint-spec) and [dashboard instructions](https://render.com/docs/configure-environment-variables).
5. The frontend's `VITE_API_BASE` references the API's public `RENDER_EXTERNAL_URL`. If creating services manually, set it to the API's full HTTPS URL before building the frontend. Never use a private Render hostname or `localhost:8000`.
6. Record both actual URLs and the deployed commit. Future releases are manual (`autoDeployTrigger: off`): run the checks and explicitly deploy the reviewed commit. A Blueprint sync can also apply configuration changes.

The frontend build command is `cd app && npm ci && npm test && npm run build`; the publish folder is `app/dist`. The API Dockerfile is `api/Dockerfile` with build context `.`. The Blueprint sets the SPA rewrite and revalidates the service worker, HTML and install manifest. See [Render Blueprint reference](https://render.com/docs/blueprint-spec) and [public service URL variables](https://render.com/docs/environment-variables).

## 4. Live SMS (Africa's Talking)

Free hosting does not provide free delivery of text messages. New accounts can use [verified email](email-accounts.md); this section is for the legacy phone option. The deployed configuration disables the development fallback that prints codes to logs. The communication board and local caregiver PIN work without SMS through **Komeza nta konti**, and a forgotten PIN can be replaced with the recovery code written down at setup.

**What happens to a code request.** The app sends `POST /auth/code` with the number. The API accepts only a Rwandan mobile number, allows one code a minute and five an hour per number and purpose, and then:

| API set-up | What the API does | What the caregiver sees |
|---|---|---|
| No API key, `VUGA_SMS_LOG_ENABLED=false` (public host now) | Refuses with **503** `sms is not set up on this server`; no code is stored | SMS is not set up on the Vuga server; they can continue without a number |
| Username `sandbox` and a sandbox key | Sends to Africa's Talking's **sandbox simulator**; **202** with `delivery: "simulator"` | The code went to the provider's simulator and will not reach a phone |
| Live username and live key | `POST https://api.africastalking.com/version1/messaging` (form fields `username`, `to`, `message`, optional `from`; header `apiKey`); **202** with `delivery: "sms"` when the recipient's status is 100, 101 or 102 | A code was sent, valid 10 minutes |
| Provider refusal (wrong key or username, or a status such as 401 RiskHold, 402 InvalidSenderId, 403 InvalidPhoneNumber, 405 InsufficientBalance) | **502**; no code is stored; the API log names the HTTP status or recipient status, never the number, code or key | The SMS could not be sent; try again later |
| Uncertain outcome (timeout, HTTP 408/5xx, malformed or unknown provider response) | **502**; keeps an inactive send reservation, the cooldown and hourly budget; never activates an unconfirmed code | Sending could not be confirmed; another request may need to wait for the cooldown |

A 202 means Africa's Talking **accepted** the text. Its status 101 "Sent" means it was handed to the mobile network, not that it reached the phone ([Africa's Talking messaging error codes](https://help.africastalking.com/en/articles/16150386-messaging-error-codes)). Only the delivery report (Success) in the Africa's Talking dashboard, or the code arriving on the handset, shows delivery. The API's request matches Africa's Talking's own Python SDK (live host `api.africastalking.com`, sandbox host `api.sandbox.africastalking.com`, sandbox chosen only by the username `sandbox`). Their developer documentation refused automated access when this was written, so check it from a browser before going live.

**Steps to turn on live SMS** (all outside the repository; none can be done from code):

1. Fix CORS first (section 3, step 4). Until then the browser never reaches `/auth/code`.
2. In Africa's Talking, create or open a **live** app (not the sandbox), note its exact **username**, and generate an **API key** for that live app. A sandbox key does not work on the live host, and a live key with the username `sandbox` goes to the simulator host and is refused.
3. Add SMS credit to the live account. Without it, texts are refused as InsufficientBalance (405). Check the per-SMS price for Rwanda in the dashboard.
4. **Sender ID for Rwanda.** Africa's Talking's [Rwanda sender ID requirements](http://help.africastalking.com/en/articles/11581484-rwanda-sender-id-requirements) ask for procuration letters for MTN and Airtel on company letterhead, stamped and signed, and the certificate of company registration. Until a sender ID is approved, leave `VUGA_AFRICASTALKING_SENDER_ID` unset so the account's default sender is used. Whether the default sender is delivered on Rwandan networks could not be confirmed. If texts come back refused (402 InvalidSenderId or 502 RejectedByGateway, or Rejected in the delivery reports), an approved sender ID is required.
5. In Render, open `vuga-api` → **Environment**, set the variables below, save, and deploy the API manually (`autoDeployTrigger: off`). The deployed commit must include this version of the API; `266dbfe` on `deploy/vuga-cloud` does not report `sms` in `/health`.

| Variable | Value |
|---|---|
| `VUGA_AFRICASTALKING_USERNAME` | The live app's username, exactly; `sandbox` sends to the simulator, not a phone |
| `VUGA_AFRICASTALKING_API_KEY` | The live app's API key (secret; dashboard only, never in Git, chat or screenshots) |
| `VUGA_AFRICASTALKING_SENDER_ID` | The approved sender ID, or leave unset |
| `VUGA_SMS_LOG_ENABLED` | Keep `false` |

6. Check the mode without texting anyone: `GET https://vuga-api.onrender.com/health` must show `"sms": "sms"` (`simulator` is the sandbox, `off` means no key). This identifies the configured sender; it does not validate its key, balance or delivery. The Render log shows one line at startup saying where codes go.
7. Check delivery with **one approved test number** (your own phone), and record three results separately: the app's message that a code was sent (the provider **accepted** it); the text's status in the Africa's Talking SMS log (**delivered**, or why not); and the text **arriving on the phone**, with its code opening the account once. Then check a wrong code (it says how many tries are left), the one-minute wait before another code, and a code older than 10 minutes. Mocked tests and provider acceptance are not proof of receipt.

Do not publish or ask users to retrieve authentication codes from logs. Vuga does not process Africa's Talking's delivery-report callbacks; use their dashboard.

**Retry semantics.** The database reserves each send before contacting the provider. A definite refusal restores the previous code and send count only if that reservation is still current. Unknown outcomes and interrupted workers keep the reservation: an SMS might already have left the provider, so retrying cannot bypass the one-minute/five-per-hour limits. A late response cannot overwrite a newer code. Provider logs contain bounded numeric status codes only, never response bodies or provider-supplied descriptions that might echo credentials or message text.

## 5. Verify the deployed system

Use test data and record actual outcomes; this checklist is not a claim of passing cloud tests.

- Open the API's `/health` and confirm both `status: "ok"` and `model_loaded: true`. This endpoint alone does not establish database readiness; verify an actual database-backed request such as `/symbols` too.
- Open the app's `/manifest.webmanifest`, `/sw.js`, bundled media and board. Confirm browser requests target the public API URL and no CORS/mixed-content errors occur.
- When SMS is configured, open a test account, receive the code on a real phone, log in, save data, restart/redeploy the API, and confirm that the account and saved data remain. Also check new-device restore and stale-backup conflict handling.
- Shut down the development PC and open the app from another device using mobile data. Check the public API too. This proves the deployed path is independent of the PC.
- Follow [physical-device testing](physical_device_testing.md) on Android and iPhone/iPad, using the new permanent URL. Data saved under the temporary tunnel hostname does not automatically move to the new origin; set up test profiles again or use a supported device export/import.
- Record cold API wake-up separately from a warm request. Keep the API sleep delay out of on-device prediction and speech timings.

## Persistent data and future changes

The email release runs an idempotent migration before serving requests: it adds email/Firebase identity fields, allows phone/password hash to be null for email accounts, and creates the identity and deleted-profile tables. PostgreSQL inspection, schema changes and table creation share one transaction and advisory lock, including simultaneous fresh-database starts. Five checks passed against disposable PostgreSQL 17.11, covering existing records/constraints, rollback and concurrent startup. This does not replace taking a Neon backup or validating the actual cloud database. Back up the deployed database before upgrading; retain its URL and JWT secret. Keep backups outside the repository and do not use the API container's local SQLite file for persistent hosting. See the [email account guide](email-accounts.md). The Docker context excludes local databases, secrets, raw corpora and large training artefacts.

Record the deployed commit and remaining verification results alongside the URLs above. Stop the temporary tunnel only after the permanent app has been verified.
