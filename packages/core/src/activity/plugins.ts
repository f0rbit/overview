import { register_activity_source } from "./registry";
import type { ActivitySource } from "./types";

export interface PluginInit {
	register_activity_source: (source: ActivitySource) => void;
}

export type PluginModule = {
	default?: (deps: PluginInit) => void | Promise<void>;
};

export type PluginLoadError =
	| { kind: "import_failed"; package_name: string; cause: string }
	| { kind: "no_default_export"; package_name: string }
	| { kind: "init_failed"; package_name: string; cause: string };

export async function load_plugins(package_names: readonly string[]): Promise<readonly PluginLoadError[]> {
	const errors: PluginLoadError[] = [];
	const deps: PluginInit = { register_activity_source };

	for (const name of package_names) {
		let mod: PluginModule;
		try {
			mod = (await import(name)) as PluginModule;
		} catch (e) {
			errors.push({ kind: "import_failed", package_name: name, cause: String(e) });
			continue;
		}
		if (typeof mod.default !== "function") {
			errors.push({ kind: "no_default_export", package_name: name });
			continue;
		}
		try {
			await mod.default(deps);
		} catch (e) {
			errors.push({ kind: "init_failed", package_name: name, cause: String(e) });
		}
	}

	return errors;
}
