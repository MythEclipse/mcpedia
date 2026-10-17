import { describe, expect, it } from "vitest"
import { BROWSER_SAFE, rejectionReason, SERVER_ONLY } from "./no-server-imports"

describe("browser bundle guard", () => {
	// The build-time plugin and this test share `rejectionReason`, so the rule
	// asserted here is literally the rule the bundler enforces.
	it("denies every server-only package", () => {
		for (const pkg of SERVER_ONLY) {
			expect(rejectionReason(pkg), pkg).toBeTypeOf("string")
		}
	})

	it("denies a subpath of a server-only package", () => {
		// Fail-closed: only the exact allow-listed specifiers pass. This is the
		// control for the export-helpers exception below: /row-map and /db/schema
		// are siblings of an allowed entry point and are still refused.
		expect(rejectionReason("@mcpedia/core/row-map")).toBeTypeOf("string")
		expect(rejectionReason("@mcpedia/db/schema")).toBeTypeOf("string")
	})

	it("allows core/export-helpers but still denies the core barrel", () => {
		// The /export/pdf port needs the stateless formatting helpers in the
		// browser. The whole justification for allowing that one subpath is that
		// it does not drag in the barrel, so this pair of assertions IS the
		// safety argument — if someone re-adds a db import to export.helpers.ts
		// this test is where that should fail loudly.
		expect(rejectionReason("@mcpedia/core/export-helpers")).toBeNull()
		expect(rejectionReason("@mcpedia/core")).toBeTypeOf("string")
	})

	it("allows core/export-docx but still denies the core barrel", () => {
		// Same shape of argument as the case above, for the .docx writer that
		// replaced the deleted Next /api/export route. This is the assertion that
		// makes the exception reviewable: the subpath is reachable from the
		// browser and the barrel — which pulls Postgres — is not.
		expect(rejectionReason("@mcpedia/core/export-docx")).toBeNull()
		expect(rejectionReason("@mcpedia/core")).toBeTypeOf("string")
	})

	it("denies a subpath adjacent to an allowed export entry point", () => {
		// Fail-closed control, mirroring the /row-map case. The export writers
		// live beside the use cases that read from the database; allowing the two
		// writer subpaths must not open their directory.
		expect(
			rejectionReason("@mcpedia/core/application/export.use-cases"),
		).toBeTypeOf("string")
		expect(rejectionReason("@mcpedia/core/application")).toBeTypeOf("string")
	})

	it("denies @mcpedia/config's bare barrel", () => {
		// config's "." reads .env off disk via node:fs; its /sections subpath
		// has no imports at all and IS safe. Only one of the two is on the
		// allow-list, and this test is what keeps that distinction honest.
		expect(rejectionReason("@mcpedia/config")).toBeTypeOf("string")
		expect(rejectionReason("@mcpedia/config/sections")).toBeNull()
	})

	it("allows the browser-safe packages", () => {
		for (const pkg of BROWSER_SAFE) {
			expect(rejectionReason(pkg), pkg).toBeNull()
		}
	})

	it("ignores Vite's query suffixes", () => {
		// Dev server requests carry ?v= and ?import. Without stripping them the
		// guard would pass in production and fire on every HMR reload.
		expect(rejectionReason("@mcpedia/db?v=1a2b3c")).toBeTypeOf("string")
		expect(rejectionReason("@mcpedia/types?import")).toBeNull()
	})

	it("leaves unrelated specifiers alone", () => {
		expect(rejectionReason("react")).toBeNull()
		expect(rejectionReason("@tanstack/react-router")).toBeNull()
		expect(rejectionReason("./local-module")).toBeNull()
	})
})
