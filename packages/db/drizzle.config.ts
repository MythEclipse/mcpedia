import { DATABASE_URL } from "@mcpedia/config"
import { defineConfig } from "drizzle-kit"

export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema.ts",
	out: "./drizzle",
	dbCredentials: { url: DATABASE_URL },
	verbose: true,
	strict: true,
})
