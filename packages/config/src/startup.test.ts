import { describe, expect, it } from "vitest"
import {
	assertStartupEnv,
	assertWebhookSecret,
	collectStartupEnv,
	formatEnvReport,
	MISSING,
} from "./startup.ts"

/**
 * THE STARTUP GATE MUST FAIL LOUDLY, ALL AT ONCE.
 *
 * The behaviour under test is "all problems in one message", not "fails on a
 * missing key". A validator that reports one problem per run turns a
 * three-variable misconfiguration into four deploy cycles, and every one of them
 * looks like the fix worked because the next error is different.
 *
 * Overrides are passed explicitly rather than through `process.env`, so these
 * tests neither depend on nor mutate the developer's real environment.
 */

/** A configuration that is valid in every respect. */
const GOOD = {
	DATABASE_URL: "postgres://user:pw@localhost:5432/mcpedia",
	BETTER_AUTH_SECRET: "a-sufficiently-long-dev-secret",
	BETTER_AUTH_URL: "https://mcpedia.example.com",
	WEBHOOK_SECRET: "hook-secret",
	REDIS_URL: "redis://localhost:6379",
	// The adapter defaults both to a local hindsight, so they are not required
	// — but they must not be BLANK either, which is why a "complete"
	// environment sets them rather than leaving them out.
	HINDSIGHT_API_URL: "http://127.0.0.1:8890",
	HINDSIGHT_BANK_ID: "mcpedia",
} as const

describe("collectStartupEnv", () => {
	it("reports nothing for a complete configuration", () => {
		const report = collectStartupEnv({ ...GOOD })
		expect(report.fatal).toEqual([])
		expect(report.warnings).toEqual([])
	})

	it("lists EVERY missing required key in one pass", () => {
		// MISSING, not `{}`: an empty override object means "fall through to the
		// real environment", so on a machine that exports DATABASE_URL this test
		// would silently accept the ambient value and never exercise the
		// required-ness at all. This is a real trap — it failed here the moment a
		// DATABASE_URL existed in the shell.
		const report = collectStartupEnv({
			DATABASE_URL: MISSING,
			BETTER_AUTH_SECRET: MISSING,
			BETTER_AUTH_URL: MISSING,
		})
		const keys = report.fatal.map((p) => p.key).sort()
		expect(keys).toContain("DATABASE_URL")
		expect(keys).toContain("BETTER_AUTH_SECRET")
		expect(keys).toContain("BETTER_AUTH_URL")
		// Three problems, one call — not one per restart.
		expect(report.fatal.length).toBeGreaterThanOrEqual(3)
	})

	it("rejects a DATABASE_URL that is not a postgres URL", () => {
		const report = collectStartupEnv({ ...GOOD, DATABASE_URL: "mysql://x/y" })
		const db = report.fatal.find((p) => p.key === "DATABASE_URL")
		expect(db?.message).toMatch(/postgres/)
	})

	it("rejects a short BETTER_AUTH_SECRET with actionable advice", () => {
		const report = collectStartupEnv({ ...GOOD, BETTER_AUTH_SECRET: "short" })
		const key = report.fatal.find((p) => p.key === "BETTER_AUTH_SECRET")
		expect(key?.message).toMatch(/openssl rand/)
	})

	it("rejects a non-URL BETTER_AUTH_URL", () => {
		const report = collectStartupEnv({ ...GOOD, BETTER_AUTH_URL: "not-a-url" })
		expect(report.fatal.some((p) => p.key === "BETTER_AUTH_URL")).toBe(true)
	})

	it("treats a missing webhook secret as non-fatal, not fatal", () => {
		// A browser-only deployment legitimately has no MCP secret. Making it
		// fatal would refuse to start a configuration that works fine.
		const report = collectStartupEnv({
			...GOOD,
			WEBHOOK_SECRET: "",
		})
		expect(report.fatal.some((p) => p.key === "WEBHOOK_SECRET")).toBe(false)
		expect(report.warnings.some((p) => p.key === "WEBHOOK_SECRET")).toBe(true)
	})

	// The adapter supplies a local default for both, so an UNSET value is a
	// deliberate choice. A blank STRING is not: the resolved config turns a
	// missing key into "", so a blank HINDSIGHT_API_URL must be reported rather
	// than silently becoming an empty base URL.
	it("treats hindsight settings as optional but not blank-able", () => {
		// Unset entirely: accepted, because the adapter defaults both.
		expect(collectStartupEnv({ ...GOOD }).problems).toEqual([])

		// Blank: reported. This is the WEBHOOK_SECRET `.min(1)` reasoning applied
		// to the new names — absent and empty are different states and only one
		// of them means "use the default".
		//
		// Asserted as a SET, not a list: `""` violates both `.min(1)` and
		// `.url()`, so Zod emits two issues for one key. The count is Zod's
		// business; what matters is that each key is flagged.
		const blank = collectStartupEnv({
			...GOOD,
			HINDSIGHT_API_URL: "",
			HINDSIGHT_BANK_ID: "",
		}).problems
		expect([...new Set(blank.map((p) => p.key))].sort()).toEqual([
			"HINDSIGHT_API_URL",
			"HINDSIGHT_BANK_ID",
		])

		// A malformed URL is caught with a message that names the key.
		const malformed = collectStartupEnv({
			...GOOD,
			HINDSIGHT_API_URL: "not a url",
		}).problems
		expect(malformed.map((p) => p.key)).toContain("HINDSIGHT_API_URL")
	})
})

describe("assertStartupEnv", () => {
	it("stays silent when the environment is usable", () => {
		expect(() => assertStartupEnv({ ...GOOD })).not.toThrow()
	})

	it("throws naming every problem, not just the first", () => {
		let message = ""
		try {
			assertStartupEnv({
				DATABASE_URL: MISSING,
				BETTER_AUTH_SECRET: MISSING,
				BETTER_AUTH_URL: MISSING,
			})
			throw new Error("expected a throw")
		} catch (error) {
			message = error instanceof Error ? error.message : String(error)
		}
		expect(message).toMatch(/DATABASE_URL/)
		expect(message).toMatch(/BETTER_AUTH_SECRET/)
		expect(message).toMatch(/BETTER_AUTH_URL/)
		// The guidance must be present: a bare list of failures is not actionable.
		expect(message).toMatch(/no defaults/i)
	})

	it("never echoes a secret value into the message", () => {
		let message = ""
		try {
			assertStartupEnv({
				...GOOD,
				BETTER_AUTH_SECRET: "SUPER-SECRET-VALUE-THAT-MUST-NOT-LEAK",
			})
		} catch (error) {
			message = error instanceof Error ? error.message : String(error)
		}
		expect(message).not.toMatch(/SUPER-SECRET-VALUE-THAT-MUST-NOT-LEAK/)
	})
})

describe("assertWebhookSecret", () => {
	it("accepts a configured secret", () => {
		expect(() => assertWebhookSecret("s3cret")).not.toThrow()
	})

	it("refuses an empty one, naming the header MCP clients send", () => {
		expect(() => assertWebhookSecret("")).toThrow(/x-webhook-secret/)
	})
})

describe("formatEnvReport", () => {
	it("separates fatal problems from warnings", () => {
		const text = formatEnvReport({
			problems: [
				{ key: "A", message: "m1", fatal: true },
				{ key: "B", message: "m2", fatal: false },
			],
			fatal: [{ key: "A", message: "m1", fatal: true }],
			warnings: [{ key: "B", message: "m2", fatal: false }],
		})
		expect(text).toMatch(/fatal/)
		expect(text).toMatch(/warning/)
		expect(text).toMatch(/A: m1/)
		expect(text).toMatch(/B: m2/)
	})
})
