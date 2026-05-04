import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ok } from "@f0rbit/corpus";
import {
	register_activity_source,
	_clear_activity_registry_for_tests,
	defaultConfig,
	list_activity_sources,
	range_daily,
	range_weekly,
	createPool,
	type ActivitySection,
	type RepoNode,
	type RepoActivity,
	type StandupRange,
} from "@overview/core";
import { register_command, get_command, _clear_registry_for_tests } from "../../palette/registry";
import type { CommandContext } from "../../palette/context";
import type { PaletteEvent } from "../../palette/types";
import { resolve_standup_range } from "../standup";

// Helper to create a fake CommandContext with in-memory event log
interface FakeContext extends CommandContext {
	events: PaletteEvent[];
}

function make_fake_context(overrides?: Partial<FakeContext>): FakeContext {
	const events: PaletteEvent[] = [];

	return {
		config: defaultConfig(),
		repos: () => [],
		selected_repo: () => null,
		ai_provider: null,
		emit: (e: PaletteEvent) => {
			events.push(e);
		},
		open_overlay: (_id: string, _payload: unknown) => {},
		trigger_rescan: () => {},
		renderer: { suspend: () => {}, resume: () => {} },
		events,
		...overrides,
	};
}

beforeEach(() => {
	_clear_activity_registry_for_tests();
	_clear_registry_for_tests();
});

afterEach(() => {
	_clear_activity_registry_for_tests();
	_clear_registry_for_tests();
});

// Helper to collect repos recursively (mirrors internal logic)
function collect_repo_paths(nodes: readonly RepoNode[]): RepoNode[] {
	const out: RepoNode[] = [];
	for (const n of nodes) {
		if (n.type === "directory") out.push(...collect_repo_paths(n.children));
		else out.push(n);
	}
	return out;
}

// Helper to collect activity for a single repo
async function collect_for_repo(
	repo: RepoNode,
	range: StandupRange,
	sources: ReturnType<typeof list_activity_sources>,
): Promise<RepoActivity> {
	const results = await Promise.all(
		sources.map((s) => s.collect(repo, range)),
	);

	const sections = results
		.map((r) => (r.ok ? r.value : null))
		.filter((s): s is ActivitySection => s !== null);

	return {
		repo_path: repo.path,
		repo_name: repo.name,
		range,
		sections,
	};
}

describe("standup pipeline integration", () => {
	test("aggregates activity from fake source across repos", async () => {
		const fake_section: ActivitySection = {
			source_id: "fake",
			source_label: "Fake Source",
			summary_line: "1 thing",
			items: [
				{
					id: "x1",
					title: "did stuff",
					timestamp: 1714816800,
				},
			],
		};

		register_activity_source({
			id: "fake",
			label: "Fake Source",
			collect: async () => ok(fake_section),
		});

		const repo: RepoNode = {
			type: "repo",
			path: "/tmp/test-repo",
			name: "test-repo",
			status: null,
			children: [],
			worktrees: [],
			depth: 0,
			expanded: false,
		};

		const range = range_daily(new Date());
		const sources = list_activity_sources();
		const activity = await collect_for_repo(repo, range, sources);

		expect(activity.repo_name).toBe("test-repo");
		expect(activity.sections).toHaveLength(1);
		expect(activity.sections[0]?.source_id).toBe("fake");
		expect(activity.sections[0]?.summary_line).toBe("1 thing");
	});

	test("aggregates multiple repos with activity", async () => {
		const fake_section: ActivitySection = {
			source_id: "fake",
			source_label: "Fake Source",
			summary_line: "2 things",
			items: [
				{
					id: "y1",
					title: "task 1",
					timestamp: 1714816800,
				},
				{
					id: "y2",
					title: "task 2",
					timestamp: 1714903200,
				},
			],
		};

		register_activity_source({
			id: "fake",
			label: "Fake Source",
			collect: async () => ok(fake_section),
		});

		const repo1: RepoNode = {
			type: "repo",
			path: "/tmp/repo1",
			name: "repo1",
			status: null,
			children: [],
			worktrees: [],
			depth: 0,
			expanded: false,
		};

		const repo2: RepoNode = {
			type: "repo",
			path: "/tmp/repo2",
			name: "repo2",
			status: null,
			children: [],
			worktrees: [],
			depth: 0,
			expanded: false,
		};

		const range = range_weekly(new Date());
		const sources = list_activity_sources();
		const pool = createPool(8);

		const activities = await Promise.all(
			[repo1, repo2].map((r) => pool.run(() => collect_for_repo(r, range, sources))),
		);

		expect(activities).toHaveLength(2);
		expect(activities.map((a) => a.repo_name)).toContain("repo1");
		expect(activities.map((a) => a.repo_name)).toContain("repo2");
		expect(activities[0]?.sections).toHaveLength(1);
		expect(activities[1]?.sections).toHaveLength(1);
	});

	test("omits repos with no sections when all sources return null", async () => {
		register_activity_source({
			id: "fake",
			label: "Fake Source",
			collect: async () => ok(null),
		});

		const repo: RepoNode = {
			type: "repo",
			path: "/tmp/test-repo",
			name: "test-repo",
			status: null,
			children: [],
			worktrees: [],
			depth: 0,
			expanded: false,
		};

		const range = range_daily(new Date());
		const sources = list_activity_sources();
		const activity = await collect_for_repo(repo, range, sources);

		expect(activity.repo_name).toBe("test-repo");
		expect(activity.sections).toHaveLength(0);
	});

	test("resolve_standup_range: positional 'daily' returns ok", () => {
		const r = resolve_standup_range({ _: ["daily"] });
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.range).toBe("daily");
	});

	test("resolve_standup_range: missing range returns invalid_args", () => {
		const r = resolve_standup_range({});
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe("invalid_args");
	});

	test("collects repos recursively from directories", async () => {
		const repo1: RepoNode = {
			type: "repo",
			path: "/tmp/repo1",
			name: "repo1",
			status: null,
			children: [],
			worktrees: [],
			depth: 1,
			expanded: false,
		};

		const dir: RepoNode = {
			type: "directory",
			path: "/tmp/dir",
			name: "dir",
			children: [repo1],
			status: null,
			worktrees: [],
			depth: 0,
			expanded: false,
		};

		const collected = collect_repo_paths([dir]);
		expect(collected).toHaveLength(1);
		expect(collected[0]?.name).toBe("repo1");
	});
});
