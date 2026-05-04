import { ok, err, type Result } from "@f0rbit/corpus";
import { ZodError } from "zod";
import { get_command } from "./registry";

// Args are parsed into a normalized shape: positional args in "_" array, flags in the object.
// Commands define zod schemas that extract from this shape (e.g., { range: z.enum(...) }).

export type ParseError =
	| { kind: "empty" }
	| { kind: "unknown_command"; input: string }
	| { kind: "args_invalid"; command_id: string; cause: string };

interface RawArgs {
	_: string[];
	[key: string]: string | boolean | string[];
}

export function parse_input(
	raw: string,
): Result<{ command_id: string; args: unknown }, ParseError> {
	const trimmed = raw.trim();

	if (!trimmed) {
		return err({ kind: "empty" });
	}

	// Tokenize by whitespace, respecting quoted strings
	const tokens = tokenize(trimmed);

	// Try longest prefix match: tokens[0..k] for k from tokens.length down to 1
	let matched_command_id: string | undefined;
	let remaining_tokens: string[] = [];

	for (let k = tokens.length; k >= 1; k--) {
		const command_id = tokens.slice(0, k).join(" ");
		const cmd = get_command(command_id);
		if (cmd) {
			matched_command_id = command_id;
			remaining_tokens = tokens.slice(k);
			break;
		}
	}

	if (!matched_command_id) {
		return err({ kind: "unknown_command", input: trimmed });
	}

	const cmd = get_command(matched_command_id);
	if (!cmd) {
		// Should not reach here, but be safe
		return err({ kind: "unknown_command", input: trimmed });
	}

	// Parse args if the command has an args_schema
	let parsed_args: unknown = undefined;

	if (cmd.args_schema) {
		const raw_args = parse_args(remaining_tokens);
		try {
			parsed_args = cmd.args_schema.parse(raw_args);
		} catch (e) {
			const cause = e instanceof ZodError ? e.message : String(e);
			return err({ kind: "args_invalid", command_id: matched_command_id, cause });
		}
	}

	return ok({ command_id: matched_command_id, args: parsed_args });
}

// Tokenize by whitespace, respecting double-quoted strings
function tokenize(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let in_quotes = false;

	for (let i = 0; i < input.length; i++) {
		const char = input[i];

		if (char === '"') {
			in_quotes = !in_quotes;
		} else if (char === " " && !in_quotes) {
			if (current) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += char;
		}
	}

	if (current) {
		tokens.push(current);
	}

	return tokens;
}

// Parse args tokens into positional + flags shape
function parse_args(tokens: string[]): RawArgs {
	const result: RawArgs = { _: [] };
	let i = 0;
	const len = tokens.length;

	// Collect positional args until first --flag
	for (; i < len; i++) {
		if (tokens[i]!.startsWith("--")) break;
		result._.push(tokens[i]!);
	}

	// Parse flags
	for (; i < len; i++) {
		const token = tokens[i]!;
		if (!token.startsWith("--")) continue;

		const flag_name = token.slice(2);
		i++;

		// Check if next token exists and is not a flag
		if (i < len && !tokens[i]!.startsWith("--")) {
			result[flag_name] = tokens[i]!;
		} else {
			result[flag_name] = true;
			i--; // Compensate for the loop increment
		}
	}

	return result;
}
