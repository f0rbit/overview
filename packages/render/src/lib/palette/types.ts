import type { Result } from "@f0rbit/corpus";
import type { ZodSchema } from "zod";
import type { OverviewConfig, RepoNode } from "@overview/core";
import type { CommandContext } from "./context";

// Phase C will replace this with the real interface in lib/ai/provider.ts
export interface AIProvider {
	id: string;
}

export type CommandError =
	| { kind: "invalid_args"; details: string }
	| { kind: "execution_failed"; cause: string }
	| { kind: "cancelled" };

export type PaletteEvent =
	| { kind: "status"; text: string; level: "info" | "warn" | "error" }
	| { kind: "command_done"; command_id: string }
	| { kind: "command_failed"; command_id: string; error: CommandError };

export interface Command<Args = void> {
	id: string;
	label: string;
	description: string;
	keywords?: readonly string[];
	args_schema?: ZodSchema<Args>;
	execute: (args: Args, ctx: CommandContext) => Promise<Result<void, CommandError>>;
}

export type { OverviewConfig, RepoNode };
