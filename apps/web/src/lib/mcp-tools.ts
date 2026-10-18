/**
 * The number of MCP tools this deployment exposes, as shown on the home page.
 *
 * It is a constant here rather than inline in the two components that render it
 * because inline is exactly how it went wrong: the same figure was written in
 * InteractiveTopology.tsx and routes/home.tsx, tools were added over time, and
 * both copies silently kept claiming 13 against a server that answers with 18.
 * One constant, asserted against the real source by mcp-tools.test.ts, cannot
 * drift that way.
 *
 * A LEAF MODULE ON PURPOSE — it imports nothing, so a test can load it without
 * pulling in the React tree or the `#/…` alias, which the root vitest config
 * does not resolve.
 */

/**
 * Count `registerTool(` registrations in an MCP server source file.
 *
 * Deliberately textual rather than an import: apps/mcp/src/index.ts constructs
 * a server and opens transports at module scope, so importing it from a test
 * would start the real server. Reading the source is what makes the assertion
 * below a real check on the shipped file rather than on a re-typed number.
 */
export function countRegisteredTools(source: string): number {
	return source.match(/\bregisterTool\(/g)?.length ?? 0
}

/** Live count from a `tools/list` against :4021 on 2026-10-18. */
export const MCP_TOOL_COUNT = 18
