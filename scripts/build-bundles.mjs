#!/usr/bin/env node
/**
 * Builds the three self-contained service bundles MCPedia runs in production.
 *
 * WHY A BUNDLE AT ALL: the sources import sibling workspace packages with
 * extensionless paths (`import { ... } from "@mcpedia/queue"` resolving to
 * TypeScript files), which Node cannot load on its own. The systemd launchers
 * therefore exec `node dist/index.js` — a single file with every workspace
 * import and every npm dependency already resolved into it.
 *
 * The `createRequire` banner is load-bearing: the output is ESM (`format:
 * "esm"`), and ESM has no `require`. Several bundled CommonJS dependencies call
 * `require(...)` at module scope; without this prelude esbuild's stub throws
 * "Dynamic require of X is not supported" the moment the service boots.
 *
 * Entrypoints and output names are exactly what the launchers under
 * /opt/mcpedia-api, /opt/mcpedia-mcp and /opt/mcpedia-worker point at, so
 * changing one without the other breaks a restart. Keep them in sync.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CREATE_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  "const require = __createRequire(import.meta.url);",
].join("\n");

const BUNDLES = [
  { name: "api", entry: "apps/api/src/index.ts", outfile: "apps/api/dist/index.js" },
  { name: "mcp", entry: "apps/mcp/src/http.ts", outfile: "apps/mcp/dist/http.js" },
  { name: "worker", entry: "apps/worker/src/index.ts", outfile: "apps/worker/dist/index.js" },
];

for (const { name, entry, outfile } of BUNDLES) {
  await build({
    entryPoints: [resolve(root, entry)],
    outfile: resolve(root, outfile),
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    banner: { js: CREATE_REQUIRE_BANNER },
    sourcemap: false,
    // Deps are bundled rather than external: the launcher only ships this one
    // file into /opt, so a bare `import "hono"` at runtime would not resolve.
    packages: "bundle",
    logLevel: "info",
  });
  console.log(`built ${name} -> ${outfile}`);
}
