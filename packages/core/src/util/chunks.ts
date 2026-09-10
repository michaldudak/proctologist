/**
 * Deals `items` into as few chunks as fit under `max`, sized as evenly as possible and keeping the
 * order: 17 items with a cap of 16 become 9 and 8, not 16 and 1. An empty list yields no chunks.
 */
export function chunkEvenly<T>(items: readonly T[], max: number): T[][] {
	if (!Number.isInteger(max) || max < 1) {
		throw new RangeError(`A chunk holds at least one item, got ${String(max)}`);
	}
	if (items.length === 0) {
		return [];
	}
	const count = Math.ceil(items.length / max);
	const size = Math.floor(items.length / count);
	const larger = items.length % count;
	const chunks: T[][] = [];
	let start = 0;
	for (let index = 0; index < count; index += 1) {
		const end = start + size + (index < larger ? 1 : 0);
		chunks.push(items.slice(start, end));
		start = end;
	}
	return chunks;
}
