import { describe, expect, test } from "bun:test";
import type { RepoActivity } from "@overview/core";
import { createInMemoryProvider } from "../in-memory";

describe("createInMemoryProvider", () => {
	test("summarize records last_input and increments call_count", async () => {
		const provider = createInMemoryProvider();
		const input = {
			range_label: "past 24h",
			activities: [] as readonly RepoActivity[],
		};

		expect(provider.call_count).toBe(0);
		expect(provider.last_input).toBe(null);

		const result = await provider.summarize(input);
		expect(result.ok).toBe(true);
		expect(provider.call_count).toBe(1);
		expect(provider.last_input).toBe(input);
	});

	test("default response streams in 50-char chunks via chunks()", async () => {
		const provider = createInMemoryProvider();
		const input = {
			range_label: "past 24h",
			activities: [] as readonly RepoActivity[],
		};

		const result = await provider.summarize(input);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const stream = result.value;
			const chunks: string[] = [];
			for await (const chunk of stream.chunks()) {
				chunks.push(chunk);
			}
			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks.every((c) => c.length <= 50)).toBe(true);
		}
	});

	test("custom response flows through", async () => {
		const custom_response = "Custom test response.";
		const provider = createInMemoryProvider({ response: custom_response });
		const input = {
			range_label: "past 24h",
			activities: [] as readonly RepoActivity[],
		};

		const result = await provider.summarize(input);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const final = await result.value.final();
			expect(final).toBe(custom_response);
		}
	});

	test("custom chunk_size flows through", async () => {
		const response = "0123456789";
		const provider = createInMemoryProvider({
			response,
			chunk_size: 3,
		});
		const input = {
			range_label: "past 24h",
			activities: [] as readonly RepoActivity[],
		};

		const result = await provider.summarize(input);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const stream = result.value;
			const chunks: string[] = [];
			for await (const chunk of stream.chunks()) {
				chunks.push(chunk);
			}
			expect(chunks.every((c) => c.length <= 3)).toBe(true);
		}
	});

	test("fail_with causes summarize to return err(...)", async () => {
		const error = { kind: "network_failed" as const, cause: "test failure" };
		const provider = createInMemoryProvider({ fail_with: error });
		const input = {
			range_label: "past 24h",
			activities: [] as readonly RepoActivity[],
		};

		const result = await provider.summarize(input);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("network_failed");
		}
	});

	test("final() returns the full response after consuming chunks", async () => {
		const response = "Test response for final.";
		const provider = createInMemoryProvider({ response });
		const input = {
			range_label: "past 24h",
			activities: [] as readonly RepoActivity[],
		};

		const result = await provider.summarize(input);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const stream = result.value;
			const final = await stream.final();
			expect(final).toBe(response);
		}
	});

	test("abort() stops the chunk stream early", async () => {
		const response = "0123456789abcdefghijklmnopqrstuvwxyz";
		const provider = createInMemoryProvider({
			response,
			chunk_size: 5,
			delay_ms: 0,
		});
		const input = {
			range_label: "past 24h",
			activities: [] as readonly RepoActivity[],
		};

		const result = await provider.summarize(input);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const stream = result.value;
			const chunks: string[] = [];
			let count = 0;
			for await (const chunk of stream.chunks()) {
				chunks.push(chunk);
				count++;
				if (count === 2) {
					stream.abort();
				}
			}
			expect(chunks.length).toBe(2);
			const combined = chunks.join("");
			expect(combined.length).toBeLessThan(response.length);
		}
	});

	test("delay_ms introduces measurable delay", async () => {
		const provider = createInMemoryProvider({
			response: "Quick test",
			delay_ms: 50,
			chunk_size: 5,
		});
		const input = {
			range_label: "past 24h",
			activities: [] as readonly RepoActivity[],
		};

		const result = await provider.summarize(input);
		expect(result.ok).toBe(true);
		if (result.ok) {
			const stream = result.value;
			const start = Date.now();
			for await (const _ of stream.chunks()) {
				// consume chunks
			}
			const elapsed = Date.now() - start;
			expect(elapsed).toBeGreaterThan(0);
		}
	});

	test("multiple calls increment call_count independently", async () => {
		const provider = createInMemoryProvider();
		const input = {
			range_label: "past 24h",
			activities: [] as readonly RepoActivity[],
		};

		await provider.summarize(input);
		expect(provider.call_count).toBe(1);

		await provider.summarize(input);
		expect(provider.call_count).toBe(2);

		await provider.summarize(input);
		expect(provider.call_count).toBe(3);
	});
});
