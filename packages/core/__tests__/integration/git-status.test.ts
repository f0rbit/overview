import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { collectStatus } from "../../src/git-status";
import {
	createTempDir,
	cleanupTempDir,
	initRepo,
	stashChanges,
} from "../helpers";

describe("git-status integration", () => {
	let temp_dir: string;

	beforeAll(async () => {
		temp_dir = await createTempDir();
	});

	afterAll(async () => {
		await cleanupTempDir(temp_dir);
	});

	test("parses branch info", async () => {
		const dir = join(temp_dir, "branch-test");
		await mkdir(dir, { recursive: true });
		const repo_path = await initRepo(dir, "branch-repo");

		const result = await collectStatus(repo_path, dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// git init may default to "main" or "master"
		expect(["main", "master"]).toContain(result.value.current_branch);
	});

	test("detects stashes", async () => {
		const dir = join(temp_dir, "stash-test");
		await mkdir(dir, { recursive: true });
		const repo_path = await initRepo(dir, "stash-repo");
		await stashChanges(repo_path);

		const result = await collectStatus(repo_path, dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.stash_count).toBeGreaterThan(0);
	});

	test("handles repo with no remote", async () => {
		const dir = join(temp_dir, "no-remote-test");
		await mkdir(dir, { recursive: true });
		const repo_path = await initRepo(dir, "no-remote-repo");

		const result = await collectStatus(repo_path, dir);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		expect(result.value.remote_url).toBeNull();
		expect(result.value.ahead).toBe(0);
		expect(result.value.behind).toBe(0);
	});
});
