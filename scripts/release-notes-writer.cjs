/**
 * semantic-release `writeReleaseNotes` that caps the release body length.
 *
 * GitHub rejects a release whose body exceeds 125,000 characters:
 *
 *   Validation Failed: {"resource":"Release","field":"body",
 *                       "message":"body is too long (maximum is 125000 characters)"}
 *
 * A repository's FIRST release generates notes from its entire history, so the
 * size of that body is a function of how long the repo has existed, not of what
 * just changed. GMW has 1889 untagged commits and its first release body blew
 * past the limit. That failure appears exactly once per repo — on the day the
 * pipeline is installed — and then never again, which makes it very easy to
 * misdiagnose as a transient.
 *
 * The same unbounded body is what pushes `git commit -m` past MAX_ARG_STRLEN
 * (128 KiB per argument), so this cap and the short `message` in
 * .releaserc.json address one class of bug from two directions.
 *
 * Deliberately self-contained: it does NOT reach into
 * @semantic-release/release-notes-generator's internals. That package is ESM
 * with a restricted `exports` map and no public `lib/write.js`, so requiring it
 * pins this file to a private path that a patch release can move — a CI failure
 * on an unrelated dependency bump.
 */

const LIMIT = Number(process.env.RELEASE_NOTES_LIMIT || 120000)
const MARKER =
	"_… earlier changes omitted; see the repository history for the full list._"

/**
 * @param {object} context  semantic-release context
 * @param {object} options  plugin options
 * @returns {string} markdown release body
 */
function writeReleaseNotes(context, options) {
	const next = context.nextRelease || {}

	if (!next.notes) return ""

	const notes = next.notes

	// Under the limit: hand back the generator's own text untouched, so a normal
	// release is byte-identical to what the built-in writer would produce.
	if (notes.length <= LIMIT) return notes

	// Over the limit: keep the TOP of the body, cut at a LINE boundary.
	//
	// Cutting on lines rather than on blank-line-separated "sections" is the
	// point. A release body is a handful of headings, each followed by an
	// arbitrarily long bullet list — and consecutive bullets have NO blank line
	// between them, so a 1,600-entry list is a single "section" however long it
	// is. Slicing by section therefore has only two outcomes per section: keep
	// it (and stay over the limit) or drop it (leaving the bare heading it
	// belonged to). Measured on a 140 KB first-release body, that produced an
	// 89-character note reading `### Features` and nothing else — the cap held,
	// and the release was empty.
	//
	// Line-cutting keeps whole bullets and spends the budget: same shape the
	// generator produced, truncated where it ran out of room.
	//
	// The budget arithmetic has to account for the SUFFIX exactly, which is
	// `\n\n` + MARKER + `\n` = MARKER.length + 3. Trimming by one character less
	// leaves the result over LIMIT by exactly 1 — measured, not theorised.
	const SUFFIX = `\n\n${MARKER}\n`
	const budget = LIMIT - SUFFIX.length
	const kept = []
	let size = 0

	for (const line of notes.split("\n")) {
		const cost = line.length + 1
		// A line that ALONE exceeds the remaining budget is hard-sliced rather
		// than kept whole. Taking it whole would defeat the cap — the one case
		// where "keep at least something so the body is never empty", applied
		// naively, returns a body that still fails GitHub's validation. Commit
		// subjects are nowhere near this long, but these notes are generated
		// from commit messages and one pathological line is not worth an
		// unhandled failure on the release that matters most (the first).
		if (cost > budget - size) {
			kept.push(line.slice(0, Math.max(budget - size - 1, 0)))
			break
		}
		kept.push(line)
		size += cost
	}

	return kept.join("\n") + SUFFIX
}

module.exports = writeReleaseNotes
