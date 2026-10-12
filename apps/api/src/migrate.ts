#!/usr/bin/env tsx
/**
 * PRODUCTION MIGRATION ENTRYPOINT.
 *
 * ## WHY THIS EXISTS, AND WHY IT IS A SEPARATE PROCESS
 *
 * Drizzle migrations and the API server are different jobs with different
 * failure modes, and running them in one process couples them in ways that only
 * show up during a deploy:
 *
 *   - A migration that fails leaves the server half-started: the port is bound,
 *     the health check answers, and every request 500s because the schema is
 *     wrong. Separating them means a failed migration never starts a server.
 *
 *   - Migrations need EXCLUSIVE access to the schema. A server that is already
 *     accepting traffic holds connections against the old schema while the
 *     migration alters it. That is how a deploy produces a brief window of
 *     errors that no test catches.
 *
 *   - Rollback is a deployment decision, not an automatic consequence of a crash.
 *     If migrations were inside the server, a crash-loop would re-run them on
 *     every restart attempt.
 *
 * The deploy pipeline therefore runs this file to completion BEFORE the server
 * is started or restarted. `pnpm db:migrate` is this file.
 *
 * ## WHY IT DOES NOT IMPORT THE API PACKAGE
 *
 * Importing `apps/api/src/app.ts` here would drag in better-auth, the queue and
 * the full router — and, worse, would make the migration process depend on
 * `BETTER_AUTH_SECRET` being set, when the schema needs nothing of the sort.
 * `db:migrate` is wired to this file directly so that a schema fix can never
 * be blocked by an auth misconfiguration.
 *
 * The actual work and the preflight guard live in @mcpedia/db, which is where
 * the migrations folder and the drizzle instance are. This file is the
 * ENTRYPOINT: it owns process exit codes and the operator-facing output, which
 * is the part that has to be different from a library call.
 */
import { db, client } from "@mcpedia/db"
import { runMigrations } from "@mcpedia/db/migrate"

/**
 * Exit codes, chosen so a deploy script can tell the cases apart:
 *
 *   0  clean, or nothing to do
 *   1  the migration failed — the schema is not what the code expects
 *   2  the target database is not in a state this tool may touch
 *
 * Collapsing 1 and 2 would make "your database is wrong, stop" indistinguishable
 * from "this migration is broken", which is the difference between a rollback
 * and a bug report.
 */
const EXIT_OK = 0
const EXIT_FAILED = 1
const EXIT_REFUSED = 2

async function main(): Promise<number> {
	// runMigrations owns the guard: it preflights, reports, and applies. This
	// file's only added value is the exit code, which is why it does not repeat
	// the check — a second, divergent copy of the preflight is how a deploy path
	// and a local path end up disagreeing about what "migrated" means.
	const outcome = await runMigrations(db)
	if (!outcome.ok) {
		console.error(`\n✗ ${outcome.message}\n`)
		return EXIT_REFUSED
	}
	if (outcome.applied.length === 0) {
		console.log(`✓ ${outcome.message}`)
		return EXIT_OK
	}
	console.log(`✓ ${outcome.message}: ${outcome.applied.join(", ")}`)
	return EXIT_OK
}

// The client is closed on EVERY path, including the refusal and the failure. A
// migration process that exits without ending its pool leaves the deployment's
// database connection count permanently one higher than expected; repeated
// deploys accumulate them until Postgres refuses new connections.
main()
	.then(async (code) => {
		await client.end()
		process.exit(code)
	})
	.catch(async (error: unknown) => {
		console.error(
			"migration failed:",
			error instanceof Error ? error.message : error,
		)
		await client.end()
		process.exit(EXIT_FAILED)
	})
