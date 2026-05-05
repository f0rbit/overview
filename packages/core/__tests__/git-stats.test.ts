import { describe, expect, test } from "bun:test";
import {
	bucketIntoDays,
	parseContributors,
	parseRecentCommits,
	parseRepoSize,
	parseSize,
	parseTags,
} from "../src/git-stats";

describe("parseSize", () => {
	test("zero bytes string", () => {
		expect(parseSize("0 bytes")).toBe(0);
	});

	test("bare zero", () => {
		expect(parseSize("0")).toBe(0);
	});

	test("bytes value", () => {
		expect(parseSize("1024 bytes")).toBe(1024);
	});

	test("KiB value", () => {
		expect(parseSize("5.5 KiB")).toBe(5632);
	});

	test("MiB value", () => {
		expect(parseSize("2 MiB")).toBe(2097152);
	});

	test("empty string returns 0", () => {
		expect(parseSize("")).toBe(0);
	});

	test("garbage returns 0", () => {
		expect(parseSize("not a number")).toBe(0);
	});
});

describe("parseContributors", () => {
	test("parses shortlog output", () => {
		const output = "  42\tJohn Doe\n  15\tJane Smith\n";
		const result = parseContributors(output);
		expect(result.contributors).toEqual(["John Doe", "Jane Smith"]);
		expect(result.contributor_count).toBe(2);
	});

	test("single contributor", () => {
		const output = "  100\tSolo Dev\n";
		const result = parseContributors(output);
		expect(result.contributors).toEqual(["Solo Dev"]);
		expect(result.contributor_count).toBe(1);
	});

	test("empty string", () => {
		const result = parseContributors("");
		expect(result.contributors).toEqual([]);
		expect(result.contributor_count).toBe(0);
	});
});

describe("parseRepoSize", () => {
	test("sums size and size-pack lines", () => {
		const output = "count: 50\nsize: 1024 bytes\nin-pack: 30\nsize-pack: 2048 bytes\n";
		expect(parseRepoSize(output)).toBe(3072);
	});

	test("only size line", () => {
		const output = "count: 10\nsize: 512 bytes\n";
		expect(parseRepoSize(output)).toBe(512);
	});

	test("only size-pack line", () => {
		const output = "count: 10\nsize-pack: 4 KiB\n";
		expect(parseRepoSize(output)).toBe(4096);
	});

	test("ignores unrelated lines", () => {
		const output = "count: 50\nin-pack: 30\nprune-packable: 0\n";
		expect(parseRepoSize(output)).toBe(0);
	});

	test("empty string", () => {
		expect(parseRepoSize("")).toBe(0);
	});
});

describe("parseTags", () => {
	test("splits and trims tags", () => {
		expect(parseTags("v1.0\nv2.0\n")).toEqual(["v1.0", "v2.0"]);
	});

	test("handles whitespace", () => {
		expect(parseTags("  v1.0  \n  v2.0  \n")).toEqual(["v1.0", "v2.0"]);
	});

	test("empty string", () => {
		expect(parseTags("")).toEqual([]);
	});

	test("single tag", () => {
		expect(parseTags("v3.0\n")).toEqual(["v3.0"]);
	});
});

describe("parseRecentCommits", () => {
	test("parses colon-delimited format", () => {
		const output = "abc123:fix bug:John:1700000000\n";
		const result = parseRecentCommits(output);
		expect(result).toEqual([{ hash: "abc123", message: "fix bug", author: "John", time: 1700000000 }]);
	});

	test("multiple commits", () => {
		const output = "aaa:first:Alice:1000\nbbb:second:Bob:2000\n";
		const result = parseRecentCommits(output);
		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({ hash: "aaa", message: "first", author: "Alice", time: 1000 });
		expect(result[1]).toEqual({ hash: "bbb", message: "second", author: "Bob", time: 2000 });
	});

	test("empty string", () => {
		expect(parseRecentCommits("")).toEqual([]);
	});
});

describe("bucketIntoDays", () => {
	// bucketIntoDays uses today_start (midnight local) as reference.
	// days_ago = floor((today_start - ts_ms) / one_day)
	// index = 13 - days_ago
	// So index=13 means days_ago=0, i.e. timestamps in [today_start - 24h, today_start)
	const now = new Date();
	const today_start_ms = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const day_s = 24 * 60 * 60;

	// A timestamp 1 second before midnight today (days_ago=0, index=13)
	const recent_sec = Math.floor(today_start_ms / 1000) - 1;

	test("empty timestamps returns 14 zeros", () => {
		const result = bucketIntoDays([]);
		expect(result).toHaveLength(14);
		expect(result.every((c) => c === 0)).toBe(true);
	});

	test("timestamp just before midnight goes in last bucket (index 13)", () => {
		const result = bucketIntoDays([recent_sec]);
		expect(result).toHaveLength(14);
		expect(result[13]).toBe(1);
		expect(result.slice(0, 13).every((c) => c === 0)).toBe(true);
	});

	test("timestamp one day earlier goes in index 12", () => {
		const result = bucketIntoDays([recent_sec - day_s]);
		expect(result).toHaveLength(14);
		expect(result[12]).toBe(1);
	});

	test("multiple timestamps same day are counted together", () => {
		const result = bucketIntoDays([recent_sec, recent_sec - 60, recent_sec - 3600]);
		expect(result[13]).toBe(3);
	});

	test("timestamps older than 14 days are ignored", () => {
		const old_sec = recent_sec - 15 * day_s;
		const result = bucketIntoDays([old_sec]);
		expect(result.every((c) => c === 0)).toBe(true);
	});

	test("timestamps spread across multiple days", () => {
		const timestamps = [recent_sec, recent_sec - day_s, recent_sec - 2 * day_s];
		const result = bucketIntoDays(timestamps);
		expect(result[13]).toBe(1);
		expect(result[12]).toBe(1);
		expect(result[11]).toBe(1);
	});
});
