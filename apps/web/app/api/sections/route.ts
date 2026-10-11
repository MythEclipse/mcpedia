import { NextResponse } from "next/server"
import { listSections } from "@mcpedia/core"

export const dynamic = "force-dynamic"

// GET /api/sections — list all active sections with document counts dynamically from PostgreSQL.
export async function GET() {
	try {
		const sections = await listSections()
		return NextResponse.json(sections)
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err)
		return NextResponse.json({ error: msg }, { status: 500 })
	}
}
