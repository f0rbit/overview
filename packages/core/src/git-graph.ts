import { ok, err, type Result } from "@f0rbit/corpus";
import type { GitGraphOutput } from "./types";

export type GitGraphError =
	| { kind: "not_a_repo"; path: string }
	| { kind: "graph_failed"; path: string; cause: string };

const DEFAULT_LIMIT = 40;

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
	options?: { limit?: number; colorize?: boolean },
): Promise<Result<GitGraphOutput, GitGraphError>> {
	if (!(await isGitRepo(repoPath))) {
		return err({ kind: "not_a_repo", path: repoPath });
	}

	const limit = options?.limit ?? DEFAULT_LIMIT;
	const color = options?.colorize === false ? "--color=never" : "--color=always";

	const proc = Bun.spawn(
		["git", "log", "--graph", "--all", "--decorate", "--oneline", `-n`, `${limit}`, color],
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

	const lines = stripTrailingEmpty(stdout.split("\n"));

	return ok({
		lines,
		total_lines: lines.length,
		repo_path: repoPath,
	});
}
