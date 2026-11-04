# Free public hosting: Render + Neon

**Prepared on 4 November 2026; not yet deployed.** This setup runs independently of the developer's computer. It replaces the temporary `trycloudflare.com` URL with a stable HTTPS app URL and a separate HTTPS API URL. Hosting account connections, the current source branch on GitHub, and successful cloud builds are still required.

## Services and limits

| Component | Service | Purpose |
|---|---|---|
| React PWA | Render Static Site, free | Serves the board, pictures, audio, model and service worker over HTTPS |
| FastAPI | Render Web Service, free Docker instance | Runs accounts, sync, backup and server-side prediction |
| PostgreSQL | Neon Free project | Persists server data across API restarts and deployments |

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
2. Set `VUGA_DATABASE_URL` to the Neon secret. For the initial `VUGA_CORS_ORIGINS`, use `[]`; this permits deployment without guessing the app's hostname. Cross-origin browser account requests will remain blocked until step 4.
3. Render generates a persistent `VUGA_JWT_SECRET`. Retain it across deployments. The Docker process binds to Render's `PORT`, and startup creates/seeds the schema in the fresh database.
4. After the static site receives its actual HTTPS URL, update the API's `VUGA_CORS_ORIGINS` to a JSON list containing that exact origin, for example `["https://vuga-app-example.onrender.com"]`. Use the actual URL, with no trailing slash, then redeploy the API. `sync: false` preserves this dashboard-managed value on later Blueprint syncs.
5. The frontend's `VITE_API_BASE` references the API's public `RENDER_EXTERNAL_URL`. If creating services manually, set it to the API's full HTTPS URL before building the frontend. Never use a private Render hostname or `localhost:8000`.
6. Record both actual URLs and the deployed commit. Future releases are manual (`autoDeployTrigger: off`): run the checks and explicitly deploy the reviewed commit. A Blueprint sync can also apply configuration changes.

The frontend build command is `cd app && npm ci && npm test && npm run build`; the publish folder is `app/dist`. The API Dockerfile is `api/Dockerfile` with build context `.`. The Blueprint sets the SPA rewrite and revalidates the service worker, HTML and install manifest. See [Render Blueprint reference](https://render.com/docs/blueprint-spec) and [public service URL variables](https://render.com/docs/environment-variables).

## 4. SMS accounts

Free hosting does not provide free delivery of text messages. The deployed configuration disables the development fallback that prints codes to logs. Without an SMS provider key, code requests return the existing delivery-failure response; they do not claim an SMS was sent. The communication board and local caregiver PIN still work through **Komeza nta nimero**. New phone-account registration and SMS PIN reset remain unavailable until live delivery is configured.

When live Africa's Talking delivery is ready, set these as API runtime variables in Render, then redeploy:

| Variable | Value |
|---|---|
| `VUGA_AFRICASTALKING_USERNAME` | Live app username; `sandbox` sends to a simulator, not a phone |
| `VUGA_AFRICASTALKING_API_KEY` | Secret live API key |
| `VUGA_AFRICASTALKING_SENDER_ID` | Approved sender ID, if required by the account |
| `VUGA_SMS_LOG_ENABLED` | Keep `false` |

Confirm the provider's charges and account requirements before sending real SMS. Do not publish or ask users to retrieve authentication codes from logs.

## 5. Verify the deployed system

Use test data and record actual outcomes; this checklist is not a claim of passing cloud tests.

- Open the API's `/health` and confirm both `status: "ok"` and `model_loaded: true`. This endpoint alone does not establish database readiness; verify an actual database-backed request such as `/symbols` too.
- Open the app's `/manifest.webmanifest`, `/sw.js`, bundled media and board. Confirm browser requests target the public API URL and no CORS/mixed-content errors occur.
- When SMS is configured, open a test account, receive the code on a real phone, log in, save data, restart/redeploy the API, and confirm that the account and saved data remain. Also check new-device restore and stale-backup conflict handling.
- Shut down the development PC and open the app from another device using mobile data. Check the public API too. This proves the deployed path is independent of the PC.
- Follow [physical-device testing](physical_device_testing.md) on Android and iPhone/iPad, using the new permanent URL. Data saved under the temporary tunnel hostname does not automatically move to the new origin; set up test profiles again or use a supported device export/import.
- Record cold API wake-up separately from a warm request. Keep the API sleep delay out of on-device prediction and speech timings.

## Persistent data and future changes

The fresh database is initialized with `create_all()`; existing databases are not migrated automatically. Before changing a deployed schema, add an explicit migration and take a database export. Keep backups outside the repository and do not use the API container's local SQLite file for persistent hosting. The Docker context excludes local databases, secrets, raw corpora and large training artefacts.

After successful deployment, update the README and deployment record with real URLs, deployed commit, date and observed results. Stop the temporary tunnel only after the permanent app has been verified.
