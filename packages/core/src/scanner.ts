import { readdir, stat, lstat } from "node:fs/promises";
import { join, basename } from "node:path";
import { ok, err, try_catch_async, format_error, type Result } from "@f0rbit/corpus";
import type { RepoNode } from "./types";

export type ScanError =
	| { kind: "invalid_path"; path: string; message: string }
	| { kind: "permission_denied"; path: string }
	| { kind: "scan_failed"; path: string; cause: string };

async function isGitRepo(dirPath: string): Promise<boolean> {
	const proc = Bun.spawn(["git", "rev-parse", "--git-dir"], {
		cwd: dirPath,
		stdout: "pipe",
		stderr: "pipe",
	});
	const code = await proc.exited;
	return code === 0;
}

async function detectType(dirPath: string): Promise<"repo" | "worktree" | null> {
	const git_path = join(dirPath, ".git");
	const result = await try_catch_async(
		() => lstat(git_path),
		() => null,
	);
	if (!result.ok || result.value === null) return null;

	const stats = result.value;
	if (stats.isFile()) return "worktree";
	if (stats.isDirectory()) return "repo";
	return null;
}

async function walkDirectory(
	dirPath: string,
	current_depth: number,
	max_depth: number,
	ignore: string[],
): Promise<Result<RepoNode[], ScanError>> {
	if (current_depth > max_depth) return ok([]);

	const entries_result = await try_catch_async(
		() => readdir(dirPath, { withFileTypes: true }),
		(e) => {
			const msg = format_error(e);
			if (msg.includes("EACCES") || msg.includes("permission"))
				return { kind: "permission_denied" as const, path: dirPath };
			return { kind: "scan_failed" as const, path: dirPath, cause: msg };
		},
	);

	if (!entries_result.ok) return entries_result;

	const dirs = entries_result.value
		.filter((e) => e.isDirectory() && !ignore.some((pattern) => e.name.includes(pattern)))
		.sort((a, b) => a.name.localeCompare(b.name));

	const results = await Promise.all(
		dirs.map(async (entry) => {
			const full_path = join(dirPath, entry.name);
			const repo_type = await detectType(full_path);
			const is_repo = repo_type !== null && (await isGitRepo(full_path));

			const children_result = await walkDirectory(full_path, current_depth + 1, max_depth, ignore);
			if (!children_result.ok) return null;

			const children = children_result.value;

			if (is_repo) {
				return {
					name: entry.name,
					path: full_path,
					type: repo_type,
					status: null,
					worktrees: [],
					children,
					depth: current_depth,
					expanded: current_depth <= 1,
				} as RepoNode;
			} else if (children.length > 0) {
				return {
					name: entry.name,
					path: full_path,
					type: "directory" as const,
					status: null,
					worktrees: [],
					children,
					depth: current_depth,
					expanded: current_depth <= 1,
				} as RepoNode;
			}
			return null;
		}),
	);

	return ok(results.filter((n): n is RepoNode => n !== null));
}

export async function scanDirectory(
	root: string,
	options: { depth: number; ignore: string[] },
): Promise<Result<RepoNode[], ScanError>> {
	const root_stat = await try_catch_async(
		() => stat(root),
		(e) => ({
			kind: "invalid_path" as const,
			path: root,
			message: format_error(e),
		}),
	);

	if (!root_stat.ok) return root_stat;
	if (!root_stat.value.isDirectory())
		return err({ kind: "invalid_path", path: root, message: "Not a directory" });

	return walkDirectory(root, 0, options.depth, options.ignore);
}
