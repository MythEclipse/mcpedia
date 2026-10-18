#!/usr/bin/env node
/**
 * The `moon run :check` gate: typecheck, tests, bundles, migration drift.
 *
 * ## WHY A RUNNER RATHER THAN FOUR MOON TASKS
 *
 * The four things this gate runs are all ROOT-scoped: one vitest.config.mts
 * covers every workspace, one esbuild script bundles the three services, and
 * the drift check reads packages/db. moon cannot express "run this once for the
 * whole workspace" as an inherited task — an inherited task runs once per
 * project, so declaring `test` here would run the entire suite fourteen times.
 *
 * So `:check` is a single inherited task that delegates to this script, and the
 * script is the one place the gate is defined. CI runs `moon run :check`, and a
 * developer runs the same thing locally, so "the gate is green" has one
 * definition rather than a list that lives only in a workflow file.
 *
 * ## WHY IT DOES NOT `exec` THE STEPS
 *
 * Each step's output is printed with its exit code, and the script exits
 * non-zero if any failed — but it runs all four rather than stopping at the
 * first. A gate that stops at the first failure makes you re-run to discover
 * the other three, and on CI that is four round trips instead of one.
 */
import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

/**
 * Each step names the binary explicitly.
 *
 * This is the same constraint the .moon/tasks/all.yml typecheck task documents:
 * moon does not put node_modules/.bin on the task PATH, and this script may be
 * invoked BY moon, so it cannot rely on inherited PATH either. A bare `vitest`
 * would resolve to whatever the host happens to have installed.
 */
const STEPS = [
	{
		name: "build:web",
		// BEFORE the tests, and with --force.
		//
		// apps/web/src/build/no-retired-branding.test.ts asserts on dist/ — the
		// bytes a browser actually receives — because a scan of apps/web/src
		// cannot see code that arrives from packages/core. An assertion over
		// dist/ is only meaningful if dist/ is the build of the CURRENT tree,
		// so the build has to happen first and has to be real.
		//
		// --force is load-bearing, not caution. web's build inputs are declared
		// as its own sources (apps/web/moon.yml), and moon resolves input globs
		// per-project, so a change in packages/core does NOT invalidate a cached
		// web:build. Verified: editing packages/core/src/application/export.docx.ts
		// and running a plain `moon run web:build` printed "(cached, 3ms)" and
		// replayed the previous bundle, which made that test pass over a dist/
		// containing a string the source no longer had.
		command: "moon",
		args: ["run", "web:build", "--force"],
	},
	{
		name: "test",
		command: "node",
		args: ["./node_modules/vitest/vitest.mjs", "run"],
	},
	{
		name: "build:bundles",
		command: "node",
		args: ["./scripts/build-bundles.mjs"],
	},
	{
		name: "migration-drift",
		command: "bash",
		args: ["./scripts/check-migration-drift.sh"],
	},
]

/**
 * The five projects that own a tsconfig, and so can actually be typechecked on
 * their own. The other nine (8 packages/ plus scripts/) publish raw TypeScript
 * and are checked TRANSITIVELY through these — verified by injecting a type
 * error into packages/core and watching apps/api report it.
 *
 * `moon run :typecheck` already walks all five through moon's own task graph
 * (the `scripts` project has no tsconfig, and its inherited typecheck task is
 * skipped by the `condition` check). This runner typechecks the same five
 * directly, so `moon run :check` is self-contained: it does not depend on the
 * caller having also run `:typecheck` separately, and its typecheck step
 * covers the same ground.
 */
const TYPECHECK_PROJECTS = [
	"apps/api",
	"apps/mcp",
	"apps/mcp-client",
	"apps/web",
	"apps/worker",
]

function typecheck() {
	const tsc = "./node_modules/typescript/bin/tsc"
	let failed = 0
	for (const project of TYPECHECK_PROJECTS) {
		console.log(`-- tsc --noEmit -p ${project}`)
		const r = spawnSync("node", [tsc, "--noEmit", "-p", project], {
			cwd: REPO_ROOT,
			stdio: "inherit",
			env: process.env,
		})
		if (r.status !== 0) failed++
	}
	return failed === 0 ? 0 : 1
}

function run(step) {
	console.log(`\n${"=".repeat(68)}`)
	console.log(`== ${step.name}`)
	console.log("=".repeat(68))
	const result = spawnSync(step.command, step.args, {
		cwd: REPO_ROOT,
		stdio: "inherit",
		env: process.env,
	})
	// null means the binary could not be spawned at all (missing, not
	// executable). That is a failure, not a skip.
	return result.status === null ? 1 : result.status
}

const results = [
	{ name: "typecheck", code: typecheck() },
	...STEPS.map((step) => ({ name: step.name, code: run(step) })),
]
const failed = results.filter((r) => r.code !== 0)

console.log(`\n${"=".repeat(68)}`)
console.log("== check summary")
console.log("=".repeat(68))
for (const r of results) {
	console.log(`${r.code === 0 ? "PASS" : "FAIL"}  ${r.name}`)
}

if (failed.length > 0) {
	console.error(
		`\n${failed.length} of ${results.length} steps failed: ${failed
			.map((f) => f.name)
			.join(", ")}`,
	)
	process.exit(1)
}
console.log(`\nall ${results.length} steps passed`)
