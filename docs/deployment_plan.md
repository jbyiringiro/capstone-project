# Vuga AAC deployment plan

**Status, 12 October 2026.** Vuga currently runs only as a local production preview (`npm run preview`). Nothing is publicly hosted yet. This plan explains how each part would be deployed, in what order, and how each step would be checked.

## 1. What gets deployed

| Part | What it is | Needs a server? | Where it runs |
|---|---|---|---|
| Communication board (PWA) | React + Vite build in `app/dist`, with a service worker that caches the app, 181 pictures, 181 speech clips and the trigram model | No. Static files only | Static HTTPS host, then the child's tablet or phone, offline |
| Caregiver data | Profiles, vocabulary, messages and parent PIN, stored in IndexedDB (Dexie) | No | On the device only |
| Optional REST API | FastAPI app in `api/`: auth, profiles, vocabulary, sync, summaries, `/predict` | Yes | Docker container on a cloud web service |
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

`docker-compose.yml` is for **local use only**. It hard-codes the Postgres password `vuga`, publishes port 5432, and allows only localhost CORS origins. None of those are acceptable on a public host.

## 4. Rollout steps

**Phase 0: local preview (done).** `npm ci && npm test && npm run build && npm run preview`. This is used for the demonstration video.

**Phase 1: public PWA (no API).**
1. Push the repository to GitHub.
2. Connect the repository to Netlify or Cloudflare Pages:
   - Base directory: `vuga-aac/app`
   - Build command: `npm ci && npm test && npm run build`
   - Publish directory: `dist`

   Because `npm test` is part of the build, a failing test blocks the deploy.
3. Add a rule that rewrites any unknown path to `/index.html` (single-page app fallback). Serve `sw.js` with `Cache-Control: no-cache` so updates reach devices. Hashed assets can be cached long-term.
4. Open the URL on an Android tablet in Chrome, install it to the home screen, switch to airplane mode, and confirm that pictures, speech and suggestions still work.

**Phase 2: API and database.**
1. Create the managed PostgreSQL database and copy its connection URL.
2. Create a Render web service from `api/Dockerfile` with the build context at the repository root. Set the secrets from section 3 and the health check path `/health`.
3. On first start, the API creates its tables (`create_all`) and imports `vocab/symbols.csv`. Confirm that `/health` returns `{"status":"ok","model_loaded":true}` and that Swagger opens at `/docs`.
4. Rebuild the PWA with `VITE_API_BASE` pointing to the API, then test register, login, sync and summary from the hosted app.

**Phase 3: pilot with a partner school or caregivers (only after validation).** This waits for a native speaker to review the speech, caregivers to review the vocabulary and pictures, and the partner to agree on data handling (section 6). Each tablet is set up once on Wi-Fi, after which daily use is offline. Updates arrive the next time a device is online.

## 5. Checks, monitoring and rollback

| When | Check |
|---|---|
| Every deploy | Build command runs the 30 Vitest tests. API changes run `python -m pytest ml/tests api/tests` before merging |
| After a PWA deploy | Airplane-mode test on a real device: board, **Vuga** speech, **Erekana**, parent PIN lock |
| After an API deploy | `/health` shows `model_loaded: true`, plus one Swagger request each to `/auth/login` and `/predict` |
| Ongoing | The host's uptime check on `/health`, the host's logs, and a weekly `pg_dump` export kept outside the host |

**Rollback.** Both hosts keep earlier deploys. For a bad deploy, re-publish the previous one from the host dashboard. Devices pick up the restored version the next time they come online, because the service worker updates automatically (`registerType: 'autoUpdate'`).

**Database changes.** There are no migrations yet; tables are created with `create_all`. Before any schema change after go-live, add Alembic migrations and take a database backup.

## 6. Security, privacy and licensing

- **Children's data.** By default, nothing leaves the device. Sync is explicit and initiated by a caregiver. Any hosted API holding profiles must follow Rwanda's personal data protection law (Law No. 058/2021) and the partner's consent process. Use the smallest amount of data needed, and do not log message content.
- **Transport.** HTTPS only, CORS limited to the PWA origin, and the JWT secret stored as a host secret.
- **Parent PIN.** The PIN is a local guard against a child accidentally changing settings. It is not server authentication. API accounts use their own password and JWT login.
- **Known gaps before a pilot.** The 28 September check recorded six development-dependency advisories in the Vite/Vitest toolchain. Run `npm audit` and update the packages before a public launch.
- **Licences.** The synthetic speech (Meta MMS-TTS) is CC BY-NC 4.0, which permits only non-commercial deployment. Picture licences and attribution must ship with the app, as recorded in `app/public/photos/manifest.json`. ARASAAC fallback pictograms are CC BY-NC-SA 4.0.

## 7. Estimated cost

| Stage | Monthly cost |
|---|---|
| Demonstration (Phases 1–2 on free tiers) | $0 |
| Small pilot (static host free, small paid API and database) | about $15–25. Check current provider pricing |
| Per device | No hosting cost; the app runs offline on existing Android tablets |
