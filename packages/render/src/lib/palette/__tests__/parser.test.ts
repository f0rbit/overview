import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ok } from "@f0rbit/corpus";
import { z } from "zod";
import { parse_input } from "../parser";
import { _clear_registry_for_tests, register_command } from "../registry";
import type { Command } from "../types";

afterEach(() => {
	_clear_registry_for_tests();
});

describe("parse_input", () => {
	test("empty input returns err({ kind: 'empty' })", () => {
		const result = parse_input("");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("empty");
		}
	});

	test("whitespace-only input returns err({ kind: 'empty' })", () => {
		const result = parse_input("   ");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("empty");
		}
	});

	test("unknown command returns err({ kind: 'unknown_command', input })", () => {
		const result = parse_input(":nope");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("unknown_command");
			if (result.error.kind === "unknown_command") {
				expect(result.error.input).toBe(":nope");
			}
		}
	});

	test(":quit (void command) returns ok with command_id and undefined args", () => {
		register_command<void>({
			id: ":quit",
			label: "Quit",
			description: "Exit",
			execute: async () => ok(undefined),
		});

		const result = parse_input(":quit");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.command_id).toBe(":quit");
			expect(result.value.args).toBeUndefined();
		}
	});

	test("longest prefix match: :standup daily matches longer command over shorter", () => {
		// Register both the longer and shorter version
		register_command<void>({
			id: ":standup daily",
			label: "Daily Standup",
			description: "Daily standup",
			execute: async () => ok(undefined),
		});

		register_command<any>({
			id: ":standup",
			label: "Standup",
			description: "Standup",
			args_schema: z.object({ _: z.array(z.string()) }),
			execute: async () => ok(undefined),
		});

		const result = parse_input(":standup daily");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.command_id).toBe(":standup daily");
		}
	});

	test("args schema path: :standup daily with schema on :standup", () => {
		register_command<any>({
			id: ":standup",
			label: "Standup",
			description: "Standup",
			args_schema: z.object({ _: z.array(z.string()) }),
			execute: async () => ok(undefined),
		});

		const result = parse_input(":standup daily");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.command_id).toBe(":standup");
			const parsed_args = result.value.args as any;
			expect(parsed_args._).toEqual(["daily"]);
		}
	});

	test("quoted strings stay as one token", () => {
		register_command<any>({
			id: ":foo",
			label: "Foo",
			description: "Foo",
			args_schema: z.object({ _: z.array(z.string()) }),
			execute: async () => ok(undefined),
		});

		const result = parse_input(':foo "bar baz"');
		expect(result.ok).toBe(true);
		if (result.ok) {
			const parsed_args = result.value.args as any;
			expect(parsed_args._).toEqual(["bar baz"]);
		}
	});

	test("flags: --filter dirty --dry-run", () => {
		register_command<any>({
			id: ":fetch",
			label: "Fetch",
			description: "Fetch",
			args_schema: z.object({
				filter: z.string().optional(),
				"dry-run": z.boolean().optional(),
			}),
			execute: async () => ok(undefined),
		});

		const result = parse_input(":fetch --filter dirty --dry-run");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const parsed_args = result.value.args as any;
			expect(parsed_args.filter).toBe("dirty");
			expect(parsed_args["dry-run"]).toBe(true);
		}
	});

	test("schema validation failure returns err({ kind: 'args_invalid' })", () => {
		register_command<any>({
			id: ":math",
			label: "Math",
			description: "Math",
			args_schema: z.object({ _: z.array(z.string()), x: z.number() }),
			execute: async () => ok(undefined),
		});

		const result = parse_input(":math --x notanumber");
		expect(result.ok).toBe(false);
		if (!result.ok && result.error.kind === "args_invalid") {
			expect(result.error.command_id).toBe(":math");
			expect(result.error.cause).toBeDefined();
		}
	});

	test("positional args before flags", () => {
		register_command<any>({
			id: ":cmd",
			label: "Cmd",
			description: "Cmd",
			args_schema: z.object({
				_: z.array(z.string()),
				flag: z.string().optional(),
			}),
			execute: async () => ok(undefined),
		});

		const result = parse_input(":cmd pos1 pos2 --flag value");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const parsed_args = result.value.args as any;
			expect(parsed_args._).toEqual(["pos1", "pos2"]);
			expect(parsed_args.flag).toBe("value");
		}
	});

	test("flag without value is boolean true", () => {
		register_command<any>({
			id: ":test",
			label: "Test",
			description: "Test",
			args_schema: z.object({
				verbose: z.boolean().optional(),
				quiet: z.boolean().optional(),
			}),
			execute: async () => ok(undefined),
		});

		const result = parse_input(":test --verbose --quiet");
		expect(result.ok).toBe(true);
		if (result.ok) {
			const parsed_args = result.value.args as any;
			expect(parsed_args.verbose).toBe(true);
			expect(parsed_args.quiet).toBe(true);
		}
	});

	test("multiple-word command id via longest prefix match", () => {
		register_command<void>({
			id: ":standup daily",
			label: "Daily",
			description: "Daily",
			execute: async () => ok(undefined),
		});

		const result = parse_input(":standup daily");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.command_id).toBe(":standup daily");
		}
	});
});
