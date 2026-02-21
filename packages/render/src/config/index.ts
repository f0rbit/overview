import { ok, err, merge_deep, type Result, type DeepPartial } from "@f0rbit/corpus";
import { type OverviewConfig, defaultConfig } from "@overview/core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type ConfigError =
	| { kind: "parse_error"; path: string; cause: string }
	| { kind: "write_error"; path: string; cause: string };

const CONFIG_DIR = join(homedir(), ".config", "overview");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

const expandTilde = (p: string): string =>
	p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;

const expandPaths = (config: OverviewConfig): OverviewConfig => ({
	...config,
	scan_dirs: config.scan_dirs.map(expandTilde),
});

const isEnoent = (e: unknown): boolean =>
	e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT";

export async function loadConfig(): Promise<Result<OverviewConfig, ConfigError>> {
	let raw: string;
	try {
		raw = await readFile(CONFIG_PATH, "utf-8");
	} catch (e) {
		if (isEnoent(e)) return ok(expandPaths(defaultConfig()));
		return err({ kind: "parse_error", path: CONFIG_PATH, cause: String(e) });
	}

	let parsed: DeepPartial<OverviewConfig>;
	try {
		parsed = JSON.parse(raw);
	} catch (e) {
		return err({ kind: "parse_error", path: CONFIG_PATH, cause: `Invalid JSON: ${e}` });
	}

	const merged = merge_deep(defaultConfig() as unknown as Record<string, unknown>, parsed as unknown as Record<string, unknown>) as unknown as OverviewConfig;
	return ok(expandPaths(merged));
}

export async function writeDefaultConfig(): Promise<Result<void, ConfigError>> {
	try {
		await readFile(CONFIG_PATH, "utf-8");
		return ok(undefined);
	} catch (e) {
		if (!isEnoent(e)) return err({ kind: "write_error", path: CONFIG_PATH, cause: String(e) });
	}

	try {
		await mkdir(CONFIG_DIR, { recursive: true });
		await writeFile(CONFIG_PATH, JSON.stringify(defaultConfig(), null, 2) + "\n", "utf-8");
		return ok(undefined);
	} catch (e) {
		return err({ kind: "write_error", path: CONFIG_PATH, cause: String(e) });
	}
}

export interface CliArgs {
	dir?: string;
	depth?: number;
	sort?: "name" | "status" | "last-commit";
	filter?: "all" | "dirty" | "clean" | "ahead" | "behind";
}

export function parseCliArgs(argv: string[]): CliArgs {
	const args = argv.slice(2);
	const result: CliArgs = {};

	for (let i = 0; i < args.length; i++) {
		const flag = args[i];
		const next = args[i + 1];

		if ((flag === "--dir" || flag === "-d") && next) {
			result.dir = next;
			i++;
		} else if (flag === "--depth" && next) {
			result.depth = parseInt(next, 10);
			i++;
		} else if (flag === "--sort" && next) {
			result.sort = next as CliArgs["sort"];
			i++;
		} else if (flag === "--filter" && next) {
			result.filter = next as CliArgs["filter"];
			i++;
		}
	}

	return result;
}

export function mergeCliArgs(config: OverviewConfig, args: CliArgs): OverviewConfig {
	const result = { ...config };

	if (args.dir !== undefined) result.scan_dirs = [expandTilde(args.dir)];
	if (args.depth !== undefined) result.depth = args.depth;
	if (args.sort !== undefined) result.sort = args.sort;
	if (args.filter !== undefined) result.filter = args.filter;

	return result;
}
