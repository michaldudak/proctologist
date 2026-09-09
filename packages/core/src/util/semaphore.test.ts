import { describe, expect, it } from "vitest";
import { Semaphore } from "./semaphore.js";

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("Semaphore", () => {
	it("runs no more than the permitted number at once", async () => {
		const semaphore = new Semaphore(2);
		let running = 0;
		let peak = 0;

		await Promise.all(
			Array.from({ length: 6 }, () =>
				semaphore.run(async () => {
					running += 1;
					peak = Math.max(peak, running);
					await tick();
					running -= 1;
				}),
			),
		);

		expect(peak).toBe(2);
		expect(semaphore.available).toBe(2);
	});

	it("releases the permit when the work throws", async () => {
		const semaphore = new Semaphore(1);

		await expect(semaphore.run(() => Promise.reject(new Error("nope")))).rejects.toThrow("nope");
		expect(semaphore.available).toBe(1);
		await expect(semaphore.run(() => Promise.resolve("fine"))).resolves.toBe("fine");
	});

	it("hands waiting work the permit in order", async () => {
		const semaphore = new Semaphore(1);
		const order: number[] = [];
		const first = semaphore.run(async () => {
			await tick();
			order.push(1);
		});
		const second = semaphore.run(() => {
			order.push(2);
			return Promise.resolve();
		});
		const third = semaphore.run(() => {
			order.push(3);
			return Promise.resolve();
		});

		await Promise.all([first, second, third]);

		expect(order).toEqual([1, 2, 3]);
	});

	it("refuses a nonsensical permit count", () => {
		expect(() => new Semaphore(0)).toThrow(RangeError);
	});
});
