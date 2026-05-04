import { Fzf } from "fzf";
import type { Command } from "./types";

export interface MatchResult {
	command: Command<unknown>;
	score: number;
	positions: readonly number[];
}

function build_haystack(cmd: Command<unknown>): string {
	const parts = [cmd.id, cmd.label];
	if (cmd.keywords) {
		parts.push(...cmd.keywords);
	}
	return parts.join(" ");
}

export function match_commands(
	query: string,
	commands: readonly Command<unknown>[],
): MatchResult[] {
	// Empty query: return all commands sorted by id ascending with score 0 and empty positions.
	const trimmed = query.trim();
	if (!trimmed) {
		return commands
			.slice()
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((cmd) => ({
				command: cmd,
				score: 0,
				positions: [],
			}));
	}

	// Use fzf to find matches
	const fzf = new Fzf(commands, {
		selector: build_haystack,
	});

	const results = fzf.find(trimmed);

	// Map fzf results to MatchResult
	return results.map((r) => ({
		command: r.item,
		score: r.score,
		positions: Array.from(r.positions).sort((a, b) => a - b),
	}));
}
