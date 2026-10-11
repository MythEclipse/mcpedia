import { defineConfig } from "drizzle-kit"
import { DATABASE_URL } from "@mcpedia/config"

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema.ts",
	out: "./drizzle",
	dbCredentials: { url: DATABASE_URL },
	verbose: true,
	strict: true,
})
