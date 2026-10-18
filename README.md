# MCPedia

> A content-first knowledge base — readable as Markdown in Git, queryable by humans via a modern Web UI, and accessible to AI agents via the Model Context Protocol (MCP).

MCPedia keeps content as plain Markdown files under `content/` as a Git-tracked source of truth. Content is indexed into PostgreSQL (with a weighted `tsvector` full-text search column and chunked embeddings) and served through a unified **Core** layer that every interface (Web, MCP, API, Worker, CLI) shares.

---

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Web UI      │    │   MCP Server    │    │  oRPC / Hono    │    │  BullMQ Worker  │
│  (Vite SPA)     │    │  (Stdio + HTTP) │    │   API (:4020)   │    │ (Async Queue)   │
└────────┬────────┘    └────────┬────────┘    └────────┬────────┘    └────────┬────────┘
         │                      │                      │                      │
         └──────────────────────┴──────────┬───────────┴──────────────────────┘
                                           ▼
                              ┌─────────────────────────┐
                              │     @mcpedia/core       │
                              │ (Unified Business Logic)│
                              └────────────┬────────────┘
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         ▼                                 ▼                                 ▼
┌──────────────────┐             ┌──────────────────┐             ┌──────────────────┐
│ Markdown Files   │             │   @mcpedia/db    │             │ @mcpedia/search  │
│ (content/ tree)  │             │  (PostgreSQL)    │             │ (FTS + Cosine)   │
└──────────────────┘             └──────────────────┘             └──────────────────┘
```

### Core Principles

1. **The database is the source of truth**: PostgreSQL holds each document's body and metadata, its revisions, and its search index. The `.md` files under `content/` are auto-generated *backups* — write documents through the MCP tools, never by editing files.
2. **Single Core Layer**: All business logic (CRUD, indexing, search, revisions, path classification) is encapsulated in `@mcpedia/core`. Interfaces never touch the database directly.
3. **Multi-Modal Search**: Keyword search, semantic search, and hybrid search (Reciprocal Rank Fusion / RRF) work out of the box, all served through a hindsight bank.
4. **Resilient Revision System**: Content edits snapshot revisions automatically; metadata-only edits are deduplicated. Restoring a revision automatically rebuilds semantic search chunks.
5. **Dual Interface**: The web UI presents itself purely as a wiki; machines reach the same corpus over MCP (`:4021`) and the oRPC API.

---

## Monorepo Layout

```
mcpedia/
├── apps/
│   ├── web/          # Vite SPA (:4016) — dark-mode UI, hierarchical doc tree, TOC, CRUD, exports
│   ├── mcp/          # MCP server (stdio + Streamable HTTP on :4021) — 18 tools + 4 resources
│   ├── mcp-client/   # Interactive MCP CLI REPL, one-shot command runner, and TypeScript client SDK
│   ├── api/          # Hono + oRPC API on :4020, git-sync webhooks, Prometheus metrics
│   └── worker/       # Long-running BullMQ worker for async indexing jobs
├── packages/
│   ├── core/         # Domain + use cases + infrastructure: the business logic (the only DB writer)
│   ├── db/           # Drizzle ORM schema, client, and migration journal
│   ├── parser/       # Frontmatter parsing & stringification with dynamic field support
│   ├── queue/        # Redis (ioredis) client & BullMQ queue/worker definitions
│   ├── types/        # Shared TypeScript domain types and interfaces
│   └── config/       # Authoritative environment configuration loader (.env)
├── content/          # Auto-generated .md BACKUPS of the database (gitignored, not source)
├── infra/
│   ├── docker/       # One Dockerfile per service + the web image's nginx config
│   └── systemd/      # Unit definitions and their launchers
├── docs/
│   ├── plans/        # Design history: redesign specs, migration plans, rationale
│   └── archive/      # Superseded runbooks
└── scripts/          # deploy-direct.sh, build-bundles.mjs, indexers, drift check
```

---

## Key Features

### 1. Multi-Modal Search

All three modes are served by a **hindsight** bank: hindsight chunks and embeds on its own side, so the repo no longer carries a chunker, an embedding provider, or a cosine comparator. The old Postgres `tsvector` + GIN path and the local `EMBED_*` provider were both deleted with it.

| Search Mode | Mechanism | Best Used For |
|---|---|---|
| **Keyword Search** | hindsight's keyword index over retained facts | Exact terms, code symbols, error codes, identifiers |
| **Semantic Search** | hindsight's embedding index, ranked by its own similarity score | Conceptual questions, paraphrased queries, intent matching |
| **Hybrid Search** | Reciprocal Rank Fusion ($RRF = \sum \frac{1}{k + rank}$) fusing the two signals | General-purpose search with optimal relevance |
| **Reflect** | Synthesis across the whole corpus, over consolidated observations | "What does this corpus know about X?", cross-document reasoning |

### 2. Hierarchical Folder Navigation

MCPedia supports nested folder structures (like GitHub repositories):
- **Dynamic Path Classification**: The router inspects paths and automatically distinguishes between leaf documents and folder nodes containing subfolders or child documents.
- **Folder Index Pages**: Navigating to any folder (e.g. `/ctf/defcon-quals-2024`) renders subfolders and documents within that path.
- **Collapsible Sidebar**: Hierarchical navigation tree reflecting the on-disk directory structure.
- **Section Indexes**: Dedicated overview pages for each section (`/docs`, `/ctf`, `/notes`).

### 3. Dynamic Custom Fields

Content frontmatter supports arbitrary custom key-value pairs without schema modifications:
- **Automatic Storage**: Custom fields are persisted into a JSONB `extra_fields` column in PostgreSQL.
- **Type Preservation**: Numbers, booleans, arrays, objects, and strings maintain native types across parser, database, and API.
- **Value-Aware UI Badges**: The Web UI automatically styles badges based on value types and semantic patterns (difficulty levels, categories, tags, status) rather than hardcoded field names.

### 4. Revision History & Rollback

- **Smart Snapshotting**: Whenever a document body changes, a revision snapshot is created in `document_revisions`.
- **Deduplication**: Metadata-only updates do not produce duplicate body snapshots.
- **One-Click Restore**: Restoring any past revision writes the historic content back to disk and database, and automatically triggers semantic chunk re-indexing to ensure search consistency.

---

## Model Context Protocol (MCP)

MCPedia runs an MCP server accessible via **Stdio** (for local subagents) and **Streamable HTTP** (for remote agents over the network at `:4021`).

### MCP Tools (18 Total)

The web UI no longer advertises this count or the protocol at all — it presents
itself as a plain wiki (see `apps/web/src/lib/site.ts`). The figure below is for
the README only; `apps/mcp/src/index.ts` is the authoritative list.

#### Read Tools (Public)
| Tool | Description |
|---|---|
| `search_documents` | Keyword-weighted search across the knowledge base |
| `semantic_search` | Embedding search for conceptual or paraphrased queries |
| `hybrid_search` | Fused keyword and semantic search via Reciprocal Rank Fusion |
| `reflect` | Synthesises an answer across the whole corpus |
| `get_document` | Fetches the full Markdown body of a document by slug |
| `list_documents` | Lists documents, optionally filtered by section or status |
| `list_sections` | Lists active sections with their document counts |
| `list_section_registry` | The full registry: label, icon, description, order, hidden |
| `get_related_documents` | Finds documents sharing tags with a given slug |
| `queue_status` | Returns current BullMQ indexing queue metrics |

#### Mutating & Admin Tools (Requires `x-webhook-secret`)
| Tool | Description |
|---|---|
| `create_document` | Creates a document (Postgres row, revision, index entry, disk backup) |
| `update_document` | Updates an existing document's body, metadata, or dynamic custom fields |
| `delete_document` | Removes a document's row, revisions, index entries and backup file |
| `index_document` | Enqueues a single-document background reindex job |
| `reindex_all` | Enqueues a full-corpus background reindexing job |
| `restore_revision` | Restores a document to a specific revision and rebuilds its index entry |
| `upsert_section` | Registers a section or updates one that exists |
| `delete_section` | Unregisters a section (removes its registry row) |

### MCP Resources

| Resource URI | Description | MIME Type |
|---|---|---|
| `mcpedia://docs` | List of all published documents in the knowledge base | `application/json` |
| `mcpedia://docs/{+slug}` | Full Markdown body of a single document | `text/markdown` |
| `mcpedia://docs/{+slug}/facts` | The facts hindsight retained for a document | `application/json` |
| `mcpedia://docs/{+slug}/revisions` | Summary of revision history for a document | `application/json` |

The `/chunks` resource was removed with the local embedding stack: it served a
preview of the chunks *this repo* computed, and hindsight now owns chunking. The
`/facts` resource exposes what hindsight actually retained instead. Template
ordering matters — `/facts` and `/revisions` are registered before `{+slug}`,
which would otherwise swallow them.

---

## HTTP, oRPC & Webhook Endpoints

The API application (`apps/api`) runs on **:4020** with Hono and **oRPC** (not
tRPC — the router was ported so the SPA can share types through a contract-free
`os.router` composition).

The RPC surface is 21 procedures. **Both `/rpc` and `/trpc` are mounted** and
resolve to the same handlers: `/rpc` is the current name the SPA uses, and
`/trpc` is retained because the production Caddyfile still proxies `/trpc/*` to
:4020.

| Router | Procedures |
|---|---|
| `auth` | `me` |
| `health` | `ping` |
| `search` | `keyword`, `semantic`, `hybrid` |
| `documents` | `get`, `list`, `sections`, `sectionsRegistry`, `related`, `folderInfo`, `export`, `create`*, `update`*, `remove`*, `upsertSection`*, `removeSection`* |
| `revisions` | `list`, `get`, `restore`* |
| `queue` | `job`, `status` |

*\* write-gated* — requires the `x-webhook-secret` header **or** a valid
better-auth session cookie. The gate runs before input validation on purpose, so
an unauthenticated caller cannot probe a schema it has no right to see.

### Webhooks & Observability
- `POST /hooks/reindex` — Enqueues a full-corpus reindex (ideal for Git push webhooks). Requires auth.
- `POST /hooks/index?slug=<slug>` — Enqueues a single-document reindex. Requires auth.
- `GET /metrics` — Prometheus exposition: `mcpedia_uptime_seconds`, `mcpedia_queue_jobs{state=...}` (verified live against :4020).
- `GET /health` — Liveness: the process is up. Deliberately does **not** touch Postgres or Redis, so a slow database cannot cause a restart loop that turns a degradation into an outage.
- `GET /healthz` — Alias of `/health`.
- `GET /ready` — Readiness: probes Postgres and Redis and returns 503 if either fails. This is the one to point an orchestrator at.

---

## Authentication & Security

MCPedia utilizes dual-tier security. The two tiers are deliberately separate:
stdio MCP has no user session, so the write gate cannot be a cookie check.

1. **Web UI Authentication** (better-auth sessions):
   - Requires `BETTER_AUTH_SECRET` in `.env`. There is **no fallback value** — an
     unset secret disables web auth with a named error rather than falling back to
     a key committed to the repository. (An earlier version of this repo shipped
     such a fallback; do not reintroduce one.) `BETTER_AUTH_URL` is optional and
     only affects absolute callback URLs.
   - Email + password, stored in `user` / `account` / `session` / `verification`.
     Passwords are hashed by better-auth; sessions are random tokens in the
     `session` table with a server-side expiry, so they are revocable and each
     login is distinct. The old `mcpedia_admin` HMAC cookie — whose value was the
     literal string `admin` for every login — has been removed.
   - The first account to sign up is granted the `admin` role; every later one is
     a plain `user` and cannot reach `/create` or the CRUD routes.
   - Protects document creation (`/create`), inline editing (`?edit=1`), and
     deletion.
   - **Promoting a user to admin later** (there is no promotion endpoint, by
     design):

     ```sql
     update "user" set role = 'admin' where email = 'you@example.com';
     ```

2. **API & MCP Write Authentication**:
   - Gated via `WEBHOOK_SECRET` in `.env`.
   - Requires the `x-webhook-secret` HTTP header on mutating endpoints and tools.
   - The API will refuse to start if `WEBHOOK_SECRET` is unset, preventing unsecured deployments.
   - **Do not migrate this to sessions.** The web UI also accepts this header
     (the inline editor receives the secret), but the MCP write gate requires it.

### Migrations

The chain is one squashed baseline (`0000`) plus additive migrations after it.
`pnpm db:migrate` refuses to replay a batch that would collide with an existing
schema, and allows purely additive batches — so the normal path for a database
created before `0001` is:

```bash
pnpm --filter @mcpedia/db db:migrate:adopt   # records only the entries whose tables exist
pnpm db:migrate                             # applies the rest
```

`db:migrate:adopt` records migrations individually: an entry is only marked
applied when the tables it creates are actually present, so a database adopted
before `0001` still gets `0001` applied rather than silently skipping it.

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22.12 — the runtime the systemd units and the
  container images use. Development *scripts* also run under `tsx`; Bun is not
  required and is not a dependency of this repo.
- [pnpm](https://pnpm.io/) 10.33.2 — pinned exactly via `packageManager`. A
  floating pnpm resolves the workspace differently from the lockfile CI
  verified, and `--frozen-lockfile` reports that as "lockfile is not up to date".
- [PostgreSQL](https://www.postgresql.org/) — the source of truth.
- [Redis](https://redis.io/) — BullMQ job queue.
- A reachable **hindsight** endpoint — chunking, embedding, search and
  consolidation all live there. Without it the document read paths still work;
  search and indexing degrade.

### 1. Installation & Environment Setup

```bash
git clone https://github.com/asepharyana/mcpedia.git
cd mcpedia

pnpm install
```

There is **no `.env.example`** in this repo. Create `.env` at the repo root
yourself; `packages/config` reads it and it deliberately OVERRIDES any inherited
shell value, so a stray `DATABASE_URL` in your shell can never point the app at
the wrong database. The keys that matter:

| Key | Required? | Notes |
|---|---|---|
| `DATABASE_URL` | yes | `postgres://` or `postgresql://`. The API refuses to start without it. |
| `BETTER_AUTH_SECRET` | yes | Signs session cookies. Min 16 chars (`openssl rand -hex 32`). **No default, ever.** |
| `BETTER_AUTH_URL` | yes | Valid URL used to derive trusted origins. |
| `WEBHOOK_SECRET` | for MCP/API writes | The `x-webhook-secret` header value. Unset means the write path is disabled, not broken. |
| `REDIS_URL` | no | Defaults to the shared instance in `packages/config`. |
| `HINDSIGHT_API_URL` | no | Defaults to the adapter's local endpoint. |
| `HINDSIGHT_BANK_ID` | no | Defaults to `mcpedia`. |
| `CONTENT_ROOT` | **on a deploy host** | Where the `.md` backup mirror is written. See the warning below. |

> **`CONTENT_ROOT` must be set outside a checkout.** Its fallback is derived from
> the config module's own location, which in the deployed layout
> (`/opt/mcpedia-<svc>/current/dist/`) resolves to `/opt/content` — a directory
> the service user cannot create, since `/opt` is root-owned. The mirror writes
> are wrapped in a catch by design, so that failure is *silent*: documents save
> and serve fine while the backups never exist. Both writing units name
> `/var/lib/mcpedia/content` explicitly and the deploy script creates it.

### 2. Database Setup

```bash
pnpm db:migrate
```

Migrations are applied by a **bundled** migrator (`apps/api/dist/migrate.js`),
the same artifact the deploy uses, so local and production cannot diverge.

The migration chain is a single generated baseline, `drizzle/0000_military_wolfpack.sql`,
produced by `pnpm --filter @mcpedia/db db:generate` from `packages/db/src/schema.ts`.

> **Existing databases:** the previous four hand-written migrations were applied manually
> via `psql -f` and left no migration-tracking table. This baseline is for **fresh
> databases only** — running it against a database that already has these tables will fail
> with a duplicate-relation error. To adopt drizzle's tracking on an existing database, use
> `drizzle-kit migrate --baseline` rather than replaying the chain.

### 3. Build & Index

```bash
# The full pre-merge gate: typecheck, tests, service bundles, migration drift.
moon run :check

# Or the pieces:
pnpm run typecheck             # moon run :typecheck
pnpm run build:bundles         # esbuild -> apps/*/dist (api, mcp, worker, migrate)
pnpm run test                  # vitest, one root config, whole workspace

# Index a CHECKOUT's content/ tree into Postgres + hindsight.
pnpm run index
```

On a deploy host the mirror may be absent, so `pnpm run index` (which walks
`content/` on disk) is not the tool — use `pnpm run reindex:hindsight`, which
reads bodies from Postgres and repairs the index from the source of truth.

### 4. Running Services

```bash
# Every service at once (moon runs the per-project dev tasks)
pnpm run dev

# Or individually:
pnpm --filter @mcpedia/web run dev   # Vite dev server (proxies /rpc, /trpc, /api/auth)
pnpm run api                         # Hono + oRPC API on :4020
pnpm run worker                      # BullMQ background worker
pnpm run mcp                         # MCP server (stdio mode)
pnpm run mcp:http                    # MCP server (Streamable HTTP on :4021)
```

---

## Scripts & CLI Reference

| Command | Action |
|---|---|
| `moon run :check` | **The gate**: typecheck + tests + service bundles + migration drift |
| `pnpm run typecheck` | `moon run :typecheck` (the 5 apps with a tsconfig; packages are checked transitively) |
| `pnpm run lint` / `pnpm run format:check` | Biome lint / format check |
| `pnpm run test` | Vitest, one root config covering apps/ and packages/ |
| `pnpm run build` | `moon run :build` (only `web` and `mcp-client` emit) |
| `pnpm run build:bundles` | esbuild the api/mcp/worker/migrate bundles into `apps/*/dist` |
| `pnpm run index` | Walk a checkout's `content/` and ingest it |
| `pnpm run reindex:hindsight` | Repair the index from Postgres (the deploy-host path) |
| `pnpm run enqueue --all` \| `pnpm run enqueue <slug>` | Enqueue a full or single-document reindex job |
| `pnpm run dev` / `api` / `worker` / `mcp` / `mcp:http` | Start individual services |
| `pnpm run db:migrate` / `db:generate` / `db:push` / `db:studio` | Drizzle migration and introspection commands |
| `pnpm --filter @mcpedia/mcp-client run chat` | Interactive MCP client REPL |
| `pnpm --filter @mcpedia/mcp-client run ask "<question>"` | One-shot MCP client query |

---

## Content Format

Documents are stored in Postgres. The `.md` files under `content/<section>/` are
written *by* the application as backups, and they are gitignored — they are not
the input, they are the output. Write content through the MCP tools.

The mirror's file format, for reading a backup by hand:

```yaml
---
id: sample-document
title: Sample Architecture Document
type: documentation
section: docs
tags: [architecture, typescript, postgres]
status: published
author: asep
created_at: 2026-08-20
updated_at: 2026-08-20
# Arbitrary custom fields (auto-discovered & styled):
difficulty: intermediate
points: 100
category: system-design
verified: true
---

# Sample Architecture Document

Your document content in standard GitHub Flavored Markdown (GFM).
Tables, code snippets, and custom sections are fully supported.
```

---

## Production Deployment

Deploys are **push-to-main and automatic**. `.github/workflows/ci.yml` runs the
gate, builds the service bundles and the SPA, uploads them as an artifact, then
`scripts/deploy-direct.sh` runs on the host to unpack them. The VPS never builds
and never checks the repo out.

```bash
# Inspect service logs
journalctl -u mcpedia-api -u mcpedia-mcp -u mcpedia-worker -u mcpedia-web -f
```

### How a release lands

```
releases/<sha>/          # immutable: nothing writes here after `current` flips
current -> releases/<sha>/
```

`KEEP_RELEASES` defaults to 2 — the live release plus one rollback target.

- **Units and launchers live in `infra/systemd/`**, not only on the host, and
  `deploy-direct.sh` installs them on every deploy. A unit that exists only in
  `/etc` cannot be reviewed and is silently lost; the current units previously
  pointed `WorkingDirectory` at a checkout that no longer exists, which stayed
  invisible until the next reboot because nothing restarts a running process.
- **`/opt/mcpedia-<svc>/bin/mcpedia-<svc>`** is the launcher each unit execs. It
  `cd`s into `current/` rather than a pinned SHA, so a rollback is a symlink flip.
- **`CONTENT_ROOT=/var/lib/mcpedia/content`** is created by the deploy script and
  named by the writing units. See the warning under Quick Start — this is the one
  write path whose failure is silent.
- **Migrations run before the swap**, as their own process. A schema that cannot
  be migrated aborts the deploy with the previous release still serving.
- **Health probes** hit the four services and both public URLs; a failure rolls
  `current` back to the previous release.

---

## Testing

One root `vitest.config.mts` covers the whole workspace — every `*.test.ts(x)`
under `apps/*/src` and `packages/*/src`:

```bash
pnpm run test          # 45 files / 540 tests
moon run :check        # the same tests, plus typecheck, bundles and drift
```

Tests run without a live database or Redis: the use cases are built by
factories, so a test supplies `vi.fn()` collaborators and never opens a pool.
The suite covers frontmatter parsing, path classification, revision
deduplication, the auth gates on both write paths, the browser-bundle
server-import guard, and the deploy payload shape.

Two suites exist specifically to stop a class of silent failure returning, and
are worth reading before touching what they guard:

- `apps/web/src/build/no-next-routing-dirs.test.ts` — fails if a Next-era file
  or a root-level `.launcher-*` reappears.
- `packages/queue/src/worker.test.ts` — pins the index worker against reporting
  success while having indexed nothing.

## Releases and container images

Every push to `main` is analysed by [semantic-release](https://semantic-release.gitbook.io/).
The commit prefix decides the version bump — nobody types a version number:

| Commit | Result |
|---|---|
| `feat(scope): …` | minor bump |
| `fix(scope): …` | patch bump |
| `BREAKING CHANGE:` in the footer | major bump |
| `chore`, `ci`, `docs`, `refactor`, `test`, `build` | patch bump, or no release at all |

A release publishes a tag, a GitHub Release and the changelog. The same workflow
then builds and pushes one container image per service to GHCR at exactly that
version, so an image tag always matches a git tag:

This repo publishes 4 image(s):

| Package | Image |
|---|---|
| `mcpedia-api` | `ghcr.io/asepharyana/mcpedia:mcpedia-api:<version>` |
| `mcpedia-mcp` | `ghcr.io/asepharyana/mcpedia:mcpedia-mcp:<version>` |
| `mcpedia-worker` | `ghcr.io/asepharyana/mcpedia:mcpedia-worker:<version>` |
| `mcpedia-web` | `ghcr.io/asepharyana/mcpedia:mcpedia-web:<version>` |


Pull one without touching the registry UI:

```bash
docker pull ghcr.io/asepharyana/<repo>:<service>:<version>
```

### Adding or removing an image

Do not edit `.github/workflows/release.yml` to change which images are built.
The list lives in `.github/docker-images.json`:

```json
{ "images": [
  { "package": "<service>", "context": ".", "file": "Dockerfile" }
] }
```

- `package` becomes the GHCR path component, so it must be lowercase
  `[a-z0-9._-]`. It does not have to match the repo name.
- `context` is the build context directory, `file` the Dockerfile within it.
- `build_args` is an object of `KEY=value` pairs; the pipeline flattens it before
  the matrix, so both the object and a pre-joined `"A=1\nB=2"` string work.
- `"enabled": false` keeps an entry documented but skips building it. **An empty
  or fully disabled list fails the run** rather than publishing nothing.

Every enabled entry must have a `Dockerfile` **and** a `.dockerignore` in its
context, and both must be tracked by git — CI cannot see an untracked file, and a
missing `.dockerignore` silently ships `node_modules/` and `.git` inside the image.

`latest` tracks the newest stable release. Prereleases (`1.2.0-rc.1`) are
tagged but never promote `latest`.

### If a release fails

Check the run, then fix forward with a normal commit — do not re-tag by hand:

```bash
gh run list --workflow=release.yml --limit 5
gh run view <run-id> --log-failed
```

A run that only built images and published no tag is normal for a `chore` push:
there was nothing to release, so no version was derived and no image was tagged.