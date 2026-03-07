import { describe, test, expect } from "bun:test";
import { DataCache } from "../src/cache";

describe("DataCache", () => {
	// ── get ────────────────────────────────────────────────────────────────

	describe("get", () => {
		test("returns null for missing keys", () => {
			const cache = new DataCache<string>();
			expect(cache.get("missing")).toBeNull();
		});

		test("returns cached data within TTL", () => {
			const cache = new DataCache<string>();
			cache.set("key", "value", 5000);
			expect(cache.get("key")).toBe("value");
		});

		test("returns null and evicts entries past TTL", async () => {
			const cache = new DataCache<string>();
			cache.set("key", "value", 10);
			await Bun.sleep(20);
			expect(cache.get("key")).toBeNull();
			// entry should be evicted — second get also null
			expect(cache.get("key")).toBeNull();
		});
	});

	// ── set ────────────────────────────────────────────────────────────────

	describe("set", () => {
		test("stores and retrieves data", () => {
			const cache = new DataCache<number>();
			cache.set("a", 42, 5000);
			cache.set("b", 99, 5000);
			expect(cache.get("a")).toBe(42);
			expect(cache.get("b")).toBe(99);
		});

		test("overwrites existing entries", () => {
			const cache = new DataCache<string>();
			cache.set("key", "old", 5000);
			cache.set("key", "new", 5000);
			expect(cache.get("key")).toBe("new");
		});
	});

	// ── invalidate ─────────────────────────────────────────────────────────

	describe("invalidate", () => {
		test("removes specific entry", () => {
			const cache = new DataCache<string>();
			cache.set("a", "keep", 5000);
			cache.set("b", "remove", 5000);
			cache.invalidate("b");
			expect(cache.get("a")).toBe("keep");
			expect(cache.get("b")).toBeNull();
		});

		test("no-op for missing keys", () => {
			const cache = new DataCache<string>();
			cache.set("a", "value", 5000);
			cache.invalidate("nonexistent");
			expect(cache.get("a")).toBe("value");
		});
	});

	// ── clear ──────────────────────────────────────────────────────────────

	describe("clear", () => {
		test("removes all entries", () => {
			const cache = new DataCache<string>();
			cache.set("a", "1", 5000);
			cache.set("b", "2", 5000);
			cache.set("c", "3", 5000);
			cache.clear();
			expect(cache.get("a")).toBeNull();
			expect(cache.get("b")).toBeNull();
			expect(cache.get("c")).toBeNull();
		});
	});
});
