import { z } from "zod";
import { ok } from "@f0rbit/corpus";
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

const standup_args_schema = z
	.object({
		_: z.array(z.string()).optional(),
		range: z.enum(["daily", "weekly"]).optional(),
	})
	.transform((raw): { range: "daily" | "weekly" } => {
		// Accept either positional `:standup daily` or named `--range daily`
		const positional = raw._?.[0];
		const range =
			raw.range ??
			(positional === "daily" || positional === "weekly"
				? positional
				: undefined);
		if (!range) throw new Error("range required: 'daily' or 'weekly'");
		return { range };
	}) as z.ZodSchema<{ range: "daily" | "weekly" }>;

register_command<{ range: "daily" | "weekly" }>({
	id: ":standup",
	label: "Standup report",
	description: "Show activity across all repos for a window",
	keywords: ["report", "summary", "daily", "weekly"],
	args_schema: standup_args_schema,
	execute: async ({ range }, ctx) => {
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
