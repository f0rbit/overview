import type { createPool } from "@overview/core";
import type { BatchAction, BatchTask } from "./planner";

type Pool = ReturnType<typeof createPool>;

export interface ExecuteOptions {
	on_progress: (task: BatchTask) => void;
	abort_signal?: AbortSignal;
}

export async function execute(
	tasks: readonly BatchTask[],
	pool: Pool,
	opts: ExecuteOptions,
): Promise<readonly BatchTask[]> {
	const live: BatchTask[] = tasks.map((t) => ({ ...t }));

	for (const t of live) {
		if (t.status === "skipped") opts.on_progress({ ...t });
	}

	await Promise.all(
		live.map((t, i) => {
			if (t.status !== "queued") return Promise.resolve();
			return pool.run(() => run_task(live, i, opts));
		}),
	);

	return live;
}

async function run_task(live: BatchTask[], i: number, opts: ExecuteOptions): Promise<void> {
	const t = live[i]!;

	if (opts.abort_signal?.aborted) {
		live[i] = { ...t, status: "skipped", skip_reason: "dry_run", result_message: "aborted" };
		opts.on_progress({ ...live[i]! });
		return;
	}

	live[i] = { ...t, status: "running" };
	opts.on_progress({ ...live[i]! });

	const start = Date.now();
	const exec_result = await run_git(t.action, t.repo_path);
	const duration_ms = Date.now() - start;

	live[i] = exec_result.ok
		? { ...t, status: "succeeded", result_message: exec_result.message, duration_ms }
		: { ...t, status: "failed", result_message: exec_result.cause, duration_ms };
	opts.on_progress({ ...live[i]! });
}

interface ExecResult {
	ok: boolean;
	message: string;
	cause: string;
}

async function run_git(action: BatchAction, cwd: string): Promise<ExecResult> {
	const args = build_args(action);
	const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const exit_code = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();

	if (exit_code === 0) {
		return { ok: true, message: summarize_output(action, stdout, stderr), cause: "" };
	}
	const first_err = (stderr || stdout).split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "git failed";
	return { ok: false, message: "", cause: first_err };
}

function build_args(action: BatchAction): string[] {
	if (action === "fetch") return ["git", "fetch", "--all", "--prune"];
	return ["git", action];
}

function summarize_output(action: BatchAction, stdout: string, stderr: string): string {
	const lines = (stdout + stderr).split("\n").map((l) => l.trim()).filter(Boolean);
	return lines[lines.length - 1] ?? `${action} ok`;
}
