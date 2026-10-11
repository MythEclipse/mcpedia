/**
 * Where better-auth's endpoints live.
 *
 * A LEAF MODULE, like src/lib/sections.ts and for the same reason: the root
 * vitest config runs without the `#/…` alias (declared in apps/web/vite.config.ts,
 * and vitest.config.mts is shared and outside this task's write scope). Keeping
 * the constant here lets the endpoint contract be asserted without importing
 * createAuthClient, which touches nanostores and `window`.
 *
 * It is re-exported by auth-client.ts, which is what page code should import.
 */

/**
 * better-auth's catch-all PATH on the SPA's own origin.
 *
 * Same-origin is load-bearing: the session cookie is first-party, and a
 * cross-origin call would drop it. This is the path vite.config.ts proxies in
 * dev, and the path apps/api is specified to mount (see api-client.ts's contract
 * note — the API does not serve it yet, which is a blocker, not a design choice).
 */
export const AUTH_BASE_PATH = "/api/auth"

/**
 * @deprecated Renamed to AUTH_BASE_PATH. The name said "URL" but the value is a
 * path, and passing it to createAuthClient's `baseURL` option THROWS:
 * getBaseURL runs it through assertHasProtocol, which requires an absolute
 * http(s) URL, so `"/api/auth"` fails with "Invalid base URL". Use `basePath`,
 * which better-auth appends to the page origin. Verified in the installed
 * dist/utils/url.mjs (withPath -> assertHasProtocol).
 */
export const AUTH_BASE_URL = AUTH_BASE_PATH
