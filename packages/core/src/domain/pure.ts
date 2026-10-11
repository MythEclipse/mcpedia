/**
 * Pure domain decisions.
 *
 * `shouldCreateRevision` is MOVED, NOT REWRITTEN. It was already exported from
 * the former `src/index.service.ts`, it is already covered by four tests, and
 * the brief is explicit that it is reused as-is. The body below is the same
 * expression it always was, with the same `boolean` return type:
 *
 *     return latestBody == null || latestBody !== body
 *
 * What changed is only that it now sits next to the predicate's other consumers
 * in the domain layer, so "is this worth a revision?" reads as a domain rule
 * rather than a detail buried in a database service. It is still exported from
 * the package barrel under the same name, so nothing downstream had to change.
 *
 * Its existing test file asserts on the SOURCE of the caller to prove the rule
 * is not re-implemented privately; that assertion is updated in
 * index.service.test.ts to point at the new caller location.
 */
export function shouldCreateRevision(
	latestBody: string | null | undefined,
	body: string,
): boolean {
	return latestBody == null || latestBody !== body
}
