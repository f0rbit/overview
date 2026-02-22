import type { Component } from "solid-js";
import type { WidgetId, WidgetSizeHint, WidgetRenderProps, RepoStatus } from "@overview/core";

export interface WidgetDefinition {
	id: WidgetId;
	label: string;
	size_hint: WidgetSizeHint;
	component: Component<WidgetRenderProps & { status: RepoStatus | null }>;
}

const registry = new Map<WidgetId, WidgetDefinition>();

export function registerWidget(def: WidgetDefinition): void {
	registry.set(def.id, def);
}

export function getWidget(id: WidgetId): WidgetDefinition | undefined {
	return registry.get(id);
}

export function getAllWidgets(): WidgetDefinition[] {
	return Array.from(registry.values());
}
