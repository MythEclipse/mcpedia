# MCPedia Agent Instructions

MCPedia is a content-first knowledge base. Documents are stored in **PostgreSQL**
as the source of truth — with auto-generated `.md` backups on disk — indexed into
embeddings and search vectors, and reached through a Web UI, an oRPC/tRPC API,
and a Model Context Protocol (MCP) server.

- **DB-first**: documents are created/updated/deleted through the MCP
  `create_document` / `update_document` / `delete_document` tools (which require
  the `x-webhook-secret` header). The `.md` files under `content/` are
  auto-generated backups and are gitignored.
- **CI builds, the host only deploys**: `.github/workflows/ci.yml` builds the
  service bundles and the SPA dist on GitHub Actions, ships them as an artifact,
  and `scripts/deploy-direct.sh` unpacks them into `/opt/mcpedia-<svc>/releases/<sha>`
  and flips the `current` symlink. The VPS never builds and never checks the repo
  out.

## Architecture Principles

1. **Single core layer (`@mcpedia/core`)**: all business logic — document CRUD,
   indexing, search, revisions, path classification — lives in `packages/core`.
   `apps/web`, `apps/mcp` and `apps/api` must never touch the database directly.
2. **The database is the source of truth**: Postgres holds the document body and
   its metadata. Write content with the MCP tools, not by editing files.
3. **Multi-modal search**: keyword search (Postgres `tsvector` + GIN), semantic
   search (cosine similarity over chunked embeddings), and hybrid search
   (Reciprocal Rank Fusion) are unified in `packages/core`.
4. **Mutations are authenticated**: every state-changing operation — document
   create/update/delete, reindexing, revision restore — requires either the
   `x-webhook-secret` header or a session cookie.

## Layout

```
apps/         api (:4020), mcp (:4021), mcp-client, web (Vite SPA, :4016), worker
packages/     config, core, db, parser, queue, types
infra/        docker/ (per-service Dockerfiles + nginx), systemd/ (units + launchers)
scripts/      deploy-direct.sh, build-bundles.mjs, check-migration-drift.sh, indexers
docs/         plans/ (design history), archive/
```

## Development Workflow

- **Install**: `pnpm install`
- **Test**: `pnpm run test`
- **Lint / format**: `pnpm run lint`, `pnpm run format:check`
- **Typecheck**: `pnpm run typecheck`
- **The full pre-merge gate**: `moon run :check` (typecheck, tests, service
  bundles, migration-drift). CI runs this; run it before pushing.
- **Index content**: `pnpm run index` walks `content/` on disk, so it needs a
  checkout. On a deploy host the mirror may be absent — use
  `pnpm run reindex:hindsight`, which reads bodies from Postgres.
- **Dev servers**: `pnpm run dev`, or `pnpm run api | mcp | worker` individually.

## Things that are load-bearing

These have each broken a deploy. Do not "simplify" them without reading the
comment at the site — every one of them is the tombstone of a specific failure.

- **`scripts/build-bundles.mjs` asserts one entrypoint per bundle.** esbuild
  inlines two modules into one file and they then share a single
  `import.meta.url`, so every `import.meta.url === process.argv[1]` guard compares
  equal and *every* one runs. That shipped two concurrent migrators once.
- **The drizzle `.sql` journal is copied beside the migrate bundle.** esbuild
  inlines JavaScript only; a migrator that cannot find its journal reports
  success while changing nothing.
- **`CONTENT_ROOT` is set explicitly in the systemd units.** The in-code default
  is derived from the module's own location, which in the deployed layout
  (`/opt/mcpedia-<svc>/current/dist/`) resolves to `/opt/content` — a directory
  the service user cannot create. The mirror writes are wrapped in a swallow-all
  `catch`, so that misderivation is silent.
- **`org.opencontainers.image` / Dockerfiles live in `infra/docker/`.** The
  image list is `.github/docker-images.json`; a path there must exist *and* be
  git-tracked, or the release fails.
- **`.moon/tasks/all.yml` must be a DIRECTORY.** A flat `.moon/tasks.yml` is the
  moon 1.x path and moon 2.x ignores it silently.
- **The `deploy` job in `ci.yml` is gated on `github.ref`, not `event_name`.**
  A `workflow_dispatch` runs the workflow file from the dispatched ref and does
  receive repository secrets, so an event-based gate still let a dispatch against
  a branch deploy that branch.

## Standing conventions

- Clean Code rules apply to every edit.
- Tests must target the failure mode being introduced and be proven non-vacuous
  by mutating the source and watching them fail.
- `organizeImports: on` in `biome.json`, so import reordering in a diff is
  intended.
- Formatting is repo-wide: a bare `pnpm run format` rewrites files unrelated to
  your change. Revert those (`git checkout -- <paths>`) before committing.
- No `sleep`, anywhere, including poll loops. Block on a real process or check
  state once.
