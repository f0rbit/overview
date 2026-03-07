import { describe, test, expect } from "bun:test";
import { defaultConfig } from "@overview/core";
import { parseCliArgs, mergeCliArgs } from "../../config/index";

// ── parseCliArgs ───────────────────────────────────────────────────────────

describe("parseCliArgs", () => {
	test("no flags returns empty object", () => {
		expect(parseCliArgs(["bun", "s"])).toEqual({});
	});

	test("--dir flag", () => {
		expect(parseCliArgs(["bun", "s", "--dir", "/tmp"])).toEqual({ dir: "/tmp" });
	});

	test("-d short flag", () => {
		expect(parseCliArgs(["bun", "s", "-d", "/tmp"])).toEqual({ dir: "/tmp" });
	});

	test("--depth flag parses as number", () => {
		expect(parseCliArgs(["bun", "s", "--depth", "5"])).toEqual({ depth: 5 });
	});

	test("--sort flag", () => {
		expect(parseCliArgs(["bun", "s", "--sort", "status"])).toEqual({ sort: "status" });
	});

	test("--filter flag", () => {
		expect(parseCliArgs(["bun", "s", "--filter", "dirty"])).toEqual({ filter: "dirty" });
	});

	test("multiple flags together", () => {
		const result = parseCliArgs(["bun", "s", "--dir", "/tmp", "--depth", "2", "--sort", "last-commit", "--filter", "ahead"]);
		expect(result).toEqual({
			dir: "/tmp",
			depth: 2,
			sort: "last-commit",
			filter: "ahead",
		});
	});

	test("flag without value is ignored", () => {
		expect(parseCliArgs(["bun", "s", "--dir"])).toEqual({});
	});
});

// ── mergeCliArgs ───────────────────────────────────────────────────────────

describe("mergeCliArgs", () => {
	test("empty args returns config unchanged", () => {
		const config = defaultConfig();
		const result = mergeCliArgs(config, {});
		expect(result).toEqual(config);
	});

	test("dir overrides scan_dirs", () => {
		const config = defaultConfig();
		const result = mergeCliArgs(config, { dir: "/tmp" });
		expect(result.scan_dirs).toEqual(["/tmp"]);
	});

	test("dir with tilde is expanded", () => {
		const config = defaultConfig();
		const result = mergeCliArgs(config, { dir: "~/dev" });
		expect(result.scan_dirs[0]).not.toContain("~");
		expect(result.scan_dirs[0]!.endsWith("/dev")).toBe(true);
	});

	test("depth overrides depth", () => {
		const config = defaultConfig();
		const result = mergeCliArgs(config, { depth: 5 });
		expect(result.depth).toBe(5);
	});

	test("sort overrides sort", () => {
		const config = defaultConfig();
		const result = mergeCliArgs(config, { sort: "status" });
		expect(result.sort).toBe("status");
	});

	test("multiple args override multiple fields", () => {
		const config = defaultConfig();
		const result = mergeCliArgs(config, { dir: "/projects", depth: 10, sort: "last-commit", filter: "dirty" });
		expect(result.scan_dirs).toEqual(["/projects"]);
		expect(result.depth).toBe(10);
		expect(result.sort).toBe("last-commit");
		expect(result.filter).toBe("dirty");
	});

	test("original config is not mutated", () => {
		const config = defaultConfig();
		const original_dirs = [...config.scan_dirs];
		const original_depth = config.depth;
		mergeCliArgs(config, { dir: "/tmp", depth: 99 });
		expect(config.scan_dirs).toEqual(original_dirs);
		expect(config.depth).toBe(original_depth);
	});
});
