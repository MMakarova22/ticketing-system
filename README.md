# Ticket Tracker — Hackathon Ticketing System

A small Kanban-style ticket tracker: a **React SPA**, a **NestJS HTTP API**, and **PostgreSQL**, started with Docker Compose.

> Status: **Milestone M5 (final validation)** done. All mandatory features work: sign-up with email verification,
> login, logout, teams, epics, tickets with comments, and a drag-and-drop Kanban board with filters.
> Validated from a clean checkout on Linux (WSL2, amd64) in Chromium and Firefox; **ARM64 (Apple Silicon), native
> Windows and macOS runs are not verified yet**.
> A follow-up security remediation changed sign-up (the password is now chosen on the verification page) and added
> rate limits to the authentication endpoints (see [Rate limits](#rate-limits)).
> A UI redesign added light and dark themes, a compact top navigation, a redesigned
> board with touch drag-and-drop, and responsive Teams, Epics, ticket and sign-in screens. It changed no API,
> database or business rule; see [User interface](#user-interface).

## Prerequisites

- **Docker** with **Docker Compose v2** (Docker Desktop on Windows/macOS, or Docker Engine on Linux).
- Nothing else is needed to run the application: no Node.js, database or mail server on the host.
- Only for development or running the automated tests on the host: **Node.js 26** and npm 11.
- The first build downloads base images and npm packages, so it needs internet access (Docker Hub, the npm registry
  and Prisma's binary server). Behind a corporate proxy, configure the proxy in Docker Desktop / the Docker daemon.

### Windows 11 (WSL2 + Docker Desktop)

1. Install **WSL2** with an Ubuntu distribution (`wsl --install` in an administrator PowerShell, then restart).
2. Install **Docker Desktop**, keep "Use the WSL 2 based engine" on, and enable integration for your Ubuntu
   distribution (Settings → Resources → WSL integration).
3. In the Ubuntu terminal, check `docker version` and `docker compose version`.
4. Clone the repository **inside the WSL file system** (for example `~/projects`), not under `/mnt/c/...`: builds and
   file access are much faster there. Line endings are forced to LF by `.gitattributes`, so a checkout made with
   Windows Git also works inside the Linux containers.
5. Run the quick start below from that directory. Open the URLs in your normal Windows browser: `localhost` ports are
   forwarded from WSL2.

The project was validated in exactly this setup (commands run inside WSL2 Ubuntu). Running `docker compose` from
PowerShell with a Windows checkout should work the same way but has not been validated.

### macOS and Apple Silicon (ARM64)

Docker Desktop for Mac runs the same commands. **ARM64 is not verified yet:** an emulated `linux/arm64` build on an
x86 machine failed inside `prisma generate` (an error that changed between attempts, which points to the emulation,
not to the application). A native build on an Apple Silicon Mac has not been run. If `docker compose up --build`
fails there, please report the exact build output.

## Quick start

From the repository root of a clean checkout:

```bash
docker compose up --build
```

| What | URL |
|------|-----|
| Application | http://localhost:3000 |
| Mailpit (local email inbox for verification emails) | http://localhost:8025 |
| Health check | http://localhost:3000/api/health |

On startup the app container applies database migrations automatically. A fresh database contains only the schema;
no sample data is loaded. Create all data through the UI or API.

The first start builds the app image (about a minute or more, depending on the network). It is ready when
`docker compose ps` shows all three services as `healthy` and http://localhost:3000/api/health returns
`{"status":"ok","database":"up"}`. To run in the background use `docker compose up --build -d`, and
`docker compose logs -f app` to follow the app's log.

### First login

1. Open http://localhost:3000 and choose **Sign up**. Enter your **email only**.
2. Open the Mailpit inbox at http://localhost:8025 and click the link in the verification email.
   Any address works locally: Mailpit catches every email, nothing is delivered to real mailboxes.
3. On the **Choose your password** screen enter a password (8–256 characters, used exactly as typed) twice and
   choose **Verify email and set password**.
4. On the "Email verified" screen choose **Continue to login** and log in. Verifying never logs you in by itself.

No email? The login page has a permanent link, **Didn't get your verification email? Resend it**, which opens the
**Resend verification email** page (`/resend-verification`). A new email is sent at most once per 60 seconds per
account; links are valid for 24 hours and can be used once, and a new link replaces the previous one. The answer is
always the same, so it never reveals whether an address is registered. Until the email is verified the account has
no password, so logging in fails with the normal "Invalid email or password" message.

Stop with `Ctrl+C` or `docker compose down`. Data is kept in the `postgres_data` volume.
To wipe all data: `docker compose down -v`.

## Configuration

No `.env` file is required: `docker-compose.yml` contains **local development defaults** (not secrets).
To override, copy `.env.example` to `.env` and edit it. `.env` is git-ignored. Never commit real credentials.

How the values are resolved:

- Docker Compose reads `.env` from the repository root automatically. A variable set in `.env` (or in your shell)
  wins over the default in `docker-compose.yml`; anything not set keeps the default.
- `.env.example` is never read by Compose. It documents every variable, and its database values are the same as the
  Compose defaults, so copying it unchanged to `.env` changes nothing.
- `DATABASE_URL` in `.env` is used only by npm scripts on the host (Prisma CLI, `npm run dev:api`). Inside Docker the
  app builds its own URL from `POSTGRES_*`, with the host name `db`.
- Run `docker compose config` to see the values Compose will actually use.

> **Changing the database password later:** PostgreSQL applies `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`
> **only when the `postgres_data` volume is first created**. Changing `POSTGRES_PASSWORD` afterwards does **not**
> change the existing database user's password: the app's startup migration then cannot log in to the database, so
> the `app` container keeps restarting and never becomes healthy (`docker compose logs app` shows an authentication
> error). Either put the old value back, change the password inside PostgreSQL
> (`docker compose exec db psql -U <user> -d <db> -c "ALTER USER <user> PASSWORD '<new>'"`) and then update `.env`,
> or start over with an empty database using `docker compose down -v` (this **deletes all data**).

| Variable | Default | Purpose |
|----------|---------|---------|
| `APP_PORT` | `3000` | Host port for the app |
| `APP_BASE_URL` | `http://localhost:3000` | Public URL used in email links |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | local defaults | Database name and credentials (local only) |
| `POSTGRES_PORT` | `5432` | Host port for PostgreSQL (bound to 127.0.0.1) |
| `SESSION_TTL_DAYS` | `7` | Login session lifetime |
| `COOKIE_SECURE` | `true` | Secure session cookie (works on `http://localhost` in Chrome/Edge/Firefox). Set `false` only when using plain HTTP on another host name |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | `mailpit` / `1025` / `false` | SMTP server for verification emails |
| `SMTP_USER` / `SMTP_PASS` | empty | SMTP credentials, if the server requires them |
| `SMTP_FROM` | `Ticket Tracker <no-reply@ticketing.local>` | Sender address |
| `MAILPIT_UI_PORT` / `MAILPIT_SMTP_PORT` | `8025` / `1025` | Host ports for Mailpit (bound to 127.0.0.1) |
| `TRUST_PROXY` | not set (disabled) | Which proxies may set `X-Forwarded-For` for the per-IP rate limits. See [Proxies and client IPs](#proxies-and-client-ips). **Not passed to the container by `docker-compose.yml`**: setting it in `.env` only affects `npm run dev:api` on the host |

### Using a corporate SMTP relay

Set `SMTP_HOST` to your organization's SMTP relay and the matching `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASS` and `SMTP_FROM` in `.env` (ask your administrator for the values), then run `docker compose up --build`
again.
`SMTP_SECURE=true` means TLS from the first byte (usually port 465); with `false` the connection is upgraded with
STARTTLS when the server offers it (usually port 587 or 25).

> The relay is supported through configuration only: it has **not been tested** with real relay credentials. All
> email flows were validated with Mailpit.

### Email: Mailpit and SMTP

By default every email goes to **Mailpit**, a local inbox that catches all messages and never delivers them:

- Inbox: http://localhost:8025 (also an HTTP API at `/api/v1/...`, used by the automated tests).
- The app sends to `mailpit:1025` inside the Compose network; port 1025 is also published on `127.0.0.1` for host
  development.
- Mailpit accepts any SMTP user name and password, so `SMTP_USER`/`SMTP_PASS` can be set or left empty.

To send real email, set the `SMTP_*` variables in `.env` (see the SMTP relay section above). SMTP failures are logged by
the app and never fail sign-up or reveal whether an account exists. Use `docker compose logs app` to see them.

### Ports

| Port (host) | Service | Bound to | Override with |
|---|---|---|---|
| 3000 | App (SPA + API) | all interfaces | `APP_PORT` |
| 5432 | PostgreSQL | `127.0.0.1` only | `POSTGRES_PORT` |
| 8025 | Mailpit web UI and API | `127.0.0.1` only | `MAILPIT_UI_PORT` |
| 1025 | Mailpit SMTP | `127.0.0.1` only | `MAILPIT_SMTP_PORT` |

### Port conflicts

If 3000, 5432, 8025 or 1025 is already in use (for example by a local PostgreSQL or another project), `docker compose
up` stops with "port is already allocated" or "address already in use". Set `APP_PORT`, `POSTGRES_PORT`,
`MAILPIT_UI_PORT` or `MAILPIT_SMTP_PORT` in `.env`. If you change `APP_PORT`, `APP_BASE_URL` follows it automatically
unless you set it yourself. To find what holds a port: `ss -ltnp | grep :5432` (Linux/WSL), `lsof -i :5432`
(macOS) or `netstat -ano | findstr :5432` (Windows).

The containers have fixed names (`ticketing-app`, `ticketing-postgres`, `ticketing-mailpit`), so only one copy of the
stack can run on a machine at a time.

### Proxies and client IPs

The per-IP rate limits use the address of the TCP peer. `X-Forwarded-For` is **ignored by default**, so clients
cannot choose their own rate-limit address.

- `TRUST_PROXY` enables it for proxies you control. Accepted: a hop count `1`–`10`, or a comma-separated list of
  `loopback`, `uniquelocal`, IP addresses and CIDR ranges. `true` and `/0` ranges are rejected at startup (they
  would trust every client). Unset, empty, `false` or `0` means disabled. The startup log shows the setting.
- `docker-compose.yml` never sets it and does not forward it from `.env`. To enable it in Docker, add it in an
  override file, like `docker-compose.test.yml` does for the test stack (see [Tests](#tests)).
- Without it, every request that reaches the container through Docker's port proxy (for example from the same
  machine, or every request on Docker Desktop) shares one address and therefore one set of per-IP limits.

## Development (optional, on the host)

```bash
npm ci                          # install all workspaces
cp .env.example .env            # matches the Compose defaults; keep DATABASE_URL in sync if you change POSTGRES_*
docker compose up -d db mailpit # database + local SMTP only
npm run db:deploy               # apply migrations
npm run prisma:generate         # generate the Prisma client

# API on http://localhost:3000 (two terminals: compiler in watch mode + server with auto-restart)
npm run dev:api:build
SMTP_HOST=localhost npm run dev:api   # "mailpit" only resolves inside Docker; shell variables win over .env

# SPA on http://localhost:5173 with hot reload; /api is proxied to port 3000
npm run dev:web
```

Other scripts: `npm run build` (production build), `npm run typecheck`, `npm run db:migrate` (create a new
migration after a schema change).

The favicon (`apps/web/public/favicon.svg`) is hand-written; `apps/web/public/favicon.ico` is generated from it with
`node scripts/generate-favicon.mjs` (uses the Chromium installed by `npx playwright install chromium`). Run it only
after changing the SVG, and commit both files.

## Tests

The application needs only Docker. The **test runner** (Playwright) runs on the host and needs **Node.js 26** and
npm 11. API and browser tests run against a running stack (by default `http://localhost:3000`) that must be
**started with the test override `docker-compose.test.yml`**:

```bash
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build
npm ci                            # first time only: installs Playwright and the other dev dependencies
npx playwright install chromium   # first time only: downloads the test browser (no sudo needed)
npm test                          # all tests (unit + API + browser)
npm run test:unit                 # unit tests only (no stack needed)
npm run test:api                  # API / backend flows only
npm run test:e2e                  # browser flows only (Chromium)
```

**Why the override is required:** the authentication endpoints are rate-limited per client IP (for example
10 sign-ups per hour). All test requests come from the same machine, so on the default stack they share one address
and a full run gets `429 Too Many Requests`. `docker-compose.test.yml` sets `TRUST_PROXY=uniquelocal`, and every
test sends its own `X-Forwarded-For` address (`tests/support/test.ts`), so each test gets its own rate-limit
buckets. Use the override **only on a development machine**: with it, any client on a private network address
(including other machines on your LAN, since the app port listens on all interfaces) can choose its own rate-limit
address. Go back to the normal stack with `docker compose up -d` (Compose recreates the app without the override).

- 431 tests: 186 unit tests (`tests/unit`, pure modules: rate limiter, client-IP keys, `TRUST_PROXY` parsing,
  `Retry-After` handling, theme handling, WCAG contrast of the design tokens, form validation helpers, favicon
  files, …), 110 API tests (`tests/api`) and 135 browser tests (`tests/e2e`), including one test that walks the whole
  Definition of Done through the UI (`tests/e2e/dod-journey.spec.ts`). Touch drag-and-drop is tested with Chromium's
  touch emulation.
- One API test is skipped unless `DB_DOWN_BASE_URL` points to an app instance whose database is unreachable: it
  checks the `503` health response, which cannot be produced on the stack under test without breaking the other
  tests.
- Use `BASE_URL=http://host:port npm test` to target another URL, and `MAILPIT_URL` if the Mailpit API is not at
  `http://localhost:8025`.
- Tests create their own users with unique emails, read verification emails from Mailpit, and never need seeded data.
  The password for test accounts is random and generated once per run (`TT_TEST_PASSWORD`); no password is stored
  in the repository.
- If `npx playwright install chromium` reports missing system libraries on Linux, it prints the command to install
  them (`sudo npx playwright install-deps chromium`).
- **Use a fresh database for full runs.** Every run adds users and teams. With thousands of teams in a long-lived
  local database, some browser tests can exceed Playwright's 5-second timeout (Playwright's role and label lookups
  slow down on very large pages; the app itself stays fast).
  Reset with `docker compose -f docker-compose.yml -f docker-compose.test.yml down -v`, then start it again as
  above (this deletes all local data).
- Firefox was validated once with a temporary Playwright config, before the UI redesign; the project's default
  browser is Chromium.

## Authentication overview

- **Sign-up** (`POST /api/auth/register {email}`): the email only (trimmed, lower-cased). Sending a password is a
  `400`. A new address gets an account **without a password** and a verification email. An existing address changes
  nothing and gets no email. The answer is always the same `202`, so it never reveals whether an email is registered.
- **Verification sets the password** (`POST /api/auth/verify-email {token, password}`): the emailed link (single use,
  valid 24 hours) opens a page where the owner of the mailbox chooses the password (8–256 characters, hashed with
  Argon2id, never trimmed). Using the link, storing the password and marking the email verified happen in one
  database transaction. An invalid password is a `400` and does not use up the link. Nobody can choose the password
  of someone else's address by registering it first.
- **Resend** (`POST /api/auth/resend-verification {email}`): always the same `202`. A new link is sent at most once
  per 60 seconds per account, replaces the previous one, and only for accounts that are not verified yet.
- **Login** (`POST /api/auth/login`): wrong password, unknown email and not-yet-verified account all get the same
  `401 INVALID_CREDENTIALS`.
- **Sessions:** an `HttpOnly`, `SameSite=Lax` (and `Secure`) cookie holding a random token; only its SHA-256 hash is
  stored. Sessions expire 7 days after login. **Logout** (`POST /api/auth/logout`) deletes the session if there is one
  and always clears the cookie (`204`), even for an expired or unknown cookie. Every API route except health,
  sign-up, verification, resend, login and logout requires a session.
- CSRF: every state-changing request (`POST`, `PUT`, `PATCH`, `DELETE`) must use `Content-Type: application/json`,
  otherwise the API answers `415`.
- Errors are JSON: `{ "statusCode": 400, "message": "...", "code": "VALIDATION_ERROR" }` (`code` is optional).
- Session tokens never appear in URLs or response bodies; only the single-use verification token is part of a link.
- Every response carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and
  `Content-Security-Policy: frame-ancestors 'none'` (the page cannot be embedded in a frame).
- IDs are UUIDs and are accepted in any letter case (they are normalized to lower case).
- The health check (`GET /api/health`) answers `200 {"status":"ok","database":"up"}`, or
  `503 {"statusCode":503,"message":"Database is unavailable","code":"DATABASE_UNAVAILABLE"}`.

### Rate limits

| Endpoint | Per client IP | Per email address |
|---|---|---|
| `POST /api/auth/register` | 10 per hour | 3 per hour |
| `POST /api/auth/login` | 50 per 15 minutes | 10 per 15 minutes (reset by a successful login) |
| `POST /api/auth/verify-email` | 20 per 15 minutes | – |
| `POST /api/auth/resend-verification` | 10 per hour | 3 per hour (plus the 60-second rule above) |

- Above a limit the API answers `429` with
  `{"statusCode":429,"message":"Too many requests. Try again in N seconds.","code":"RATE_LIMITED"}` and a
  `Retry-After: N` header ("1 second" when N is 1). The screens show "Too many attempts. Try again in …" (seconds
  below one minute, whole minutes above).
- The per-IP limit is checked first. Invalid requests (`400`) are not counted. The decision never depends on whether
  an account exists, so a `429` reveals nothing about it.
- Email addresses are counted by their SHA-256 hash; IPv6 clients by their `/64` network, and IPv4-mapped IPv6
  addresses as IPv4. See [Proxies and client IPs](#proxies-and-client-ips) for `X-Forwarded-For`.
- **The counters are kept in the app process's memory:** they are not shared between several app instances (each
  instance applies the limits on its own) and they reset when the app restarts.
- The app logs one warning per endpoint and limit type (IP or email) per limit window, not one per blocked request;
  warnings never contain an email, IP or password.

## Teams and epics

- **Teams** screen: create, rename and delete teams. Names are trimmed and must be unique ignoring case. The list
  shows ticket and epic counts and when the team was last modified.
- **Epics** screen: pick a team, then create, edit and delete its epics (title required, description optional).
  An epic's team is chosen when it is created and cannot be changed.
- A team that still has tickets or epics, or an epic that tickets still reference, cannot be deleted: the Delete
  button is disabled and the API answers `409`. Deleting asks for confirmation.
- "Modified" changes only when something actually changed; saving unchanged values keeps it.

| Method | Path (prefix `/api`) | Notes |
|--------|----------------------|-------|
| `GET` | `/teams` | All teams with `ticketCount`, `epicCount` |
| `POST` | `/teams` | `{name}` → `201`; duplicate name → `409 TEAM_NAME_TAKEN` |
| `PATCH` | `/teams/:id` | `{name}` → `200` |
| `DELETE` | `/teams/:id` | `204`; still has tickets or epics → `409 TEAM_IN_USE` |
| `GET` | `/epics?teamId=…` | Epics of one team (required) with `ticketCount` |
| `POST` | `/epics` | `{teamId, title, description?}` → `201`; unknown team → `404 TEAM_NOT_FOUND` |
| `GET` / `PATCH` | `/epics/:id` | PATCH `{title?, description?}`; `teamId` cannot be changed (`400`) |
| `DELETE` | `/epics/:id` | `204`; referenced by tickets → `409 EPIC_IN_USE` |

Malformed IDs return `400 VALIDATION_ERROR`; unknown IDs return `404`.

## Kanban board

- The **Board** shows one team at a time in five columns, in workflow order: **New**, **Ready for
  implementation**, **In progress**, **Ready for acceptance**, **Done**. The columns fill the window height and each
  one scrolls on its own; on narrow screens the board scrolls sideways. Each column lists its tickets most recently
  modified first. Cards show the title, type, epic (or "No epic") and the relative modified time.
- The toolbar above the board holds the **team selector**, the title search, the type and epic filters, **Clear**,
  the ticket count and **New ticket**.
- **Drag a card to any column** to change its state. Every state can move to every other state, including from
  Done back to New. The card moves straight away and the change is saved (`PATCH /api/tickets/:id {state}`).
  If saving fails (server error or no connection), the card goes back to its original column and an error is
  shown. Dropping a card on its own column does nothing.
- **Mouse:** drag a card (it starts moving after 5 pixels, so a click on the title still opens the ticket).
- **Touch screens:** press and hold a card for about 0.2 seconds, then drag. A quick swipe scrolls the column or the
  board instead, and a tap on the title opens the ticket.
- **Keyboard:** Tab to a card, press **Space** to pick it up, **←/→** to choose a column, then **Space** to drop
  it or **Esc** to cancel. Click (or Tab to and press Enter on) a card's title to open the ticket.
- **Filters:** type, epic (including **No epic**) and a case-insensitive title search, combined with AND, plus
  **Clear**. They run in the browser.
- **URL:** the team and filters are kept in the URL (`/?teamId=…&type=bug&epic=none&q=login`), so a reload or a
  shared link shows the same board. Changing the team adds a browser history entry (Back returns to the previous
  team); changing a filter does not. Changing the team resets the epic filter.

## Tickets and comments

- **New ticket** (opens with the board's team selected): team, epic (optional), type (`bug`, `feature`, `fix`),
  title and body. New tickets start in the **New** state. Changing the team clears the epic, and only the selected team's epics can be chosen.
- **Ticket details**: all fields, the creator's email and timestamps. **Edit** also changes the state; any state
  can move to any other. **Delete** asks for confirmation and deletes the ticket's comments too.
- **Comments** are listed oldest first with author and time. They cannot be edited or deleted, and adding one
  does not change the ticket's "Modified" time.
- Titles, bodies and comments are trimmed; empty or whitespace-only values are rejected. Saving unchanged values
  keeps "Modified".

| Method | Path (prefix `/api`) | Notes |
|--------|----------------------|-------|
| `GET` | `/tickets?teamId=…` | Tickets of one team (required), sorted by `modifiedAt` newest first |
| `POST` | `/tickets` | `{teamId, epicId?, type, state?, title, body}` → `201`; `state` defaults to `new` |
| `GET` | `/tickets/:id` | One ticket, with `epic {id,title}`, `createdBy {id,email}` and `commentCount` |
| `PATCH` | `/tickets/:id` | Any of `{teamId, epicId, type, state, title, body}`; `epicId: null` clears the epic |
| `DELETE` | `/tickets/:id` | `204`; the ticket's comments are deleted with it |
| `GET` | `/tickets/:id/comments` | Comments, oldest first, with `author {id,email}` |
| `POST` | `/tickets/:id/comments` | `{body}` → `201` |

- The epic must belong to the ticket's team: an epic of another team, or one that does not exist, returns
  `400 INVALID_EPIC`. Changing a ticket's team while keeping the old team's epic is rejected the same way, so
  send `epicId: null` or an epic of the new team along with the new `teamId`.
- Unknown team → `404 TEAM_NOT_FOUND`; unknown ticket → `404 TICKET_NOT_FOUND`.
- The creator and timestamps are set by the server; sending `createdById`, `createdAt` or `modifiedAt` is a `400`.

## User interface

- **Light and dark themes.** The sun/moon button in the top navigation (and on the sign-in screens) switches between
  them. Until you choose, the app follows the operating system's setting; your choice is remembered in the browser
  (`localStorage`, key `tt-theme`) and applied before the first paint, so pages never flash in the wrong theme.
- **Top navigation:** the product logo, **Board**, **Teams** and **Epics**, the theme button and the account menu
  (your email and **Log out**). On phones the logo text and the email are hidden.
- **Responsive layout** from phone width (390 px) up: the board scrolls sideways, and the Teams and Epics tables
  scroll inside their panels, so the page itself never scrolls sideways.
- **Accessibility:** every control has a visible label or an accessible name, keyboard focus is always visible, and
  the colors meet WCAG AA contrast in both themes (checked by a unit test). Form errors are announced to screen
  readers; on the Teams and Epics screens a missing name or title is shown next to its field, which receives focus.
- The browser tab shows the product icon (`favicon.svg`, which follows the browser's light or dark scheme, with a
  `favicon.ico` fallback).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `port is already allocated` / `address already in use` | Another program uses 3000, 5432, 8025 or 1025. Change the port in `.env` (see [Port conflicts](#port-conflicts)). |
| `Conflict. The container name "/ticketing-app" is already in use` | Another copy of this stack (for example a second checkout) is running. Stop it with `docker compose down` in that checkout. |
| `app` keeps restarting; `docker compose logs app` shows a database authentication error | `POSTGRES_*` changed after the volume was created. See [Changing the database password later](#configuration). |
| After `docker compose up -d --build` the old version still runs | Compose kept the running container. Recreate it: `docker compose up -d --no-deps --force-recreate app`. |
| No verification email | Open the Mailpit inbox (http://localhost:8025). With a real SMTP server, check `docker compose logs app` for SMTP errors. |
| The verification link does not open the app | `APP_BASE_URL` does not match the URL you use in the browser (for example after changing `APP_PORT` together with an explicit `APP_BASE_URL`). |
| Logged out immediately on a host other than `localhost` over plain HTTP | Browsers drop `Secure` cookies on non-HTTPS hosts other than `localhost`. Set `COOKIE_SECURE=false` in `.env` for that setup only. |
| Build fails while downloading packages | No internet access or a proxy blocks Docker Hub, the npm registry or Prisma's binary server. Configure the proxy in Docker Desktop. |
| Build fails in `prisma generate` with `Unable to parse JSON … [Context: getDmmf]` | Seen only in an emulated `linux/arm64` build on an x86 machine (not verified on real ARM64). Build on the target machine's native platform and report the output. |
| Start over with an empty database | `docker compose down -v` (deletes all data in this stack), then `docker compose up -d`. |
| "Too many attempts. Try again in …" while trying things out locally | A [rate limit](#rate-limits) was reached. Wait, or restart the app (`docker compose restart app`): the counters are kept in memory only. |
| Many tests fail with `429` | The stack was started without `docker-compose.test.yml`. Start it as shown in [Tests](#tests). |

## Project structure

```
apps/api      NestJS API (TypeScript, compiled to CommonJS with tsc); also serves the built SPA
apps/web      React + Vite SPA
prisma        Prisma schema and migrations (PostgreSQL)
tests         Playwright tests (tests/unit, tests/api, tests/e2e, shared helpers in tests/support)
scripts       Maintenance scripts (generate-favicon.mjs)
```

See `CLAUDE.md` for requirements, architecture and conventions.
