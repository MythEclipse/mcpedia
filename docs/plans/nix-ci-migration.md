# MCPedia — Nix-based CI/CD Migration Plan

## Goal
Migrate from tarball+SSH deploy to Nix-native build-and-deploy (like GMW).
CI builds with Nix in GitHub Actions → `nix copy` closure to VPS →
`nix-env --set` + `systemctl restart` on VPS. VPS never builds.

## Services to migrate
| Service | Build | Runtime | systemd unit |
|---------|-------|---------|-------------|
| web (Next.js) | `bun run build` → `.next` | `next start` | `mcpedia-web` |
| api (Hono) | `bun build src/index.ts` → `dist/index.js` | `bun run src/index.ts` | `mcpedia-api` |
| mcp (MCP server) | `bun build src/http.ts` → `dist/http.js` | `bun run src/http.ts` | `mcpedia-mcp` |
| worker (BullMQ) | `bun build src/index.ts` → `dist/index.js` | `bun run src/index.ts` | `mcpedia-worker` |

## Changes

### 1. flake.nix (new)
- `nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable"` (Bun >=1.3)
- 4 packages: `web`, `api`, `mcp`, `worker`
- Each: `mkDerivation` with `bun` as nativeBuildInput, `sandbox=false`
- Filter source to exclude `.next`, `node_modules`, `.git`

### 2. CI workflow (.github/workflows/ci.yml — rewrite)
- `test` job: typecheck + test (Bun, as before)
- `build-and-deploy` job: matrix [web, api, mcp, worker]
  - `DeterminateSystems/nix-installer-action@v16` with `determinate: false`, `sandbox=false`
  - `DeterminateSystems/magic-nix-cache-action@v14` with `use-flakehub: false`
  - `nix build .#<service>` → store path
  - SSH setup (key sanitization)
  - `nix copy --to ssh://...`
  - `nix-env --profile /nix/var/nix/profiles/mcpedia-<service> --set <path>`
  - `systemctl restart mcpedia-<service>`

### 3. systemd units (update on VPS)
- Change `ExecStart` from `bun run` to Nix profile binary path
- Profile path: `/nix/var/nix/profiles/mcpedia-web/bin/mcpedia-web`
- Keep `EnvironmentFile` pointing to `.env`
- Keep `Restart=always`

### 4. Deploy secrets
- `SSH_PRIVATE_KEY` (already exists as `SSH_DEPLOY_KEY`)
- `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT`

## Verification
- `nix build .#web --impure` builds
- `gh run list` shows all 4 services `completed success`
- `curl https://wiki.asepharyana.my.id/` returns 200
- `journalctl -u mcpedia-web` shows Next.js started
