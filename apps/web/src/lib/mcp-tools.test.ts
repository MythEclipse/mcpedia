import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, expect, it } from "vitest"
import { countRegisteredTools, MCP_TOOL_COUNT } from "./mcp-tools"

// Mirrors the convention in screens/no-secret.test.ts, which also reads real
// source off disk to assert something about a sibling app.
const SRC = join(dirname(new URL(import.meta.url).pathname), "..")

function mcpSource(): string {
	return readFileSync(join(SRC, "../../mcp/src/index.ts"), "utf8")
}

describe("MCP tool count shown on the home page", () => {
	it("matches the number of tools apps/mcp actually registers", () => {
		// The home page claims a tool count to visitors. It said 13 for long
		// enough that a live tools/list answered 18 — the figure lived inline in
		// two components and nothing tied it to the server. MCP_TOOL_COUNT is
		// now the single copy, and this is the assertion that keeps it honest.
		expect(countRegisteredTools(mcpSource())).toBe(MCP_TOOL_COUNT)
	})

	it("counts only registerTool calls, not every mention", () => {
		// Guards the counter itself: the .test.ts files and comments in the repo
		// discuss registerTool by name, and a looser pattern would count prose.
		// Anchoring on the call parenthesis is what makes the number above mean
		// "registrations" rather than "occurrences of this word".
		expect(countRegisteredTools("// registerTool is discussed here")).toBe(0)
		expect(
			countRegisteredTools("server.registerTool({}); server.registerTool({})"),
		).toBe(2)
	})

	it("is a plausible tool count, not a copied-and-stale one", () => {
		// Fails loudly if someone edits the constant to 0 or to a typo'd value
		// without touching the server, which is the drift this test exists for.
		expect(MCP_TOOL_COUNT).toBeGreaterThan(10)
		expect(Number.isInteger(MCP_TOOL_COUNT)).toBe(true)
	})
})
