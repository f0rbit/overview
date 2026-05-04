import type { Command } from "./types";

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous storage map — public API keeps Command<Args>
const registry = new Map<string, Command<any>>();

export function register_command<Args>(cmd: Command<Args>): void {
	// biome-ignore lint/suspicious/noExplicitAny: storage erases Args
	registry.set(cmd.id, cmd as Command<any>);
}

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous storage
export function get_command(id: string): Command<any> | undefined {
	return registry.get(id);
}

// biome-ignore lint/suspicious/noExplicitAny: heterogeneous storage
export function list_commands(): readonly Command<any>[] {
	return Array.from(registry.values());
}

export function _clear_registry_for_tests(): void {
	registry.clear();
}
