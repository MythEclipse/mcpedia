import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import type { Resource } from "@modelcontextprotocol/sdk/types.js"
import { createMcpServer } from "../src/index"

/** A keyword/hybrid search hit, as the smoke assertions read it. */
interface SearchHit {
	doc: { slug: string; title?: string }
}

/** A semantic chunk hit. */
interface SemanticHit {
	slug: string
	score: number
}

/** The `content` array off a tool result, if it has one. */
function blocksOf(result: unknown): unknown[] {
	if (typeof result !== "object" || result === null) return []
	const { content } = result as { content?: unknown }
	return Array.isArray(content) ? content : []
}

/** The `contents` array off a resource read, if it has one. */
function resourceBlocksOf(result: unknown): unknown[] {
	if (typeof result !== "object" || result === null) return []
	const { contents } = result as { contents?: unknown }
	return Array.isArray(contents) ? contents : []
}

/** The text body of the first block, or "" when there is none. */
function textOf(blocks: unknown[]): string {
	const first: unknown = blocks[0]
	if (typeof first !== "object" || first === null) return ""
	const { text } = first as { text?: unknown }
	return typeof text === "string" ? text : ""
}

/** The text body of a tool result. */
function toolText(result: unknown): string {
	return textOf(blocksOf(result))
}

/**
 * Parse a tool result's text body as JSON.
 *
 * Generic so each call site keeps the concrete shape it immediately indexes
 * into, instead of re-asserting `unknown` at nine separate places.
 */
function toolJson<T>(result: unknown): T {
	return JSON.parse(toolText(result)) as T
}

/** The text body of a resource read. */
function resourceText(result: unknown): string {
	return textOf(resourceBlocksOf(result))
}

/**
 * The first element, or throw.
 *
 * Every caller has already asserted the array is non-empty; this keeps that
 * guarantee in the type instead of scattering `!` across the smoke assertions.
 */
function first<T>(items: readonly T[]): T {
	const head: T | undefined = items[0]
	if (head === undefined) throw new Error("expected a non-empty array")
	return head
}

async function main() {
	const server = createMcpServer()
	const [clientT, serverT] = InMemoryTransport.createLinkedPair()
	await server.connect(serverT)

	const client = new Client({ name: "smoke", version: "0.0.1" })
	await client.connect(clientT)

	// 1) tool discovery
	const tools = await client.listTools()
	const names = tools.tools.map((t) => t.name).sort()
	console.log("tools:", names.join(", "))
	const expected = [
		"create_document",
		"delete_document",
		"get_document",
		"get_related_documents",
		"hybrid_search",
		"index_document",
		"list_documents",
		"list_sections",
		"queue_status",
		"reindex_all",
		"restore_revision",
		"search_documents",
		"semantic_search",
		"update_document",
	].sort()
	if (JSON.stringify(names) !== JSON.stringify(expected)) {
		throw new Error(`tool set mismatch: ${names.join(",")}`)
	}

	// 2) search_documents
	const search = await client.callTool({
		name: "search_documents",
		arguments: { query: "websocket", limit: 10 },
	})
	const hits = toolJson<SearchHit[]>(search)
	if (!Array.isArray(hits) || hits.length < 1) {
		throw new Error("search_documents returned no hits")
	}
	console.log(`search_documents("websocket") => ${hits.length} hits`)
	console.log("  top:", first(hits).doc.slug, first(hits).doc.title)

	// 3) get_document
	const get = await client.callTool({
		name: "get_document",
		arguments: { slug: "docs/websocket/contract" },
	})
	const body = toolText(get)
	if (!body.includes("WebSocket Contract")) {
		throw new Error("get_document returned unexpected body")
	}
	console.log(
		"get_document('docs/websocket/contract') => body ok (len",
		body.length,
		")",
	)

	// 4) get_document not found
	const missing = await client.callTool({
		name: "get_document",
		arguments: { slug: "nope/missing" },
	})
	if (!missing.isError) {
		throw new Error("get_document should report isError for missing doc")
	}
	console.log("get_document('nope/missing') => isError ok")

	// 5) list_documents
	const list = await client.callTool({
		name: "list_documents",
		arguments: { section: "docs" },
	})
	const docs = toolJson<Array<{ slug: string }>>(list)
	if (docs.length !== 4)
		throw new Error(`list_documents docs != 4 (got ${docs.length})`)
	console.log("list_documents(section=docs) =>", docs.length, "doc")

	// 6) semantic_search
	const sem = await client.callTool({
		name: "semantic_search",
		arguments: { query: "websocket connection closing unexpectedly", limit: 5 },
	})
	const semHits = toolJson<SemanticHit[]>(sem)
	if (!Array.isArray(semHits) || semHits.length < 1) {
		throw new Error("semantic_search returned no hits")
	}
	console.log(
		`semantic_search => ${semHits.length} chunks, top: ${first(semHits).slug}@${first(semHits).score.toFixed(3)}`,
	)

	// 7) hybrid_search
	const hyb = await client.callTool({
		name: "hybrid_search",
		arguments: { query: "websocket timeout debugging", limit: 5 },
	})
	const hybHits = toolJson<SearchHit[]>(hyb)
	if (!Array.isArray(hybHits) || hybHits.length < 1) {
		throw new Error("hybrid_search returned no hits")
	}
	console.log(
		`hybrid_search => ${hybHits.length} docs, top: ${first(hybHits).doc.slug}`,
	)

	// 8) resources: list
	const resList = await client.listResources()
	const resNames = resList.resources.map((r: Resource) => r.name).sort()
	console.log("resources:", resNames.join(", "))
	if (!resNames.includes("mcpedia-docs-list")) {
		throw new Error("expected mcpedia-docs-list resource")
	}

	// 9) resource: read the docs list (must not throw, returns JSON content)
	const readList = await client.readResource({ uri: "mcpedia://docs" })
	const listText = resourceText(readList)
	if (!listText.includes("docs/websocket/contract")) {
		throw new Error("mcpedia://docs did not list the websocket contract doc")
	}
	console.log("readResource(mcpedia://docs) => ok")

	// 10) resource: read a single doc body + revisions
	const readDoc = await client.readResource({
		uri: "mcpedia://docs/docs/websocket/contract",
	})
	const docText = resourceText(readDoc)
	if (!docText.includes("WebSocket Contract")) {
		throw new Error("mcpedia://docs/{slug} returned unexpected body")
	}
	console.log("readResource(mcpedia://docs/docs/websocket/contract) => ok")

	await client.readResource({
		uri: "mcpedia://docs/docs/websocket/contract/revisions",
	})
	console.log("readResource(.../revisions) => ok")

	await client.close()
	await server.close()
	console.log("\nSMOKE OK")
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error("SMOKE FAIL:", e)
		process.exit(1)
	})
