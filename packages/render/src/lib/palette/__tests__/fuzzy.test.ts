import { describe, test, expect } from "bun:test";
import { ok } from "@f0rbit/corpus";
import { match_commands } from "../fuzzy";
import type { Command } from "../types";

const fake_commands: readonly Command<unknown>[] = [
	{
		id: ":quit",
		label: "Quit",
		description: "Exit the application",
		execute: async () => ok(undefined),
	},
	{
		id: ":standup daily",
		label: "Daily Standup",
		description: "Show daily activity",
		keywords: ["report", "summary"],
		execute: async () => ok(undefined),
	},
	{
		id: ":standup weekly",
		label: "Weekly Standup",
		description: "Show weekly activity",
		keywords: ["report", "summary"],
		execute: async () => ok(undefined),
	},
	{
		id: ":reload",
		label: "Reload",
		description: "Reload data",
		execute: async () => ok(undefined),
	},
];

describe("match_commands", () => {
	test("empty query returns all commands sorted by id ascending with score 0", () => {
		const results = match_commands("", fake_commands);

		expect(results.length).toBe(4);
		expect(results[0]!.command.id).toBe(":quit");
		expect(results[1]!.command.id).toBe(":reload");
		expect(results[2]!.command.id).toBe(":standup daily");
		expect(results[3]!.command.id).toBe(":standup weekly");

		// All scores should be 0 for empty query
		for (const result of results) {
			expect(result.score).toBe(0);
			expect(result.positions.length).toBe(0);
		}
	});

	test("whitespace-only query treats as empty", () => {
		const results = match_commands("   ", fake_commands);

		expect(results.length).toBe(4);
		expect(results[0]!.command.id).toBe(":quit");
	});

	test("query 'qu' matches ':quit' first", () => {
		const results = match_commands("qu", fake_commands);

		expect(results.length).toBeGreaterThan(0);
		const first_id = results[0]!.command.id;
		expect(first_id).toBe(":quit");
	});

	test("query 'std' matches both standup variants", () => {
		const results = match_commands("std", fake_commands);

		const ids = results.map((r) => r.command.id);
		expect(ids).toContain(":standup daily");
		expect(ids).toContain(":standup weekly");
	});

	test("query 'daily' matches ':standup daily' first", () => {
		const results = match_commands("daily", fake_commands);

		expect(results.length).toBeGreaterThan(0);
		const first_id = results[0]!.command.id;
		expect(first_id).toBe(":standup daily");
	});

	test("query 'xyz' returns empty array", () => {
		const results = match_commands("xyz", fake_commands);
		expect(results.length).toBe(0);
	});

	test("match positions are sorted ascending and valid indices", () => {
		const results = match_commands("qu", fake_commands);

		if (results.length > 0) {
			const first_result = results[0]!;
			const positions = first_result.positions;

			// Check positions are sorted
			for (let i = 1; i < positions.length; i++) {
				expect(positions[i]!).toBeGreaterThanOrEqual(positions[i - 1]!);
			}

			// Check all indices are non-negative and valid
			for (const pos of positions) {
				expect(pos).toBeGreaterThanOrEqual(0);
				expect(pos).toBeLessThan(1000); // Reasonable upper bound for a haystack string
			}
		}
	});
});
