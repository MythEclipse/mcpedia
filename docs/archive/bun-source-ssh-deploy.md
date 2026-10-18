# SSH deploy to bun-source services (not Nix): gotchas

This repo (`asepharyana/mcpedia`) deploys **bun source** via systemd — NOT via
Nix like GMW. The pattern is: CI builds in GitHub Actions → upload artifact →
deploy job downloads artifact → SCP tarball to VPS → SSH → git pull + unpack +
index + `systemctl restart`. The VPS does NOT build.

## Gotchas (learned during mcpedia deploy setup, 2026-08-20/21)

### 1. SSH host = public IP, NOT Tailscale IP

The VPS appears in `~/.ssh/config` as `Host orange → HostName 100.79.111.61`.
That IP is a **Tailscale `tailscale0` interface address** in the CGNAT range
(`100.64.0.0/10`). GitHub Actions runners are NOT on the Tailscale network, so
they get `Connection timed out` (dropped at the network layer, not refused).

**Fix:** Use the VPS's real public IP (`45.127.35.244`, discovered via
`curl https://api.ipify.org` from the VPS). Port 22 is open in iptables
(`ACCEPT tcp dpt:22` from `0.0.0.0/0`).

### 2. SSH key MUST be stored directly from file (not shell variable)

Storing the deploy key via a shell variable corrupts it:

```bash
# ❌ WRONG — newlines get mangled by the shell → "ssh: no key found"
PRIV_KEY=$(cat keyfile)
gh secret set SSH_DEPLOY_KEY --body "$PRIV_KEY"

# ✅ CORRECT — pipe the file directly so GitHub preserves all bytes
cat keyfile | gh secret set SSH_DEPLOY_KEY --repo asepharyana/mcpedia
```

Symptom: `appleboy/ssh-action` fails with
`ssh.ParsePrivateKey: ssh: no key found`.

### 3. Use `appleboy/ssh-action@v1` (not `@v1.1.0`)

- `@v1.1.0` (very old) has a key-parsing bug that rejects valid keys
  (`ssh.ParsePrivateKey: ssh: no key found`).
- `@v1` (latest) handles OpenSSH ed25519 keys correctly.

### 4. `appleboy/ssh-action` needs explicit `envs` to pass through secret-derived vars

The `envs` parameter passes environment variables to the remote script.
Include any secret you reference in the script:
```yaml
envs: SSH_DEPLOY_HOST  # passes SSH_DEPLOY_HOST into the remote script
```
Without it, `echo $SSH_DEPLOY_HOST` on the VPS returns empty even though the
action connected.

### 5. Always pass `-o IdentitiesOnly=yes`

Without it, SSH offers ALL loaded identities (deploy key + default keys) and the
server may reject after "Too many authentication failures". `appleboy/ssh-action`
handles this internally via the `key` input, but if you use raw `ssh` add
`-o IdentitiesOnly=yes`.

### 6. GitHub `workflow_run` does NOT carry the push commit SHA

`workflow_run` events fire after CI completes, but `actions/checkout` checks out
the **default branch tip**, not the specific commit. This is fine for deploy
(the script does `git pull origin main` anyway), but verify the checkout ref
matches what CI built if you rely on it.

### 7. DB migrations: `db:push` prompt is non-interactive-unfriendly in SSH deploy

When the schema includes a new column (e.g. adding `extra_fields JSONB`),
`drizzle-kit push` in the SSH deploy script needs to be run. Two issues:

- **`--strict` mode (config default)**: `drizzle.config.ts` has `strict: true`,
  which makes `drizzle-kit push` prompt `No, abort / Yes, I want to execute all
  statements`. In a non-interactive SSH script (no TTY), the prompt never receives
  input and the command times out → SIGTERM → exit code 124 → deploy fails.
  `set -e` then kills the whole deploy.
- **`bun run <script>` ambiguity**: `bun run index` resolves the `index` script
  from `package.json`. In a monorepo with workspace packages, ensure the script
  name is unique or use the explicit file path (e.g. `bun run scripts/indexer.ts`).

**Fix**: Use `psql` for schema changes instead of `db:push`:
```bash
psql "$DATABASE_URL" -c \
  "ALTER TABLE documents ADD COLUMN IF NOT EXISTS extra_fields jsonb DEFAULT '{}'::jsonb NOT NULL;"
```

After deploy, check the **public URL** (not just `systemctl is-active`):
```bash
curl -sk -o /dev/null -w "%{http_code}" https://wiki.asepharyana.my.id/
curl -s https://wiki.asepharyana.my.id/docs/websocket/contract | grep -c "frontmatter-pattern"
```

## Deploy workflow template (bun-source, not Nix) — build in CI, deploy-only on VPS

> **User correction (2026-08-21):** "alur ci nya juga benarkan lah masa build
> di vps,harusnya kan di vps hanya deploy,dan seharusnya pakai nix"

The VPS must **not** build. Build happens in CI; the VPS only deploys the
pre-built artifact. Use a single workflow with a `needs:` chain (not
`workflow_run` — see pitfall #8 below).

### Pitfalls for bun-source deploy workflows

- **`bun --cwd X run Y` is broken.** `bun run` does NOT accept `--cwd` as a
  subcommand flag — it prints usage and exits 0 (silent failure). Use
  `working-directory: X` in the step, or `cd X && bun run Y`. (Root cause of
  CI appearing to pass while the build never actually ran. This also affects
  the smoke test step: `bun --cwd apps/mcp run smoke` was silently failing.)
- **`.next/` is a hidden directory.** `actions/upload-artifact@v4` excludes
  hidden files/dirs by default (`include-hidden-files: false`). Set
  `include-hidden-files: true` or the artifact will be empty.
- **`workflow_run` cannot download artifacts from the CI run.** This is a
  known GitHub Actions limitation — the deploy workflow doesn't have access to
  the CI run's artifacts. **Fix:** merge CI + deploy into a single workflow with
  `deploy: needs: [build]`.
- **`actions/checkout@v4` → Node 20 deprecation.** Bump to `@v5`.
- **SCP'ing hundreds of individual files from `.next/` can time out.** Tar first,
  then SCP the single tarball: `tar -czf app.tar.gz .next`, SCP, then SSH to
  unpack. Also exclude `.next/cache/` to reduce size (~73MB → ~49MB).
- **`download-artifact` path resolution.** When downloading with
  `path: apps/web/.next`, the artifact (which contains the `.next` directory
  contents from upload `path: apps/web/.next`) gets extracted correctly to
  `apps/web/.next/`. Do NOT use `path: .next` — that creates `.next/.next/`.

### Final working workflow (verified 2026-08-21)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    name: typecheck + build
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Set up Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: "1.3.14"

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Typecheck
        run: bun run typecheck

      - name: Build web
        working-directory: apps/web
        run: bun run build

      # Upload .next/ — include-hidden-files is REQUIRED (hidden dir)
      - name: Upload web build artifact
        uses: actions/upload-artifact@v4
        with:
          name: mcpedia-web-build
          path: apps/web/.next
          include-hidden-files: true
          if-no-files-found: error

      # Smoke test: requires Postgres + Redis — skipped in CI without secrets
      - name: MCP smoke test
        if: env.DATABASE_URL != ''
        working-directory: apps/mcp
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          REDIS_URL: ${{ secrets.REDIS_URL }}
        run: bun run smoke

      - name: Test
        run: bun run test

  deploy:
    name: deploy to VPS
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v5

      - name: Download build artifact
        uses: actions/download-artifact@v4
        with:
          name: mcpedia-web-build
          path: apps/web/.next

      - name: Tar .next
        run: tar -C apps/web --exclude='.next/cache' -czf mcpedia-web-next.tar.gz .next

      - name: Copy tarball to VPS
        uses: appleboy/scp-action@v1
        with:
          host: ${{ secrets.SSH_DEPLOY_HOST }}
          port: ${{ secrets.SSH_DEPLOY_PORT }}
          username: ${{ secrets.SSH_DEPLOY_USER }}
          key: ${{ secrets.SSH_DEPLOY_KEY }}
          source: "mcpedia-web-next.tar.gz"
          target: "/tmp/"

      - name: Unpack and restart on VPS
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SSH_DEPLOY_HOST }}
          port: ${{ secrets.SSH_DEPLOY_PORT }}
          username: ${{ secrets.SSH_DEPLOY_USER }}
          key: ${{ secrets.SSH_DEPLOY_KEY }}
          envs: SSH_DEPLOY_HOST
          script: |
            set -e
            cd /home/code/mcpedia
            git pull origin main
            /home/code/.bun/bin/bun install --frozen-lockfile
            /home/code/.bun/bin/bun run scripts/indexer.ts
            rm -rf apps/web/.next
            tar -xzf /tmp/mcpedia-web-next.tar.gz -C apps/web/
            rm -f /tmp/mcpedia-web-next.tar.gz
            sudo systemctl restart mcpedia-web mcpedia-api mcpedia-mcp mcpedia-worker
            sleep 3
            systemctl --no-pager status mcpedia-web mcpedia-api mcpedia-mcp mcpedia-worker --no-legend
```

## Secrets to configure (per-repo GitHub secrets)

| Secret | Value | How |
|--------|-------|-----|
| `SSH_DEPLOY_HOST` | VPS public IP (e.g. `45.127.35.244`) | `gh secret set SSH_DEPLOY_HOST --body "45.127.35.244"` |
| `SSH_DEPLOY_PORT` | `22` | `gh secret set SSH_DEPLOY_PORT --body "22"` |
| `SSH_DEPLOY_USER` | `code` (or whatever user owns the services) | `gh secret set SSH_DEPLOY_USER --body "code"` |
| `SSH_DEPLOY_KEY` | SSH deploy private key (ed25519) | `cat keyfile \| gh secret set SSH_DEPLOY_KEY` |

And on the VPS, add the public key to the deploy user's `authorized_keys`:
```bash
ssh code@<public-ip> "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys <<< '$(cat keyfile.pub)'"
chmod 600 ~/.ssh/authorized_keys
```

## CI monitoring

```bash
gh run list --repo asepharyana/mcpedia --workflow "CI" --limit 3
gh run view <run_id> --log-failed   # only failing-step logs
```
