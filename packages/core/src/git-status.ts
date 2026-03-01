import { ok, err, type Result } from "@f0rbit/corpus";
import { basename, relative } from "node:path";
import type {
	RepoStatus,
	GitFileChange,
	BranchInfo,
	StashEntry,
	HealthStatus,
} from "./types";

export type GitStatusError =
	| { kind: "not_a_repo"; path: string }
	| { kind: "git_failed"; path: string; command: string; cause: string };

async function git(
	args: string[],
	cwd: string,
): Promise<Result<string, GitStatusError>> {
	const proc = Bun.spawn(["git", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	await proc.exited;

	if (proc.exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		if (
			stderr.includes("not a git repository") ||
			stderr.includes("not a git repo")
		) {
			return err({ kind: "not_a_repo", path: cwd });
		}
		return err({
			kind: "git_failed",
			path: cwd,
			command: `git ${args.join(" ")}`,
			cause: stderr.trim(),
		});
	}

	const stdout = await new Response(proc.stdout).text();
	return ok(stdout);
}

function parseFileStatus(line: string): GitFileChange | null {
	const first_char = line[0];
	if (!first_char) return null;

	if (first_char === "?") {
		const path = line.slice(2);
		return { path, status: "untracked", staged: false };
	}

	if (first_char === "u") {
		const parts = line.split("\t");
		const path = parts[1] ?? line.split(" ").pop() ?? "";
		return { path, status: "conflicted", staged: false };
	}

	if (first_char === "1") {
		const parts = line.split(" ");
		const xy = parts[1] ?? "..";
		const path = line.split("\t")[0]?.split(" ").pop() ?? parts.at(-1) ?? "";
		const staged = xy[0] !== ".";
		const status = parseXY(xy);
		return { path, status, staged };
	}

	if (first_char === "2") {
		const tab_parts = line.split("\t");
		const path = tab_parts[2] ?? tab_parts[1] ?? "";
		const parts = line.split(" ");
		const xy = parts[1] ?? "..";
		const staged = xy[0] !== ".";
		return { path, status: "renamed", staged };
	}

	return null;
}

function parseXY(
	xy: string,
): GitFileChange["status"] {
	const x = xy[0] ?? ".";
	const y = xy[1] ?? ".";
	const code = x !== "." ? x : y;
	switch (code) {
		case "A":
			return "added";
		case "D":
			return "deleted";
		case "R":
			return "renamed";
		case "C":
			return "copied";
		case "M":
			return "modified";
		default:
			return "modified";
	}
}

function parseStatusPorcelain(raw: string): {
	branch: string;
	ahead: number;
	behind: number;
	changes: GitFileChange[];
} {
	const lines = raw.split("\n").filter((l) => l.length > 0);
	let branch = "HEAD";
	let ahead = 0;
	let behind = 0;
	const changes: GitFileChange[] = [];

	for (const line of lines) {
		if (line.startsWith("# branch.head ")) {
			branch = line.slice("# branch.head ".length);
		} else if (line.startsWith("# branch.ab ")) {
			const match = line.match(/\+(\d+) -(\d+)/);
			if (match) {
				ahead = Number.parseInt(match[1] ?? "0", 10);
				behind = Number.parseInt(match[2] ?? "0", 10);
			}
		} else if (line.startsWith("#")) {
			continue;
		} else {
			const change = parseFileStatus(line);
			if (change) changes.push(change);
		}
	}

	return { branch, ahead, behind, changes };
}

function parseStashList(raw: string): StashEntry[] {
	return raw
		.split("\n")
		.filter((l) => l.length > 0)
		.map((line) => {
			const colon_idx = line.indexOf(":");
			const ref = colon_idx >= 0 ? line.slice(0, colon_idx) : line;
			const message = colon_idx >= 0 ? line.slice(colon_idx + 1) : "";
			const index_match = ref.match(/\{(\d+)\}/);
			return {
				index: index_match ? Number.parseInt(index_match[1] ?? "0", 10) : 0,
				message: message.trim(),
				date: "",
			};
		});
}

function parseBranches(raw: string): {
	branches: BranchInfo[];
	local_count: number;
	remote_count: number;
} {
	const names = raw
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0);

	const branches: BranchInfo[] = [];
	let local_count = 0;
	let remote_count = 0;

	for (const name of names) {
		const is_remote = name.includes("/");
		if (is_remote) {
			remote_count++;
		} else {
			local_count++;
		}
		branches.push({
			name,
			is_current: false,
			upstream: null,
			ahead: 0,
			behind: 0,
			last_commit_time: 0,
		});
	}

	return { branches, local_count, remote_count };
}

function deriveHealth(
	ahead: number,
	behind: number,
	modified: number,
	staged: number,
	untracked: number,
	conflicts: number,
): HealthStatus {
	if (conflicts > 0) return "conflict";
	if (ahead > 0 && behind > 0) return "diverged";
	if (ahead > 0) return "ahead";
	if (behind > 0) return "behind";
	if (modified + staged + untracked > 0) return "dirty";
	return "clean";
}

export async function collectStatus(
	repoPath: string,
	scanRoot: string,
): Promise<Result<RepoStatus, GitStatusError>> {
	const [status_result, log_result, stash_result, branches_result, remote_result] =
		await Promise.all([
			git(["status", "--porcelain=v2", "--branch"], repoPath),
			git(["log", "-1", "--format=%H:%s:%at"], repoPath),
			git(["stash", "list", "--format=%gd:%gs"], repoPath),
			git(["branch", "-a", "--format=%(refname:short)"], repoPath),
			git(["remote", "get-url", "origin"], repoPath),
		]);

	if (!status_result.ok) return status_result;
	if (!log_result.ok) return log_result;
	if (!stash_result.ok) return stash_result;
	if (!branches_result.ok) return branches_result;

	const { branch, ahead, behind, changes } = parseStatusPorcelain(
		status_result.value,
	);

	const log_parts = log_result.value.trim().split(":");
	const head_commit = log_parts[0] ?? "";
	const head_message = log_parts.slice(1, -1).join(":") ;
	const head_time = Number.parseInt(log_parts.at(-1) ?? "0", 10);

	const stashes = parseStashList(stash_result.value);
	const { branches, local_count, remote_count } = parseBranches(
		branches_result.value,
	);

	const current_branch =
		branch === "(detached)" || branch === "HEAD" ? "HEAD (detached)" : branch;

	const current_idx = branches.findIndex(
		(b) => b.name === current_branch || b.name === branch,
	);
	if (current_idx >= 0 && branches[current_idx]) {
		branches[current_idx].is_current = true;
	}

	const remote_url = remote_result.ok ? remote_result.value.trim() || null : null;

	const modified_count = changes.filter(
		(c) => !c.staged && c.status !== "untracked" && c.status !== "conflicted",
	).length;
	const staged_count = changes.filter((c) => c.staged).length;
	const untracked_count = changes.filter(
		(c) => c.status === "untracked",
	).length;
	const conflict_count = changes.filter(
		(c) => c.status === "conflicted",
	).length;

	const is_clean =
		modified_count === 0 &&
		staged_count === 0 &&
		untracked_count === 0 &&
		conflict_count === 0 &&
		ahead === 0;

	const health = deriveHealth(
		ahead,
		behind,
		modified_count,
		staged_count,
		untracked_count,
		conflict_count,
	);

	return ok({
		path: repoPath,
		name: basename(repoPath),
		display_path: relative(scanRoot, repoPath),

		current_branch,
		head_commit,
		head_message,
		head_time,

		remote_url,
		ahead,
		behind,

		modified_count,
		staged_count,
		untracked_count,
		conflict_count,
		changes,

		stash_count: stashes.length,
		stashes,

		branches,
		local_branch_count: local_count,
		remote_branch_count: remote_count,

		tags: [],
		total_commits: 0,
		repo_size_bytes: 0,
		contributor_count: 0,

		recent_commits: [],

		commit_activity: null,

		is_clean,
		health,
	});
}
