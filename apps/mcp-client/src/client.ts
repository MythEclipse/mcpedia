import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type {
	CallToolResult,
	ListResourcesResult,
	ReadResourceResult,
	Resource,
	ResourceContents,
	TextContent,
	Tool,
} from "@modelcontextprotocol/sdk/types.js"

// MCP client that talks to the MCPedia MCP server over Streamable HTTP.
//
// Usage:
//   import { McpediaClient } from "@/src/client";
//   const client = await McpediaClient.connect(
//     "https://mcp.asepharyana.my.id/mcp",
//     { headers: { "x-webhook-secret": process.env.WEBHOOK_SECRET } }
//   );
//
//   const docs = await client.listDocuments();
//   const results = await client.search("websocket");
//   const doc = await client.getDocument("docs/websocket/contract");

export interface McpediaClientOptions {
	/** Custom headers to send with each request (e.g. x-webhook-secret for write tools). */
	headers?: Record<string, string>
}

/**
 * A tool result's text payload, from the union of content blocks the SDK allows.
 *
 * `CallToolResult["content"]` is a heterogeneous union (text, image, audio,
 * embedded resource, ...). Only text blocks carry a `text` field, so this is the
 * one shape `extractText` can meaningfully narrow to.
 */
type TextContentBlock = { type?: string; text?: string }

/**
 * Narrow a content block to the text shape without asserting past it.
 *
 * The SDK's own `TextContent` requires `type: "text"`; results reaching a
 * client are validated by the transport, but the declared union still widens
 * `text` to `string | undefined`, and this helper is the single place where
 * that is resolved rather than repeated at every call site.
 */
function asTextContent(block: unknown): TextContentBlock | null {
	if (typeof block !== "object" || block === null) return null
	const record = block as Record<string, unknown>
	if (typeof record.text === "string") return record as TextContentBlock
	if (typeof record.uri === "string") return record as TextContentBlock
	return null
}

function extractText(result: CallToolResult): string {
	const first = result.content?.[0]
	return asTextContent(first)?.text ?? ""
}

/**
 * Parse a JSON tool payload, rejecting anything that is not an object array.
 *
 * Every tool in this client returns a JSON object or array as its text body,
 * and each caller immediately indexes into it. `unknown` is the honest type at
 * the transport boundary; this turns it into the shape the callers rely on, and
 * throws rather than handing back a value that would blow up at the call site.
 */
function parseJson<T>(
	text: string,
	fallback: T,
	expect: "array" | "object",
): T {
	if (text.trim() === "") return fallback
	const parsed: unknown = JSON.parse(text)
	if (Array.isArray(parsed)) {
		if (expect === "array") return parsed as T
		throw new Error("Expected a JSON object from the MCP tool, got an array")
	}
	if (typeof parsed === "object" && parsed !== null) {
		if (expect === "object") return parsed as T
		throw new Error("Expected a JSON array from the MCP tool, got an object")
	}
	throw new Error("Expected JSON from the MCP tool, got a primitive")
}

/** Document metadata as returned by list_documents / get_document. */
export interface DocumentSummary {
	slug: string
	title: string
	section: string
	[key: string]: unknown
}

/** One search hit, as returned by the three search tools. */
export interface SearchHitSummary {
	slug: string
	title?: string
	section?: string
	snippet?: string
	doc?: { slug?: string; title?: string; section?: string; excerpt?: string }
	rank?: number
	score?: number
}

/** Index/reindex acknowledgement. */
export interface IndexAck {
	[index: string]: unknown
}

export class McpediaClient {
	private client: Client

	private constructor(client: Client) {
		this.client = client
	}

	/** Connect to an MCP server over Streamable HTTP. */
	static async connect(
		url: string,
		options: McpediaClientOptions = {},
	): Promise<McpediaClient> {
		const transport = new StreamableHTTPClientTransport(new URL(url), {
			requestInit: options.headers ? { headers: options.headers } : undefined,
		})
		const client = new Client(
			{ name: "mcpedia-client", version: "0.1.0" },
			{ capabilities: {} },
		)
		await client.connect(transport)
		return new McpediaClient(client)
	}

	// --- Tool wrappers ---

	async listTools(): Promise<Tool[]> {
		const res = await this.client.listTools()
		return res.tools
	}

	async callTool(
		name: string,
		args: Record<string, unknown> = {},
	): Promise<CallToolResult> {
		return (await this.client.callTool({
			name,
			arguments: args,
		})) as CallToolResult
	}

	// Convenience methods for MCPedia-specific tools:

	/** List all documents, optionally filtered by section. */
	async listDocuments(section?: string): Promise<DocumentSummary[]> {
		const args: Record<string, unknown> = {}
		if (section) args.section = section
		const result = await this.callTool("list_documents", args)
		return parseJson<DocumentSummary[]>(extractText(result), [], "array")
	}

	/** Get full markdown body of a document by slug. */
	async getDocument(slug: string): Promise<string> {
		const result = await this.callTool("get_document", { slug })
		return extractText(result)
	}

	/** Keyword (full-text) search. */
	async search(query: string, limit = 20): Promise<SearchHitSummary[]> {
		const result = await this.callTool("search_documents", { query, limit })
		return parseJson<SearchHitSummary[]>(extractText(result), [], "array")
	}

	/** Semantic search (embedding-based). */
	async semanticSearch(query: string, limit = 10): Promise<SearchHitSummary[]> {
		const result = await this.callTool("semantic_search", { query, limit })
		return parseJson<SearchHitSummary[]>(extractText(result), [], "array")
	}

	/** Hybrid search (FTS + semantic via RRF). */
	async hybridSearch(query: string, limit = 10): Promise<SearchHitSummary[]> {
		const result = await this.callTool("hybrid_search", { query, limit })
		return parseJson<SearchHitSummary[]>(extractText(result), [], "array")
	}

	/** Get related documents by shared tags. */
	async getRelated(slug: string, limit = 5): Promise<SearchHitSummary[]> {
		const result = await this.callTool("get_related_documents", { slug, limit })
		return parseJson<SearchHitSummary[]>(extractText(result), [], "array")
	}

	/** Index (re-index) a single document. */
	async indexDocument(slug: string): Promise<IndexAck> {
		const result = await this.callTool("index_document", { slug })
		return parseJson<IndexAck>(extractText(result), {}, "object")
	}

	/** Full-corpus reindex. */
	async reindexAll(): Promise<IndexAck> {
		const result = await this.callTool("reindex_all", {})
		return parseJson<IndexAck>(extractText(result), {}, "object")
	}

	/** Current queue status. */
	async queueStatus(): Promise<IndexAck> {
		const result = await this.callTool("queue_status", {})
		return parseJson<IndexAck>(extractText(result), {}, "object")
	}

	/** Create a document (requires x-webhook-secret). */
	async createDocument(input: {
		slug: string
		title: string
		section: "docs" | "writeups" | "research" | "notes"
		body: string
		type?: "documentation" | "writeup" | "research" | "note"
		status?: "published" | "draft"
		author?: string
		tags?: string[]
		extraFields?: Record<string, unknown>
	}): Promise<IndexAck> {
		const result = await this.callTool("create_document", input)
		return parseJson<IndexAck>(extractText(result), {}, "object")
	}

	/** Update a document (requires x-webhook-secret). */
	async updateDocument(
		slug: string,
		updates: Record<string, unknown>,
	): Promise<IndexAck> {
		const result = await this.callTool("update_document", { slug, ...updates })
		return parseJson<IndexAck>(extractText(result), {}, "object")
	}

	/** Delete a document (requires x-webhook-secret). */
	async deleteDocument(slug: string): Promise<IndexAck> {
		const result = await this.callTool("delete_document", { slug })
		return parseJson<IndexAck>(extractText(result), {}, "object")
	}

	// --- Resource wrappers ---

	async listResources(): Promise<Resource[]> {
		const res = (await this.client.listResources()) as ListResourcesResult
		return res.resources
	}

	/** Read a resource by URI (e.g. mcpedia://docs). */
	async readResource(
		uri: string,
	): Promise<{ uri: string; mimeType: string; text: string }> {
		const res = (await this.client.readResource({ uri })) as ReadResourceResult
		const item = res.contents[0] as ResourceContents | undefined
		const withText = asTextContent(item)
		return {
			uri: (item as { uri?: string } | undefined)?.uri ?? uri,
			mimeType:
				(item as { mimeType?: string } | undefined)?.mimeType ?? "text/plain",
			text: withText?.text ?? "",
		}
	}

	/** Graceful disconnect. */
	async disconnect() {
		await this.client.close()
	}
}

// Re-exported so consumers can name the SDK's text block without importing
// from the SDK's deep paths directly.
export type { TextContent }
