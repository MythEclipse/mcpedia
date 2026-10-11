import type { NextConfig } from "next"

const nextConfig: NextConfig = {
	// @mcpedia/db pulls in the `postgres` driver + node:fs; keep it external to
	// the server bundle so it runs in the Node runtime as-is.
	serverExternalPackages: [
		"@mcpedia/core",
		"@mcpedia/db",
		"@mcpedia/config",
		"@mcpedia/parser",
		"@mcpedia/search",
		"@mcpedia/queue",
	],
}

export default nextConfig
