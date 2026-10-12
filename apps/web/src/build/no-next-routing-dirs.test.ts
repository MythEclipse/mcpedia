import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * THE SPA MUST NOT REINTRODUCE A DIRECTORY NAME NEXT.JS CLAIMS.
 *
 * Next used to live in this package alongside the SPA. It is gone: apps/web is a
 * Vite SPA, served as static files, and `app/` was a 55-file rollback path that
 * nobody rolled back to.
 *
 * The rule is kept because it outlives Next. `pages` in particular is a name a
 * developer reaches for unthinkingly, and a directory called `src/pages` or
 * `src/app` reads as routing structure in a codebase that has no file-based
 * routing at all. If the SPA's screens are ever moved, they go to `src/screens`
 * (where the router in `src/routes.tsx` points) or the router moves with them.
 *
 * The `app/` deletion also took the "Next owns routing roots" hazard with it —
 * that failure mode cannot recur while Next is not installed.
 */

const WEB = join(dirname(new URL(import.meta.url).pathname), "../..")

const deployScript = () => join(REPO, "scripts/deploy-direct.sh")

/**
 * The deploy script with its comments removed.
 *
 * Asserting on the raw text of a shell script that documents itself produces
 * assertions about the documentation. This script says outright that it does
 * "no clone, no pnpm install, no build", so a `not.toContain("pnpm install")`
 * over the file as written fails on the sentence explaining the rule. Stripping
 * comment lines leaves only what the script actually executes, which is the
 * thing worth pinning.
 */
function executableLines(script: string): string {
	return script
		.split("\n")
		.filter((line) => {
			const trimmed = line.trim()
			if (trimmed.startsWith("#")) return false
			// A `#` inside quotes is data, not a comment; only a `#` that opens
			// the line (or follows only whitespace) starts a comment.
			return trimmed.length > 0
		})
		.join("\n")
}

describe("apps/web carries no Next.js residue", () => {
	it("has no Next app/ tree or next.config", () => {
		// If this fails, Next came back. Everything below is then advisory.
		expect(existsSync(join(WEB, "app"))).toBe(false)
		expect(existsSync(join(WEB, "next.config.ts"))).toBe(false)
		expect(existsSync(join(WEB, "next.config.js"))).toBe(false)
	})

	it("has no SPA-owned directory named app/ or pages/ under src/", () => {
		// src/screens is deliberately NOT in this list: it is an ordinary
		// directory as far as any future convention is concerned.
		const src = join(WEB, "src")
		expect(existsSync(src)).toBe(true)

		for (const entry of readdirSync(src, { withFileTypes: true })) {
			expect(
				entry.isDirectory() && ["app", "pages"].includes(entry.name),
				`src/${entry.name} is a routing-shaped name this SPA does not use. ` +
					`src/screens is the established location for SPA screens.`,
			).toBe(false)
		}
	})

	it("keeps the SPA screens under src/screens/", () => {
		expect(existsSync(join(WEB, "src/screens"))).toBe(true)
		expect(existsSync(join(WEB, "src/screens/login.tsx"))).toBe(true)
		expect(existsSync(join(WEB, "src/screens/create.tsx"))).toBe(true)
	})
})

/**
 * NEXT MUST NOT REAPPEAR ANYWHERE THE DEPLOY PATH READS.
 *
 * The test above only looked inside apps/web, and that was not enough: when the
 * Next tree was deleted, `scripts/deploy-direct.sh` kept its
 * `next build` line. Nothing failed. CI stayed green, because CI builds through
 * moon and moon builds the web app with Vite — so the one file that still spoke
 * Next was the one file CI never executes. The break would have landed on the
 * host, at deploy time, after CI had already approved the SHA.
 *
 * So the rule is stated against the DEPLOY PATH, not against a directory: any
 * file the deploy script or a launcher runs is checked for a Next invocation.
 * This is the tripwire that would have caught it.
 */
const REPO = join(WEB, "../..")

/** Files that execute on the host during a deploy, or when a unit restarts. */
const DEPLOY_EXECUTABLES = [
	"scripts/deploy-direct.sh",
	"scripts/build-bundles.mjs",
	".launcher-mcpedia-api.sh",
	".launcher-mcpedia-mcp.sh",
	".launcher-mcpedia-web.sh",
	".launcher-mcpedia-worker.sh",
]

describe("the deploy path invokes no Next tooling", () => {
	it.each(DEPLOY_EXECUTABLES)("%s names no next binary", (rel) => {
		const abs = join(REPO, rel)
		expect(existsSync(abs)).toBe(true)
		const body = readFileSync(abs, "utf8")
		// The shape that matters is a binary being EXECUTED, which in a shell
		// script means the token is followed by arguments or is path-qualified:
		//   ./node_modules/.bin/next build
		//   npx next build
		//   exec next start
		// A bare mention inside prose — "the next deploy", a backticked `next`
		// in a comment explaining the migration — has no path prefix and no
		// arguments after it, and must not trip this. Matching on that shape
		// rather than on the word alone is what keeps the rule honest: a
		// tripwire that fires on its own documentation is one nobody reads.
		const invocation = body.match(
			/(?:\.bin\/|\bnpx\s+|\byarn\s+|\bpnpm\s+exec\s+|\bexec\s+)next\b/,
		)
		expect(
			invocation,
			`${rel} appears to invoke \`next\`. This repo is a Vite SPA; a Next ` +
				`invocation here fails at deploy time on the host, not in CI.`,
		).toBeNull()
	})

	it("declares no next dependency anywhere", () => {
		// A `next` in a manifest is how the residue comes back: the script above
		// is the symptom, an installed binary is the cause.
		for (const manifest of [
			"package.json",
			"apps/api/package.json",
			"apps/web/package.json",
			"apps/mcp/package.json",
			"apps/mcp-client/package.json",
			"apps/worker/package.json",
		]) {
			const deps = JSON.parse(readFileSync(join(REPO, manifest), "utf8"))
			const declared = {
				...deps.dependencies,
				...deps.devDependencies,
			}
			expect(Object.keys(declared)).not.toContain("next")
		}
	})

	it("stages the SPA payload the web launcher actually execs", () => {
		// The launcher runs `node serve.mjs` from the release directory, so both
		// that script and the dist it serves have to be in the deploy payload.
		// Without this, the restart lands on a launcher with nothing to run.
		//
		// The deploy script stopped declaring a src:dst BUNDLES table when it
		// moved to releases/<sha> + a `current` symlink, so the assertion follows
		// the paths as they are actually referenced now: each is named on its own
		// rather than as one side of a `src:dst` pair.
		// The deploy no longer names apps/web/dist: CI builds it and the host
		// receives $ARTIFACT_DIR/web. What still has to hold is that the web
		// payload is assembled from a web/ folder and that serve.mjs — which the
		// launcher execs — ships with it.
		const deploy = executableLines(readFileSync(deployScript(), "utf8"))
		expect(deploy).toContain("$ARTIFACT_DIR/web")
		expect(deploy).toContain("serve.mjs")
		expect(existsSync(join(WEB, "serve.mjs"))).toBe(true)
	})

	it("keeps the production host out of the build", () => {
		// The host used to clone the repo, install dependencies and run vite +
		// esbuild on the VPS, which meant the bundle serving production was
		// compiled against whatever the lockfile happened to say at deploy time
		// rather than against the tree the gate verified. CI builds; the host only
		// receives ARTIFACT_DIR.
		//
		// Asserted as a negative because the regression is invisible: a deploy
		// that starts building again still succeeds, just slower and less
		// reproducibly, so nothing else would fail.
		// Comments are stripped: this script spells out what it does NOT do
		// ("no clone, no pnpm install, no build"), so a raw-text assertion
		// matches the explanation of the rule instead of the rule itself, and the
		// negative case fails on the very comment that documents it.
		const deploy = executableLines(readFileSync(deployScript(), "utf8"))
		for (const step of [
			"pnpm install",
			"vite build",
			"build-bundles",
			"git fetch",
			"git reset",
			"db:migrate",
		]) {
			expect(deploy).not.toContain(step)
		}
		expect(deploy).toContain("ARTIFACT_DIR")
	})

	it("ships the migration journal beside the migrate bundle", () => {
		// drizzle reads its .sql files from disk relative to the migrator's own
		// module URL. esbuild inlines JavaScript but leaves every other file type
		// behind, so a payload without the journal runs, finds an empty folder
		// and reports SUCCESS while changing no schema at all. Both the bundler
		// and the deploy script have to carry it explicitly.
		const builder = readFileSync(
			join(REPO, "scripts/build-bundles.mjs"),
			"utf8",
		)
		expect(builder).toContain("apps/api/src/migrate.ts")
		expect(builder).toContain("drizzle")

		const deploy = executableLines(readFileSync(deployScript(), "utf8"))
		expect(deploy).toContain("api/drizzle/")
	})

	it("launches the web payload through the current symlink, not a fixed release", () => {
		// A launcher naming a concrete release pins the service to that release
		// until someone edits the file, so a deploy would restart the old build
		// and report success. Resolving `current` at exec time is what makes a
		// rollback a symlink flip.
		const launcher = readFileSync(
			join(REPO, ".launcher-mcpedia-web.sh"),
			"utf8",
		)
		expect(launcher).toContain("cd /opt/mcpedia-web/current")
		expect(launcher).not.toMatch(/releases\/[0-9a-f]{7,40}/)
	})
})
