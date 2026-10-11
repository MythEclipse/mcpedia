import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { createMcpServer } from "./index"

// Phase 3 follow-up: serve the MCPedia MCP server over Streamable HTTP
// (MCP 2025-03-26 transport) so remote clients can use its tools/resources
// without spawning a stdio subprocess. Stateless mode (sessionIdGenerator
// undefined): one McpServer + transport per request, no session affinity, no
// shared-transport connect race, no session-map memory leak. Re-registering
// 6 tools + 4 resources per request is negligible for a KB-sized corpus.

const PORT = Number(process.env.MCP_PORT ?? 4021)
const PATH = "/mcp"

const CORS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
	"Access-Control-Allow-Headers":
		"Content-Type, Accept, Authorization, MCP-Protocol-Version, mcp-session-id",
}

const httpServer = createServer(
	async (req: IncomingMessage, res: ServerResponse) => {
		for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v)

		if (req.method === "OPTIONS") {
			res.writeHead(204).end()
			return
		}

		if ((req.url ?? "").split("?")[0] !== PATH) {
			res.writeHead(404).end("Not found")
			return
		}

		// Stateless: fresh server + transport per request. The x-webhook-secret header
		// (if present) is threaded into the server so write tools can require it.
		const rawSecret = req.headers["x-webhook-secret"]
		const authSecret = Array.isArray(rawSecret) ? rawSecret[0] : rawSecret
		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
		})
		const server = createMcpServer(authSecret)
		await server.connect(transport)
		await transport.handleRequest(req, res)
	},
)

httpServer.listen(PORT, () => {
	console.log(
		`MCPedia MCP server (Streamable HTTP) listening on http://localhost:${PORT}/mcp`,
	)
})
