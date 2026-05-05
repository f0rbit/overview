import { type Result, err, ok } from "@f0rbit/corpus";
import { createPool } from "@overview/core";
import { z } from "zod";
import { type BatchAction, type BatchFilter, execute, plan } from "../batch";
import { register_command } from "../palette/registry";
import type { CommandError } from "../palette/types";

const batch_args_schema = z.object({
	_: z.array(z.string()).optional(),
	filter: z.enum(["all", "dirty", "clean", "ahead", "behind"]).optional(),
	"dry-run": z.boolean().optional(),
	force: z.boolean().optional(),
});

export type BatchRawArgs = z.infer<typeof batch_args_schema>;

interface BatchArgs {
	filter: BatchFilter;
	dry_run: boolean;
	force: boolean;
}

export function resolve_batch_args(raw: BatchRawArgs): Result<BatchArgs, CommandError> {
	const positional = raw._?.[0];
	if (positional !== undefined && positional !== "all") {
		return err({
			kind: "invalid_args",
			details: `unknown positional: ${positional}. Try '... all'.`,
		});
	}
	return ok({
		filter: raw.filter ?? "all",
		dry_run: raw["dry-run"] ?? false,
		force: raw.force ?? false,
	});
}

async function run_batch(
	action: BatchAction,
	args: BatchArgs,
	ctx: any, // CommandContext, but typing would create circular import
): Promise<any> {
	const repos = ctx.repos();
	const tasks = plan({
		repos,
		action,
		filter: args.filter,
		dry_run: args.dry_run,
		force: args.force,
	});

	if (tasks.length === 0) {
		ctx.emit({ kind: "status", text: "(no repos to operate on)", level: "info" });
		return ok(undefined);
	}

	const pool = createPool(8);
	const abort_controller = new AbortController();

	// Track in-progress task updates for subscribers
	let current_tasks = tasks;
	const subscribers = new Set<(tasks: readonly any[]) => void>();
	const done_subscribers = new Set<() => void>();
	let abort_called = false;

	// Payload for the overlay
	const payload = {
		action,
		filter: args.filter,
		dry_run: args.dry_run,
		force: args.force,
		initial_tasks: tasks,
		subscribe: (cb: (tasks: readonly any[]) => void) => {
			subscribers.add(cb);
			return () => {
				subscribers.delete(cb);
			};
		},
		subscribe_done: (cb: () => void) => {
			done_subscribers.add(cb);
			return () => {
				done_subscribers.delete(cb);
			};
		},
		abort: () => {
			abort_called = true;
			abort_controller.abort();
		},
	};

	ctx.open_overlay("batch", payload);

	// Run executor with progress callback
	const final_tasks = await execute(tasks, pool, {
		on_progress: (task) => {
			current_tasks = current_tasks.map((t) => (t.repo_path === task.repo_path && t.action === task.action ? task : t));
			for (const cb of subscribers) {
				cb(current_tasks);
			}
		},
		abort_signal: abort_controller.signal,
	});

	current_tasks = final_tasks;
	for (const cb of subscribers) {
		cb(current_tasks);
	}
	for (const cb of done_subscribers) {
		cb();
	}

	return ok(undefined);
}

register_command<BatchRawArgs>({
	id: ":fetch all",
	label: "Fetch all repos",
	description: "Run git fetch across all repos",
	keywords: ["fetch", "all"],
	args_schema: batch_args_schema,
	execute: async (raw_args, ctx) => {
		const args_result = resolve_batch_args(raw_args);
		if (!args_result.ok) return args_result;
		return run_batch("fetch", args_result.value, ctx);
	},
});

register_command<BatchRawArgs>({
	id: ":pull all",
	label: "Pull clean repos",
	description: "Run git pull across all repos (skips dirty unless --force)",
	keywords: ["pull", "all"],
	args_schema: batch_args_schema,
	execute: async (raw_args, ctx) => {
		const args_result = resolve_batch_args(raw_args);
		if (!args_result.ok) return args_result;
		return run_batch("pull", args_result.value, ctx);
	},
});

register_command<BatchRawArgs>({
	id: ":push all",
	label: "Push repos with commits ahead",
	description: "Run git push across all repos with commits to push",
	keywords: ["push", "all"],
	args_schema: batch_args_schema,
	execute: async (raw_args, ctx) => {
		const args_result = resolve_batch_args(raw_args);
		if (!args_result.ok) return args_result;
		return run_batch("push", args_result.value, ctx);
	},
});
