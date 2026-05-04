import { ok } from "@f0rbit/corpus";
import { register_command } from "../palette/registry";

register_command<void>({
	id: ":quit",
	label: "Quit overview",
	description: "Exit the application",
	keywords: ["exit", "q"],
	execute: async () => {
		process.exit(0);
		return ok(undefined);
	},
});

register_command<void>({
	id: ":help",
	label: "Show help",
	description: "Open the keybinding reference",
	keywords: ["?", "keys"],
	execute: async (_, ctx) => {
		ctx.open_overlay("help", null);
		return ok(undefined);
	},
});

register_command<void>({
	id: ":reload",
	label: "Reload",
	description: "Run a full repo rescan",
	keywords: ["rescan", "refresh"],
	execute: async (_, ctx) => {
		ctx.emit({ kind: "status", text: "rescanning…", level: "info" });
		ctx.trigger_rescan();
		return ok(undefined);
	},
});
