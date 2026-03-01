import { describe, test, expect } from "bun:test";
import { createPool } from "../src/concurrency";

describe("createPool", () => {
	test("respects concurrency limit", async () => {
		const pool = createPool(2);
		let max_concurrent = 0;
		let current = 0;

		const task = async () => {
			current++;
			max_concurrent = Math.max(max_concurrent, current);
			await Bun.sleep(30);
			current--;
		};

		await Promise.all([
			pool.run(task),
			pool.run(task),
			pool.run(task),
			pool.run(task),
			pool.run(task),
		]);

		expect(max_concurrent).toBe(2);
		expect(current).toBe(0);
	});

	test("all tasks complete", async () => {
		const pool = createPool(3);
		const results: number[] = [];

		const tasks = Array.from({ length: 10 }, (_, i) =>
			pool.run(async () => {
				await Bun.sleep(10);
				results.push(i);
				return i;
			}),
		);

		const returned = await Promise.all(tasks);

		expect(returned).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(results).toHaveLength(10);
	});

	test("errors propagate correctly", async () => {
		const pool = createPool(2);

		const failing = pool.run(async () => {
			throw new Error("boom");
		});

		await expect(failing).rejects.toThrow("boom");

		// Pool should still work after error
		const result = await pool.run(async () => "ok");
		expect(result).toBe("ok");
	});

	test("queued tasks run as active tasks complete", async () => {
		const pool = createPool(1);
		const order: string[] = [];

		const p1 = pool.run(async () => {
			await Bun.sleep(30);
			order.push("first");
		});

		const p2 = pool.run(async () => {
			order.push("second");
		});

		await Promise.all([p1, p2]);
		expect(order).toEqual(["first", "second"]);
	});

	test("active_count and queue_length track state", async () => {
		const pool = createPool(2);
		const started: Array<() => void> = [];

		// Create tasks that block until we release them
		const make_blocking = () =>
			pool.run(() => new Promise<void>((resolve) => { started.push(resolve); }));

		const p1 = make_blocking();
		const p2 = make_blocking();
		const p3 = make_blocking();

		// Wait for first two to start
		await Bun.sleep(10);

		expect(pool.active_count).toBe(2);
		expect(pool.queue_length).toBe(1);

		// Release first task
		started[0]!();
		await Bun.sleep(10);

		expect(pool.active_count).toBe(2); // third task started
		expect(pool.queue_length).toBe(0);

		// Release remaining
		started[1]!();
		started[2]!();
		await Promise.all([p1, p2, p3]);

		expect(pool.active_count).toBe(0);
		expect(pool.queue_length).toBe(0);
	});
});
