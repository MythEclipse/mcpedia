// API entry point (invoked by `bun run src/index.ts` / systemd unit).
// Delegates to the testable factory in app.ts so the HTTP surface can be unit-
// tested without a live process. start() fail-fasts on missing WEBHOOK_SECRET.
import { createApp, start } from "./app"
export { createApp, start }
export type { ApiDeps, QueueLike } from "./app"

// When run directly (bun run src/index.ts), start the server.
const isMain =
	typeof process.argv[1] === "string" &&
	import.meta.url === `file://${process.argv[1]}`
if (isMain) {
	start().catch((err: unknown) => {
		console.error(err)
		process.exit(1)
	})
}
