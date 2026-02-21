export interface DevpadProject {
	id: string;
	project_id: string;
	name: string;
	description: string | null;
	status: string;
	repo_url: string | null;
}

export interface DevpadTask {
	id: string;
	title: string;
	description: string | null;
	priority: "LOW" | "MEDIUM" | "HIGH";
	progress: "UNSTARTED" | "IN_PROGRESS" | "COMPLETED";
	project_id: string | null;
	tags: string[];
}

export interface DevpadMilestone {
	id: string;
	name: string;
	target_version: string | null;
	target_time: string | null;
	finished_at: string | null;
	goals_total: number;
	goals_completed: number;
}

export interface DevpadRepoData {
	project: DevpadProject | null;
	tasks: DevpadTask[];
	milestones: DevpadMilestone[];
}

export function normalizeGitUrl(url: string): string {
	let normalized = url
		.trim()
		.replace(/\.git$/, "")
		.replace(/\/$/, "");
	const ssh_match = normalized.match(/^git@([^:]+):(.+)$/);
	if (ssh_match) {
		normalized = `https://${ssh_match[1]}/${ssh_match[2]}`;
	}
	return normalized.toLowerCase();
}

export function matchRepoToProject(
	remote_url: string | null,
	repo_name: string,
	projects: DevpadProject[],
): DevpadProject | null {
	if (remote_url) {
		const normalized = normalizeGitUrl(remote_url);
		const match = projects.find(
			(p) => p.repo_url && normalizeGitUrl(p.repo_url) === normalized,
		);
		if (match) return match;
	}
	return projects.find((p) => p.project_id === repo_name) ?? null;
}
