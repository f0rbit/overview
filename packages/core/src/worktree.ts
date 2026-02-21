import { ok, err, type Result } from "@f0rbit/corpus";
import type { WorktreeInfo } from "./types";

export type WorktreeError =
	| { kind: "not_a_repo"; path: string }
	| { kind: "worktree_failed"; path: string; cause: string };

async function gitCommand(
	args: string[],
	cwd: string,
): Promise<Result<string, WorktreeError>> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	await proc.exited;

	if (proc.exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		const is_not_repo =
			stderr.includes("not a git repository") ||
			stderr.includes("not a git repo");
		if (is_not_repo) {
			return err({ kind: "not_a_repo", path: cwd });
		}
		return err({
			kind: "worktree_failed",
			path: cwd,
			cause: stderr.trim(),
		});
	}

	const stdout = await new Response(proc.stdout).text();
	return ok(stdout);
}

function parseWorktreeBlock(
	lines: string[],
	is_main: boolean,
): WorktreeInfo | null {
	const path = lines
		.find((l) => l.startsWith("worktree "))
		?.slice("worktree ".length);
	if (!path) return null;

	const head_line = lines.find((l) => l.startsWith("HEAD "));
	const head = head_line ? head_line.slice("HEAD ".length, "HEAD ".length + 7) : "0000000";

	const branch_line = lines.find((l) => l.startsWith("branch "));
	const is_bare = lines.some((l) => l === "bare");
	const branch = branch_line
		? branch_line.slice("branch refs/heads/".length)
		: is_bare
			? "bare"
			: "detached";

	return { path, branch, head, is_bare, is_main };
}

export async function detectWorktrees(
	repoPath: string,
): Promise<Result<WorktreeInfo[], WorktreeError>> {
	const result = await gitCommand(["worktree", "list", "--porcelain"], repoPath);
	if (!result.ok) return result;

	const blocks = result.value
		.split("\n\n")
		.map((b) => b.trim())
		.filter((b) => b.length > 0);

	const worktrees = blocks
		.map((block, i) => parseWorktreeBlock(block.split("\n"), i === 0))
		.filter((w): w is WorktreeInfo => w !== null);

	if (worktrees.length <= 1) return ok([]);

	return ok(worktrees);
}
