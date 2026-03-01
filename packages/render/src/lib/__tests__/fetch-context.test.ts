import { describe, test, expect } from "bun:test";
import { createFetchContext, InFlightDedup } from "../fetch-context";

describe("createFetchContext", () => {
	test("trigger fires after delay", async () => {
		let result: string | null = null;
		const ctx = createFetchContext<string>(50, (value) => {
			result = value;
		});

		ctx.trigger(() => Promise.resolve("hello"));

		// Not yet fired
		expect(result).toBeNull();

		// Wait for debounce
		await Bun.sleep(80);

		expect(result).toBe("hello");
		ctx.dispose();
	});

	test("rapid triggers only fire the last one", async () => {
		const results: string[] = [];
		const ctx = createFetchContext<string>(50, (value) => {
			results.push(value);
		});

		ctx.trigger(() => Promise.resolve("first"));
		ctx.trigger(() => Promise.resolve("second"));
		ctx.trigger(() => Promise.resolve("third"));

		await Bun.sleep(80);

		expect(results).toEqual(["third"]);
		ctx.dispose();
	});

	test("immediate bypasses debounce", async () => {
		let result: string | null = null;
		const ctx = createFetchContext<string>(500, (value) => {
			result = value;
		});

		ctx.immediate(() => Promise.resolve("now"));

		await Bun.sleep(10);

		expect(result).toBe("now");
		ctx.dispose();
	});

	test("immediate cancels pending debounced trigger", async () => {
		const results: string[] = [];
		const ctx = createFetchContext<string>(50, (value) => {
			results.push(value);
		});

		ctx.trigger(() => Promise.resolve("debounced"));
		ctx.immediate(() => Promise.resolve("immediate"));

		await Bun.sleep(80);

		// Only "immediate" should have fired, "debounced" was cancelled
		expect(results).toEqual(["immediate"]);
		ctx.dispose();
	});

	test("stale results are discarded", async () => {
		const results: string[] = [];
		const ctx = createFetchContext<string>(10, (value) => {
			results.push(value);
		});

		// Start a slow fetch
		ctx.immediate(async () => {
			await Bun.sleep(100);
			return "slow";
		});

		// Before the slow fetch completes, trigger a fast one
		await Bun.sleep(20);
		ctx.immediate(() => Promise.resolve("fast"));

		// Wait for both to complete
		await Bun.sleep(150);

		// Only "fast" should be in results — "slow" was stale
		expect(results).toEqual(["fast"]);
		ctx.dispose();
	});

	test("cancel prevents pending execution", async () => {
		const results: string[] = [];
		const ctx = createFetchContext<string>(50, (value) => {
			results.push(value);
		});

		ctx.trigger(() => Promise.resolve("cancelled"));
		ctx.cancel();

		await Bun.sleep(80);

		expect(results).toEqual([]);
		ctx.dispose();
	});

	test("request_id increments on each trigger/cancel/immediate", () => {
		const ctx = createFetchContext<string>(50, () => {});

		const id1 = ctx.request_id;
		ctx.trigger(() => Promise.resolve("a"));
		expect(ctx.request_id).toBe(id1 + 1);

		ctx.cancel();
		expect(ctx.request_id).toBe(id1 + 2);

		ctx.immediate(() => Promise.resolve("b"));
		expect(ctx.request_id).toBe(id1 + 3);

		ctx.dispose();
	});
});

describe("InFlightDedup", () => {
	test("deduplicates concurrent calls for the same key", async () => {
		const dedup = new InFlightDedup<string>();
		let call_count = 0;

		const fn = async () => {
			call_count++;
			await Bun.sleep(50);
			return "result";
		};

		// Fire 3 concurrent requests for the same key
		const [r1, r2, r3] = await Promise.all([
			dedup.run("key1", fn),
			dedup.run("key1", fn),
			dedup.run("key1", fn),
		]);

		// All get the same result
		expect(r1).toBe("result");
		expect(r2).toBe("result");
		expect(r3).toBe("result");

		// But fn was only called once
		expect(call_count).toBe(1);
	});

	test("different keys run independently", async () => {
		const dedup = new InFlightDedup<string>();
		let call_count = 0;

		const fn = async (val: string) => {
			call_count++;
			await Bun.sleep(20);
			return val;
		};

		const [r1, r2] = await Promise.all([
			dedup.run("a", () => fn("alpha")),
			dedup.run("b", () => fn("beta")),
		]);

		expect(r1).toBe("alpha");
		expect(r2).toBe("beta");
		expect(call_count).toBe(2);
	});

	test("after completion, next call starts a new fetch", async () => {
		const dedup = new InFlightDedup<number>();
		let call_count = 0;

		const fn = async () => {
			call_count++;
			return call_count;
		};

		const r1 = await dedup.run("k", fn);
		expect(r1).toBe(1);
		expect(dedup.has("k")).toBe(false);

		const r2 = await dedup.run("k", fn);
		expect(r2).toBe(2);
		expect(call_count).toBe(2);
	});

	test("error propagates and cleans up in-flight entry", async () => {
		const dedup = new InFlightDedup<string>();

		const fn = async () => {
			throw new Error("boom");
		};

		await expect(dedup.run("k", fn)).rejects.toThrow("boom");
		expect(dedup.has("k")).toBe(false);
	});
});
