# MCPedia

> A content-first knowledge base — readable as Markdown in Git, queryable by humans via a modern Web UI, and accessible to AI agents via the Model Context Protocol (MCP).

MCPedia keeps content as plain Markdown files under `content/` as a Git-tracked source of truth. Content is indexed into PostgreSQL (with a weighted `tsvector` full-text search column and chunked embeddings) and served through a unified **Core** layer that every interface (Web, MCP, API, Worker, CLI) shares.

---

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│     Web UI      │    │   MCP Server    │    │  tRPC / Hono    │    │  BullMQ Worker  │
│   (Next.js 16)  │    │  (Stdio + HTTP) │    │   API (:4020)   │    │ (Async Queue)   │
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

1. **Content as Source of Truth**: Markdown files with YAML frontmatter under `content/` are primary. The database holds metadata, search indices, chunk embeddings, and revision history.
2. **Single Core Layer**: All business logic (CRUD, indexing, search, revisions, path classification) is encapsulated in `@mcpedia/core`. Interfaces never touch the database directly.
3. **Multi-Modal Search**: Keyword search (Postgres FTS), semantic search (vector cosine similarity), and hybrid search (Reciprocal Rank Fusion / RRF) work out of the box.
4. **Resilient Revision System**: Content edits snapshot revisions automatically; metadata-only edits are deduplicated. Restoring a revision automatically rebuilds semantic search chunks.
5. **Dual Interface**: Full human-friendly web experience + first-class AI agent integration via MCP.

---

## Monorepo Layout

```
mcpedia/
├── apps/
│   ├── web/          # Next.js 16 (Turbopack) — dark-mode UI, hierarchical doc tree, TOC, CRUD
│   ├── mcp/          # MCP server (stdio + Streamable HTTP on :4021) — 13 tools + 4 resources
│   ├── mcp-client/   # Interactive MCP CLI REPL, one-shot command runner, and TypeScript client SDK
│   ├── api/          # Hono + tRPC v11 API on :4020, git-sync webhooks, Prometheus metrics, dashboard
│   └── worker/       # Long-running BullMQ worker for async indexing and embedding jobs
├── packages/
│   ├── core/         # Document, Content, Search, Index, Revision, and Path services (the business logic)
│   ├── db/           # Drizzle ORM schema, client, and migrations
│   ├── parser/       # Frontmatter (gray-matter) parsing & stringification with dynamic field support
│   ├── search/       # Postgres FTS query (ts_rank + ts_headline), vector cosine, and RRF hybrid fusion
│   ├── embeddings/   # Chunking algorithms & embedding provider integrations
│   ├── queue/        # Redis (ioredis) client & BullMQ queue/worker definitions
│   ├── types/        # Shared TypeScript domain types and interfaces
│   └── config/       # Authoritative environment configuration loader (.env)
├── content/          # Markdown knowledge base organized by sections and nested folders
│   ├── docs/         # System and architectural documentation
│   ├── writeups/     # Technical writeups, CTF solutions, and debugging reports
│   ├── research/     # Research notes and evaluations
│   └── notes/        # Engineering notes and quick references
└── scripts/          # indexer.ts (full corpus reindexing), enqueue.ts (one-shot job enqueue)
```

---

## Key Features

### 1. Multi-Modal Search

| Search Mode | Mechanism | Best Used For |
|---|---|---|
| **Keyword Search** | PostgreSQL `tsvector` (`simple` config, weighted A/B) + GIN index + `ts_rank` + `ts_headline` | Exact terms, code symbols, error codes, identifiers |
| **Semantic Search** | Text chunking (1000 chars, 150 overlap) + vector embeddings + cosine similarity ranking | Conceptual questions, paraphrased queries, intent matching |
| **Hybrid Search** | Reciprocal Rank Fusion ($RRF = \sum \frac{1}{k + rank}$) fusing keyword and semantic signals | General-purpose search with optimal relevance |

### 2. Hierarchical Folder Navigation

MCPedia supports nested folder structures (like GitHub repositories):
- **Dynamic Path Classification**: The router inspects paths and automatically distinguishes between leaf documents and folder nodes containing subfolders or child documents.
- **Folder Index Pages**: Navigating to any folder (e.g. `/writeups/ctf/defcon-quals-2024`) renders subfolders and documents within that path.
- **Collapsible Sidebar**: Hierarchical navigation tree reflecting the on-disk directory structure.
- **Section Indexes**: Dedicated overview pages for each section (`/docs`, `/writeups`, `/research`, `/notes`).

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

### MCP Tools (13 Total)

#### Read Tools (Public)
| Tool | Description |
|---|---|
| `search_documents` | Full-text keyword search over the knowledge base with headline snippets |
| `semantic_search` | Embedding-based cosine search across chunked content |
| `hybrid_search` | Fused full-text and semantic search via Reciprocal Rank Fusion |
| `get_document` | Fetches the full Markdown body of a document by slug |
| `list_documents` | Lists documents, optionally filtered by section or status |
| `get_related_documents` | Finds documents sharing tags with a given slug |
| `queue_status` | Returns current BullMQ indexing queue metrics |

#### Mutating & Admin Tools (Requires `x-webhook-secret`)
| Tool | Description |
|---|---|
| `create_document` | Creates a new document (writes Markdown file, database row, revision, and chunks) |
| `update_document` | Updates an existing document's body, metadata, or dynamic custom fields |
| `delete_document` | Removes a document file, database rows, revisions, and chunks |
| `index_document` | Enqueues a single-document background reindex job |
| `reindex_all` | Enqueues a full-corpus background reindexing job |
| `restore_revision` | Restores a document to a specific revision and rebuilds search chunks |

### MCP Resources

| Resource URI | Description | MIME Type |
|---|---|---|
| `mcpedia://docs` | List of all published documents in the knowledge base | `application/json` |
| `mcpedia://docs/{+slug}` | Full Markdown body of a single document from disk | `text/markdown` |
| `mcpedia://docs/{+slug}/chunks` | Preview of embedded semantic chunks for a document | `application/json` |
| `mcpedia://docs/{+slug}/revisions` | Summary of revision history for a document | `application/json` |

---

## HTTP, tRPC & Webhook Endpoints

The API application (`apps/api`) runs on **:4020** with Hono and tRPC v11:

### tRPC Procedures
- **Queries**: `search`, `semanticSearch`, `hybridSearch`, `getDocument`, `listDocuments`, `related`, `revisions`, `getRevision`, `jobStatus`, `queueStatus`.
- **Mutations** (Protected by `x-webhook-secret`): `createDocument`, `updateDocument`, `deleteDocument`, `restoreRevision`.

### Webhooks & Observability
- `POST /hooks/reindex` — Triggers a full corpus reindex (ideal for Git push webhooks).
- `POST /hooks/index?slug=<slug>` — Reindexes a single document.
- `GET /metrics` — Prometheus metrics exposition (`mcpedia_uptime_seconds`, `mcpedia_queue_jobs{state=...}`).
- `GET /dashboard` — Standalone real-time web dashboard for queue monitoring and live search.
- `GET /health` — Health check endpoint.

---

## Authentication & Security

MCPedia utilizes dual-tier security:

1. **Web UI Authentication**:
   - Gated via `ADMIN_PASSWORD` in `.env`.
   - Generates an HMAC-signed `mcpedia_admin` HttpOnly cookie upon login at `/login`.
   - Protects document creation (`/create`), inline editing (`?edit=1`), and deletion.

2. **API & MCP Write Authentication**:
   - Gated via `WEBHOOK_SECRET` in `.env`.
   - Requires the `x-webhook-secret` HTTP header on mutating endpoints and tools.
   - The API will refuse to start if `WEBHOOK_SECRET` is unset, preventing unsecured deployments.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) (v1.1+)
- [PostgreSQL](https://www.postgresql.org/) (with `tsvector` support)
- [Redis](https://redis.io/) (for BullMQ async workers)

### 1. Installation & Environment Setup

```bash
# Clone repository
git clone https://github.com/asepharyana/mcpedia.git
cd mcpedia

# Install workspace dependencies
bun install

# Configure environment variables
cp .env.example .env
```

Ensure `.env` contains your database connection, Redis configuration, webhook secret, and admin password.

### 2. Database Setup

Apply migrations to initialize the schema (`documents`, `document_chunks`,
`document_revisions`):

```bash
pnpm db:migrate
```

The migration chain is a single generated baseline, `drizzle/0000_military_wolfpack.sql`,
produced by `pnpm --filter @mcpedia/db db:generate` from `packages/db/src/schema.ts`.

> **Existing databases:** the previous four hand-written migrations were applied manually
> via `psql -f` and left no migration-tracking table. This baseline is for **fresh
> databases only** — running it against a database that already has these tables will fail
> with a duplicate-relation error. To adopt drizzle's tracking on an existing database, use
> `drizzle-kit migrate --baseline` rather than replaying the chain.

### 3. Build & Index

```bash
# Typecheck and build all packages
bunx turbo run build

# Run initial full indexation (parses content/, embeds chunks, writes DB)
bun run index
```

### 4. Running Services

```bash
# Start all development services (Web, API, MCP, Worker) concurrently
bun run dev

# Or run services individually:
bun --cwd apps/web run dev     # Web UI on :3000 (or :4016 in production)
bun run api                    # Hono + tRPC API on :4020
bun run worker                 # BullMQ background worker
bun run mcp                    # MCP server (stdio mode)
bun run mcp:http               # MCP server (Streamable HTTP mode on :4021)
```

---

## Scripts & CLI Reference

| Command | Action |
|---|---|
| `bun run index` | Run full synchronous reindexer over `content/` |
| `bun run enqueue --all` | Enqueue a full reindex job to Redis/BullMQ |
| `bun run enqueue <slug>` | Enqueue a single-document reindex job |
| `bun run worker` | Start the BullMQ background worker |
| `bun run api` | Start the Hono + tRPC API server |
| `bun run mcp` | Run MCP server in stdio mode |
| `bun run mcp:http` | Run MCP server in Streamable HTTP mode |
| `bun run chat` | Launch interactive MCP Client REPL |
| `bun run ask <cmd> [args]` | Run one-shot MCP client command |
| `bun run test` | Run the comprehensive test suite across all packages |
| `bun run typecheck` | Run TypeScript type checking across all workspaces |

---

## Content Format

Content files reside in `content/<section>/` as Markdown files with YAML frontmatter:

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

Production services run as supervised systemd units behind a Caddy reverse proxy:

```bash
# Copy systemd unit templates
sudo cp deploy/*.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable and start all supervised services
sudo systemctl enable --now mcpedia-web mcpedia-api mcpedia-worker mcpedia-mcp

# Inspect service logs
journalctl -u mcpedia-web -u mcpedia-api -u mcpedia-worker -u mcpedia-mcp -f
```

---

## Testing

The test suite runs with in-memory mocks without requiring an active database or Redis instance:

```bash
bun run test
```

All 32+ unit and integration tests across packages and apps validate chunking, frontmatter parsing, cosine similarity, revision deduplication, auth gates, and route handlers.
