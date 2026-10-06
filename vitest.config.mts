import { defineConfig } from "vitest/config";

// One root config runs the whole suite: every test file that lives under
// apps/ and packages/ (pnpm workspace packages all publish their TS sources
// directly, so no build step is needed before testing).
// .mts (not .ts) because the repo root package.json has no "type": "module".
export default defineConfig({
  test: {
    include: ["apps/**/src/**/*.test.ts", "packages/**/src/**/*.test.ts"],
    environment: "node",
    // Each file gets its own module registry + process, so module mocks
    // (vi.mock) never leak between test files.
    isolate: true,
  },
});
