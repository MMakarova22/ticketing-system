# CLAUDE.md — Hackathon Ticketing System

> **Requirements reference:** this file is the in-repo source of truth for the requirements. Section numbers (§)
> refer to the original specification. The project decisions in §2 add to the spec, and where the spec leaves a
> choice open they settle it.
>
> **Status:** M0–M5 done. All mandatory features are implemented and validated (M5: clean-clone build and startup,
> empty DB, 111/111 tests in Chromium, 33/33 e2e in Firefox, persistence, security tests) on Linux/WSL2 amd64.
> **Not verified:** ARM64/Apple Silicon (an emulated arm64 build failed in `prisma generate`), native Windows and
> macOS runs, and delivery through a real corporate SMTP relay. See §14 for milestones.
>
> **Security remediation** (after the backend review): the password is set during email
> verification (D12), rate limits on the auth endpoints (D13, D14), lower-case UUIDs, logout always clears the cookie,
> standard 503 health body (D15).
>
> **UI redesign** (included in `main`): design tokens with light/dark themes, top navigation,
> redesigned board (toolbar, columns, cards, touch drag-and-drop), branding (logo, favicon), Teams/Epics, ticket and
> auth screens. Frontend only: no API, schema or business-rule changes. See §11a. Full suite: 431 tests (186 unit,
> 110 API, 135 e2e; 1 skipped by default).

---

## 1. Objective & mandatory scope (spec §0–§1, §13)

Build a small, working **Kanban-style ticket tracker** as a **three-tier SPA backed by an RDBMS**. Registered, verified
users organize tickets by team and move them through a fixed five-state workflow on a draggable board.

**Mandatory scope:** authentication (with email verification), teams, epics, tickets, comments, and a draggable
Kanban board.

### Definition of Done (§13), the acceptance checklist
- [x] A user can sign up, receive a verification email via the configured SMTP service, verify, and log in (M1,
  verified with Mailpit; a corporate SMTP relay is supported through `SMTP_*` env vars but not tested here).
- [x] Teams and epics can be managed through the UI and persist in the database (M2).
- [x] A verified user can create, view, edit, and delete tickets (M3).
- [x] A user can add comments and see their author and timestamp (M3).
- [x] The board shows tickets in the correct state columns for the selected team (M4).
- [x] Dragging a ticket to another column updates the server and stays correct after a page refresh (M4).
- [x] `docker compose up --build` from the repo root starts the whole solution from a clean checkout (verified in M0
  and again in M5 with a no-cache build of a fresh clone, Linux/WSL2 amd64). ARM64, native Windows and macOS: not
  verified.
- [x] No hard-coded user password or committed secret (M5: test-account password generated per run; only local
  development defaults, decision D1, are in `docker-compose.yml`/`.env.example`; keep verifying).
- [x] A fresh DB contains only the schema and migration metadata. No application data is preloaded (verified in M0
  and M5: all application tables empty, one `_prisma_migrations` row).
- [x] QA can create all test/demo data through the UI or API without editing DB records by hand (M5: every test,
  including the DoD journey `tests/e2e/dod-journey.spec.ts`, creates its own data through the UI or API).

## 2. Project decisions (approved; these add to the spec)

| # | Decision |
|---|----------|
| D1 | Compose works from a clean checkout **without a `.env` file**. It uses local-only default DB credentials; `.env.example` documents overrides. Never commit real secrets. |
| D2 | **Mailpit** is the default local SMTP server. SMTP is fully configurable through env vars so a corporate SMTP relay works. Don't invent the relay's host, port or credentials. |
| D3 | **Retired** (review M1, 2026-11-24). Was: login with correct credentials but an unverified email returns 403 `EMAIL_NOT_VERIFIED`. An unverified account now has no password (D12), so login returns the generic **401 `INVALID_CREDENTIALS`** like any wrong password or unknown email. The login page has a permanent "Resend it" link to `/resend-verification`. `EMAIL_NOT_VERIFIED` is no longer used anywhere. |
| D4 | Sessions last **7 days** (absolute). Cookie flags: `HttpOnly`, `Secure` (env `COOKIE_SECURE`, default true), `SameSite=Lax`. |
| D5 | Resend of the verification email is rate-limited to **once per 60 s per account**, based on the newest token's `createdAt`. |
| D6 | Public register and resend responses **never reveal whether an email is registered**. Both always return the same `202` body. |
| D7 | `modifiedAt` advances only on an actual change, for **tickets, teams and epics**. |
| D8 | A ticket body that is only whitespace counts as **empty** and is rejected. |
| D9 | The board epic filter includes a **"No epic"** option. |
| D10 | The application listens on **port 3000**. |
| D11 | **UUID** identifiers. A human-readable ticket number is optional, is not planned, and must not delay mandatory features. It would need a migration. |
| D12 | **The password is chosen during email verification** (review M1). Register takes `{email}` only (a `password` field is a 400). The account is created with `passwordHash = NULL`; `POST auth/verify-email {token, password}` sets it. DB CHECK `User_passwordHash_matches_verification`: `passwordHash` is NULL exactly while `emailVerifiedAt` is NULL. Nobody can pre-set the password of someone else's address. |
| D13 | **Rate limits on the public auth endpoints** (review M2), per client IP / per normalized email: register 10/h / 3/h; login 50/15 min / 10/15 min (the email counter resets on a successful login); verify-email 20/15 min / –; resend-verification 10/h / 3/h (D5 still applies on its own). 429 `RATE_LIMITED` + `Retry-After`. **Process-local**: not shared between instances, reset on restart. Do not change the limits without approval. |
| D14 | **`TRUST_PROXY` is disabled by default** (X-Forwarded-For ignored). Accepted: hop count 1–10, or a list of `loopback`, `uniquelocal`, IPs and CIDRs; `true` and `/0` ranges are rejected at startup. `docker-compose.yml` never sets or forwards it; only the test override `docker-compose.test.yml` sets `uniquelocal`. |
| D15 | Review fixes: UUIDs are accepted in any case and normalized to lower case (L1); `POST auth/logout` is public and always returns 204 with a clearing cookie (L3); health 503 uses the standard error body `{statusCode:503, message:"Database is unavailable", code:"DATABASE_UNAVAILABLE"}` (I4). |

## 3. Architecture (§2)

| Tier | Implementation |
|------|----------------|
| Presentation | React SPA (`apps/web`), built by Vite. Talks to the API only through `/api` on the same origin |
| Application / API | NestJS HTTP API (`apps/api`), all routes under `/api`. In production it also serves the compiled SPA |
| Persistence | PostgreSQL 17 container, accessed only through Prisma 7 from the API |

- One `app` container serves both the API and the SPA on port 3000 (spec §2 allows the backend to serve the SPA). The
  tiers stay separate in code: the SPA never touches the DB, and the API owns all business rules.
- Client-side routing: any non-`/api` GET without a file extension returns `index.html` (`apps/api/src/spa.ts`).
  Unknown `/api/*` routes return JSON 404s.
- Development: Vite on 5173 proxies `/api` to the API on 3000, so the browser still sees one origin.
- Cross-platform: Docker Compose is the only host requirement. `.gitattributes` forces LF line endings, and there are
  no shell entrypoint scripts.

## 4. Technology stack (versions pinned exactly in package.json)

| Area | Choice |
|------|--------|
| Runtime | Node.js 26 (`node:26.13.1-bookworm-slim` image), npm 11 workspaces (`apps/api`, `apps/web`) |
| Language | TypeScript 7.0.2 (strict; shared settings in `tsconfig.base.json`) |
| Backend | NestJS 12.4.2 (`@nestjs/common`, `core`, `platform-express`) on Express 5 |
| ORM | Prisma 7.10.1 (`prisma`, `@prisma/client`, `@prisma/adapter-pg` + `pg`) |
| Frontend | React 19.3.1, react-router 8.5.1, TanStack Query 5.107.1, Vite 8.3.7 |
| Auth / validation (M1) | `argon2` 0.45.2, `nodemailer` 10.6.1 (ships its own types; no `@types/nodemailer`), `class-validator` 0.15.1, `class-transformer` 0.5.1 |
| Drag and drop (M4) | `@dnd-kit/core` 6.3.1 only (no `sortable`/`utilities`: no manual ordering in a column) |
| DB / mail | PostgreSQL 17 (alpine), Mailpit v1.33.1 |
| Tests | Playwright 1.65.1 (`unit` project = pure modules, no server; `api` project = HTTP-only flows; `e2e` project = Chromium) |

### Build and toolchain facts (verified in M0, do not "fix")
- **TypeScript 7 ships only a native `tsc` and has no JS compiler API.** So `@nestjs/cli` is **not used**: the API is
  compiled with plain `tsc` (`apps/api/tsconfig.json`). TS 7 emits correct CommonJS and decorator metadata for Nest
  dependency injection. Don't add tools that need the TypeScript JS API (ts-jest, ts-node, nest CLI, typescript-eslint
  type-aware rules) without checking that they work with TS 7 first.
- The API is CommonJS (`apps/api/package.json` `"type": "commonjs"`). The root and web packages are ESM.
- Relative imports in the API use **`.ts` extensions** (`import { X } from "./x.ts"`), rewritten at emit by
  `rewriteRelativeImportExtensions`. This is required because the generated Prisma client uses `.ts` imports.
- The API needs `experimentalDecorators` and `emitDecoratorMetadata`. It doesn't use `verbatimModuleSyntax` or
  `isolatedModules`, because those break decorator metadata and CommonJS output.
- npm 11 blocks dependency install scripts by default. `allowScripts` in the root `package.json` allows only
  `prisma@7.10.1` and `@prisma/engines@7.10.1`, so the schema engine is downloaded at install and build time. `argon2`
  uses its bundled prebuilt binaries, so it needs no install script. When you upgrade Prisma, update these pins.

### Prisma 7 rules (do not break)
- The connection URL lives in `prisma.config.ts` (`env("DATABASE_URL")`), **never** in `schema.prisma`.
- Generator: `provider = "prisma-client"`, `output = "../apps/api/src/generated/prisma"`, `moduleFormat = "cjs"`.
  The output is git-ignored and regenerated by `npm run prisma:generate` (root `build` and `typecheck` run it too).
- Import from the generated client: `import { PrismaClient } from "../generated/prisma/client.ts"`. Enums come from
  `.../enums.ts`. **Never** import from `@prisma/client` directly.
- The client is created with a driver adapter in `PrismaService`:
  `super({ adapter: new PrismaPg({ connectionString }) })`.
- Change the schema only via `npm run db:migrate -- --name <change>` (`prisma migrate dev`). Never edit an applied
  migration. **Don't change models without approval.** The init migration `20261123122054_init` must be preserved.
- Containers run `prisma migrate deploy` on startup (Dockerfile `CMD`).

## 5. Project structure

```
.
├── CLAUDE.md  README.md  .env.example  .gitignore  .gitattributes  .dockerignore
├── Dockerfile                 # multi-stage: deps → build (prisma generate, vite build, tsc) → prod-deps → runtime
├── docker-compose.yml         # db (postgres:17-alpine) + mailpit + app
├── docker-compose.test.yml    # test-stack override: TRUST_PROXY=uniquelocal (D14); development machines only
├── package.json               # npm workspaces root: prisma CLI, dotenv, Playwright, scripts
├── tsconfig.base.json         # shared strict compiler options
├── tsconfig.json              # root type-check: playwright.config.ts, prisma.config.ts, tests/ (except tests/unit)
├── prisma.config.ts
├── prisma/schema.prisma, prisma/migrations/
├── playwright.config.ts
├── scripts/generate-favicon.mjs  # renders apps/web/public/favicon.svg into favicon.ico (Playwright Chromium)
├── tests/
│   ├── unit/                  # pure API/web modules (rate limiter, keys, log throttle, TRUST_PROXY, Retry-After,
│   │                          # errorMessage, error filter, theme, token contrast, validation, refs, favicon);
│   │                          # own tsconfig.json (imports CommonJS API sources), excluded from the root tsconfig
│   ├── api/                   # backend/API flows (Playwright request fixture); security.spec.ts = headers, 401 sweep,
│   │                          # cookie flags, session-token exposure; rate-limit.spec.ts = D13 limits
│   ├── e2e/                   # browser flows; dod-journey.spec.ts = whole Definition of Done in one UI test;
│   │                          # UI redesign specs: theme, layout, components, shared-styles, branding,
│   │                          # board-toolbar, board-columns (incl. touch), teams-page, epics-page, ticket-auth-styles
│   └── support/               # test.ts = `test`/`expect` with a unique X-Forwarded-For per test (import from here);
│                              # Mailpit reader, uniqueEmail/registerForToken/registerAndVerify/createLoggedInUser,
│                              # UI login and verifyAndSetPasswordViaUi; board.ts = drag helpers (mouse, keyboard,
│                              # touch via CDP)
└── apps/
    ├── api/                   # NestJS (CommonJS)
    │   └── src/
    │       ├── main.ts        # bootstrap: config, /api prefix, shutdown hooks, SPA serving
    │       ├── app.module.ts
    │       ├── spa.ts         # static SPA + index.html fallback
    │       ├── config/        # env loading/validation, APP_CONFIG provider, trust-proxy.ts (TRUST_PROXY parser)
    │       ├── prisma/        # PrismaModule (global), PrismaService
    │       ├── health/        # GET /api/health (public)
    │       ├── common/        # global AuthGuard + @Public/@CurrentUser, security headers + JSON-only (415) middleware,
    │       │                  # error filter ({statusCode, message, code?}), ValidationPipe factory, cookie reader,
    │       │                  # pickChanges (D7 no-op updates), Prisma error helpers, uuidPipe (lower-cases),
    │       │                  # trim/lowercaseUuid transforms; rate-limit/ = RateLimiter, keys (IP /64, email
    │       │                  # SHA-256), LogThrottle, RateLimitedException (429 + Retry-After)
    │       ├── auth/          # AuthController/Service, SessionService (cookie tt_session), AuthRateLimitService
    │       │                  # (D13 limits), DTOs, token hashing
    │       ├── mail/          # MailService (nodemailer, SMTP_* config)
    │       ├── teams/         # TeamsController/Service, DTO, TeamView (with ticket/epic counts)
    │       ├── epics/         # EpicsController/Service, DTOs, EpicView (with ticket count)
    │       ├── tickets/       # TicketsController/Service, DTOs, TicketView (epic, createdBy, commentCount)
    │       ├── comments/      # CommentsController/Service (tickets/:id/comments), DTO, CommentView
    │       └── generated/     # Prisma client (git-ignored)
    └── web/                   # React + Vite
        ├── index.html         # favicon links; blocking <script src="/theme-init.js"> before first paint
        ├── public/            # theme-init.js (applies <html data-theme>), favicon.svg (source), favicon.ico
        ├── vite.config.ts
        └── src/
            ├── main.tsx, router.tsx   # main.tsx imports styles/ in order: tokens, base, components, layout, pages,
            │                          # board; starts followSystemTheme()
            ├── styles/        # tokens.css (all colors, light on :root, dark on :root[data-theme="dark"]), base.css,
            │                  # components.css (forms, buttons, alerts, panels, tables, badges, chips), layout.css
            │                  # (top nav, auth card, page header), pages.css (Teams/Epics/ticket), board.css
            ├── api/           # apiFetch/postJson/patchJson/deleteJson client (ApiError with retryAfter,
            │                  # errorMessage), typed hooks (auth.ts, teams.ts, epics.ts,
            │                  # tickets.ts incl. useMoveTicket)
            ├── lib/           # format.ts (relative "modified" timestamps), board.ts (filters, grouping, sorting),
            │                  # retry.ts (Retry-After parsing, "Try again in …" text), theme.ts (theme state),
            │                  # validation.ts (field checks, ARIA props), refs.ts (ref merging, ref-callback cache)
            ├── components/    # Layout, AuthLayout, RequireAuth/RedirectIfAuthenticated, ResendVerification,
            │                  # TicketForm (create/edit), icons.tsx (inline SVG icons + BrandMark logo),
            │                  # layout/ (TopNav, ThemeToggle, AccountMenu),
            │                  # forms/ (useFieldError, useFocusAfterBusy),
            │                  # board/ (Board = DndContext, BoardColumn, TicketCard, BoardFilters)
            └── pages/         # Login, Signup, VerifyEmail (choose password), ResendVerification, Board (Kanban),
                               # Teams, Epics, NewTicket, Ticket (details + comments)
```

### Commands
```bash
docker compose up --build        # full stack: app :3000, Mailpit UI :8025
npm ci                           # install (host development)
npm run prisma:generate          # generate the client into apps/api/src/generated/prisma
npm run db:deploy                # apply migrations to DATABASE_URL (.env)
npm run db:migrate               # create/apply a new migration in development
npm run build                    # generate + build web + build api
npm run typecheck                # api + web + root (tests/config) + tests/unit
npm run dev:api:build / dev:api  # tsc --watch / node --watch (two terminals)
npm run dev:web                  # Vite on :5173, proxies /api → :3000
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build   # stack for the test suite (D14)
npm test | test:unit | test:api | test:e2e   # Playwright against BASE_URL (default http://localhost:3000)
node scripts/generate-favicon.mjs            # regenerate favicon.ico after changing favicon.svg
```

## 6. Database entities & relationships

All primary keys are UUIDs. Enums: `TicketType`, `TicketState`.

| Entity | Key fields | Spec |
|--------|-----------|------|
| **User** | `email` (unique, stored trimmed + lower-cased), `passwordHash?` (NULL until verified; CHECK: NULL ⇔ `emailVerifiedAt` NULL, D12), `emailVerifiedAt?`, `createdAt` | §3 |
| **Session** | `tokenHash` (unique), `userId`, `expiresAt`, `ipAddress?`, `userAgent?` | §3/§9, D4 |
| **EmailVerificationToken** | `tokenHash` (unique), `userId`, `expiresAt`, `usedAt?`, `createdAt` | §3, D5 |
| **Team** | `name`, `nameNormalized` (unique), `createdAt`, `modifiedAt` | §4 |
| **Epic** | `teamId`, `title`, `description?`, `createdAt`, `modifiedAt`; `@@unique([id, teamId])` | §5 |
| **Ticket** | `teamId`, `epicId?`, `type`, `state` (default `new`), `title`, `body`, `createdById`, `createdAt`, `modifiedAt` | §6 |
| **Comment** | `ticketId`, `authorId`, `body`, `createdAt` (immutable, so no `modifiedAt`) | §7 |

Relationships and delete behavior (already enforced by the schema):
- User 1—N Session, User 1—N EmailVerificationToken: Cascade.
- Team 1—N Epic, Team 1—N Ticket: **Restrict**. Deleting a team with epics or tickets returns **409**.
- Epic 1—N Ticket (optional): composite FK `(epicId, teamId) → Epic(id, teamId)`, **Restrict**. The DB enforces
  "epic belongs to the ticket's team". Deleting an epic that tickets reference returns **409**.
- User 1—N Ticket (`TicketCreator`): Restrict. User 1—N Comment (author): Restrict.
- Ticket 1—N Comment: **Cascade**. Deleting a ticket deletes its comments.

There's no assignee, user display name, or team membership. Team membership is out of scope (§4, §12). In the UI,
show users by **email**.

## 7. Ticket types & states (§6, §8)

**Types:** `bug`, `feature`, `fix`. These are labels only, with no type-specific behavior.

| State (API value) | UI label |
|-------------------|----------|
| `new` | New |
| `ready_for_implementation` | Ready for implementation |
| `in_progress` | In progress |
| `ready_for_acceptance` | Ready for acceptance |
| `done` | Done |

New tickets default to `new`. **Any state → any state** is allowed, and `done` is not terminal. The workflow is
fixed: no custom states or types.

## 8. Authentication & email verification (§3, §9, D2, D4–D6, D12–D15)

- **Register** (`POST /api/auth/register {email}`, D12):
  - Email only, trimmed and lower-cased before storing and comparing. A `password` field is rejected (400,
    whitelist validation).
  - Always responds `202` with the same generic body (D6). If the email already exists, nothing changes and no email
    is sent.
  - A new account is created with `passwordHash = NULL` and a verification token, and the email is sent through SMTP.
- **Verification sets the password** (`POST /api/auth/verify-email {token, password}`, D12):
  - Token: 32 random bytes; only the SHA-256 hash is stored. Single-use (`usedAt`) and expires after **24 h**.
  - Link: `${APP_BASE_URL}/verify-email?token=…`. This is the only token ever allowed in a URL. The SPA reads the
    token once, keeps it in memory and removes it from the address bar, then asks for the password and its
    confirmation ("Choose your password") and POSTs both.
  - The DTO validates the password first (8–256, never trimmed): an invalid password is a 400 and does not use the
    token.
  - `AuthService.verifyEmail`: (1) look the token up without locks; unknown, used or expired → 400
    `INVALID_OR_EXPIRED_TOKEN` before any Argon2 work; (2) hash the password with Argon2id **outside** the
    transaction; (3) in one transaction: lock the User row (`SELECT … FOR UPDATE`, the same lock order as resend, so
    the two serialize instead of deadlocking), consume the token with a conditional UPDATE that re-checks `usedAt` and
    expiry against database time read after the lock (`clock_timestamp() AT TIME ZONE 'UTC'`), then set
    `passwordHash` and `emailVerifiedAt` (= the token's `usedAt`) together. Any failure rolls all of it back. Of
    concurrent requests with one token, exactly one succeeds.
  - On success the screen offers "Continue to login" (no automatic login, no cookie). On an invalid or expired link
    it shows "Verification failed" and the resend form; any other error (validation, 429, network) keeps the form,
    since the link was not used.
- **Resend** (`POST /api/auth/resend-verification {email}`):
  - Always returns the same `202` (D6).
  - Silently does nothing for unknown emails, already-verified accounts, or when called within 60 s of the newest
    token (D5).
  - Otherwise it deletes the user's earlier unused tokens, issues a new one, and sends it.
- **Login** (`POST /api/auth/login`):
  - Wrong password, unknown email and unverified account (no password yet) all get the same `401
    INVALID_CREDENTIALS`, after an Argon2 check (a dummy hash when there is no stored one) so the timing matches.
    D3 (403) is retired; the login page has a permanent "Resend it" link to `/resend-verification`.
  - Success: creates a `Session` (random token, hash stored, `expiresAt` = now + 7 days) and sets the cookie (D4).
- **Logout** (`POST /api/auth/logout`, public, D15) deletes the session matching the cookie's token hash if there is
  one (valid, expired or unknown alike) and always clears the cookie: `204` in every case. Still JSON-only (415).
  **`GET /api/auth/me`** returns the current user.
- **Guard:** a global auth guard covers every route except those marked `@Public()`: register, verify-email,
  resend-verification, login, logout and health. Expired sessions are rejected (and deleted). Static SPA assets are
  public. `tests/api/security.spec.ts` checks the public/protected route lists against the controllers.
- **CSRF:** `SameSite=Lax` cookie, and **every** state-changing method (`POST`, `PUT`, `PATCH`, `DELETE`) must send
  `Content-Type: application/json`, even without a body; otherwise **415** (`code: "UNSUPPORTED_MEDIA_TYPE"`).
  `apiFetch` sets the header automatically for non-GET requests.
- **Password:** 8–256 characters, never trimmed or modified; chosen on the verification page (D12).
- Registering an existing (even unverified) email changes nothing and sends no email; the user must use resend.
- Implementation notes: the session cookie is `tt_session`. Verification and resend emails are sent after the DB
  transaction commits and are not awaited (failures are logged), so SMTP problems never fail the request or reveal
  account state. Resend locks the user row (`SELECT … FOR UPDATE`) so concurrent requests respect the 60 s limit.
- Security headers (M5): `securityHeadersMiddleware` is registered first in `main.ts`, so every response (API, errors,
  SPA files, `index.html`) carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin` and
  `Content-Security-Policy: frame-ancestors 'none'`. The CSP intentionally restricts framing only; don't widen it
  without checking the SPA still loads.
- Session tokens are accepted only from the `tt_session` cookie (never from a query parameter or `Authorization`
  header) and never appear in a URL or response body; `tests/api/security.spec.ts` enforces this.
- Error codes in use: `VALIDATION_ERROR` (400, also malformed UUIDs), `INVALID_OR_EXPIRED_TOKEN` (400),
  `INVALID_CREDENTIALS` (401), `TEAM_NOT_FOUND` / `EPIC_NOT_FOUND` (404, also for a
  well-formed `teamId` in a body or query that matches no team), `TICKET_NOT_FOUND` (404), `INVALID_EPIC` (400),
  `TEAM_NAME_TAKEN` / `TEAM_IN_USE` / `EPIC_IN_USE` (409), `UNSUPPORTED_MEDIA_TYPE` (415), `RATE_LIMITED` (429),
  `DATABASE_UNAVAILABLE` (503, health). `EMAIL_NOT_VERIFIED` (403) is no longer used (D3 retired).
- **Rate limiting** (D13, D14; `AuthRateLimitService`, core in `common/rate-limit/`):
  - Counted at the start of the four public auth handlers: after the global ValidationPipe (400s are not counted;
    the email is already normalized) and before any database or Argon2 work. The IP bucket is checked first; a
    request it blocks does not touch the email bucket.
  - Keys: `<policy>:ip:<normalizeClientIp(req.ip)>` (IPv4-mapped IPv6 → IPv4, other IPv6 → /64, unparsable →
    `unknown`) and `<policy>:email:<SHA-256 of the normalized email>`. The decision never depends on whether the
    account exists.
  - `RateLimiter`: fixed windows in a `Map`, at most 100,000 keys (oldest evicted first, O(1)), an `unref`'d sweep of
    expired windows every 60 s, disposed on module shutdown. Blocked requests are not counted. **Process-local**.
  - 429 body `{statusCode:429, message:"Too many requests. Try again in N seconds." ("1 second" for N = 1),
    code:"RATE_LIMITED"}` plus `Retry-After: N` (set by `HttpExceptionFilter`). The SPA shows "Too many attempts. Try
    again in …" (`errorMessage()` in `api/client.ts`, `lib/retry.ts`; whole minutes from 60 s; `Retry-After` HTTP
    dates are accepted only if they round-trip exactly through `toUTCString()`).
  - Logging (`LogThrottle`): one warning per policy + bucket per rule window ("Rate limit reached: login (email
    bucket); further blocks of this kind are not logged for 15 min"); every blocked request still gets its 429. Never
    log an email, IP, hash, key, password or token.
  - `req.ip` honours `TRUST_PROXY` (D14, `config/trust-proxy.ts`, applied in `main.ts` only when set; the startup log
    states it).
- There are no roles or ownership. All verified users can view and manage everything (§4).

## 9. Business validation rules (always enforced server-side, §6)

**Teams (§4)**
- Name is required and non-empty after trimming; store it trimmed.
- `nameNormalized = lower(trim(name))` must be unique. A duplicate returns **409**.
- The list shows the ticket count, epic count, and modified time.
- Delete is blocked while the team has tickets or epics: return **409**, and the UI disables Delete and shows a
  message. No cascading deletion.
- `modifiedAt` advances only on an actual change (D7).

**Epics (§5)**
- Belongs to one team, set at creation and **immutable**. PATCH rejects `teamId`.
- Title is required and non-empty after trimming. Description is optional; it is trimmed and a blank value is stored
  as `null` (PATCH with `null` or `""` clears it).
- Delete is blocked while tickets reference the epic: return **409**, and the UI disables Delete and shows a message.
- `modifiedAt` advances only on an actual change (D7).
- M2 implementation notes: deletes check `_count` first (409 with a clear message) and treat a foreign-key violation
  (P2003) as 409 too, for races. Lists: teams by `nameNormalized`, epics by title (case-insensitive);
  `GET epics` requires `teamId`. The 409s caused by tickets and the `ticketCount` values are tested in
  `tests/api/tickets.spec.ts` (M3). Delete buttons in the UI ask for a browser confirmation.

**Tickets (§6)**
- Team must exist. `type` and `state` must be valid enum values; otherwise return **400**.
- `epicId` is null or an epic of the **same team**. The service validates this and returns **400**; the composite FK
  is the backstop.
- Title is required and non-empty after trimming. Body is required and **non-empty after trimming** (D8). No maximum
  lengths.
- `createdById` comes from the session and is never accepted from the client. `createdAt` and `modifiedAt` are set by
  the server in UTC.
- **`modifiedAt` advances only on actual changes to fields or state** (D7). Adding a comment never changes it.
  ⚠️ Prisma's `@updatedAt` sets the timestamp on *every* `update` call. Compare the incoming values with the stored row
  and skip the update when nothing changed. Use one shared helper for tickets, teams and epics.
- When the team changes, the UI clears the epic, and the backend rejects a mismatched epic.
- Delete requires an explicit confirmation in the UI. Comments are deleted with the ticket.
- M3 decisions and implementation notes:
  - A nonexistent epic, or one of another team, returns **400 `INVALID_EPIC`**. A nonexistent team returns
    **404 `TEAM_NOT_FOUND`**.
  - Changing the team while keeping an epic of the old team (implicitly or explicitly) returns 400 `INVALID_EPIC`;
    the backend never clears the epic silently. The ticket form clears the epic whenever the team changes and only
    lists the selected team's epics.
  - Title, body and comment body are stored **trimmed**; empty or whitespace-only values are rejected.
  - `POST /tickets` accepts an optional `state` (default `new`); the create form does not show it.
  - `PATCH` writes only fields that differ (`pickChanges`); the edit form also sends only changed fields.
  - Comments are written with `prisma.comment.create`, never through a nested `ticket.update`, so the ticket's
    `@updatedAt` is never touched by a comment.
  - Foreign key violations after the checks (concurrent deletes) are mapped to 404/400, never 500.

**Comments (§7):** body is required and non-empty. Author and `createdAt` are set by the server. Listed oldest first.
**Immutable**: no update or delete endpoints.

## 10. API (§9)

| Area | Endpoints (prefix `/api`) |
|---|---|
| Health (public) | `GET health` → `{status:"ok", database:"up"}`, or `503 {statusCode, message, code:"DATABASE_UNAVAILABLE"}` |
| Auth (public) | `POST auth/register {email}`, `POST auth/verify-email {token, password}`, `POST auth/resend-verification {email}`, `POST auth/login`, `POST auth/logout` (rate limits: D13) |
| Auth (session) | `GET auth/me` |
| Teams | `GET/POST teams`, `PATCH/DELETE teams/:id` |
| Epics | `GET epics?teamId=`, `POST epics`, `GET/PATCH/DELETE epics/:id` |
| Tickets | `GET tickets?teamId=` (sorted `modifiedAt desc`), `POST tickets`, `GET/PATCH/DELETE tickets/:id` (drag-and-drop = `PATCH {state}`) |
| Comments | `GET/POST tickets/:id/comments` |

- JSON in and out. Errors use the form `{statusCode, message, code?}`.
- Status codes:
  - `400`: validation (malformed UUIDs and malformed JSON too)
  - `401`: not authenticated, or bad credentials (also for an unverified account, D3 retired)
  - `404`: not found
  - `409`: conflict (team/epic still in use, duplicate team name)
  - `415`: a state-changing request without `Content-Type: application/json`
  - `429`: rate limit reached on a public auth endpoint (D13), with `Retry-After`
  - `503`: health check with the database unreachable
  - Never `409` for a duplicate email (D6). `403` is no longer used.
- Timestamps are **ISO-8601 UTC** strings. Last write wins; there's no concurrency control.
- All writes go through the API into PostgreSQL. Browser storage is never the system of record.
- **No seed data**, ever. There is no seed script, and no default path loads sample data (§9, §13).

## 11. Kanban board & screens (§8, §10, §15)

- The board shows one team (team selector) with **five columns** in workflow order. Cards show the title and type, and
  also the epic and relative modified time.
- Within a column, cards are ordered by `modifiedAt` **descending**. No manual ordering.
- **dnd-kit** drag-and-drop to any column calls `PATCH {state}` straight away. **On failure the card goes back to its
  column and an error is shown** (TanStack Query optimistic update with rollback).
- Filters: type, epic (**including "No epic"**, D9), and case-insensitive title substring search, combined with AND.
  They run in the browser. Also: a Clear action, New ticket, and opening a card shows the ticket.
- Must stay usable with at least **100 tickets** per board.
- Screens: sign-up (email only), verification (choose password, then result), resend verification
  (`/resend-verification`, linked from the login page), login, board, ticket create/edit/details (with comments),
  team management, epic management. The header has nav (Board / Teams / Epics) and a user menu with **Log out**.
- Every screen shows loading, empty, success, and error states.
- M4 implementation notes (no backend or schema changes were needed):
  - Columns come from `TICKET_STATES` (`api/tickets.ts`); droppable id = state value, test ids `column-<state>`
    and `ticket-card`. There is no transition table anywhere: any state → any state.
  - `useDraggable` on the whole card. Sensors (`components/board/Board.tsx`): a `PointerSensor` subclass that
    ignores touch pointers (mouse and pen: 5 px activation distance, so clicking the title link still opens the
    ticket; the link has `draggable={false}`); `TouchSensor` with a 200 ms press-and-hold delay and 5 px tolerance
    (an earlier move cancels the pick-up, so swipes scroll; cards use `touch-action: manipulation`); `KeyboardSensor`:
    Space picks up, ←/→ jump one column (the target column is tracked in a ref, not read from `context.over`, which
    lags a render), Space drops, Esc cancels. Collision: `pointerWithin`, falling back to `rectIntersection`.
    `DragOverlay` (position: fixed) draws the moving card: no `transform`, `filter` or `contain` on any ancestor of
    the board. Dropping on the card's own column sends no request.
  - `useMoveTicket`: optimistic `{state, modifiedAt: now}` in the team's cached list; on any error only **that
    ticket's** previous `state`/`modifiedAt` are restored (never a whole-list snapshot, which would undo concurrent
    moves); the list is refetched only when no other move is pending (`isMutating === 1` in `onSettled`). A card
    whose move is pending is disabled (`aria-busy`). Errors show a dismissible alert (`data-testid="move-error"`).
  - Columns are re-sorted on the client with the API's order (`modifiedAt desc, createdAt desc, id asc`).
  - URL: `teamId`, `type`, `epic` (`none` = No epic), `q`. Team changes push a history entry and drop `epic`;
    filter changes use `replace`. A missing/unknown `teamId` falls back to the first team (URL rewritten with
    `replace`); an `epic` that is not one of the team's epics is dropped.
  - 100+ tickets: one request per board, `useMemo` grouping, memoized cards and columns, columns scroll on their own,
    no virtualization (stretch). With 120 tickets the board renders in about 0.1–0.3 s in the e2e test.
  - Test helpers in `tests/support/board.ts` (`dragCardToColumn`, `moveCardWithKeyboard`, `sessionCookie`, …). The
    keyboard helper flushes one page task after pick-up because dnd-kit attaches its keydown listener in a
    `setTimeout`, which synthetic input can outrun.

## 11a. UI design system & theme (UI redesign)

- **Tokens:** every color is a CSS custom property in `styles/tokens.css` (light on `:root`, dark on
  `:root[data-theme="dark"]`); other files use only `var(--…)`. Palette accent: light `#635BDB`, dark `#9189FF`.
  `tests/unit/contrast.spec.ts` checks WCAG AA (text 4.5:1, UI 3:1) for the token pairs; add a pair when you add a
  token combination.
- **Theme:** Light/Dark only. `public/theme-init.js` (blocking, in `<head>`) sets `<html data-theme>` before the first
  paint: a saved choice in `localStorage["tt-theme"]` wins, otherwise the OS setting. `lib/theme.ts` (`useTheme`,
  `toggleTheme`, `followSystemTheme`) keeps following the OS until the user chooses. The toggle (`ThemeToggle`, a
  button with the fixed name "Dark theme" and `aria-pressed`) is in the top nav and on the auth screens.
- **Layout:** compact top nav (`components/layout/TopNav.tsx`; logo `BrandMark`, Board/Teams/Epics with
  `aria-current`, theme toggle, `AccountMenu` = native `<details>` with the email and Log out). No sidebar. Board,
  Teams and Epics keep a visually hidden `h1`; the ticket page shows the title as a visible `h1`.
- **Components** (`styles/components.css`): `.button` + `-secondary`/`-ghost`/`-danger`/`-danger-subtle`/`-small`,
  `.field` (+ `[aria-invalid]` and `.field-error`), `.alert-*`, `.panel`, `.table` (+ `.table-scroll` wrapper),
  `.badge-<type>`, `.chip-state[data-state]`. Icons are inline SVG in `components/icons.tsx` (`aria-hidden`).
- **Forms:** `useFieldError` (client-side checks → message after the field's `<label>`, `aria-invalid`,
  `aria-describedby`, focus after commit; server errors stay one form-level alert) and `useFocusAfterBusy` (focus
  back on a button that was disabled during its request) are used on Teams and Epics. Ticket and auth forms keep
  their single form-level alerts.
- **Board toolbar:** the "Board filters" search region (Team, search, Type, Epic, Clear, count), then New ticket
  outside it. DOM order = visual order at every width (responsive layout is CSS only).
- **Branding:** `BrandMark` (ticket stub with three columns) and `public/favicon.svg` share the geometry
  (`tests/unit/favicon.spec.ts`); `favicon.ico` is generated by `scripts/generate-favicon.mjs`.

## 12. Docker, testing & non-functional requirements (§2, §11, §13)

**`docker compose up --build` flow** (verified from a clean checkout in M0):
1. Compose uses local defaults for every variable; `.env` overrides them if present.
2. The app image is built in stages: `npm ci`, then `prisma generate` + `vite build` + `tsc`, then production
   dependencies, then a slim runtime image that runs as the non-root `node` user.
3. `db` (healthcheck `pg_isready`) and `mailpit` start, then `app` starts once `db` is healthy.
4. The app runs `prisma migrate deploy`, then `node apps/api/dist/main.js` on port 3000, with a healthcheck on
   `/api/health`.
5. App: http://localhost:3000. Mailpit inbox: http://localhost:8025. DB and Mailpit ports are bound to 127.0.0.1.
6. Data persists in the `postgres_data` volume. `docker compose down -v` resets it to an empty database.

**Testing**
- Playwright project `unit` tests pure modules without a server (`tests/unit`, own `tsconfig.json`). Project `api`
  runs backend business flows over HTTP. Project `e2e` runs browser flows.
- API and e2e tests run against a running stack (`BASE_URL`, default `http://localhost:3000`) that **must be started
  with the test override**: `docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build`. It sets
  `TRUST_PROXY=uniquelocal`, and every test sends its own `X-Forwarded-For` (a random /64 in `2001:db8::/32`), so the
  per-IP rate limits (D13) never leak between tests or runs. On the default stack all requests share one address and
  a full run gets 429s. Use the override only on development machines (it trusts any private-network client).
- **Every API/e2e spec imports `test` and `expect` from `tests/support/test.ts`**, not from `@playwright/test`.
  Contexts created with `playwright.request.newContext()` don't get the header; pass `X-Forwarded-For` yourself if
  such a context calls a rate-limited endpoint.
- Tests create their own uniquely named data and never depend on seeded data. Email flows read Mailpit's HTTP API
  (`MAILPIT_URL`, default `http://localhost:8025/api/v1/...`).
- API tests send the session cookie explicitly (`createLoggedInUser` returns it) instead of relying on the request
  context's cookie jar. In e2e tests, don't log in through `page.request` before using the login screen (it shares the
  browser's cookies); use `loginAsNewUser(page)` from `tests/support/ui.ts`.
- After each milestone: `npm run typecheck`, `npm run build`, the test-stack command above, then `npm test`. Report
  failures; never skip them silently (and don't filter test output in a way that hides failure lines).
- Current counts: 431 tests = 186 unit + 110 API + 135 e2e. One API test (503 health body) is skipped unless
  `DB_DOWN_BASE_URL` points to an app instance whose database is unreachable.
- UI redesign testing notes: touch drag-and-drop is emulated through the Chromium DevTools protocol
  (`tests/support/board.ts`, `finger()`; Chromium only, `hasTouch: true`). Specs that only need their own teams
  filter the `GET /api/teams` response in the browser so a large test database does not slow them down.
- M5 testing notes:
  - Test accounts use `TEST_PASSWORD` from `tests/support/auth.ts`, generated once per run in `playwright.config.ts`
    (`TT_TEST_PASSWORD`, random). Never add a fixed password; never log it.
  - Tests that need *no* session use a separate `playwright.request.newContext()`: the shared `request` fixture keeps
    cookies from login responses and would send them along.
  - On the board, dnd-kit renders its own `role="status"` live region. Filter `getByRole("status")` by text there.
  - Run full suites against a **fresh database**. A long-lived local DB with thousands of teams makes Playwright's
    role/label lookups slow enough to hit the 5 s timeout; this is not an app defect. A side-by-side isolated stack
    needs a Compose override that removes `container_name`, remaps the ports and gives the app image its own tag.
  - After `docker compose up -d --build`, check that the running container uses the new image
    (`docker inspect -f '{{.Image}}' ticketing-app`); if not, `docker compose up -d --no-deps --force-recreate app`.
  - Firefox is not in the default projects; it was validated with a temporary config that imports
    `playwright.config.ts` and swaps in `devices["Desktop Firefox"]` (33/33 e2e in M5; not re-run after the security
    remediation or the UI redesign).
- Security-remediation testing notes:
  - Registration in tests: `registerForToken()` (email only) and `registerAndVerify(request, email, password)`, which
    sets the password at verification; in the UI, `verifyAndSetPasswordViaUi()`.
  - Rate-limit tests (`tests/api/rate-limit.spec.ts`) use fresh addresses from `uniqueClientIp()` per request group.
    Every registration, including the one that creates an account, counts against that email's 3/hour.
  - E2E 429 tests mostly mock the response with `page.route(..., { times: 1 })` so they don't use up real limits.

**Other non-functional requirements:** protect endpoints, hash passwords, validate input, and keep secrets out of
git. Target current desktop Chrome, Edge and Firefox. Keep the README up to date.

## 13. Out of scope (do NOT implement) (§12)

- Scrum: sprints, backlogs, story points, velocity, burndown charts, sprint planning
- SSO, OAuth, corporate identity integration, social login
- Fine-grained roles, administrators, team membership, private teams, per-ticket access control
- File attachments, notifications, mentions, watchers, audit history, real-time multi-user updates
- Custom workflows, custom ticket types, subtasks, dependencies, time tracking, reporting dashboards
- Production deployment, high availability, production-grade mail infrastructure
- Seed or sample application data

**Stretch features (§14). Only with explicit approval:** password reset, editing or deleting your own comments,
ticket activity history, virtualized board rendering, human-readable ticket numbers (D11).

## 14. Milestones

| # | Milestone | Status |
|---|-----------|--------|
| M0 | Foundation: workspaces, Nest + Vite skeletons, Prisma wiring, health, Docker (db + mailpit + app), migrations on startup, smoke tests | **Done** |
| M1 | Authentication: register, verify, resend, login (403 unverified; later retired, see D3), logout, me, guard, Mailpit; auth screens | **Done** |
| M2 | Teams + Epics: API (409 rules, no-op `modifiedAt`), management screens | **Done** |
| M3 | Tickets + Comments: API, detail/create/edit screen, interim ticket list on the Board route | **Done** |
| M4 | Kanban board: dnd-kit with rollback, filters including "No epic", 100-ticket usability | **Done** |
| M5 | Hardening: UX states, README, Definition of Done walkthrough, clean-clone test on all platforms | **Done** on Linux/WSL2 amd64; ARM64, native Windows/macOS and a real corporate SMTP relay not verified |
| — | Security remediation after the backend review: L1, I4, L3, M1 (password at verification), M2 (rate limits) | **Done** |
| — | UI redesign: tokens/themes, navigation, board, branding, Teams/Epics, ticket and auth screens | **Done** |

Work one milestone at a time. Stop and report after each one, and wait for approval before the next.

## 15. Working rules for contributors & agents

- Follow the spec and the decisions in §2 strictly. No features beyond them.
- **Never commit secrets** or private documents. `.env`/`.env.*` are ignored; `.env.example` holds
  placeholders only.
- Preserve the Prisma 7 setup (§4) and the existing migration. Don't change models without approval.
- Pin exact dependency versions, and keep `package-lock.json` in sync (`npm install` from the root).
- Don't overwrite working configuration without a reason, and report every change to it.
- `.agents/`, `.cursor/`, `.devin/` are generated by `prisma skills sync` (postinstall) and are git-ignored.
