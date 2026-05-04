import type { RepoNode } from "@overview/core";

export type BatchAction = "fetch" | "pull" | "push";
export type BatchFilter = "all" | "dirty" | "clean" | "ahead" | "behind";

// `nothing_to_push` — push action with `ahead === 0`.
// `no_remote` — repo has no upstream (executor-detected; not produced by the planner).
export type BatchSkipReason =
	| "filter_excluded"
	| "would_conflict"
	| "no_remote"
	| "dry_run"
	| "nothing_to_push";

export interface BatchTask {
	repo_path: string;
	repo_name: string;
	action: BatchAction;
	status: "queued" | "running" | "succeeded" | "skipped" | "failed";
	skip_reason?: BatchSkipReason;
	result_message?: string;
	duration_ms?: number;
}

export interface PlanInput {
	repos: readonly RepoNode[];
	action: BatchAction;
	filter: BatchFilter;
	dry_run: boolean;
	force: boolean;
}

export function plan(input: PlanInput): readonly BatchTask[] {
	return flatten_repos(input.repos).map((repo) => build_task(repo, input));
}

function flatten_repos(nodes: readonly RepoNode[]): RepoNode[] {
	const out: RepoNode[] = [];
	for (const n of nodes) {
		if (n.type === "directory") out.push(...flatten_repos(n.children));
		else out.push(n);
	}
	return out;
}

function build_task(repo: RepoNode, input: PlanInput): BatchTask {
	const base: BatchTask = {
		repo_path: repo.path,
		repo_name: repo.name,
		action: input.action,
		status: "queued",
	};

	// fetch is filter-exempt — always safe.
	if (input.action !== "fetch" && !filter_passes(repo, input.filter)) {
		return { ...base, status: "skipped", skip_reason: "filter_excluded" };
	}

	if (input.action === "pull") {
		const health = repo.status?.health;
		if (health === "dirty" && !input.force) {
			return { ...base, status: "skipped", skip_reason: "would_conflict" };
		}
	}

	if (input.action === "push") {
		const ahead = repo.status?.ahead ?? 0;
		if (ahead === 0) {
			return { ...base, status: "skipped", skip_reason: "nothing_to_push" };
		}
		if (repo.status?.health === "diverged" && !input.force) {
			return { ...base, status: "skipped", skip_reason: "would_conflict" };
		}
	}

	if (input.dry_run) {
		return { ...base, status: "skipped", skip_reason: "dry_run" };
	}

	return base;
}

function filter_passes(repo: RepoNode, filter: BatchFilter): boolean {
	if (filter === "all") return true;
	const h = repo.status?.health;
	if (!h) return false;
	switch (filter) {
		case "dirty": return h !== "clean";
		case "clean": return h === "clean";
		case "ahead": return h === "ahead" || h === "diverged";
		case "behind": return h === "behind" || h === "diverged";
	}
}
