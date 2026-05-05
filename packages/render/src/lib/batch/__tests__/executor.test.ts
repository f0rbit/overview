import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool } from "@overview/core";
import { execute } from "../executor";
import type { BatchTask } from "../planner";

describe("batch executor", () => {
	// ── Skipped tasks (no spawning) ────────────────────────────────────

	test("executor emits progress for skipped tasks without spawning", async () => {
		const skipped_tasks: BatchTask[] = [
			{
				repo_path: "/x",
				repo_name: "x",
				action: "fetch",
				status: "skipped",
				skip_reason: "dry_run",
			},
			{
				repo_path: "/y",
				repo_name: "y",
				action: "pull",
				status: "skipped",
				skip_reason: "filter_excluded",
			},
		];

		const events: BatchTask[] = [];
		const pool = createPool(4);

		const final_tasks = await execute(skipped_tasks, pool, {
			on_progress: (t) => events.push(t),
		});

		expect(events).toHaveLength(2);
		expect(final_tasks).toHaveLength(2);
		expect(final_tasks.every((t) => t.status === "skipped")).toBe(true);
	});

	// ── Fixture repo integration ────────────────────────────────────

	test("executor runs queued fetch task against a fixture repo", async () => {
		const tmp = await mkdtemp(join(tmpdir(), "overview-batch-test-"));

		try {
			// Initialize a git repo
			await Bun.spawn(["git", "init", "-q"], { cwd: tmp }).exited;
			await Bun.spawn(["git", "config", "user.email", "test@test.com"], { cwd: tmp }).exited;
			await Bun.spawn(["git", "config", "user.name", "Test User"], { cwd: tmp }).exited;
			await Bun.write(join(tmp, "README.md"), "# Test Repo");
			await Bun.spawn(["git", "add", "."], { cwd: tmp }).exited;
			await Bun.spawn(["git", "commit", "-m", "initial"], { cwd: tmp }).exited;

			const tasks: BatchTask[] = [
				{
					repo_path: tmp,
					repo_name: "tmp",
					action: "fetch",
					status: "queued",
				},
			];

			const events: BatchTask[] = [];
			const pool = createPool(4);

			const final = await execute(tasks, pool, {
				on_progress: (t) => events.push({ ...t }),
			});

			// Should have transitioned through states
			expect(final).toHaveLength(1);
			const task = final[0]!;
			expect(["succeeded", "failed"]).toContain(task.status);

			// Should have emitted progress (at least running + final state)
			expect(events.length).toBeGreaterThanOrEqual(1);
			expect(events.some((e) => e.status === "running")).toBe(true);
		} finally {
			await rm(tmp, { recursive: true, force: true });
		}
	});

	test("executor respects abort signal", async () => {
		const tmp = await mkdtemp(join(tmpdir(), "overview-batch-test-"));

		try {
			// Initialize a git repo
			await Bun.spawn(["git", "init", "-q"], { cwd: tmp }).exited;
			await Bun.spawn(["git", "config", "user.email", "test@test.com"], { cwd: tmp }).exited;
			await Bun.spawn(["git", "config", "user.name", "Test User"], { cwd: tmp }).exited;
			await Bun.write(join(tmp, "README.md"), "# Test Repo");
			await Bun.spawn(["git", "add", "."], { cwd: tmp }).exited;
			await Bun.spawn(["git", "commit", "-m", "initial"], { cwd: tmp }).exited;

			// Create multiple queued tasks
			const tasks: BatchTask[] = Array.from({ length: 4 }, (_, i) => ({
				repo_path: tmp,
				repo_name: `task-${i}`,
				action: "fetch" as const,
				status: "queued" as const,
			}));

			const ac = new AbortController();
			ac.abort(); // abort before we start

			const pool = createPool(4);

			const final = await execute(tasks, pool, {
				on_progress: () => {},
				abort_signal: ac.signal,
			});

			// All tasks should be skipped
			expect(final.every((t) => t.status === "skipped")).toBe(true);
		} finally {
			await rm(tmp, { recursive: true, force: true });
		}
	});

	test("executor emits progress events during execution", async () => {
		const tmp = await mkdtemp(join(tmpdir(), "overview-batch-test-"));

		try {
			// Initialize a git repo
			await Bun.spawn(["git", "init", "-q"], { cwd: tmp }).exited;
			await Bun.spawn(["git", "config", "user.email", "test@test.com"], { cwd: tmp }).exited;
			await Bun.spawn(["git", "config", "user.name", "Test User"], { cwd: tmp }).exited;
			await Bun.write(join(tmp, "README.md"), "# Test Repo");
			await Bun.spawn(["git", "add", "."], { cwd: tmp }).exited;
			await Bun.spawn(["git", "commit", "-m", "initial"], { cwd: tmp }).exited;

			const tasks: BatchTask[] = [
				{
					repo_path: tmp,
					repo_name: "test-repo",
					action: "fetch",
					status: "queued",
				},
			];

			const events: BatchTask[] = [];
			const pool = createPool(4);

			await execute(tasks, pool, {
				on_progress: (t) => events.push({ ...t }),
			});

			// Should have seen at least running state and a final state
			const statuses = events.map((e) => e.status);
			expect(statuses).toContain("running");
			expect(statuses[statuses.length - 1]).toMatch(/succeeded|failed/);
		} finally {
			await rm(tmp, { recursive: true, force: true });
		}
	});
});
