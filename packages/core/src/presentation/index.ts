/**
 * The presentation layer.
 *
 * ## WHY THERE IS ALMOST NOTHING HERE
 *
 * The task asked for presentation/ to hold the oRPC routers, and that is where
 * they would go if this package served RPC. It does not: the RPC surface lives
 * in apps/api/src/presentation/routers/, and the brief requires those routers to
 * keep working unchanged from the outside. Moving them into @mcpedia/core would
 * mean apps/api's public contract is defined by a package it no longer owns,
 * and would drag the Hono/oRPC/zod dependencies into a package that apps/mcp,
 * the queue worker and the CLI all import in-process — three processes that have
 * no use for an HTTP router and would pay for the dependency graph.
 *
 * So the layer exists as a named, documented boundary rather than as a move:
 * this is where transport-shaped concerns belong when core serves a transport,
 * and the file records why the current RPC surface lives in apps/api instead.
 *
 * What IS here is the one presentation concern that genuinely belongs to the
 * core: turning the domain's `FolderInfo` into the shape the slug page consumes.
 * That mapping is a contract between the two, it has a name, and pinning it here
 * means a change to either side fails in one place.
 */

import type { FolderInfo } from "../domain"
import { classifyPath, extractFoldersForSection } from "../domain"

/**
 * Build the folder view for one path within a section.
 *
 * Exported from the presentation layer because the ANSWER is addressed to a
 * renderer — "is this a document, a folder, or neither?" is a question only a
 * page asks — while the two predicates behind it are domain logic and stay
 * importable on their own.
 *
 * Both are computed from ONE list of slugs, never two. A document created
 * between two separate reads would make the classification say "none" while the
 * folder tree still showed its parent, and the page would 404 on a document
 * that exists.
 */
export function folderView(
	docSlugs: string[],
	section: string,
	path: string,
): FolderInfo {
	return {
		classification: classifyPath(docSlugs, path),
		folders: extractFoldersForSection(docSlugs, section),
		docCount: docSlugs.length,
	}
}
