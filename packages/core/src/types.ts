// Git file change
export interface GitFileChange {
	path: string;
	status: "modified" | "added" | "deleted" | "renamed" | "copied" | "untracked" | "ignored" | "conflicted";
	staged: boolean;
}

// Branch info
export interface BranchInfo {
	name: string;
	is_current: boolean;
	upstream: string | null;
	ahead: number;
	behind: number;
	last_commit_time: number; // unix timestamp
}

// Stash entry
export interface StashEntry {
	index: number;
	message: string;
	date: string;
}

// Recent commit
export interface RecentCommit {
	hash: string;
	message: string;
	author: string;
	time: number; // unix timestamp
}

// Health status
export type HealthStatus = "clean" | "dirty" | "ahead" | "behind" | "diverged" | "conflict";

// Full repo status
export interface RepoStatus {
	// Identity
	path: string;
	name: string;
	display_path: string; // relative to scan root

	// Current state
	current_branch: string;
	head_commit: string;
	head_message: string;
	head_time: number;

	// Tracking
	remote_url: string | null;
	ahead: number;
	behind: number;

	// Working tree
	modified_count: number;
	staged_count: number;
	untracked_count: number;
	conflict_count: number;
	changes: GitFileChange[];

	// Stash
	stash_count: number;
	stashes: StashEntry[];

	// Branches
	branches: BranchInfo[];
	local_branch_count: number;
	remote_branch_count: number;

	// Metadata
	tags: string[];
	total_commits: number;
	repo_size_bytes: number;
	contributor_count: number;

	// Recent activity
	recent_commits: RecentCommit[];

	// Derived
	is_clean: boolean;
	health: HealthStatus;
}

// Worktree info
export interface WorktreeInfo {
	path: string;
	branch: string;
	head: string;
	is_bare: boolean;
	is_main: boolean;
}

// Git graph output
export interface GitGraphOutput {
	lines: string[];
	total_lines: number;
	repo_path: string;
}

// Repo tree node
export interface RepoNode {
	name: string;
	path: string;
	type: "directory" | "repo" | "worktree";
	status: RepoStatus | null;
	worktrees: WorktreeInfo[];
	children: RepoNode[];
	depth: number;
	expanded: boolean;
}

// Widget system
export type WidgetId =
	| "git-status"
	| "recent-commits"
	| "branch-list"
	| "github-prs"
	| "github-issues"
	| "github-ci"
	| "devpad-tasks"
	| "devpad-milestones"
	| "repo-meta"
	| "file-changes"
	| "commit-activity"
	| "github-release";

export interface WidgetConfig {
	id: WidgetId;
	enabled: boolean;
	priority: number;
	collapsed: boolean;
}

export interface WidgetSizeRequest {
	min_rows: number;
	preferred_rows: number;
	max_rows: number;
}

export interface WidgetRenderProps {
	allocated_rows: number;
	width: number;
	focused: boolean;
}

// Config
export interface OverviewConfig {
	scan_dirs: string[];
	depth: number;
	refresh_interval: number;
	layout: {
		left_width_pct: number;
		graph_height_pct: number;
	};
	sort: "name" | "status" | "last-commit";
	filter: "all" | "dirty" | "clean" | "ahead" | "behind";
	ignore: string[];
	actions: {
		ggi: string;
		editor: string;
		sessionizer: string | null;
	};
}

// Default config factory
export function defaultConfig(): OverviewConfig {
	return {
		scan_dirs: ["~/dev"],
		depth: 3,
		refresh_interval: 30,
		layout: {
			left_width_pct: 35,
			graph_height_pct: 45,
		},
		sort: "name",
		filter: "all",
		ignore: ["node_modules", ".git"],
		actions: {
			ggi: "ggi",
			editor: "$EDITOR",
			sessionizer: null,
		},
	};
}
