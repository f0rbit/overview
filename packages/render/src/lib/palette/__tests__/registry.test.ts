import { afterEach, describe, expect, test } from "bun:test";
import { ok } from "@f0rbit/corpus";
import { _clear_registry_for_tests, get_command, list_commands, register_command } from "../registry";
import type { Command } from "../types";

afterEach(() => {
	_clear_registry_for_tests();
});

describe("registry", () => {
	test("register_command and get_command round-trip", () => {
		const cmd: Command<void> = {
			id: ":test",
			label: "Test Command",
			description: "A test command",
			execute: async () => ok(undefined),
		};

		register_command(cmd);
		const retrieved = get_command(":test");

		expect(retrieved).toBe(cmd);
	});

	test("list_commands includes registered command", () => {
		const cmd: Command<void> = {
			id: ":hello",
			label: "Hello",
			description: "Say hello",
			execute: async () => ok(undefined),
		};

		register_command(cmd);
		const all = list_commands();

		expect(all).toContain(cmd);
		expect(all.length).toBe(1);
	});

	test("re-registering same id replaces previous entry", () => {
		const cmd1: Command<void> = {
			id: ":test",
			label: "First",
			description: "First command",
			execute: async () => ok(undefined),
		};

		const cmd2: Command<void> = {
			id: ":test",
			label: "Second",
			description: "Second command",
			execute: async () => ok(undefined),
		};

		register_command(cmd1);
		register_command(cmd2);

		const retrieved = get_command(":test");
		expect(retrieved).toBe(cmd2);
		expect(list_commands().length).toBe(1);
	});

	test("_clear_registry_for_tests removes all entries", () => {
		register_command({
			id: ":cmd1",
			label: "Cmd1",
			description: "Command 1",
			execute: async () => ok(undefined),
		});
		register_command({
			id: ":cmd2",
			label: "Cmd2",
			description: "Command 2",
			execute: async () => ok(undefined),
		});

		expect(list_commands().length).toBe(2);

		_clear_registry_for_tests();

		expect(list_commands().length).toBe(0);
		expect(get_command(":cmd1")).toBeUndefined();
		expect(get_command(":cmd2")).toBeUndefined();
	});
});
