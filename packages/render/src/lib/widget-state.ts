import { ok, err, try_catch, type Result } from "@f0rbit/corpus";
import type { WidgetConfig } from "@overview/core";
import { join } from "path";
import { homedir } from "os";
import { mkdir } from "fs/promises";

export interface WidgetStateFile {
	widgets: WidgetConfig[];
	devpad?: {
		api_url: string;
		api_key: string;
	};
}

const STATE_PATH = join(homedir(), ".config", "overview", "widgets.json");

export function defaultWidgetConfig(): WidgetConfig[] {
	return [
		{ id: "git-status", enabled: true, priority: 0, collapsed: false },
		{ id: "recent-commits", enabled: true, priority: 1, collapsed: false },
		{ id: "github-prs", enabled: true, priority: 2, collapsed: false },
		{ id: "file-changes", enabled: true, priority: 3, collapsed: false },
		{ id: "repo-meta", enabled: true, priority: 4, collapsed: false },
		{ id: "github-ci", enabled: true, priority: 5, collapsed: false },
		{ id: "branch-list", enabled: true, priority: 6, collapsed: false },
		{ id: "devpad-tasks", enabled: true, priority: 7, collapsed: false },
		{ id: "devpad-milestones", enabled: false, priority: 8, collapsed: false },
		{ id: "commit-activity", enabled: false, priority: 9, collapsed: false },
		{ id: "github-issues", enabled: false, priority: 10, collapsed: false },
		{ id: "github-release", enabled: false, priority: 11, collapsed: false },
	];
}

export function defaultWidgetState(): WidgetStateFile {
	return { widgets: defaultWidgetConfig() };
}

function safeParse(text: string): Result<unknown, string> {
	return try_catch(
		() => JSON.parse(text),
		() => "invalid JSON in widget state file",
	);
}

function mergeConfigs(user_widgets: WidgetConfig[]): WidgetConfig[] {
	const defaults = defaultWidgetConfig();
	const user_ids = new Set(user_widgets.map((w) => w.id));
	const missing = defaults.filter((d) => !user_ids.has(d.id));
	return [...user_widgets, ...missing];
}

export async function loadWidgetState(): Promise<Result<WidgetStateFile, string>> {
	const file = Bun.file(STATE_PATH);
	const exists = await file.exists();

	if (!exists) return ok(defaultWidgetState());

	const text = await file.text().catch(() => null);
	if (text === null) return err("failed to read widget state file");

	let parsed: Partial<WidgetStateFile>;
	const parse_result = safeParse(text);
	if (!parse_result.ok) return err(parse_result.error);
	parsed = parse_result.value as Partial<WidgetStateFile>;

	const widgets = Array.isArray(parsed.widgets)
		? mergeConfigs(parsed.widgets)
		: defaultWidgetConfig();

	return ok({
		widgets,
		devpad: parsed.devpad,
	});
}

export async function saveWidgetState(state: WidgetStateFile): Promise<Result<void, string>> {
	const dir = join(homedir(), ".config", "overview");
	await mkdir(dir, { recursive: true }).catch(() => {});

	const text = JSON.stringify(state, null, "\t");
	const written = await Bun.write(STATE_PATH, text).catch(() => null);
	if (written === null) return err("failed to write widget state file");

	return ok(undefined);
}
