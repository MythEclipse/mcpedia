import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createMcpServer } from "../src/index"

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
	const hits = JSON.parse((search.content as any)[0].text)
	if (!Array.isArray(hits) || hits.length < 1) {
		throw new Error("search_documents returned no hits")
	}
	console.log(`search_documents("websocket") => ${hits.length} hits`)
	console.log("  top:", hits[0].doc.slug, hits[0].doc.title)

	// 3) get_document
	const get = await client.callTool({
		name: "get_document",
		arguments: { slug: "docs/websocket/contract" },
	})
	const body = (get.content as any)[0].text
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
	if (!(missing as any).isError) {
		throw new Error("get_document should report isError for missing doc")
	}
	console.log("get_document('nope/missing') => isError ok")

	// 5) list_documents
	const list = await client.callTool({
		name: "list_documents",
		arguments: { section: "docs" },
	})
	const docs = JSON.parse((list.content as any)[0].text)
	if (docs.length !== 4)
		throw new Error(`list_documents docs != 4 (got ${docs.length})`)
	console.log("list_documents(section=docs) =>", docs.length, "doc")

	// 6) semantic_search
	const sem = await client.callTool({
		name: "semantic_search",
		arguments: { query: "websocket connection closing unexpectedly", limit: 5 },
	})
	const semHits = JSON.parse((sem.content as any)[0].text)
	if (!Array.isArray(semHits) || semHits.length < 1) {
		throw new Error("semantic_search returned no hits")
	}
	console.log(
		`semantic_search => ${semHits.length} chunks, top: ${semHits[0].slug}@${semHits[0].score.toFixed(3)}`,
	)

	// 7) hybrid_search
	const hyb = await client.callTool({
		name: "hybrid_search",
		arguments: { query: "websocket timeout debugging", limit: 5 },
	})
	const hybHits = JSON.parse((hyb.content as any)[0].text)
	if (!Array.isArray(hybHits) || hybHits.length < 1) {
		throw new Error("hybrid_search returned no hits")
	}
	console.log(
		`hybrid_search => ${hybHits.length} docs, top: ${hybHits[0].doc.slug}`,
	)

	// 8) resources: list
	const resList = await client.listResources()
	const resNames = resList.resources.map((r: any) => r.name).sort()
	console.log("resources:", resNames.join(", "))
	if (!resNames.includes("mcpedia-docs-list")) {
		throw new Error("expected mcpedia-docs-list resource")
	}

	// 9) resource: read the docs list (must not throw, returns JSON content)
	const readList = await client.readResource({ uri: "mcpedia://docs" })
	const listText = (readList.contents as any)[0].text
	if (!listText.includes("docs/websocket/contract")) {
		throw new Error("mcpedia://docs did not list the websocket contract doc")
	}
	console.log("readResource(mcpedia://docs) => ok")

	// 10) resource: read a single doc body + revisions
	const readDoc = await client.readResource({
		uri: "mcpedia://docs/docs/websocket/contract",
	})
	const docText = (readDoc.contents as any)[0].text
	if (!docText.includes("WebSocket Contract")) {
		throw new Error("mcpedia://docs/{slug} returned unexpected body")
	}
	console.log("readResource(mcpedia://docs/docs/websocket/contract) => ok")

	const readRev = await client.readResource({
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
