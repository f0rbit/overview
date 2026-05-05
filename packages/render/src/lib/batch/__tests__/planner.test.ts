import { describe, expect, test } from "bun:test";
import type { RepoNode, RepoStatus } from "@overview/core";
import { type BatchTask, type PlanInput, plan } from "../planner";

// Helper to create a minimal valid RepoStatus
function make_status(overrides: Partial<RepoStatus> = {}): RepoStatus {
	return {
		path: "/tmp/test",
		name: "test",
		display_path: "test",
		current_branch: "main",
		head_commit: "abc123",
		head_message: "test commit",
		head_time: 0,
		remote_url: "https://github.com/test/test.git",
		ahead: 0,
		behind: 0,
		modified_count: 0,
		staged_count: 0,
		untracked_count: 0,
		conflict_count: 0,
		changes: [],
		stash_count: 0,
		stashes: [],
		branches: [],
		local_branch_count: 0,
		remote_branch_count: 0,
		tags: [],
		total_commits: 0,
		repo_size_bytes: 0,
		contributor_count: 0,
		recent_commits: [],
		commit_activity: null,
		ocn_status: null,
		is_clean: true,
		health: "clean",
		...overrides,
	};
}

// Helper to create a minimal RepoNode
function make_repo(name: string, path = `/tmp/${name}`, status: RepoStatus | null = make_status()): RepoNode {
	return {
		type: "repo",
		name,
		path,
		status,
		children: [],
		worktrees: [],
		depth: 0,
		expanded: false,
	};
}

describe("batch planner", () => {
	// ── Empty repos ────────────────────────────────────────────────────

	test("empty repos returns no tasks", () => {
		const input: PlanInput = {
			repos: [],
			action: "fetch",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(0);
	});

	// ── Fetch always safe ────────────────────────────────────────────────────

	test("fetch on mixed repos (dirty, clean, ahead) queued for all", () => {
		const dirty_repo = make_repo("dirty", "/tmp/dirty", make_status({ health: "dirty" }));
		const clean_repo = make_repo("clean", "/tmp/clean", make_status({ health: "clean" }));
		const ahead_repo = make_repo("ahead", "/tmp/ahead", make_status({ ahead: 3 }));

		const input: PlanInput = {
			repos: [dirty_repo, clean_repo, ahead_repo],
			action: "fetch",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(3);
		expect(tasks.every((t) => t.status === "queued")).toBe(true);
	});

	test("fetch ignores filter and runs on all repos", () => {
		const dirty_repo = make_repo("dirty", "/tmp/dirty", make_status({ health: "dirty" }));
		const clean_repo = make_repo("clean", "/tmp/clean", make_status({ health: "clean" }));

		const input: PlanInput = {
			repos: [dirty_repo, clean_repo],
			action: "fetch",
			filter: "clean",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(2);
		// Both should be queued because fetch is filter-exempt
		expect(tasks[0]?.status).toBe("queued");
		expect(tasks[1]?.status).toBe("queued");
	});

	// ── Pull filter and conflict rules ────────────────────────────────────

	test("pull on dirty repo without force skips with would_conflict", () => {
		const dirty_repo = make_repo("dirty", "/tmp/dirty", make_status({ health: "dirty" }));

		const input: PlanInput = {
			repos: [dirty_repo],
			action: "pull",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.status).toBe("skipped");
		expect(tasks[0]?.skip_reason).toBe("would_conflict");
	});

	test("pull on dirty repo with force=true queued", () => {
		const dirty_repo = make_repo("dirty", "/tmp/dirty", make_status({ health: "dirty" }));

		const input: PlanInput = {
			repos: [dirty_repo],
			action: "pull",
			filter: "all",
			dry_run: false,
			force: true,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.status).toBe("queued");
	});

	test("pull on clean repo queued", () => {
		const clean_repo = make_repo("clean", "/tmp/clean", make_status({ health: "clean" }));

		const input: PlanInput = {
			repos: [clean_repo],
			action: "pull",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.status).toBe("queued");
	});

	test("pull with filter=clean excludes dirty repos", () => {
		const dirty_repo = make_repo("dirty", "/tmp/dirty", make_status({ health: "dirty" }));
		const clean_repo = make_repo("clean", "/tmp/clean", make_status({ health: "clean" }));

		const input: PlanInput = {
			repos: [dirty_repo, clean_repo],
			action: "pull",
			filter: "clean",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(2);
		expect(tasks[0]?.skip_reason).toBe("filter_excluded");
		expect(tasks[1]?.status).toBe("queued");
	});

	// ── Push rules ────────────────────────────────────────────────────────

	test("push with ahead=0 skips with nothing_to_push", () => {
		const no_ahead = make_repo("no-ahead", "/tmp/no-ahead", make_status({ ahead: 0 }));

		const input: PlanInput = {
			repos: [no_ahead],
			action: "push",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.status).toBe("skipped");
		expect(tasks[0]?.skip_reason).toBe("nothing_to_push");
	});

	test("push with ahead=3 on clean health queued", () => {
		const ahead_repo = make_repo("ahead", "/tmp/ahead", make_status({ ahead: 3, health: "clean" }));

		const input: PlanInput = {
			repos: [ahead_repo],
			action: "push",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.status).toBe("queued");
	});

	test("push with ahead=3 on diverged health without force skips with would_conflict", () => {
		const diverged = make_repo("diverged", "/tmp/diverged", make_status({ ahead: 3, health: "diverged" }));

		const input: PlanInput = {
			repos: [diverged],
			action: "push",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.status).toBe("skipped");
		expect(tasks[0]?.skip_reason).toBe("would_conflict");
	});

	test("push with ahead=3 on diverged health with force=true queued", () => {
		const diverged = make_repo("diverged", "/tmp/diverged", make_status({ ahead: 3, health: "diverged" }));

		const input: PlanInput = {
			repos: [diverged],
			action: "push",
			filter: "all",
			dry_run: false,
			force: true,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.status).toBe("queued");
	});

	// ── Filter rules ────────────────────────────────────────────────────────

	test("filter=all passes all repos", () => {
		const repos = [
			make_repo("r1", "/tmp/r1", make_status({ health: "clean" })),
			make_repo("r2", "/tmp/r2", make_status({ health: "dirty" })),
			make_repo("r3", "/tmp/r3", make_status({ ahead: 3 })),
		];

		const input: PlanInput = {
			repos,
			action: "push",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks.filter((t) => t.skip_reason === "filter_excluded")).toHaveLength(0);
	});

	test("filter=clean passes only clean health", () => {
		const repos = [
			make_repo("clean", "/tmp/clean", make_status({ health: "clean", ahead: 3 })),
			make_repo("dirty", "/tmp/dirty", make_status({ health: "dirty", ahead: 3 })),
			make_repo("ahead", "/tmp/ahead", make_status({ health: "ahead", ahead: 3 })),
		];

		const input: PlanInput = {
			repos,
			action: "push",
			filter: "clean",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks[0]?.status).toBe("queued"); // clean, ahead=3 → push queued
		expect(tasks[1]?.skip_reason).toBe("filter_excluded"); // dirty → excluded
		expect(tasks[2]?.skip_reason).toBe("filter_excluded"); // ahead health → excluded
	});

	test("filter=dirty passes non-clean health", () => {
		const repos = [
			make_repo("clean", "/tmp/clean", make_status({ health: "clean", ahead: 3 })),
			make_repo("dirty", "/tmp/dirty", make_status({ health: "dirty", ahead: 3 })),
		];

		const input: PlanInput = {
			repos,
			action: "push",
			filter: "dirty",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks[0]?.skip_reason).toBe("filter_excluded"); // clean → excluded
		expect(tasks[1]?.status).toBe("queued"); // dirty, ahead=3 → push queued
	});

	test("filter=ahead passes ahead or diverged health", () => {
		const repos = [
			make_repo("clean", "/tmp/clean", make_status({ health: "clean", ahead: 3 })),
			make_repo("ahead", "/tmp/ahead", make_status({ health: "ahead", ahead: 3 })),
			make_repo("diverged", "/tmp/diverged", make_status({ health: "diverged", ahead: 3 })),
			make_repo("behind", "/tmp/behind", make_status({ health: "behind", ahead: 3 })),
		];

		const input: PlanInput = {
			repos,
			action: "push",
			filter: "ahead",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks[0]?.skip_reason).toBe("filter_excluded"); // clean → excluded
		expect(tasks[1]?.status).toBe("queued"); // ahead, ahead=3 → push queued
		expect(tasks[2]?.status).toBe("skipped");
		expect(tasks[2]?.skip_reason).toBe("would_conflict"); // diverged → conflict without force
		expect(tasks[3]?.skip_reason).toBe("filter_excluded"); // behind → excluded
	});

	test("filter=behind passes behind or diverged health", () => {
		const repos = [
			make_repo("clean", "/tmp/clean", make_status({ health: "clean", ahead: 3 })),
			make_repo("behind", "/tmp/behind", make_status({ health: "behind", ahead: 3 })),
			make_repo("diverged", "/tmp/diverged", make_status({ health: "diverged", ahead: 3 })),
			make_repo("ahead", "/tmp/ahead", make_status({ health: "ahead", ahead: 3 })),
		];

		const input: PlanInput = {
			repos,
			action: "push",
			filter: "behind",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks[0]?.skip_reason).toBe("filter_excluded"); // clean → excluded
		expect(tasks[1]?.status).toBe("queued"); // behind, ahead=3 → push queued
		expect(tasks[2]?.status).toBe("skipped");
		expect(tasks[2]?.skip_reason).toBe("would_conflict"); // diverged → conflict without force
		expect(tasks[3]?.skip_reason).toBe("filter_excluded"); // ahead → excluded
	});

	// ── Dry-run ────────────────────────────────────────────────────────

	test("dry_run=true skips all queued tasks with dry_run reason", () => {
		const repo = make_repo("clean", "/tmp/clean", make_status({ health: "clean", ahead: 3 }));

		const input: PlanInput = {
			repos: [repo],
			action: "push",
			filter: "all",
			dry_run: true,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.status).toBe("skipped");
		expect(tasks[0]?.skip_reason).toBe("dry_run");
	});

	test("dry_run=true skips everything, including filter-excluded", () => {
		const repos = [
			make_repo("clean", "/tmp/clean", make_status({ health: "clean", ahead: 3 })),
			make_repo("dirty", "/tmp/dirty", make_status({ health: "dirty", ahead: 3 })),
		];

		const input: PlanInput = {
			repos,
			action: "push",
			filter: "clean",
			dry_run: true,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(2);
		// clean repo would pass filter but is dry_run'd
		expect(tasks[0]?.status).toBe("skipped");
		expect(tasks[0]?.skip_reason).toBe("dry_run");
		// dirty repo is excluded by filter
		expect(tasks[1]?.skip_reason).toBe("filter_excluded");
	});

	// ── Directory flattening ────────────────────────────────────────────────────

	test("directory nodes are flattened to leaf repos", () => {
		const repo1 = make_repo("repo1", "/tmp/repo1");
		const repo2 = make_repo("repo2", "/tmp/repo2");

		const dir: RepoNode = {
			type: "directory",
			name: "mydir",
			path: "/tmp/mydir",
			children: [repo1, repo2],
			status: null,
			worktrees: [],
			depth: 0,
			expanded: false,
		};

		const input: PlanInput = {
			repos: [dir],
			action: "fetch",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(2);
		expect(tasks.map((t) => t.repo_name)).toEqual(["repo1", "repo2"]);
	});

	test("nested directories are fully flattened", () => {
		const repo1 = make_repo("repo1", "/tmp/repo1");
		const repo2 = make_repo("repo2", "/tmp/repo2");

		const inner_dir: RepoNode = {
			type: "directory",
			name: "inner",
			path: "/tmp/inner",
			children: [repo2],
			status: null,
			worktrees: [],
			depth: 1,
			expanded: false,
		};

		const outer_dir: RepoNode = {
			type: "directory",
			name: "outer",
			path: "/tmp/outer",
			children: [repo1, inner_dir],
			status: null,
			worktrees: [],
			depth: 0,
			expanded: false,
		};

		const input: PlanInput = {
			repos: [outer_dir],
			action: "fetch",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(2);
		expect(tasks.map((t) => t.repo_name)).toEqual(["repo1", "repo2"]);
	});

	// ── Null status repos ────────────────────────────────────────────────────

	test("repos with null status pass filter=all on fetch but fail other filters", () => {
		const no_status = make_repo("no-status", "/tmp/no-status", null);

		const input: PlanInput = {
			repos: [no_status],
			action: "fetch",
			filter: "all",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.status).toBe("queued");
	});

	test("repos with null status are excluded by non-all filters", () => {
		const no_status = make_repo("no-status", "/tmp/no-status", null);

		const input: PlanInput = {
			repos: [no_status],
			action: "push",
			filter: "clean",
			dry_run: false,
			force: false,
		};

		const tasks = plan(input);
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.skip_reason).toBe("filter_excluded");
	});
});
