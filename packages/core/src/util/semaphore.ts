/** A counting semaphore. Used for the one cap that matters: concurrent Codex processes. */
export class Semaphore {
	#available: number;
	readonly #waiting: (() => void)[] = [];

	constructor(permits: number) {
		if (!Number.isInteger(permits) || permits < 1) {
			throw new RangeError(`A semaphore needs at least one permit, got ${String(permits)}`);
		}
		this.#available = permits;
	}

	get available(): number {
		return this.#available;
	}

	get waiting(): number {
		return this.#waiting.length;
	}

	/** Runs `work` once a permit is free, releasing it however `work` ends. */
	async run<T>(work: () => Promise<T>): Promise<T> {
		await this.#acquire();
		try {
			return await work();
		} finally {
			this.#release();
		}
	}

	async #acquire(): Promise<void> {
		if (this.#available > 0) {
			this.#available -= 1;
			return;
		}
		await new Promise<void>((resolve) => this.#waiting.push(resolve));
	}

	#release(): void {
		const next = this.#waiting.shift();
		if (next) {
			// The permit passes straight to the next waiter rather than going back in the pool.
			next();
			return;
		}
		this.#available += 1;
	}
}
