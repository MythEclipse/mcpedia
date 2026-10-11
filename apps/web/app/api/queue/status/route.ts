import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// GET /api/queue/status — BullMQ queue counts (read-only, public)
// Falls back gracefully when Redis is unavailable so the UI never breaks.
export async function GET() {
	try {
		const { getQueue } = await import("@mcpedia/queue")
		const q = getQueue()
		const [waiting, active, completed, failed, delayed] = await Promise.all([
			q.getWaitingCount(),
			q.getActiveCount(),
			q.getCompletedCount(),
			q.getFailedCount(),
			q.getDelayedCount(),
		])
		return NextResponse.json({ waiting, active, completed, failed, delayed })
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e)
		// Return zeroed status so the FE can render gracefully
		return NextResponse.json(
			{
				waiting: 0,
				active: 0,
				completed: 0,
				failed: 0,
				delayed: 0,
				error: msg,
			},
			{ status: 200 },
		)
	}
}
