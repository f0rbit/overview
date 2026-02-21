// Heavyweight on-demand git stats
import { ok, err, type Result } from "@f0rbit/corpus";
import type { RecentCommit } from "./types";

export type GitStatsError =
	| { kind: "not_a_repo"; path: string }
	| { kind: "stats_failed"; path: string; cause: string };

export interface ExtendedStats {
	contributor_count: number;
	contributors: string[];
	repo_size_bytes: number;
	tags: string[];
	recent_commits: RecentCommit[];
	total_commits: number;
}

async function git(args: string[], cwd: string): Promise<Result<string, GitStatsError>> {
	try {
		const proc = Bun.spawn(["git", ...args], {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
		});

		const [stdout, stderr, exit_code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		if (exit_code !== 0) {
			if (stderr.includes("not a git repository")) {
				return err({ kind: "not_a_repo", path: cwd });
			}
			return err({ kind: "stats_failed", path: cwd, cause: stderr.trim() });
		}

		return ok(stdout);
	} catch (e) {
		return err({
			kind: "stats_failed",
			path: cwd,
			cause: e instanceof Error ? e.message : String(e),
		});
	}
}

export function parseSize(size_str: string): number {
	const trimmed = size_str.trim();
	if (trimmed === "0 bytes" || trimmed === "0") return 0;

	const match = trimmed.match(/^([\d.]+)\s*(\w+)?$/);
	if (!match) return 0;

	const value = parseFloat(match[1] ?? "0");
	const unit = (match[2] ?? "bytes").toLowerCase();

	const multipliers: Record<string, number> = {
		bytes: 1,
		kib: 1024,
		mib: 1024 * 1024,
		gib: 1024 * 1024 * 1024,
	};

	return Math.round(value * (multipliers[unit] ?? 1));
}

function parseContributors(output: string): { contributors: string[]; contributor_count: number } {
	const contributors = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/^\d+\t/, ""));

	return { contributors, contributor_count: contributors.length };
}

function parseRepoSize(output: string): number {
	const line = output
		.split("\n")
		.find((l) => l.startsWith("size-pack:"));

	if (!line) return 0;

	const size_str = line.replace("size-pack:", "").trim();
	return parseSize(size_str);
}

function parseTags(output: string): string[] {
	return output
		.split("\n")
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
}

function parseRecentCommits(output: string): RecentCommit[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const [hash, message, author, time_str] = line.split(":");
			return {
				hash: hash ?? "",
				message: message ?? "",
				author: author ?? "",
				time: parseInt(time_str ?? "0", 10),
			};
		});
}

function parseTotalCommits(output: string): number {
	const n = parseInt(output.trim(), 10);
	return isNaN(n) ? 0 : n;
}

export interface CommitActivity {
	daily_counts: number[];
	total_this_week: number;
	total_last_week: number;
}

function bucketIntoDays(timestamps: number[]): number[] {
	const now = new Date();
	const today_start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const counts = new Array<number>(14).fill(0);

	for (const ts of timestamps) {
		const ms = ts * 1000;
		const days_ago = Math.floor((today_start - ms) / (24 * 60 * 60 * 1000));
		const index = 13 - days_ago;
		if (index >= 0 && index < 14) counts[index] = (counts[index] ?? 0) + 1;
	}

	return counts;
}

export async function collectCommitActivity(
	repo_path: string,
): Promise<Result<CommitActivity, GitStatsError>> {
	const log_r = await git(["log", "--format=%at", "--since=14 days ago", "--all"], repo_path);

	if (!log_r.ok) return err(log_r.error);

	const timestamps = log_r.value
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l.length > 0)
		.map((l) => parseInt(l, 10))
		.filter((n) => !isNaN(n));

	const daily_counts = bucketIntoDays(timestamps);
	const total_last_week = daily_counts.slice(0, 7).reduce((a, b) => a + b, 0);
	const total_this_week = daily_counts.slice(7).reduce((a, b) => a + b, 0);

	return ok({ daily_counts, total_this_week, total_last_week });
}

export async function collectStats(
	repoPath: string,
): Promise<Result<ExtendedStats, GitStatsError>> {
	const [shortlog_r, count_objects_r, tags_r, log_r, rev_list_r] = await Promise.all([
		git(["shortlog", "-sn", "--all"], repoPath),
		git(["count-objects", "-vH"], repoPath),
		git(["tag", "--list", "--sort=-version:refname"], repoPath),
		git(["log", "-5", "--format=%h:%s:%an:%at"], repoPath),
		git(["rev-list", "--count", "HEAD"], repoPath),
	]);

	// not_a_repo is fatal — check any result for it
	for (const r of [shortlog_r, count_objects_r, tags_r, log_r, rev_list_r]) {
		if (!r.ok && r.error.kind === "not_a_repo") return err(r.error);
	}

	const { contributors, contributor_count } = shortlog_r.ok
		? parseContributors(shortlog_r.value)
		: { contributors: [], contributor_count: 0 };

	const repo_size_bytes = count_objects_r.ok
		? parseRepoSize(count_objects_r.value)
		: 0;

	const tags = tags_r.ok ? parseTags(tags_r.value) : [];

	const recent_commits = log_r.ok ? parseRecentCommits(log_r.value) : [];

	const total_commits = rev_list_r.ok ? parseTotalCommits(rev_list_r.value) : 0;

	return ok({
		contributor_count,
		contributors,
		repo_size_bytes,
		tags,
		recent_commits,
		total_commits,
	});
}
