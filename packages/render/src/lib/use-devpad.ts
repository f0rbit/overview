import { createSignal, createEffect, type Accessor } from "solid-js";
import ApiClient from "@devpad/api";
import type { Project, TaskWithDetails } from "@devpad/api";
import {
	DataCache,
	matchRepoToProject,
	type DevpadProject,
	type DevpadTask,
	type DevpadMilestone,
	type DevpadRepoData,
} from "@overview/core";
import { getWidgetState } from "./widget-state";

type ExtractOkArray<T> = T extends { ok: true; value: (infer U)[] } ? U : T extends { ok: false } ? never : never;
type ApiMilestone = ExtractOkArray<Awaited<ReturnType<InstanceType<typeof ApiClient>["milestones"]["getByProject"]>>>;
type ApiGoal = ExtractOkArray<Awaited<ReturnType<InstanceType<typeof ApiClient>["milestones"]["goals"]>>>;

const project_cache = new DataCache<DevpadProject[]>();
const data_cache = new DataCache<DevpadRepoData>();

const PROJECT_CACHE_TTL = 600_000;
const DATA_CACHE_TTL = 300_000;

function toDevpadProject(p: Project): DevpadProject {
	return {
		id: p.id,
		project_id: p.project_id,
		name: p.name,
		description: p.description,
		status: p.status,
		repo_url: p.repo_url,
	};
}

function toDevpadTask(t: TaskWithDetails): DevpadTask {
	return {
		id: t.task.id,
		title: t.task.title,
		description: t.task.description,
		priority: t.task.priority,
		progress: t.task.progress,
		project_id: t.task.project_id,
		tags: t.tags,
	};
}

export function useDevpad(
	remote_url: Accessor<string | null>,
	repo_name: Accessor<string>,
): {
	data: Accessor<DevpadRepoData | null>;
	error: Accessor<string | null>;
	loading: Accessor<boolean>;
} {
	const [data, setData] = createSignal<DevpadRepoData | null>(null);
	const [error, setError] = createSignal<string | null>(null);
	const [loading, setLoading] = createSignal(false);

	async function fetchData() {
		const state = getWidgetState();
		if (!state.devpad?.api_key) {
			setError("devpad not configured");
			setData(null);
			return;
		}

		const client = new ApiClient({
			base_url: state.devpad.api_url ?? "https://devpad.tools/api/v1",
			api_key: state.devpad.api_key,
		});

		const name = repo_name();
		const url = remote_url();

		const cache_key = url ?? name;
		const cached = data_cache.get(cache_key);
		if (cached) {
			setData(cached);
			setError(null);
			return;
		}

		setLoading(true);

		let projects = project_cache.get("all");
		if (!projects) {
			const projects_result = await client.projects.list();
			if (!projects_result.ok) {
				setError(projects_result.error.message);
				setLoading(false);
				return;
			}
			projects = projects_result.value.map(toDevpadProject);
			project_cache.set("all", projects, PROJECT_CACHE_TTL);
		}

		const matched = matchRepoToProject(url, name, projects);
		if (!matched) {
			setData({ project: null, tasks: [], milestones: [] });
			setError(null);
			setLoading(false);
			return;
		}

		const [tasks_result, milestones_result] = await Promise.all([
			client.tasks.getByProject(matched.id),
			client.milestones.getByProject(matched.id),
		]);

		const tasks: DevpadTask[] = tasks_result.ok
			? tasks_result.value
					.map(toDevpadTask)
					.filter((t) => t.progress !== "COMPLETED")
			: [];

		const raw_milestones: ApiMilestone[] = milestones_result.ok
			? milestones_result.value.filter((m) => !m.finished_at)
			: [];

		const milestones: DevpadMilestone[] = await Promise.all(
			raw_milestones.map(async (m) => {
				const goals_result = await client.milestones.goals(m.id);
				const goals: ApiGoal[] = goals_result.ok ? goals_result.value : [];
				return {
					id: m.id,
					name: m.name,
					target_version: m.target_version ?? null,
					target_time: m.target_time ?? null,
					finished_at: m.finished_at ?? null,
					goals_total: goals.length,
					goals_completed: goals.filter((g) => g.finished_at !== null).length,
				};
			}),
		);

		const repo_data: DevpadRepoData = {
			project: matched,
			tasks,
			milestones,
		};

		data_cache.set(cache_key, repo_data, DATA_CACHE_TTL);
		setData(repo_data);
		setError(null);
		setLoading(false);
	}

	createEffect(() => {
		remote_url();
		repo_name();
		fetchData();
	});

	return { data, error, loading };
}
