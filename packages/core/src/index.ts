import { ok, type Result } from "@f0rbit/corpus";
import type { RepoNode } from "./types";
import { scanDirectory, type ScanError } from "./scanner";
import { collectStatus } from "./git-status";
import { detectWorktrees } from "./worktree";

export * from "./types";
export * from "./scanner";
export * from "./worktree";
export * from "./git-status";
export * from "./git-graph";
export * from "./git-stats";
export * from "./watcher";
export * from "./cache";
export * from "./github";
export * from "./devpad";

export type ScanAndCollectError = ScanError;

async function populateNode(node: RepoNode, scanRoot: string): Promise<void> {
	if (node.type === "repo" || node.type === "worktree") {
		const [status_result, worktree_result] = await Promise.all([
			collectStatus(node.path, scanRoot),
			detectWorktrees(node.path),
		]);
		node.status = status_result.ok ? status_result.value : null;
		node.worktrees = worktree_result.ok ? worktree_result.value : [];
	}

	await Promise.all(node.children.map((child) => populateNode(child, scanRoot)));
}

export async function scanAndCollect(
	root: string,
	options: { depth: number; ignore: string[] },
): Promise<Result<RepoNode[], ScanAndCollectError>> {
	const scan_result = await scanDirectory(root, options);
	if (!scan_result.ok) return scan_result;

	const nodes = scan_result.value;
	await Promise.all(nodes.map((node) => populateNode(node, root)));

	return ok(nodes);
}
