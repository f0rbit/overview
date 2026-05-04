import { z } from "zod";
import { ok, err, type Result } from "@f0rbit/corpus";
import {
	list_activity_sources,
	range_daily,
	range_weekly,
	type ActivitySection,
	type RepoActivity,
	type RepoNode,
	type StandupRange,
} from "@overview/core";
import { createPool } from "@overview/core";
import { register_command } from "../palette/registry";
import type { CommandError } from "../palette/types";

const standup_args_schema = z.object({
	_: z.array(z.string()).optional(),
	range: z.enum(["daily", "weekly"]).optional(),
});

export type StandupRawArgs = z.infer<typeof standup_args_schema>;

export function resolve_standup_range(
	raw: StandupRawArgs,
): Result<{ range: "daily" | "weekly" }, CommandError> {
	const positional = raw._?.[0];
	const range_from_positional =
		positional === "daily" || positional === "weekly" ? positional : undefined;
	const range = raw.range ?? range_from_positional;
	if (!range) {
		return err({
			kind: "invalid_args",
			details: "range required: 'daily' or 'weekly' (e.g. ':standup daily')",
		});
	}
	return ok({ range });
}

register_command<StandupRawArgs>({
	id: ":standup",
	label: "Standup report",
	description: "Show activity across all repos for a window",
	keywords: ["report", "summary", "daily", "weekly"],
	args_schema: standup_args_schema,
	execute: async (raw_args, ctx) => {
		const args_result = resolve_standup_range(raw_args);
		if (!args_result.ok) return args_result;
		const { range } = args_result.value;

		const now = new Date();
		const window = range === "daily" ? range_daily(now) : range_weekly(now);
		const repos = collect_repo_paths(ctx.repos());
		const pool = createPool(8);
		const sources = list_activity_sources();

		const activities = await Promise.all(
			repos.map((repo) => pool.run(() => collect_for_repo(repo, window, sources))),
		);

		ctx.open_overlay("standup", { window, activities });
		return ok(undefined);
	},
});

async function collect_for_repo(
	repo: RepoNode,
	range: StandupRange,
	sources: ReturnType<typeof list_activity_sources>,
): Promise<RepoActivity> {
	const results = await Promise.all(
		sources.map((s) => s.collect(repo, range)),
	);

	const sections = results
		.map((r) => (r.ok ? r.value : null))
		.filter((s): s is ActivitySection => s !== null);

	return {
		repo_path: repo.path,
		repo_name: repo.name,
		range,
		sections,
	};
}

function collect_repo_paths(nodes: readonly RepoNode[]): RepoNode[] {
	const out: RepoNode[] = [];
	for (const n of nodes) {
		if (n.type === "directory") out.push(...collect_repo_paths(n.children));
		else out.push(n);
	}
	return out;
}
