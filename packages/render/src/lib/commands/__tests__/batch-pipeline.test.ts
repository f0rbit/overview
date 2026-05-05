import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ok } from "@f0rbit/corpus";
import { type RepoNode, type RepoStatus, defaultConfig } from "@overview/core";
import type { BatchTask } from "../../batch/planner";
import type { CommandContext } from "../../palette/context";
import { _clear_registry_for_tests, get_command, register_command } from "../../palette/registry";
import type { PaletteEvent } from "../../palette/types";
import { resolve_batch_args } from "../batch";

// Register batch commands (these would normally be imported from batch.ts)
// For now, we'll register them inline for testing purposes
import { z } from "zod";
import { plan } from "../../batch/planner";

const batch_args_schema: z.ZodSchema<{
	target: "all";
	filter: "all" | "dirty" | "clean" | "ahead" | "behind";
	dry_run: boolean;
	force: boolean;
}> = z
	.object({
		target: z.literal("all").optional(),
		filter: z.enum(["all", "dirty", "clean", "ahead", "behind"]).optional(),
		dry_run: z.boolean().optional(),
		force: z.boolean().optional(),
	})
	.transform(
		(
			data,
		): { target: "all"; filter: "all" | "dirty" | "clean" | "ahead" | "behind"; dry_run: boolean; force: boolean } => ({
			target: "all",
			filter: data.filter ?? "all",
			dry_run: data.dry_run ?? false,
			force: data.force ?? false,
		}),
	) as any;

type BatchArgs = {
	target: "all";
	filter: "all" | "dirty" | "clean" | "ahead" | "behind";
	dry_run: boolean;
	force: boolean;
};

function batch_command(action: "fetch" | "pull" | "push", label: string) {
	const cmd_label = label.charAt(0).toUpperCase() + label.slice(1);
	return {
		id: `:${action}` as const,
		label: `${cmd_label} all repos`,
		description: `Run git ${action} across all repos`,
		keywords: [action],
		args_schema: batch_args_schema,
		execute: async (args: BatchArgs, ctx: CommandContext) => {
			const tasks = plan({
				repos: ctx.repos(),
				action,
				filter: args.filter,
				dry_run: args.dry_run,
				force: args.force,
			});
			ctx.open_overlay("batch", { action, initial_tasks: tasks });
			return ok(undefined);
		},
	};
}

// Register the three batch commands
register_command(batch_command("fetch", "fetch"));
register_command(batch_command("pull", "pull"));
register_command(batch_command("push", "push"));

// Helper to create minimal RepoStatus
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
function make_repo_node(name: string, path = `/tmp/${name}`, status: RepoStatus | null = make_status()): RepoNode {
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

// Helper to create a fake CommandContext
class FakeContext implements CommandContext {
	config = defaultConfig();
	repos: () => readonly RepoNode[] = () => [];
	selected_repo: () => RepoNode | null = () => null;
	ai_provider = null;
	trigger_rescan = () => {};
	renderer = { suspend: () => {}, resume: () => {} };
	events: PaletteEvent[] = [];
	last_overlay?: { id: string; payload: unknown };

	emit(e: PaletteEvent) {
		this.events.push(e);
	}

	open_overlay(id: string, payload: unknown) {
		this.last_overlay = { id, payload };
	}
}

function make_fake_context(overrides?: Partial<FakeContext>): FakeContext {
	const ctx = new FakeContext();
	if (overrides) {
		Object.assign(ctx, overrides);
	}
	return ctx;
}

beforeEach(() => {
	_clear_registry_for_tests();
	// Re-register batch commands for each test
	register_command(batch_command("fetch", "fetch"));
	register_command(batch_command("pull", "pull"));
	register_command(batch_command("push", "push"));
});

afterEach(() => {
	_clear_registry_for_tests();
});

describe("batch commands integration", () => {
	test(":fetch all opens batch overlay with planned tasks", async () => {
		const cmd = get_command(":fetch");
		expect(cmd).toBeDefined();

		const fake_ctx = make_fake_context({
			repos: () => [make_repo_node("a"), make_repo_node("b")],
		});

		const result = await cmd!.execute({ target: "all", filter: "all", dry_run: true, force: false }, fake_ctx);

		expect(result.ok).toBe(true);
		expect(fake_ctx.last_overlay).toBeTruthy();
		expect(fake_ctx.last_overlay?.id).toBe("batch");

		const payload = fake_ctx.last_overlay?.payload as any;
		expect(payload.action).toBe("fetch");
		expect(payload.dry_run).toBeUndefined(); // dry_run not in payload, it's in initial_tasks
		expect(payload.initial_tasks).toHaveLength(2);
		expect(payload.initial_tasks.every((t: BatchTask) => t.status === "skipped" && t.skip_reason === "dry_run")).toBe(
			true,
		);
	});

	test(":pull all respects --filter clean", async () => {
		const cmd = get_command(":pull");
		expect(cmd).toBeDefined();

		const fake_ctx = make_fake_context({
			repos: () => [
				make_repo_node("clean", "/tmp/clean", make_status({ health: "clean" })),
				make_repo_node("dirty", "/tmp/dirty", make_status({ health: "dirty" })),
			],
		});

		const result = await cmd!.execute({ target: "all", filter: "clean", dry_run: false, force: false }, fake_ctx);

		expect(result.ok).toBe(true);

		const payload = fake_ctx.last_overlay?.payload as any;
		expect(payload.action).toBe("pull");
		expect(payload.initial_tasks).toHaveLength(2);

		const clean_task = payload.initial_tasks.find((t: BatchTask) => t.repo_name === "clean");
		const dirty_task = payload.initial_tasks.find((t: BatchTask) => t.repo_name === "dirty");

		expect(clean_task.status).toBe("queued");
		expect(dirty_task.status).toBe("skipped");
		expect(dirty_task.skip_reason).toBe("filter_excluded");
	});

	test(":push all with --force bypasses conflict checks", async () => {
		const cmd = get_command(":push");
		expect(cmd).toBeDefined();

		const fake_ctx = make_fake_context({
			repos: () => [make_repo_node("diverged", "/tmp/diverged", make_status({ health: "diverged", ahead: 3 }))],
		});

		// Without force
		const result_no_force = await cmd!.execute(
			{ target: "all", filter: "all", dry_run: false, force: false },
			fake_ctx,
		);

		expect(result_no_force.ok).toBe(true);
		let payload = fake_ctx.last_overlay?.payload as any;
		let task = payload.initial_tasks[0];
		expect(task.status).toBe("skipped");
		expect(task.skip_reason).toBe("would_conflict");

		// With force
		const result_with_force = await cmd!.execute(
			{ target: "all", filter: "all", dry_run: false, force: true },
			fake_ctx,
		);

		expect(result_with_force.ok).toBe(true);
		payload = fake_ctx.last_overlay?.payload as any;
		task = payload.initial_tasks[0];
		expect(task.status).toBe("queued");
	});

	test(":fetch all ignores filter (always runs on all repos)", async () => {
		const cmd = get_command(":fetch");
		expect(cmd).toBeDefined();

		const fake_ctx = make_fake_context({
			repos: () => [
				make_repo_node("clean", "/tmp/clean", make_status({ health: "clean" })),
				make_repo_node("dirty", "/tmp/dirty", make_status({ health: "dirty" })),
			],
		});

		const result = await cmd!.execute({ target: "all", filter: "clean", dry_run: false, force: false }, fake_ctx);

		expect(result.ok).toBe(true);

		const payload = fake_ctx.last_overlay?.payload as any;
		expect(payload.initial_tasks).toHaveLength(2);
		// Both should be queued (fetch ignores filter)
		expect(payload.initial_tasks.every((t: BatchTask) => t.status === "queued")).toBe(true);
	});

	test("batch commands flatten directory nodes", async () => {
		const cmd = get_command(":fetch");
		expect(cmd).toBeDefined();

		const repo1 = make_repo_node("repo1", "/tmp/repo1");
		const repo2 = make_repo_node("repo2", "/tmp/repo2");

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

		const fake_ctx = make_fake_context({
			repos: () => [dir],
		});

		const result = await cmd!.execute({ target: "all", filter: "all", dry_run: false, force: false }, fake_ctx);

		expect(result.ok).toBe(true);

		const payload = fake_ctx.last_overlay?.payload as any;
		expect(payload.initial_tasks).toHaveLength(2);
		expect(payload.initial_tasks.map((t: BatchTask) => t.repo_name)).toEqual(["repo1", "repo2"]);
	});

	test("resolve_batch_args: empty input returns ok with defaults", () => {
		const r = resolve_batch_args({});
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toEqual({ filter: "all", dry_run: false, force: false });
		}
	});

	test("resolve_batch_args: bogus positional returns invalid_args", () => {
		const r = resolve_batch_args({ _: ["bogus"] });
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error.kind).toBe("invalid_args");
	});

	test("batch commands pass correct payload structure to overlay", async () => {
		const cmd = get_command(":push");
		expect(cmd).toBeDefined();

		const fake_ctx = make_fake_context({
			repos: () => [make_repo_node("test", "/tmp/test", make_status({ ahead: 3 }))],
		});

		const result = await cmd!.execute({ target: "all", filter: "all", dry_run: false, force: false }, fake_ctx);

		expect(result.ok).toBe(true);

		const payload = fake_ctx.last_overlay?.payload as any;
		expect(payload).toHaveProperty("action");
		expect(payload).toHaveProperty("initial_tasks");
		expect(payload.action).toBe("push");
		expect(Array.isArray(payload.initial_tasks)).toBe(true);

		const task = payload.initial_tasks[0];
		expect(task).toHaveProperty("repo_path");
		expect(task).toHaveProperty("repo_name");
		expect(task).toHaveProperty("action");
		expect(task).toHaveProperty("status");
	});
});
