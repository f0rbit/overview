import { describe, expect, test } from "bun:test";
import type { RepoActivity } from "@overview/core";
import { DEFAULT_SYSTEM_PROMPT, build_user_prompt } from "../prompt";

const empty_activities: readonly RepoActivity[] = [];

const sample_activities: readonly RepoActivity[] = [
	{
		repo_path: "/x/foo",
		repo_name: "foo",
		range: { kind: "daily", since: new Date(0), until: new Date(0), label: "past 24h" },
		sections: [
			{
				source_id: "git",
				source_label: "Git Activity",
				summary_line: "3 commits, +50/-10",
				items: [
					{
						id: "a1",
						title: "fix: bug",
						timestamp: 0,
						author: "alice",
						meta: { files: "1", insertions: "+5", deletions: "-3" },
					},
					{
						id: "a2",
						title: "feat: thing",
						timestamp: 0,
						author: "alice",
					},
				],
				metrics: { commits: 2 },
			},
		],
	},
	{
		repo_path: "/x/bar",
		repo_name: "bar",
		range: { kind: "daily", since: new Date(0), until: new Date(0), label: "past 24h" },
		sections: [],
	},
];

describe("build_user_prompt", () => {
	test("empty activities → output contains '(no activity in this window)' and range label", () => {
		const result = build_user_prompt({
			range_label: "past 24h",
			activities: empty_activities,
		});
		expect(result).toContain("(no activity in this window)");
		expect(result).toContain("past 24h");
	});

	test("repo with sections shows ## <repo_name> header and ### <source_label> subheader", () => {
		const result = build_user_prompt({
			range_label: "past 24h",
			activities: sample_activities,
		});
		expect(result).toContain("## foo");
		expect(result).toContain("### Git Activity (3 commits, +50/-10)");
	});

	test("repo with empty sections is omitted from output", () => {
		const result = build_user_prompt({
			range_label: "past 24h",
			activities: sample_activities,
		});
		expect(result).not.toContain("## bar");
	});

	test("items render with title + author + meta tags [k=v]", () => {
		const result = build_user_prompt({
			range_label: "past 24h",
			activities: sample_activities,
		});
		expect(result).toContain("- fix: bug — alice");
		expect(result).toContain("[files=1]");
		expect(result).toContain("[insertions=+5]");
		expect(result).toContain("[deletions=-3]");
	});

	test("8-item cap: 12 items shows first 8 plus (+4 more) summary line", () => {
		const many_items: RepoActivity[] = [
			{
				repo_path: "/test",
				repo_name: "test",
				range: { kind: "daily", since: new Date(0), until: new Date(0), label: "past 24h" },
				sections: [
					{
						source_id: "git",
						source_label: "Git Activity",
						summary_line: "12 commits",
						items: Array.from({ length: 12 }, (_, i) => ({
							id: `item-${i}`,
							title: `commit ${i}`,
							timestamp: 0,
						})),
					},
				],
			},
		];
		const result = build_user_prompt({
			range_label: "past 24h",
			activities: many_items,
		});
		expect(result).toContain("- commit 0");
		expect(result).toContain("- commit 7");
		expect(result).not.toContain("- commit 8");
		expect(result).toContain("(+4 more)");
	});

	test("default style is 'narrative'", () => {
		const result = build_user_prompt({
			range_label: "past 24h",
			activities: sample_activities,
		});
		expect(result).toContain("Style: narrative");
	});

	test("custom style 'concise' flows through", () => {
		const result = build_user_prompt({
			range_label: "past 24h",
			activities: sample_activities,
			style: "concise",
		});
		expect(result).toContain("Style: concise");
	});

	test("DEFAULT_SYSTEM_PROMPT is non-empty string referencing standup or summarise", () => {
		expect(typeof DEFAULT_SYSTEM_PROMPT).toBe("string");
		expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
		const lower = DEFAULT_SYSTEM_PROMPT.toLowerCase();
		const has_standup = lower.includes("standup");
		const has_summarise = lower.includes("summarise") || lower.includes("summarize");
		expect(has_standup || has_summarise).toBe(true);
	});
});
