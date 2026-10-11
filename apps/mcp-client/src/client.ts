import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type {
	CallToolResult,
	ListResourcesResult,
	ReadResourceResult,
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

// Type-cast helper for the SDK's content union (avoids TS noise from zod-v4 typing).
type AnyContent = {
	text?: string
	uri?: string
	mimeType?: string
	blob?: string
}
function extractText(result: CallToolResult): string {
	return ((result.content?.[0] as AnyContent) ?? {}).text ?? ""
}

export class McpediaClient {
	private client: Client
	private options: McpediaClientOptions

	private constructor(client: Client, options: McpediaClientOptions) {
		this.client = client
		this.options = options
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
		return new McpediaClient(client, options)
	}

	// --- Tool wrappers ---

	async listTools(): Promise<any[]> {
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
	async listDocuments(section?: string): Promise<any[]> {
		const args: Record<string, unknown> = {}
		if (section) args.section = section
		const result = await this.callTool("list_documents", args)
		return JSON.parse(extractText(result) || "[]")
	}

	/** Get full markdown body of a document by slug. */
	async getDocument(slug: string): Promise<string> {
		const result = await this.callTool("get_document", { slug })
		return extractText(result)
	}

	/** Keyword (full-text) search. */
	async search(query: string, limit = 20): Promise<any[]> {
		const result = await this.callTool("search_documents", { query, limit })
		return JSON.parse(extractText(result) || "[]")
	}

	/** Semantic search (embedding-based). */
	async semanticSearch(query: string, limit = 10): Promise<any[]> {
		const result = await this.callTool("semantic_search", { query, limit })
		return JSON.parse(extractText(result) || "[]")
	}

	/** Hybrid search (FTS + semantic via RRF). */
	async hybridSearch(query: string, limit = 10): Promise<any[]> {
		const result = await this.callTool("hybrid_search", { query, limit })
		return JSON.parse(extractText(result) || "[]")
	}

	/** Get related documents by shared tags. */
	async getRelated(slug: string, limit = 5): Promise<any[]> {
		const result = await this.callTool("get_related_documents", { slug, limit })
		return JSON.parse(extractText(result) || "[]")
	}

	/** Index (re-index) a single document. */
	async indexDocument(slug: string): Promise<any> {
		const result = await this.callTool("index_document", { slug })
		return JSON.parse(extractText(result) || "{}")
	}

	/** Full-corpus reindex. */
	async reindexAll(): Promise<any> {
		const result = await this.callTool("reindex_all", {})
		return JSON.parse(extractText(result) || "{}")
	}

	/** Current queue status. */
	async queueStatus(): Promise<any> {
		const result = await this.callTool("queue_status", {})
		return JSON.parse(extractText(result) || "{}")
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
	}): Promise<any> {
		const result = await this.callTool("create_document", input)
		return JSON.parse(extractText(result) || "{}")
	}

	/** Update a document (requires x-webhook-secret). */
	async updateDocument(
		slug: string,
		updates: Record<string, unknown>,
	): Promise<any> {
		const result = await this.callTool("update_document", { slug, ...updates })
		return JSON.parse(extractText(result) || "{}")
	}

	/** Delete a document (requires x-webhook-secret). */
	async deleteDocument(slug: string): Promise<any> {
		const result = await this.callTool("delete_document", { slug })
		return JSON.parse(extractText(result) || "{}")
	}

	// --- Resource wrappers ---

	async listResources(): Promise<any[]> {
		const res = (await this.client.listResources()) as ListResourcesResult
		return res.resources
	}

	/** Read a resource by URI (e.g. mcpedia://docs). */
	async readResource(
		uri: string,
	): Promise<{ uri: string; mimeType: string; text: string }> {
		const res = (await this.client.readResource({ uri })) as ReadResourceResult
		const item = res.contents[0] as AnyContent
		return {
			uri: item.uri ?? uri,
			mimeType: item.mimeType ?? "text/plain",
			text: item.text ?? "",
		}
	}

	/** Graceful disconnect. */
	async disconnect() {
		await this.client.close()
	}
}
