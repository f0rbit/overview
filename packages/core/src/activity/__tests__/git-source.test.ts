import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RepoNode } from "../../types";
import { range_custom } from "../range";

// Import the git_source for testing — deep import is acceptable for tests
import { git_source } from "../sources/git";

let tmp_dir: string;

// Helper to spawn git with environment variables for deterministic timestamps
async function spawn_git_with_date(iso_date: string, ...args: string[]): Promise<void> {
	const timestamp = new Date(iso_date).getTime() / 1000;
	const timestamp_str = Math.floor(timestamp).toString();

	const proc = Bun.spawn(["git", ...args], {
		cwd: tmp_dir,
		env: {
			...process.env,
			GIT_AUTHOR_DATE: timestamp_str,
			GIT_COMMITTER_DATE: timestamp_str,
			GIT_AUTHOR_NAME: "Test User",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test User",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	const code = await proc.exited;
	if (code !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`git failed with code ${code}: ${stderr}`);
	}
}

async function spawn_git(...args: string[]): Promise<void> {
	const proc = Bun.spawn(["git", ...args], {
		cwd: tmp_dir,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Test User",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test User",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	const code = await proc.exited;
	if (code !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`git failed with code ${code}: ${stderr}`);
	}
}

beforeAll(async () => {
	tmp_dir = await mkdtemp(join(tmpdir(), "overview-git-test-"));
	await spawn_git("init");

	// Create first file and commit with deterministic date
	await writeFile(join(tmp_dir, "a.txt"), "hello\n");
	await spawn_git("add", "a.txt");
	await spawn_git_with_date("2026-05-03T10:00:00Z", "commit", "-m", "first");

	// Modify file and commit with second deterministic date
	await writeFile(join(tmp_dir, "a.txt"), "hello\nworld\n");
	await spawn_git("add", "a.txt");
	await spawn_git_with_date("2026-05-04T10:00:00Z", "commit", "-m", "second");
});

afterAll(async () => {
	await rm(tmp_dir, { recursive: true, force: true });
});

describe("git source", () => {
	test("collects commits within range", async () => {
		const node: RepoNode = {
			type: "repo",
			path: tmp_dir,
			name: "fixture",
			status: null,
			children: [],
			worktrees: [],
			depth: 0,
			expanded: false,
		};
		const range = range_custom(new Date("2026-05-01"), new Date("2026-05-05"));

		const result = await git_source.collect(node, range);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value).not.toBeNull();
		if (result.value === null) return;

		expect(result.value.source_id).toBe("git");
		expect(result.value.source_label).toBe("Git Activity");
		expect(result.value.items).toHaveLength(2);
		expect(result.value.items[0]?.title).toBe("second");
		expect(result.value.items[1]?.title).toBe("first");
		expect(result.value.metrics?.commits).toBe(2);
	});

	test("returns null for empty range", async () => {
		const node: RepoNode = {
			type: "repo",
			path: tmp_dir,
			name: "fixture",
			status: null,
			children: [],
			worktrees: [],
			depth: 0,
			expanded: false,
		};
		const range = range_custom(new Date("2026-05-10"), new Date("2026-05-15"));

		const result = await git_source.collect(node, range);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value).toBeNull();
	});

	test("returns null for directory nodes", async () => {
		const node: RepoNode = {
			type: "directory",
			path: tmp_dir,
			name: "fixture",
			children: [],
			status: null,
			worktrees: [],
			depth: 0,
			expanded: false,
		};
		const range = range_custom(new Date("2026-05-01"), new Date("2026-05-05"));

		const result = await git_source.collect(node, range);

		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value).toBeNull();
	});

	test("includes commit metadata in items", async () => {
		const node: RepoNode = {
			type: "repo",
			path: tmp_dir,
			name: "fixture",
			status: null,
			children: [],
			worktrees: [],
			depth: 0,
			expanded: false,
		};
		const range = range_custom(new Date("2026-05-01"), new Date("2026-05-05"));

		const result = await git_source.collect(node, range);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		if (result.value === null) return;

		const second_item = result.value.items[0];
		expect(second_item).toBeDefined();
		expect(second_item?.author).toBe("Test User");
		expect(second_item?.timestamp).toBeDefined();
		expect(second_item?.timestamp).toBeGreaterThan(0);
	});

	test("generates summary_line with correct format", async () => {
		const node: RepoNode = {
			type: "repo",
			path: tmp_dir,
			name: "fixture",
			status: null,
			children: [],
			worktrees: [],
			depth: 0,
			expanded: false,
		};
		const range = range_custom(new Date("2026-05-01"), new Date("2026-05-05"));

		const result = await git_source.collect(node, range);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		if (result.value === null) return;

		// summary_line should contain commit count
		expect(result.value.summary_line).toMatch(/2 commits/);
	});
});
