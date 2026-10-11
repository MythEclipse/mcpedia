import { defineConfig } from "vitest/config"

// One root config runs the whole suite: every test file that lives under
// apps/ and packages/ (pnpm workspace packages all publish their TS sources
// directly, so no build step is needed before testing).
// .mts (not .ts) because the repo root package.json has no "type": "module".
export default defineConfig({
	test: {
		// NOTE: the `app/` segment is deliberate and load-bearing. This glob used to be
		// `apps/**\/src/**\/*.test.ts`, which matched nothing under apps/web — that package
		// keeps its sources in `app/`, not `src/` — so every test in the web app was
		// silently excluded from the suite. It looked fine because there were none.
		include: [
			"apps/**/src/**/*.test.ts",
			"apps/web/app/**/*.test.ts",
			"packages/**/src/**/*.test.ts",
		],
		environment: "node",
		// Each file gets its own module registry + process, so module mocks
		// (vi.mock) never leak between test files.
		isolate: true,
	},
})
