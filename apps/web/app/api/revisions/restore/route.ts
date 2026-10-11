import { NextRequest, NextResponse } from "next/server"
import { restoreRevision, getRevision } from "@mcpedia/core"
import { isAuthorized as isAuthorizedRequest } from "@/lib/auth"
import { revalidatePath } from "next/cache"

function isAuthorized(req: NextRequest): Promise<boolean> {
	return isAuthorizedRequest(req.headers)
}

// POST /api/revisions/restore  — restore a document to a past revision.
// Body (form-urlencoded): id=<revision uuid>
// After restoring, we rebuild semantic chunks (handled inside restoreRevision)
// and revalidate the doc page so the Web UI reflects the restored body.
export async function POST(req: NextRequest) {
	if (!isAuthorized(req)) {
		return NextResponse.json(
			{ ok: false, error: "Unauthorized" },
			{ status: 401 },
		)
	}

	const form = await req.formData().catch(() => null)
	const id = form?.get("id")
	if (typeof id !== "string" || id.length === 0) {
		return NextResponse.json(
			{ ok: false, error: "missing id" },
			{ status: 400 },
		)
	}

	const rev = await getRevision(id)
	if (!rev) {
		return NextResponse.json(
			{ ok: false, error: "revision not found" },
			{ status: 404 },
		)
	}

	const result = await restoreRevision(id)
	if (!result) {
		return NextResponse.json(
			{ ok: false, error: "restore failed" },
			{ status: 500 },
		)
	}

	// Revalidate the doc route + home so the change is visible immediately.
	revalidatePath(`/${result.slug}`)
	revalidatePath("/")

	return NextResponse.redirect(new URL(`/${result.slug}`, req.url))
}
