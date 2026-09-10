/**
 * Structural equality for what the bridge hands over: primitives, arrays and plain objects, as
 * deep as they go. Two answers to the same question read as equal even though every IPC reply is
 * a fresh set of objects.
 */
export function isDeepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) {
		return true;
	}
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
		return false;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, index) => isDeepEqual(item, b[index]))
		);
	}
	const left = a as Record<string, unknown>;
	const right = b as Record<string, unknown>;
	const keys = Object.keys(left);
	return (
		keys.length === Object.keys(right).length &&
		keys.every((key) => Object.hasOwn(right, key) && isDeepEqual(left[key], right[key]))
	);
}
