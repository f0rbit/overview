import { ok, type Result } from "@f0rbit/corpus";
import type { RepoNode, OcnStatus } from "./types";
import { scanDirectory, type ScanError } from "./scanner";
import { collectStatus } from "./git-status";
import { detectWorktrees } from "./worktree";
import { createPool } from "./concurrency";
import { readOcnStates } from "./ocn";

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
export * from "./concurrency";
export * from "./ocn";

export type ScanAndCollectError = ScanError;

const pool = createPool(8);

async function populateNode(node: RepoNode, scanRoot: string, ocn_map: Map<string, OcnStatus>): Promise<void> {
	if (node.type === "repo" || node.type === "worktree") {
		await pool.run(async () => {
			const [status_result, worktree_result] = await Promise.all([
				collectStatus(node.path, scanRoot),
				detectWorktrees(node.path),
			]);
			node.status = status_result.ok ? status_result.value : null;
			if (node.status) {
				node.status.ocn_status = ocn_map.get(node.path) ?? null;
			}
			node.worktrees = worktree_result.ok ? worktree_result.value : [];
		});
	}

	await Promise.all(node.children.map((child) => populateNode(child, scanRoot, ocn_map)));
}

export async function scanAndCollect(
	root: string,
	options: { depth: number; ignore: string[] },
): Promise<Result<RepoNode[], ScanAndCollectError>> {
	const scan_result = await scanDirectory(root, options);
	if (!scan_result.ok) return scan_result;

	const ocn_result = await readOcnStates();
	const ocn_map = ocn_result.ok ? ocn_result.value : new Map<string, OcnStatus>();

	const nodes = scan_result.value;
	await Promise.all(nodes.map((node) => populateNode(node, root, ocn_map)));

	return ok(nodes);
}
