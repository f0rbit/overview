import type { RepoNode, HealthStatus } from "@overview/core";

export type SortMode = "name" | "status" | "last-commit";
export type FilterMode = "all" | "dirty" | "clean" | "ahead" | "behind";

const FILTER_MODES: FilterMode[] = ["all", "dirty", "clean", "ahead", "behind"];
const SORT_MODES: SortMode[] = ["name", "status", "last-commit"];

const HEALTH_PRIORITY: Record<HealthStatus, number> = {
	conflict: 0,
	diverged: 1,
	ahead: 2,
	behind: 3,
	dirty: 4,
	clean: 5,
};

const FILTER_MATCHERS: Record<FilterMode, (h: HealthStatus) => boolean> = {
	all: () => true,
	dirty: (h) => h !== "clean",
	clean: (h) => h === "clean",
	ahead: (h) => h === "ahead" || h === "diverged",
	behind: (h) => h === "behind" || h === "diverged",
};

function matchesFilter(node: RepoNode, filter: FilterMode): boolean {
	if (!node.status) return false;
	return FILTER_MATCHERS[filter](node.status.health);
}

export function filterTree(nodes: RepoNode[], filter: FilterMode): RepoNode[] {
	if (filter === "all") return nodes;
	return nodes
		.map((node): RepoNode | null => {
			if (node.type === "directory") {
				const children = filterTree(node.children, filter);
				return children.length > 0 ? { ...node, children } : null;
			}
			return matchesFilter(node, filter) ? node : null;
		})
		.filter((n): n is RepoNode => n !== null);
}

export function sortTree(nodes: RepoNode[], sort: SortMode): RepoNode[] {
	const dirs = nodes
		.filter((n) => n.type === "directory")
		.map((n) => ({ ...n, children: sortTree(n.children, sort) }));
	const repos = nodes.filter((n) => n.type !== "directory");

	const sorted = [...repos].sort((a, b) => {
		switch (sort) {
			case "name":
				return a.name.localeCompare(b.name);
			case "status": {
				const pa = a.status ? HEALTH_PRIORITY[a.status.health] : 6;
				const pb = b.status ? HEALTH_PRIORITY[b.status.health] : 6;
				return pa !== pb ? pa - pb : a.name.localeCompare(b.name);
			}
			case "last-commit": {
				const ta = a.status?.head_time ?? 0;
				const tb = b.status?.head_time ?? 0;
				return tb !== ta ? tb - ta : a.name.localeCompare(b.name);
			}
		}
	});

	return [
		...dirs.sort((a, b) => a.name.localeCompare(b.name)),
		...sorted,
	];
}

export function searchRepos(nodes: RepoNode[], query: string): RepoNode[] {
	const q = query.toLowerCase();
	const flatten = (ns: RepoNode[]): RepoNode[] =>
		ns.flatMap((n) =>
			n.type === "directory"
				? flatten(n.children)
				: [n],
		);
	return flatten(nodes).filter((n) => {
		if (n.name.toLowerCase().includes(q)) return true;
		if (n.status?.display_path.toLowerCase().includes(q)) return true;
		return false;
	});
}

export function nextFilter(current: FilterMode): FilterMode {
	return FILTER_MODES[(FILTER_MODES.indexOf(current) + 1) % FILTER_MODES.length]!;
}

export function nextSort(current: SortMode): SortMode {
	return SORT_MODES[(SORT_MODES.indexOf(current) + 1) % SORT_MODES.length]!;
}
