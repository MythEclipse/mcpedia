// API entry point (invoked by `pnpm api` / the systemd unit).
// Delegates to the testable factory in app.ts so the HTTP surface can be unit-
// tested without a live process. start() fail-fasts on missing WEBHOOK_SECRET.
import { createApp, start } from "./app"
export { createApp, start }
export type { ApiDeps, QueueLike } from "./app"

// --- Type-only public surface -----------------------------------------------
//
// TYPE-ONLY on purpose. `export type` is erased at compile time, so importing
// from this barrel cannot pull runtime server code (Postgres, Redis, the router)
// into a consumer's bundle — which matters because the web app's Next server
// components are about to start importing AppRouter from here.
//
// A plain `export { AppRouter }` would NOT be type-only: AppRouter is a value
// (the router object) whose type is also called AppRouter, and re-exporting it
// as a value would make the barrel import the whole server.
export type { AppRouter } from "./presentation/routers"
export type { AppRole, Session } from "./presentation/context"

// The client-side view of AppRouter: exactly what `createRouterClient` (from
// @orpc/client) returns for a link pointing at this router. Derived here so the
// inference lives in one place instead of being re-derived in every consumer.
//
// Bound explicitly to AppRouter — RouterClient is generic over the router, so
// re-exporting the bare name would hand consumers an unapplied type parameter.
import type { RouterClient } from "@orpc/server"
import type { AppRouter as AppRouterType } from "./presentation/routers"

export type AppRouterClient = RouterClient<AppRouterType, Record<never, never>>

// When run directly (pnpm api), start the server.
const isMain =
	typeof process.argv[1] === "string" &&
	import.meta.url === `file://${process.argv[1]}`
if (isMain) {
	start().catch((err: unknown) => {
		console.error(err)
		process.exit(1)
	})
}
