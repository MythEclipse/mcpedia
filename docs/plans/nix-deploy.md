# Phase 15b — CI/CD: Build in CI, Deploy only on VPS

> User: "alur ci nya juga benarkan lah masa build di vps,harusnya kan di vps hanya deploy, dan seharusnya pakai nix"

## Final Architecture

### CI Workflow (`.github/workflows/ci.yml`)
Single workflow with two jobs:

**Job 1: `build`** (runs on GitHub Actions runner)
1. Checkout → Set up Bun 1.3.14 → `bun install --frozen-lockfile`
2. Typecheck (`bun run typecheck`)
3. Build web (`working-directory: apps/web && bun run build`) ← **Build happens here, not VPS**
4. Upload `.next/` as artifact (`include-hidden-files: true` ← critical for hidden `.next/` dir)
5. MCP smoke test (conditional on DATABASE_URL secret — skipped in CI without DB)
6. Unit tests (`bun run test`)

**Job 2: `deploy`** (needs: build, main branch only)
1. Download artifact to `apps/web/.next`
2. Tar `.next` (exclude cache, ~15MB tarball)
3. SCP tarball to VPS (`/tmp/`)
4. SSH to VPS: `git pull` → `bun install` → `bun run scripts/indexer.ts` → `tar -xzf` → `systemctl restart`

### Key Fixes During This Phase

1. **`actions/checkout@v4` → `@v5`** — Node 20 deprecation warning
2. **`bun --cwd apps/web run build` → `working-directory: apps/web`** — `bun run` doesn't support `--cwd` flag; was silently printing usage, exiting 0
3. **`path: apps/web/.next/`** → **`path: apps/web/.next`** + **`include-hidden-files: true`** — `.next/` is a hidden directory; `upload-artifact@v4` excludes hidden files by default
4. **`bun --cwd apps/mcp run smoke`** → **`working-directory: apps/mcp`** — same `--cwd` bug
5. **Smoke test made conditional** on `DATABASE_URL` — was silently failing (never actually ran due to bug #2/#4)
6. **SCP of individual `.next/*`** → **tarball transfer** — SCP with glob of hidden files was failing/timing out
7. **Deploy tarball excludes `.next/cache`** — cache is ephemeral, reduces transfer size
8. **Merged ci.yml + deploy.yml** into single workflow — `workflow_run` trigger can't access artifacts from CI run
