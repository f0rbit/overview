import { describe, expect, test } from "bun:test";
import { formatBytes, formatRelativeTime, padTo, truncate } from "../format";

// ── truncate ───────────────────────────────────────────────────────────────

describe("truncate", () => {
	test("string shorter than maxLen is unchanged", () => {
		expect(truncate("hello", 10)).toBe("hello");
	});

	test("string equal to maxLen is unchanged", () => {
		expect(truncate("hello", 5)).toBe("hello");
	});

	test("string longer than maxLen is truncated with ellipsis", () => {
		expect(truncate("hello world", 5)).toBe("hell…");
	});

	test("truncated string has exact length of maxLen", () => {
		const result = truncate("a long string here", 8);
		expect(result.length).toBe(8);
		expect(result).toBe("a long …");
	});

	test("maxLen of 1 gives just ellipsis", () => {
		expect(truncate("hello", 1)).toBe("…");
	});
});

// ── formatBytes ────────────────────────────────────────────────────────────

describe("formatBytes", () => {
	test("0 bytes", () => {
		expect(formatBytes(0)).toBe("0 B");
	});

	test("bytes below 1 KB", () => {
		expect(formatBytes(512)).toBe("512 B");
	});

	test("exactly 1 KB", () => {
		expect(formatBytes(1024)).toBe("1.0 KB");
	});

	test("fractional KB", () => {
		expect(formatBytes(1536)).toBe("1.5 KB");
	});

	test("exactly 1 MB", () => {
		expect(formatBytes(1048576)).toBe("1.0 MB");
	});

	test("large KB value rounds", () => {
		// 10 KB = 10240 bytes, value >= 10 → rounded
		expect(formatBytes(10240)).toBe("10 KB");
	});

	test("exactly 1 GB", () => {
		expect(formatBytes(1073741824)).toBe("1.0 GB");
	});

	test("exactly 1 TB", () => {
		expect(formatBytes(1099511627776)).toBe("1.0 TB");
	});
});

// ── padTo ──────────────────────────────────────────────────────────────────

describe("padTo", () => {
	test("shorter string is padded with spaces", () => {
		expect(padTo("hi", 5)).toBe("hi   ");
	});

	test("exact length is unchanged", () => {
		expect(padTo("hello", 5)).toBe("hello");
	});

	test("longer string is truncated to len", () => {
		expect(padTo("hello world", 5)).toBe("hello");
	});

	test("empty string pads to all spaces", () => {
		expect(padTo("", 3)).toBe("   ");
	});
});

// ── formatRelativeTime ─────────────────────────────────────────────────────

describe("formatRelativeTime", () => {
	const now = Math.floor(Date.now() / 1000);

	test("less than 60 seconds ago → 'just now'", () => {
		expect(formatRelativeTime(now - 30)).toBe("just now");
	});

	test("exactly 0 seconds ago → 'just now'", () => {
		expect(formatRelativeTime(now)).toBe("just now");
	});

	test("120 seconds ago → '2m ago'", () => {
		expect(formatRelativeTime(now - 120)).toBe("2m ago");
	});

	test("3600 seconds ago → '1h ago'", () => {
		expect(formatRelativeTime(now - 3600)).toBe("1h ago");
	});

	test("86400 seconds ago → '1d ago'", () => {
		expect(formatRelativeTime(now - 86400)).toBe("1d ago");
	});

	test("604800 seconds ago → '1w ago'", () => {
		expect(formatRelativeTime(now - 604800)).toBe("1w ago");
	});

	test("~36 days ago → '1mo ago'", () => {
		// 36 days = 5+ weeks, crosses into months branch (days/30 = 1)
		expect(formatRelativeTime(now - 36 * 86400)).toBe("1mo ago");
	});

	test("~365 days ago → '1y ago'", () => {
		expect(formatRelativeTime(now - 31536000)).toBe("1y ago");
	});

	test("minutes boundary: 59 seconds → 'just now'", () => {
		expect(formatRelativeTime(now - 59)).toBe("just now");
	});

	test("minutes boundary: 60 seconds → '1m ago'", () => {
		expect(formatRelativeTime(now - 60)).toBe("1m ago");
	});
});
