import { describe, expect, test } from "bun:test";
import {
	type GithubError,
	type RawPR,
	deriveCiStatus,
	isGithubRemote,
	mapPR,
	parseGhOwnerRepo,
	safeJsonParse,
} from "../src/github";

describe("isGithubRemote", () => {
	test("returns true for https github URL", () => {
		expect(isGithubRemote("https://github.com/owner/repo.git")).toBe(true);
	});

	test("returns true for ssh github URL", () => {
		expect(isGithubRemote("git@github.com:owner/repo.git")).toBe(true);
	});

	test("returns false for null", () => {
		expect(isGithubRemote(null)).toBe(false);
	});

	test("returns false for empty string", () => {
		expect(isGithubRemote("")).toBe(false);
	});

	test("returns false for gitlab URL", () => {
		expect(isGithubRemote("https://gitlab.com/owner/repo.git")).toBe(false);
	});

	test("returns false for bitbucket URL", () => {
		expect(isGithubRemote("https://bitbucket.org/owner/repo.git")).toBe(false);
	});
});

describe("parseGhOwnerRepo", () => {
	test("parses https URL with .git suffix", () => {
		const result = parseGhOwnerRepo("https://github.com/owner/repo.git");
		expect(result).toEqual({ owner: "owner", repo: "repo" });
	});

	test("parses https URL without .git suffix", () => {
		const result = parseGhOwnerRepo("https://github.com/owner/repo");
		expect(result).toEqual({ owner: "owner", repo: "repo" });
	});

	test("parses ssh URL", () => {
		const result = parseGhOwnerRepo("git@github.com:owner/repo.git");
		expect(result).toEqual({ owner: "owner", repo: "repo" });
	});

	test("handles hyphens and underscores in owner/repo", () => {
		const result = parseGhOwnerRepo("https://github.com/my-org/my_repo.git");
		expect(result).toEqual({ owner: "my-org", repo: "my_repo" });
	});

	test("returns null for non-github URL", () => {
		expect(parseGhOwnerRepo("https://gitlab.com/owner/repo.git")).toBeNull();
	});

	test("returns null for malformed URL", () => {
		expect(parseGhOwnerRepo("not-a-url")).toBeNull();
	});
});

describe("deriveCiStatus", () => {
	test("returns none for null checks", () => {
		expect(deriveCiStatus(null)).toBe("none");
	});

	test("returns none for empty array", () => {
		expect(deriveCiStatus([])).toBe("none");
	});

	test("returns success when all checks succeed (uppercase)", () => {
		const checks = [
			{ state: "COMPLETED", status: "completed", conclusion: "SUCCESS" },
			{ state: "COMPLETED", status: "completed", conclusion: "SUCCESS" },
		];
		expect(deriveCiStatus(checks)).toBe("success");
	});

	test("returns success when all checks succeed (lowercase)", () => {
		const checks = [
			{ state: "completed", status: "completed", conclusion: "success" },
			{ state: "completed", status: "completed", conclusion: "success" },
		];
		expect(deriveCiStatus(checks)).toBe("success");
	});

	test("returns failure when any check fails (uppercase)", () => {
		const checks = [
			{ state: "COMPLETED", status: "completed", conclusion: "SUCCESS" },
			{ state: "COMPLETED", status: "completed", conclusion: "FAILURE" },
		];
		expect(deriveCiStatus(checks)).toBe("failure");
	});

	test("returns failure when any check fails (lowercase)", () => {
		const checks = [
			{ state: "completed", status: "completed", conclusion: "success" },
			{ state: "completed", status: "completed", conclusion: "failure" },
		];
		expect(deriveCiStatus(checks)).toBe("failure");
	});

	test("returns pending when mix of success and in-progress", () => {
		const checks = [
			{ state: "COMPLETED", status: "completed", conclusion: "SUCCESS" },
			{ state: "IN_PROGRESS", status: "in_progress", conclusion: "" },
		];
		expect(deriveCiStatus(checks)).toBe("pending");
	});

	test("failure takes priority over pending", () => {
		const checks = [
			{ state: "COMPLETED", status: "completed", conclusion: "FAILURE" },
			{ state: "IN_PROGRESS", status: "in_progress", conclusion: "" },
		];
		expect(deriveCiStatus(checks)).toBe("failure");
	});
});

describe("mapPR", () => {
	const base_raw: RawPR = {
		number: 42,
		title: "Add feature",
		state: "OPEN",
		reviewDecision: "APPROVED",
		statusCheckRollup: [{ state: "COMPLETED", status: "completed", conclusion: "SUCCESS" }],
		isDraft: false,
		author: { login: "testuser" },
	};

	test("maps all fields correctly", () => {
		const result = mapPR(base_raw);
		expect(result).toEqual({
			number: 42,
			title: "Add feature",
			state: "OPEN",
			review_decision: "APPROVED",
			ci_status: "success",
			is_draft: false,
			author: "testuser",
		});
	});

	test("handles null reviewDecision", () => {
		const raw = { ...base_raw, reviewDecision: null };
		const result = mapPR(raw);
		expect(result.review_decision).toBeNull();
	});

	test("handles null author with fallback to unknown", () => {
		const raw = { ...base_raw, author: null as unknown as RawPR["author"] };
		const result = mapPR(raw);
		expect(result.author).toBe("unknown");
	});

	test("handles undefined author with fallback to unknown", () => {
		const raw = { ...base_raw, author: undefined as unknown as RawPR["author"] };
		const result = mapPR(raw);
		expect(result.author).toBe("unknown");
	});

	test("maps draft PRs", () => {
		const raw = { ...base_raw, isDraft: true };
		const result = mapPR(raw);
		expect(result.is_draft).toBe(true);
	});

	test("maps ci_status from statusCheckRollup", () => {
		const raw = { ...base_raw, statusCheckRollup: null };
		const result = mapPR(raw);
		expect(result.ci_status).toBe("none");
	});
});

describe("safeJsonParse", () => {
	test("parses valid JSON and returns ok", () => {
		const result = safeJsonParse<{ a: number }>('{"a": 1}');
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual({ a: 1 });
		}
	});

	test("parses valid JSON array", () => {
		const result = safeJsonParse<number[]>("[1, 2, 3]");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value).toEqual([1, 2, 3]);
		}
	});

	test("returns err for invalid JSON", () => {
		const result = safeJsonParse<unknown>("not json at all");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			const error = result.error as GithubError;
			expect(error.kind).toBe("api_error");
			expect((error as { kind: "api_error"; cause: string }).cause).toBe("invalid JSON response from gh CLI");
		}
	});

	test("returns err for empty string", () => {
		const result = safeJsonParse<unknown>("");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect((result.error as GithubError).kind).toBe("api_error");
		}
	});

	test("returns err for truncated JSON", () => {
		const result = safeJsonParse<unknown>('{"a": ');
		expect(result.ok).toBe(false);
	});
});
