/**
 * Lexical (Postgres full-text) search — the fallback that keeps search working
 * when hindsight cannot embed.
 *
 * ## WHY THIS EXISTS
 *
 * Every search mode delegated to hindsight, which embeds the query before it can
 * rank anything. When the embedding provider returns 429 — an exhausted quota, a
 * billing lapse, a provider outage — hindsight answers 500, `recall` throws, and
 * ALL THREE public modes fail at once. The site loses search entirely over a
 * dependency that is not the corpus: the documents are in Postgres, and
 * `documents.search_vector` has been a generated `tsvector` column with a GIN
 * index since the schema was written.
 *
 * That column was maintained on every insert and update and read by NOTHING. The
 * index was paying write cost for no read, so this does not add infrastructure —
 * it uses what was already there, which is also why it works on the existing
 * data with no backfill and no migration.
 *
 * ## WHY lexical AND NOT "SEMANTIC FALLBACK"
 *
 * There is no local embedding provider any more: `document_chunks` is legacy and
 * nothing writes to it (packages/db/src/schema.ts), so a degraded semantic arm is
 * not available. Full-text search is genuinely useful on its own — it is exact,
 * it is fast, and on a corpus full of identifiers, flags, and challenge names it
 * is often what the reader wanted anyway — so this is a real reduction in
 * capability rather than a pretend one.
 *
 * ## WHY IT IS NOT SILENT
 *
 * A fallback that looks identical to success is how a search engine quietly
 * degrades to substring matching for a year. The caller is told the mode it got
 * back (`degraded: true`), so the API can say so and an operator can see it in
 * the logs. Ranking is also NOT comparable to hindsight's fused score, so the
 * ranks here are `ts_rank_cd` values scaled into 0..1 — a caller that sorts by
 * rank within one response is fine; a caller comparing ranks across the two
 * engines would not be.
 */
import { db } from "@mcpedia/db"
import { documents } from "@mcpedia/db/schema"
import { and, desc, eq, sql } from "drizzle-orm"
import type { SearchHit } from "@mcpedia/types"
import { toMeta } from "../row-map.ts"

/**
 * `ts_headline` needs the query and the text; it marks matches with these tags.
 * `<mark>` is deliberate — it survives the sanitizer the UI already runs, and it
 * is what a reader expects a highlighted hit to look like.
 */
const HL_START = "<mark>"
const HL_END = "</mark>"

/**
 * A query is user text, and `to_tsquery` wants operators. `websearch_to_tsquery`
 * is the right parser: it accepts what a person actually types (`RSA padding`,
 * `"exact phrase"`, `-excluded`) and never raises a syntax error on stray quotes
 * or a trailing `&` — the failure mode of hand-building a `to_tsquery` string.
 *
 * It has no `ts_headline` counterpart, so the same query is re-derived for the
 * highlighting call below.
 */
const tsQuery = (q: string) => sql`websearch_to_tsquery('simple', ${q})`

/**
 * `ts_rank_cd` with normalization flag 32 (rank/(rank+1)).
 *
 * The flag is load-bearing, not decoration. Raw `ts_rank_cd` is UNBOUNDED — real
 * values on this corpus run 1.6 to 4.4 — so scaling it into 0..1 by clamping
 * (the obvious approach, and this file's first version) pins every strong hit to
 * exactly 1.0 and destroys the ordering the UI sorts on. Flag 32 divides by
 * rank+1, which is both bounded and strictly monotone, so equal raw ranks stay
 * equal and different ones stay ordered.
 */
const tsRank = (q: string) =>
	sql<number>`ts_rank_cd(${documents.searchVector}, ${tsQuery(q)}, 32)`
/**
 * `ts_headline` marks matches with these tags. `<mark>` is deliberate — it
 * survives the sanitizer the UI already runs, and it is what a reader expects a
 * highlighted hit to look like.
 *
 * `Options` is NOT a bind parameter: Postgres parses it as a comma-separated
 * list, so a value containing a comma or a quote breaks the call rather than
 * being quoted. Every value below is a constant, which is what keeps that safe.
 */
const tsHeadlineOptions = () =>
	`StartSel=${HL_START}, StopSel=${HL_END}, MaxWords=40, MinWords=15, ShortWord=3, HighlightAll=false, MaxFragments=2, FragmentDelimiter=" … "`

/**
 * Full-text search over `documents`, newest-first among equal ranks.
 *
 * `limit` is clamped by the caller's schema (max 50); it is interpolated as a
 * bound parameter rather than string-concatenated, so a limit cannot become SQL.
 */
export async function lexicalSearch(
	q: string,
	limit = 10,
): Promise<SearchHit[]> {
	const query = q.trim()
	if (!query) return []

	const rank = tsRank(query)
	const headline = sql<string>`ts_headline('simple', coalesce(${documents.body}, ''), ${tsQuery(query)}, ${tsHeadlineOptions()})`

	const rows = await db
		.select({
			// The row, so toMeta stays the ONE place a Drizzle row becomes a
			// DocumentMeta. Mapping here as well would give one shape two
			// definitions, and the UI reads title/section/status off this.
			doc: documents,
			rank,
			snippet: headline,
		})
		.from(documents)
		.where(
			and(
				sql`${documents.searchVector} @@ ${tsQuery(query)}`,
				// Drafts are excluded for the same reason hindsight's namespace tag
				// excludes other writers' facts: a reader searching the wiki must
				// not find a page that is not published on it.
				eq(documents.status, "published"),
			),
		)
		.orderBy(desc(rank), desc(documents.updatedAt))
		.limit(limit)

	return rows.map((row) => ({
		doc: toMeta(row.doc),
		// Already normalized by tsRank's flag 32: bounded 0..1 and monotone, so
		// no clamping is applied here. A clamp would have to be re-applied on
		// every change to the query, and would silently flatten the ordering if
		// the normalization flag were ever dropped.
		rank: row.rank,
		// ts_headline returns the WHOLE body with matches marked, which is not a
		// snippet. The first fragment is the useful one; 200 chars matches the
		// cap `excerpt()` applies on the hindsight path.
		snippet: firstFragment(row.snippet),
	}))
}

/**
 * `ts_headline` with MaxFragments>0 returns fragments joined by the delimiter.
 * Take the first, and cap it the way the hindsight path caps its excerpt.
 */
function firstFragment(headline: string): string {
	const first = headline.split(" … ")[0] ?? headline
	const flat = first.replace(/\s+/g, " ").trim()
	return flat.length <= 200 ? flat : `${flat.slice(0, 200)}…`
}
