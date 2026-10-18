/**
 * The search surface every consumer imports.
 *
 * ## WHY THIS IS A SHIM AND NOT THE IMPLEMENTATION
 *
 * Callers (two routers, the MCP tool server, the client SDK) import search by
 * name from `@mcpedia/core`, never from a backend. Keeping a thin module here
 * means swapping the engine touches this file and `hindsight.ts` — and nothing
 * in apps/ — which is why hindsight could replace five code paths without a
 * single router changing an import.
 *
 * `toMeta` is deliberately NOT re-exported here. It maps a Drizzle row onto
 * `DocumentMeta` and is used by the document repository and by `row-map.ts`;
 * it is row mapping, not retrieval, and it has one home (`../row-map.ts`).
 * Carrying it here too would give one symbol two import paths, which is how a
 * rename ends up fixing one and missing the other.
 */
export {
	consolidate,
	forgetDocument,
	hybridSearch,
	keywordSearch,
	recallDocumentFacts,
	recallForTest,
	reflect,
	semanticSearch,
} from "./hindsight.ts"
