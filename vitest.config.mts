import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

// One root config runs the whole suite: every test file that lives under
// apps/ and packages/ (pnpm workspace packages all publish their TS sources
// directly, so no build step is needed before testing).
// .mts (not .ts) because the repo root package.json has no "type": "module".
export default defineConfig({
	resolve: {
		alias: {
			// Mirrors apps/web/vite.config.ts and apps/web/tsconfig.json. The SPA
			// under apps/web/src imports itself as `#/...`; without this the alias
			// resolves in tsc and in the Vite build but not in vitest, so every SPA
			// test that touches an aliased module fails to even load.
			"#": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
		},
	},
	test: {
		// NOTE: the `app/` segment is deliberate and load-bearing. This glob used to be
		// `apps/**\/src/**\/*.test.ts`, which matched nothing under apps/web — that package
		// keeps its sources in `app/`, not `src/` — so every test in the web app was
		// silently excluded from the suite. It looked fine because there were none.
		//
		// The `app/` entries themselves are deleted at cutover, at which point the
		// first glob covers the SPA alone and this one matches nothing. Harmless
		// either way, so it is left until the Next tree is fully gone.
		include: [
			"apps/**/src/**/*.test.ts",
			"apps/**/src/**/*.test.tsx",
			"apps/web/app/**/*.test.ts",
			"packages/**/src/**/*.test.ts",
			"packages/**/src/**/*.test.tsx",
			// scripts/ holds two things CI depends on and nothing else tested:
			// the release-notes cap (a .cjs invoked by semantic-release inside a
			// workflow) and build-bundles.mjs (the deploy payload). Their tests
			// live beside them here rather than under a src/, which is why this
			// fourth glob is needed — the three above match nothing in scripts/.
			"scripts/**/*.test.ts",
		],
		environment: "node",
		// Each file gets its own module registry + process, so module mocks
		// (vi.mock) never leak between test files.
		isolate: true,
	},
})
