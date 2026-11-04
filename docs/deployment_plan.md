# Vuga AAC deployment plan

**4 November 2026 update:** use the [Render + Neon hosting guide](hosting.md) and [render.yaml](../render.yaml) on branch `deploy/vuga-cloud`. They supersede the provider choices and rollout instructions below for the selected free deployment. Permanent hosting is not live yet.

**Status, 2 November 2026.** Vuga currently runs only as a local production preview (`npm run preview`). Nothing is publicly hosted yet. This plan explains how each part would be deployed, in what order, and how each step would be checked.

## 1. What gets deployed

| Part | What it is | Needs a server? | Where it runs |
|---|---|---|---|
| Communication board (PWA) | React + Vite build in `app/dist`, with a service worker that caches the app, 188 pictures, 188 word clips, 1,259 generated clips for spoken sentences and the trigram model | No. Static files only | Static HTTPS host, then the child's tablet or phone, offline |
| Caregiver data | Profiles, vocabulary, messages, custom words with their photos, recordings and the parent PIN, stored in IndexedDB (Dexie) | No | On the device. A device linked to the caregiver's number also keeps an account copy of each coded child's words and settings on the API; names, photos, recordings and messages never leave the device that way |
| Optional REST API | FastAPI app in `api/`: accounts by mobile number, profiles, vocabulary, sync, summaries, account backup, `/predict` | Yes | Docker container on a cloud web service |
| Database | SQLAlchemy: SQLite in development, PostgreSQL 16 for hosting | Yes | Managed PostgreSQL |
| ML model | `kn_trigram.json` from `ml/artifacts`, bundled in the PWA and loaded by the API through `VUGA_MODEL_DIR` | No | Inside both builds |

The key design decision is that the board **does not depend on the API**. A child can communicate with no account, no network and no server. The API only adds explicit caregiver sync, summaries and server-side prediction. So the PWA can be deployed and used on its own, and the API is a second, optional phase.

```
 Tablet / phone (offline after first load)        Cloud (optional)
 ┌──────────────────────────────┐   HTTPS    ┌───────────────────┐   ┌──────────────┐
 │ Vuga PWA + service worker    │──────────▶│ FastAPI (Docker)  │──▶│ PostgreSQL 16 │
 │ IndexedDB, pictures, audio,  │ sync only │ /health, /predict │   │ backups daily │
 │ trigram model                │           └───────────────────┘   └──────────────┘
 └──────────────────────────────┘
          ▲ first install and updates
 ┌──────────────────────────────┐
 │ Static host: app/dist (HTTPS)│
 └──────────────────────────────┘
```

## 2. Hosting choices

| Part | Primary choice | Alternative | Why |
|---|---|---|---|
| PWA | Netlify or Cloudflare Pages (free tier) | GitHub Pages | Free HTTPS (service workers and install require it), a global CDN, and automatic deploys from GitHub |
| API | Render web service built from `api/Dockerfile` | Railway or Fly.io | Uses the existing Dockerfile unchanged, has a free tier, and provides HTTPS |
| Database | Render managed PostgreSQL | Neon or Supabase PostgreSQL | Same provider as the API, with daily backups on paid plans |

Free tiers have limits: services sleep when idle, and free databases have size and lifetime limits. That is acceptable for a demonstration. A school pilot would need a paid database plan, or a free tier whose terms have been checked and which has an export schedule.

## 3. Configuration

**PWA (set at build time)**

| Variable | Value |
|---|---|
| `VITE_API_BASE` | Public API URL, for example `https://vuga-api.onrender.com`. Defaults to `http://localhost:8000` if unset |

**API (set as runtime secrets on the host; never committed)**

| Variable | Value |
|---|---|
| `VUGA_DATABASE_URL` | `postgresql+psycopg://USER:PASSWORD@HOST:5432/vuga` from the managed database |
| `VUGA_JWT_SECRET` | Random string of at least 48 characters. It must stay the same across restarts, or every caregiver session becomes invalid |
| `VUGA_CORS_ORIGINS` | `["https://<pwa-domain>"]`, the exact PWA origin and nothing else |
| `VUGA_MODEL_DIR` | `/srv/ml/artifacts` (already set in the Dockerfile) |
| `VUGA_DEFAULT_MODEL` | `kn_trigram.json` |
| `VUGA_AFRICASTALKING_USERNAME` | The Africa's Talking app username. `sandbox` (the default) uses the free sandbox, whose texts appear in its online phone simulator instead of on real phones |
| `VUGA_AFRICASTALKING_API_KEY` | The API key of that app. Without it the API sends no SMS and writes each sign-up or PIN code to its log, which suits local runs only |
| `VUGA_AFRICASTALKING_SENDER_ID` | Optional sender name registered with Africa's Talking, such as `VUGA`. Left unset, their default sender is used |

`docker-compose.yml` is for **local use only**. It hard-codes the Postgres password `vuga`, publishes port 5432, and allows only localhost CORS origins. None of those are acceptable on a public host.

## 4. Rollout steps

**Phase 0: local preview (done).** `npm ci && npm test && npm run build && npm run preview`. This is used for the demonstration video.

**Phase 1: public PWA (no API).**
1. Push the repository to GitHub.
2. Connect the repository to Netlify or Cloudflare Pages:
   - Base directory: `app` (the app's folder at the root of this repository)
   - Build command: `npm ci && npm test && npm run build`
   - Publish directory: `dist` (inside the base directory)

   Because `npm test` is part of the build, a failing test blocks the deploy.
3. Add a rule that rewrites any unknown path to `/index.html` (single-page app fallback). Serve `sw.js` with `Cache-Control: no-cache` so updates reach devices. Hashed assets can be cached long-term.
4. Open the URL on an Android tablet in Chrome, install it to the home screen, switch to airplane mode, and confirm that pictures, speech and suggestions still work.

**Phase 2: API and database.**
1. Create the managed PostgreSQL database and copy its connection URL.
2. Create a Render web service from `api/Dockerfile` with the build context at the repository root. Set the secrets from section 3 and the health check path `/health`.
3. On first start, the API creates its tables (`create_all`) and imports `vocab/symbols.csv`. Confirm that `/health` returns `{"status":"ok","model_loaded":true}` and that Swagger opens at `/docs`.
4. Rebuild the PWA with `VITE_API_BASE` pointing to the API, then test from the hosted app: opening an account with the code texted to a real phone, signing in with the number and PIN, a PIN reset (the other device's session must end), sync and summary, and the account copy: saved from one device, then refused from a second device holding the older copy until the caregiver chooses.

**Phase 3: pilot with a partner school or caregivers (only after validation).** This waits for a native speaker to review the speech, caregivers to review the vocabulary and pictures, and the partner to agree on data handling (section 6). Each tablet is set up once on Wi-Fi, after which daily use is offline. Updates arrive the next time a device is online.

## 5. Checks, monitoring and rollback

| When | Check |
|---|---|
| Every deploy | Build command runs the 145 Vitest tests. API changes run `python -m pytest ml/tests api/tests` before merging |
| After a PWA deploy | Airplane-mode test on a real device: board, **Vuga** speech, **Erekana**, parent PIN lock |
| After an API deploy | `/health` shows `model_loaded: true`, plus one Swagger request each to `/auth/login` and `/predict` |
| Ongoing | The host's uptime check on `/health`, the host's logs, and a weekly `pg_dump` export kept outside the host |

**Rollback.** Both hosts keep earlier deploys. For a bad deploy, re-publish the previous one from the host dashboard. Devices pick up the restored version the next time they come online, because the service worker updates automatically (`registerType: 'autoUpdate'`).

**Database changes.** There are no migrations yet; tables are created with `create_all`, which adds missing tables but not missing columns. The 2 November changes added `users.token_version` and `account_backups.revision`, so a database created before them needs `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0` and `ALTER TABLE account_backups ADD COLUMN revision INTEGER NOT NULL DEFAULT 1` (or a fresh start); account copies saved in the earlier format, which carried photos and recordings, should be deleted. Before any schema change after go-live, add Alembic migrations and take a database backup.

## 6. Security, privacy and licensing

- **Children's data.** By default, nothing leaves the device. Sync is explicit and initiated by a caregiver. Any hosted API holding profiles must follow Rwanda's personal data protection law (Law No. 058/2021) and the partner's consent process. Use the smallest amount of data needed, and do not log message content.
- **Transport.** HTTPS only, CORS limited to the PWA origin, and the JWT secret stored as a host secret.
- **Parent PIN.** The PIN guards the caregiver area against a child changing settings by accident. On each device it is checked against a PBKDF2 hash, so it works offline. When the device is linked to the caregiver's number, the same PIN signs in to the account, where it is kept as a bcrypt hash, followed by JWT sessions.
- **Accounts by mobile number.** An account is opened only with a six-digit code texted to the caregiver's Rwandan mobile number, and a forgotten PIN is replaced with a new code. Because a PIN of 4 to 6 digits is short, five wrong PINs lock the number for 15 minutes; a texted code lifts the lock. Each try is counted in the database before its PIN is checked, so tries sent at the same moment cannot slip past the lock (20 parallel wrong PINs: 5 checked, then locked). A new or reset PIN ends every session opened with the old one: each token carries the account's `token_version`.
- **Account copy.** A linked device keeps each coded child's word list and board settings on the account so a new device gets them back. The API refuses children's names, custom-word photos, recordings and anything else outside that schema (NFR4), and caps a copy at 1 MB. Every save names the revision it builds on; a save from a device holding an older copy is refused (409) and the caregiver chooses which set-up to keep. The server keeps a keyed hash of each code, never the code itself. A code works once, for 10 minutes and 5 tries, and one number gets at most one code a minute and 5 an hour. Opening an account says when a number already has one, and a PIN reset says when it has none. That is clearer for caregivers, but it lets anyone check whether a number is registered. Per-number limits do not stop one client from texting many different numbers, so a public API should also limit requests per client address (for example at the host's proxy).
- **Known gaps before a pilot.** The 28 September check recorded six development-dependency advisories in the Vite/Vitest toolchain. Run `npm audit` and update the packages before a public launch.
- **Licences.** The synthetic speech (Meta MMS-TTS) is CC BY-NC 4.0, which permits only non-commercial deployment. Picture licences and attribution must ship with the app, as recorded in `app/public/photos/manifest.json`. ARASAAC fallback pictograms are CC BY-NC-SA 4.0.

## 7. Estimated cost

| Stage | Monthly cost |
|---|---|
| Demonstration (Phases 1–2 on free tiers) | $0 |
| Small pilot (static host free, small paid API and database) | about $15–25. Check current provider pricing |
| Per device | No hosting cost; the app runs offline on existing Android tablets |
| SMS codes | Africa's Talking bills each text: one per account opened and one per forgotten PIN. The sandbox is free. Check current pricing for Rwandan numbers |
