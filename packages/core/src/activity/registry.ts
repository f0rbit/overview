import type { ActivitySource } from "./types";

const registry = new Map<string, ActivitySource>();

export function register_activity_source(source: ActivitySource): void {
	registry.set(source.id, source);
}

export function get_activity_source(id: string): ActivitySource | undefined {
	return registry.get(id);
}

export function list_activity_sources(): readonly ActivitySource[] {
	return Array.from(registry.values());
}

export function _clear_activity_registry_for_tests(): void {
	registry.clear();
}
