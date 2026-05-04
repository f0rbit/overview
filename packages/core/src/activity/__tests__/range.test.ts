import { describe, test, expect } from "bun:test";
import { range_daily, range_weekly, range_custom } from "../range";

describe("range_daily", () => {
	test("returns kind === 'daily'", () => {
		const now = new Date("2026-05-04T15:00:00Z");
		const result = range_daily(now);
		expect(result.kind).toBe("daily");
	});

	test("until equals input", () => {
		const now = new Date("2026-05-04T15:00:00Z");
		const result = range_daily(now);
		expect(result.until.getTime()).toBe(now.getTime());
	});

	test("since equals input - 24h exactly", () => {
		const now = new Date("2026-05-04T15:00:00Z");
		const result = range_daily(now);
		const expected_since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
		expect(result.since.getTime()).toBe(expected_since.getTime());
	});

	test("label is 'past 24h'", () => {
		const now = new Date("2026-05-04T15:00:00Z");
		const result = range_daily(now);
		expect(result.label).toBe("past 24h");
	});
});

describe("range_weekly", () => {
	test("for Wednesday, since is Monday 00:00 local", () => {
		// May 7, 2026 is a Wednesday
		const now = new Date("2026-05-07T15:00:00Z");
		const result = range_weekly(now);

		// Verify result.since is a Monday at midnight
		expect(result.since.getDay()).toBe(1); // Monday
		expect(result.since.getHours()).toBe(0);
		expect(result.since.getMinutes()).toBe(0);
		expect(result.since.getSeconds()).toBe(0);
	});

	test("for Monday afternoon, since is same day at 00:00", () => {
		// May 4, 2026 is a Monday
		const now = new Date("2026-05-04T15:00:00Z");
		const result = range_weekly(now);

		expect(result.since.getDay()).toBe(1); // Monday
		expect(result.since.getDate()).toBe(4);
		expect(result.since.getHours()).toBe(0);
	});

	test("for Sunday, since is previous Monday at 00:00", () => {
		// May 10, 2026 is a Sunday
		const now = new Date("2026-05-10T15:00:00Z");
		const result = range_weekly(now);

		expect(result.since.getDay()).toBe(1); // Monday
		// Since is 6 days before Sunday
		expect(result.since.getDate()).toBe(4);
		expect(result.since.getHours()).toBe(0);
	});

	test("until equals input", () => {
		const now = new Date("2026-05-04T15:00:00Z");
		const result = range_weekly(now);
		expect(result.until.getTime()).toBe(now.getTime());
	});

	test("label is formatted 'since <Day> <Month> <Date>'", () => {
		const now = new Date("2026-05-04T15:00:00Z");
		const result = range_weekly(now);
		expect(result.label).toMatch(/since \w+ \w+ \d+/);
	});

	test("kind is 'weekly'", () => {
		const now = new Date("2026-05-04T15:00:00Z");
		const result = range_weekly(now);
		expect(result.kind).toBe("weekly");
	});
});

describe("range_custom", () => {
	test("kind is 'custom'", () => {
		const since = new Date("2026-05-01");
		const now = new Date("2026-05-05");
		const result = range_custom(since, now);
		expect(result.kind).toBe("custom");
	});

	test("since and until match inputs", () => {
		const since = new Date("2026-05-01");
		const now = new Date("2026-05-05");
		const result = range_custom(since, now);
		expect(result.since.getTime()).toBe(since.getTime());
		expect(result.until.getTime()).toBe(now.getTime());
	});

	test("label is 'since YYYY-MM-DD'", () => {
		const since = new Date("2026-05-01");
		const now = new Date("2026-05-05");
		const result = range_custom(since, now);
		expect(result.label).toBe("since 2026-05-01");
	});
});
