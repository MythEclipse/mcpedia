import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { DATABASE_URL } from "@mcpedia/config"
import * as schema from "./schema"

// PgBouncer (imrnes :6432) uses transaction pooling, which rejects protocol
//-level prepared statements. prepare:false makes postgres-js use simple queries.
const client = postgres(DATABASE_URL, {
	prepare: false,
	max: 5,
	onnotice: () => {},
})

export const db = drizzle(client, { schema })
export { schema, client }
