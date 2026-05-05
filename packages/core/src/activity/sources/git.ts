import { type Result, err, format_error, ok, try_catch_async } from "@f0rbit/corpus";
import type { RepoNode } from "../../types";
import { register_activity_source } from "../registry";
import type { ActivityError, ActivityItem, ActivitySection, ActivitySource, StandupRange } from "../types";

interface CommitMeta {
	full_sha: string;
	short_sha: string;
	author: string;
	email: string;
	timestamp: number;
	subject: string;
}

interface CommitStat {
	files_changed: number;
	insertions: number;
	deletions: number;
}

export const git_source: ActivitySource = {
	id: "git",
	label: "Git Activity",
	async collect(repo, range) {
		if (repo.type === "directory") return ok(null);
		return collect_git_section(repo.path, range);
	},
};

register_activity_source(git_source);

async function run_git(args: readonly string[], cwd: string): Promise<Result<string, ActivityError>> {
	const spawn_result = await try_catch_async(
		async () => {
			const proc = Bun.spawn(["git", ...args], {
				cwd,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [stdout, stderr, code] = await Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			return { stdout, stderr, code };
		},
		(e) => ({ kind: "git_failed" as const, cause: format_error(e) }),
	);

	if (!spawn_result.ok) return err(spawn_result.error);

	const { stdout, stderr, code } = spawn_result.value;
	if (code !== 0) {
		if (stderr.includes("not a git repository")) {
			return err({ kind: "not_a_repo", path: cwd });
		}
		return err({ kind: "git_failed", cause: stderr.trim() });
	}
	return ok(stdout);
}

export function parse_commit_metadata(output: string): CommitMeta[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.flatMap((line): CommitMeta[] => {
			const parts = line.split("\t");
			if (parts.length < 6) return [];
			const [full_sha, short_sha, author, email, ts, ...rest] = parts;
			const subject = rest.join("\t");
			const timestamp = Number.parseInt(ts ?? "0", 10);
			if (!full_sha || !short_sha || Number.isNaN(timestamp)) return [];
			return [
				{
					full_sha,
					short_sha,
					author: author ?? "",
					email: email ?? "",
					timestamp,
					subject,
				},
			];
		});
}

export function parse_shortstat_line(line: string): CommitStat {
	const files_match = line.match(/(\d+)\s+files?\s+changed/);
	const ins_match = line.match(/(\d+)\s+insertions?\(\+\)/);
	const del_match = line.match(/(\d+)\s+deletions?\(-\)/);
	return {
		files_changed: files_match ? Number.parseInt(files_match[1] ?? "0", 10) : 0,
		insertions: ins_match ? Number.parseInt(ins_match[1] ?? "0", 10) : 0,
		deletions: del_match ? Number.parseInt(del_match[1] ?? "0", 10) : 0,
	};
}

export function parse_shortstat_output(output: string): Map<string, CommitStat> {
	const stats = new Map<string, CommitStat>();
	const lines = output.split("\n");
	let current_sha: string | null = null;

	for (const raw of lines) {
		const line = raw.trim();
		if (line.length === 0) continue;
		if (/^[0-9a-f]{40}$/.test(line)) {
			current_sha = line;
			continue;
		}
		if (current_sha && /\d+\s+files?\s+changed/.test(line)) {
			stats.set(current_sha, parse_shortstat_line(line));
			current_sha = null;
		}
	}

	return stats;
}

async function collect_git_section(
	repo_path: string,
	range: StandupRange,
): Promise<Result<ActivitySection | null, ActivityError>> {
	const since_iso = range.since.toISOString();

	const meta_r = await run_git(
		["log", `--since=${since_iso}`, "--pretty=format:%H%x09%h%x09%an%x09%ae%x09%at%x09%s"],
		repo_path,
	);
	if (!meta_r.ok) return err(meta_r.error);

	const commits = parse_commit_metadata(meta_r.value);
	if (commits.length === 0) return ok(null);

	const stats_r = await run_git(["log", `--since=${since_iso}`, "--shortstat", "--pretty=format:%H"], repo_path);
	const stats_map = stats_r.ok ? parse_shortstat_output(stats_r.value) : new Map<string, CommitStat>();

	const items: ActivityItem[] = commits.map((c) => {
		const stat = stats_map.get(c.full_sha);
		const meta: Record<string, string> = {};
		if (stat) {
			meta.files = String(stat.files_changed);
			meta.insertions = `+${stat.insertions}`;
			meta.deletions = `-${stat.deletions}`;
		}
		return {
			id: c.short_sha,
			title: c.subject,
			timestamp: c.timestamp,
			author: c.author,
			meta: stat ? meta : undefined,
		};
	});

	const total_insertions = commits.reduce((a, c) => a + (stats_map.get(c.full_sha)?.insertions ?? 0), 0);
	const total_deletions = commits.reduce((a, c) => a + (stats_map.get(c.full_sha)?.deletions ?? 0), 0);
	const total_files = commits.reduce((a, c) => a + (stats_map.get(c.full_sha)?.files_changed ?? 0), 0);

	const commit_word = commits.length === 1 ? "commit" : "commits";
	const summary_line = `${commits.length} ${commit_word}, +${total_insertions}/-${total_deletions}`;

	return ok({
		source_id: "git",
		source_label: "Git Activity",
		summary_line,
		items,
		metrics: {
			commits: commits.length,
			insertions: total_insertions,
			deletions: total_deletions,
			files_changed: total_files,
		},
	});
}
