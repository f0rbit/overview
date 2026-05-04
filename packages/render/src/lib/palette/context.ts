import type { OverviewConfig, RepoNode } from "@overview/core";
import type { AIProvider, PaletteEvent } from "./types";

export interface CommandContextDeps {
	config: OverviewConfig;
	get_repos: () => readonly RepoNode[];
	get_selected_repo: () => RepoNode | null;
	get_ai_provider: () => AIProvider | null;
	emit: (event: PaletteEvent) => void;
	open_overlay: (id: string, payload: unknown) => void;
	trigger_rescan: () => void;
	renderer: { suspend: () => void; resume: () => void };
}

export interface CommandContext {
	config: OverviewConfig;
	repos: () => readonly RepoNode[];
	selected_repo: () => RepoNode | null;
	ai_provider: AIProvider | null;
	emit: (event: PaletteEvent) => void;
	open_overlay: (id: string, payload: unknown) => void;
	trigger_rescan: () => void;
	renderer: { suspend: () => void; resume: () => void };
}

export function createCommandContext(deps: CommandContextDeps): CommandContext {
	return {
		config: deps.config,
		repos: deps.get_repos,
		selected_repo: deps.get_selected_repo,
		// Live accessor — provider can change between command invocations once Phase C lands.
		get ai_provider() {
			return deps.get_ai_provider();
		},
		emit: deps.emit,
		open_overlay: deps.open_overlay,
		trigger_rescan: deps.trigger_rescan,
		renderer: deps.renderer,
	};
}
