import { ok, err, type Result } from "@f0rbit/corpus";
import type { GitGraphOutput } from "./types";

export type GitGraphError =
	| { kind: "not_a_repo"; path: string }
	| { kind: "graph_failed"; path: string; cause: string };

const DEFAULT_LIMIT = 40;

// Strip ANSI escape codes in case git config forces color
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

const stripTrailingEmpty = (lines: string[]): string[] => {
	let end = lines.length;
	while (end > 0 && lines[end - 1]!.trim() === "") end--;
	return lines.slice(0, end);
};

const isGitRepo = async (path: string): Promise<boolean> => {
	const proc = Bun.spawn(["git", "rev-parse", "--git-dir"], {
		cwd: path,
		stdout: "pipe",
		stderr: "pipe",
	});
	const code = await proc.exited;
	return code === 0;
};

export async function captureGraph(
	repoPath: string,
	options?: { limit?: number },
): Promise<Result<GitGraphOutput, GitGraphError>> {
	if (!(await isGitRepo(repoPath))) {
		return err({ kind: "not_a_repo", path: repoPath });
	}

	const limit = options?.limit ?? DEFAULT_LIMIT;

	const proc = Bun.spawn(
		["git", "log", "--graph", "--all", "--decorate", "--oneline", `-n`, `${limit}`, "--color=never"],
		{
			cwd: repoPath,
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	const [stdout, stderr, exit_code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (exit_code !== 0) {
		// empty repo (no commits) exits non-zero — treat as empty
		if (stderr.includes("does not have any commits")) {
			return ok({ lines: [], total_lines: 0, repo_path: repoPath });
		}
		return err({ kind: "graph_failed", path: repoPath, cause: stderr.trim() });
	}

	const lines = stripTrailingEmpty(stdout.split("\n").map(stripAnsi));

	return ok({
		lines,
		total_lines: lines.length,
		repo_path: repoPath,
	});
}
