import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ok, err } from "@f0rbit/corpus";
import { z } from "zod";
import { defaultConfig } from "@overview/core";
import { parse_input } from "../parser";
import { get_command, register_command, _clear_registry_for_tests } from "../registry";
import type { Command, PaletteEvent } from "../types";
import type { CommandContext } from "../context";

// Helper to create a fake CommandContext with in-memory event log
function make_fake_context(overrides?: Partial<CommandContext & { events: PaletteEvent[] }>): CommandContext & { events: PaletteEvent[] } {
	const events: PaletteEvent[] = [];
	return {
		config: defaultConfig(),
		repos: () => [],
		selected_repo: () => null,
		ai_provider: null,
		emit: (e: PaletteEvent) => {
			events.push(e);
		},
		open_overlay: (_id: string, _payload: unknown) => {},
		trigger_rescan: () => {},
		renderer: { suspend: () => {}, resume: () => {} },
		events,
		...overrides,
	};
}

afterEach(() => {
	_clear_registry_for_tests();
});

describe("state machine integration", () => {
	test("parse + execute: :test command flow", async () => {
		const ctx = make_fake_context();
		let execute_called = false;
		let received_args: unknown;

		register_command<void>({
			id: ":test",
			label: "Test",
			description: "Test command",
			execute: async (args, _ctx) => {
				execute_called = true;
				received_args = args;
				_ctx.emit({ kind: "command_done", command_id: ":test" });
				return ok(undefined);
			},
		});

		// Step 1: Parse input
		const parse_result = parse_input(":test");
		expect(parse_result.ok).toBe(true);

		if (!parse_result.ok) {
			throw new Error("Parse failed");
		}

		const { command_id, args } = parse_result.value;

		// Step 2: Get command from registry
		const cmd = get_command(command_id);
		expect(cmd).toBeDefined();

		// Step 3: Execute command
		if (cmd) {
			const exec_result = await cmd.execute(args, ctx);
			expect(exec_result.ok).toBe(true);
			expect(execute_called).toBe(true);
			expect(received_args).toBeUndefined();
		}

		// Step 4: Check emitted events
		expect(ctx.events).toHaveLength(1);
		expect(ctx.events[0]!.kind).toBe("command_done");
		if (ctx.events[0]!.kind === "command_done") {
			expect(ctx.events[0]!.command_id).toBe(":test");
		}
	});

	test("command with args schema receives parsed args", async () => {
		const ctx = make_fake_context();
		let received_args: unknown;

		register_command<any>({
			id: ":echo",
			label: "Echo",
			description: "Echo",
			args_schema: z.object({ _: z.array(z.string()) }),
			execute: async (args, _ctx) => {
				received_args = args;
				return ok(undefined);
			},
		});

		const parse_result = parse_input(":echo hello");
		expect(parse_result.ok).toBe(true);

		if (parse_result.ok) {
			const cmd = get_command(parse_result.value.command_id);
			if (cmd) {
				await cmd.execute(parse_result.value.args, ctx);
				const parsed_args = received_args as any;
				expect(parsed_args._).toEqual(["hello"]);
			}
		}
	});

	test("command execution failure emits error event", async () => {
		const ctx = make_fake_context();

		register_command<void>({
			id: ":fail",
			label: "Fail",
			description: "This command fails",
			execute: async (_, _ctx) => {
				_ctx.emit({
					kind: "command_failed",
					command_id: ":fail",
					error: { kind: "execution_failed", cause: "boom" },
				});
				return err({ kind: "execution_failed", cause: "boom" });
			},
		});

		const parse_result = parse_input(":fail");
		if (parse_result.ok) {
			const cmd = get_command(parse_result.value.command_id);
			if (cmd) {
				const exec_result = await cmd.execute(parse_result.value.args, ctx);
				expect(exec_result.ok).toBe(false);
			}
		}

		expect(ctx.events).toHaveLength(1);
		const event = ctx.events[0]!;
		expect(event.kind).toBe("command_failed");
	});

	test("command can emit status messages", async () => {
		const ctx = make_fake_context();

		register_command<void>({
			id: ":status",
			label: "Status",
			description: "Status",
			execute: async (_, _ctx) => {
				_ctx.emit({ kind: "status", text: "processing...", level: "info" });
				_ctx.emit({ kind: "status", text: "done", level: "info" });
				_ctx.emit({ kind: "command_done", command_id: ":status" });
				return ok(undefined);
			},
		});

		const parse_result = parse_input(":status");
		if (parse_result.ok) {
			const cmd = get_command(parse_result.value.command_id);
			if (cmd) {
				await cmd.execute(parse_result.value.args, ctx);
			}
		}

		expect(ctx.events).toHaveLength(3);
		expect(ctx.events[0]!.kind).toBe("status");
		if (ctx.events[0]!.kind === "status") {
			expect(ctx.events[0]!.text).toBe("processing...");
			expect(ctx.events[0]!.level).toBe("info");
		}
		expect(ctx.events[1]!.kind).toBe("status");
		expect(ctx.events[2]!.kind).toBe("command_done");
	});

	test("command can call open_overlay", async () => {
		const ctx = make_fake_context();
		let overlay_called = false;
		let overlay_id: string = "";
		let overlay_payload: unknown;

		const ctx_with_overlay = make_fake_context({
			open_overlay: (id, payload) => {
				overlay_called = true;
				overlay_id = id;
				overlay_payload = payload;
			},
		});

		register_command<void>({
			id: ":help",
			label: "Help",
			description: "Show help",
			execute: async (_, _ctx) => {
				_ctx.open_overlay("help", { version: "1.0" });
				return ok(undefined);
			},
		});

		const parse_result = parse_input(":help");
		if (parse_result.ok) {
			const cmd = get_command(parse_result.value.command_id);
			if (cmd) {
				await cmd.execute(parse_result.value.args, ctx_with_overlay);
			}
		}

		expect(overlay_called).toBe(true);
		expect(overlay_id).toBe("help");
		const payload = overlay_payload as any;
		expect(payload.version).toBe("1.0");
	});

	test("parse error prevents command execution", () => {
		const result = parse_input(":nonexistent");
		expect(result.ok).toBe(false);

		if (!result.ok) {
			expect(result.error.kind).toBe("unknown_command");
		}
	});

	test("command receives CommandContext with all accessors", async () => {
		const ctx = make_fake_context({
			config: defaultConfig(),
			repos: () => [
				{
					name: "test-repo",
					path: "/test",
					type: "repo",
					status: null,
					worktrees: [],
					children: [],
					depth: 0,
					expanded: false,
				},
			],
		});

		let received_ctx: unknown = null;

		register_command<void>({
			id: ":introspect",
			label: "Introspect",
			description: "Introspect context",
			execute: async (_, _ctx) => {
				received_ctx = _ctx;
				return ok(undefined);
			},
		});

		const parse_result = parse_input(":introspect");
		if (parse_result.ok) {
			const cmd = get_command(parse_result.value.command_id);
			if (cmd) {
				await cmd.execute(parse_result.value.args, ctx);
			}
		}

		expect(received_ctx).not.toBeNull();
		const typed_ctx = received_ctx as CommandContext;
		expect(typed_ctx.config).toBeDefined();
		expect(typed_ctx.repos).toBeDefined();
		expect(typed_ctx.repos()).toHaveLength(1);
		expect(typed_ctx.ai_provider).toBeNull();
		expect(typed_ctx.emit).toBeDefined();
		expect(typed_ctx.open_overlay).toBeDefined();
		expect(typed_ctx.trigger_rescan).toBeDefined();
	});

	test("registry lookup during parse uses current registry state", () => {
		// Register a command
		register_command<void>({
			id: ":dynamic",
			label: "Dynamic",
			description: "Dynamic",
			execute: async () => ok(undefined),
		});

		// Parse should succeed
		let result = parse_input(":dynamic");
		expect(result.ok).toBe(true);

		// Clear registry
		_clear_registry_for_tests();

		// Parse should fail now
		result = parse_input(":dynamic");
		expect(result.ok).toBe(false);
	});
});
