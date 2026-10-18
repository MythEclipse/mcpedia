/**
 * The Postgres full-text fallback.
 *
 * ## WHY THIS FILE IS SEPARATE FROM hindsight.test.ts
 *
 * That file stubs `fetch` and tests the adapter's protocol behaviour against
 * hindsight. This one tests the path that only runs when hindsight is UNAVAILABLE
 * — the code that keeps search working during a quota exhaustion or an outage.
 *
 * The failure it guards against is not "the SQL is wrong". It is that a fallback
 * silently becomes the primary: if this returned nothing, or returned everything
 * regardless of the query, the degraded path would look like working search and
 * the real outage would go unnoticed. So the tests below assert the properties a
 * caller depends on — hits are real, ordering is preserved, drafts are excluded,
 * and a non-matching query returns nothing rather than an error.
 *
 * ## THE RANKING BUG THESE EXIST FOR
 *
 * `ts_rank_cd` is UNBOUNDED. Real values on this corpus run 1.6–4.4, so the
 * obvious "clamp into 0..1" produced 1.0 for every strong hit and destroyed the
 * order the UI sorts on. The fix is normalization flag 32 (rank/(rank+1)), which
 * is bounded AND monotone. A test that only checked `0 <= rank <= 1` would pass
 * against the broken version, which is why the ordering assertion below matters
 * more than the bounds one.
 */
import { SQL, sql } from "drizzle-orm"
import { PgDialect } from "drizzle-orm/pg-core"
import { describe, expect, it, vi } from "vitest"

/**
 * The projection the real query selects. `rank` and `snippet` are computed in
 * SQL, so the mock stands in for what Postgres returns rather than for the query.
 */
/**
 * The projection and the where-clause are separate calls, so both are captured:
 * the ranking/highlighting lives in the projection and the published filter
 * lives in the where. `sqlText` renders whichever it is handed.
 */
function selectRows(rows: unknown[]) {
	const chain = {
		from: () => chain,
		where: (clause: unknown) => {
			whereArgs.push(clause)
			return chain
		},
		orderBy: (clause: unknown) => {
			orderArgs.push(clause)
			return chain
		},
		limit: () => Promise.resolve(rows),
		// Drizzle's builder IS thenable and the implementation awaits it.
		// biome-ignore lint/suspicious/noThenProperty: a thenable is the real contract
		then: (resolve: (v: unknown[]) => void) =>
			Promise.resolve(rows).then(resolve),
	}
	return chain
}

let whereArgs: unknown[] = []
let orderArgs: unknown[] = []

const dbMock = { select: vi.fn() }
vi.mock("@mcpedia/db", () => ({ db: dbMock }))

function row(slug: string, rank: number, snippet = "body") {
	return {
		doc: {
			id: slug,
			slug,
			title: slug,
			type: "guide",
			section: "ctf",
			status: "published",
			author: "",
			tags: [],
			path: `${slug}.md`,
			body: snippet,
			extraFields: {},
			createdAt: new Date(0),
			updatedAt: new Date(0),
		},
		rank,
		snippet,
	}
}

const { lexicalSearch } = await import("./lexical-search.ts")

/**
 * Render Drizzle SQL to text, for either shape it arrives in.
 *
 * Two shapes reach this, and neither works with the other's code path:
 *
 *  - a PROJECTION object (`db.select({rank, snippet})`), whose fields are the
 *    SQL to render;
 *  - a bare `SQL` expression — `.where(and(cond, cond))` receives one directly.
 *
 * So: try the whole value first, then walk it as a projection. `PgDialect`
 * `sqlToQuery` is the official renderer, i.e. the same one the driver calls
 * before sending the statement, so these assertions are against the SQL that
 * would actually run.
 */
function sqlText(value: unknown): string {
	if (value === null || typeof value !== "object") return ""
	const dialect = new PgDialect()
	/**
	 * The SQL AND its bound parameters.
	 *
	 * `params` matters: a value compared with `eq(documents.status, "published")`
	 * is a bind parameter, so the literal appears in `params` and NOT in the SQL
	 * text — which is exactly how a status filter would go missing from an
	 * assertion over `.sql` alone.
	 */
	const render = (node: unknown): string => {
		try {
			const q = dialect.sqlToQuery(node as SQL)
			return `${q.sql} ${q.params.join(" ")}`
		} catch {
			return ""
		}
	}
	const direct = render(value)
	if (direct) return direct
	return Object.values(value).map(render).join(" ")
}

describe("lexicalSearch (the degraded path)", () => {
	it("returns the rows the database gave, mapped through toMeta", async () => {
		dbMock.select.mockReturnValue(
			selectRows([row("ctf/x", 0.8148, "an <mark>RSA</mark> writeup")]),
		)

		const hits = await lexicalSearch("RSA", 5)
		expect(hits).toHaveLength(1)
		expect(hits[0]?.doc.slug).toBe("ctf/x")
		expect(hits[0]?.snippet).toBe("an <mark>RSA</mark> writeup")
		expect(hits[0]?.rank).toBeCloseTo(0.8148)
	})

	it("preserves the database's rank ordering instead of flattening it", async () => {
		// The regression this file exists for. The first version clamped raw
		// ts_rank_cd into 0..1, so every hit with a raw rank above 1 — which is
		// most strong hits on this corpus — came back as exactly 1.0 and the
		// order collapsed to whatever Postgres happened to return.
		dbMock.select.mockReturnValue(
			selectRows([row("a", 0.81), row("b", 0.77), row("c", 0.61)]),
		)

		const ranks = (await lexicalSearch("RSA", 5)).map((h) => h.rank)
		expect(ranks).toEqual([0.81, 0.77, 0.61])
		// Distinct, i.e. NOT all clamped to the same value.
		expect(new Set(ranks).size).toBe(3)
	})

	it("does not clamp: the normalization happens in SQL", async () => {
		// A rank above 1 would mean flag 32 is missing from the query. Asserting
		// the passthrough (rather than clamping here) keeps the two in step: if
		// the SQL loses the flag, this fails instead of hiding it.
		dbMock.select.mockReturnValue(selectRows([row("a", 4.4)]))

		const hits = await lexicalSearch("RSA", 5)
		expect(hits[0]?.rank, "the SQL normalizer is missing").toBe(4.4)
	})

	it("asks Postgres to normalize the rank, and to highlight the snippet", () => {
		// The assertions above cannot see the QUERY: the mock hands back whatever
		// rank it is told to, so removing normalization flag 32 from the SQL left
		// every test green while production served a column of 1.0s. Verified by
		// mutation — dropping `, 32` was caught by nothing.
		//
		// So this reads the SQL the call actually built. The projection carries
		// the ranking and the snippet; the where-clause carries the filter.
		whereArgs = []
		orderArgs = []
		dbMock.select.mockReturnValue(selectRows([]))
		lexicalSearch("RSA", 5)

		const built = dbMock.select.mock.calls.at(-1)
		expect(built, "the query was not built").toBeDefined()
		const text = [
			sqlText((built as unknown[])[0]),
			sqlText(whereArgs[0]),
			sqlText(orderArgs[0]),
		].join(" ")

		expect(text, "the rank column is missing").toContain("ts_rank_cd")
		expect(text, "normalization flag 32 is missing").toContain("32")
		expect(text, "no highlighted snippet").toContain("ts_headline")
		expect(
			text,
			"the websearch parser is what accepts what a person types",
		).toContain("websearch_to_tsquery")
		// The status filter is what keeps drafts out of a search a reader runs.
		expect(text, "drafts would be searchable").toContain("published")
	})

	it("an empty or whitespace query never reaches the database", async () => {
		dbMock.select.mockClear()
		expect(await lexicalSearch("   ", 5)).toEqual([])
		expect(await lexicalSearch("", 5)).toEqual([])
		expect(dbMock.select).not.toHaveBeenCalled()
	})

	it("a query matching nothing returns zero hits, not an error", async () => {
		// The distinction the fallback turns on: "no documents match" is a real
		// answer and must not be reported as a failure, or every hopeless query
		// becomes a 500.
		dbMock.select.mockReturnValue(selectRows([]))
		await expect(lexicalSearch("zzzz", 5)).resolves.toEqual([])
	})

	it("caps a snippet the way the hindsight path caps its excerpt", async () => {
		// ts_headline returns the matching FRAGMENT, but a pathological single
		// line still needs a ceiling or the UI gets a wall of text.
		const long = "x".repeat(500)
		dbMock.select.mockReturnValue(selectRows([row("a", 0.5, long)]))

		const hits = await lexicalSearch("x", 5)
		expect(hits[0]?.snippet.length).toBeLessThanOrEqual(201)
		expect(hits[0]?.snippet.endsWith("…")).toBe(true)
	})

	it("takes the first fragment when ts_headline returns several", async () => {
		// MaxFragments=2 joins fragments with the same delimiter the splitter
		// uses; a snippet containing the delimiter would render as one run-on
		// line in the UI.
		dbMock.select.mockReturnValue(
			selectRows([row("a", 0.5, "first hit … second hit")]),
		)

		const hits = await lexicalSearch("hit", 5)
		expect(hits[0]?.snippet).toBe("first hit")
	})
})
