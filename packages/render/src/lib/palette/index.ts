export type { AIProvider, Command, CommandError, PaletteEvent } from "./types";
export type { CommandContext, CommandContextDeps } from "./context";
export type { ParseError } from "./parser";
export type { MatchResult } from "./fuzzy";
export { createCommandContext } from "./context";
export { _clear_registry_for_tests, get_command, list_commands, register_command } from "./registry";
export { parse_input } from "./parser";
export { match_commands } from "./fuzzy";

import "../commands/builtin"; // registers :quit, :help, :reload at module load
import "../commands/standup"; // registers :standup with daily|weekly arg
import "../commands/batch"; // registers :fetch all, :pull all, :push all
