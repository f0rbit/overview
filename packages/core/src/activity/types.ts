import type { Result } from "@f0rbit/corpus";
import type { RepoNode } from "../types";

export interface StandupRange {
	kind: "daily" | "weekly" | "custom";
	since: Date;
	until: Date;
	label: string;
}

export interface ActivityItem {
	id: string;
	title: string;
	timestamp: number;
	author?: string;
	url?: string;
	meta?: Record<string, string>;
}

export interface ActivitySection {
	source_id: string;
	source_label: string;
	summary_line: string;
	items: readonly ActivityItem[];
	metrics?: Record<string, number>;
}

export type ActivityError =
	| { kind: "git_failed"; cause: string }
	| { kind: "not_a_repo"; path: string }
	| { kind: "source_failed"; source_id: string; cause: string };

export interface ActivitySource {
	id: string;
	label: string;
	collect(
		repo: RepoNode,
		range: StandupRange,
	): Promise<Result<ActivitySection | null, ActivityError>>;
}

export interface RepoActivity {
	repo_path: string;
	repo_name: string;
	range: StandupRange;
	sections: readonly ActivitySection[];
}
