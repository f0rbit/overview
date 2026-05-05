import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOcnStates } from "../src/ocn";

describe("readOcnStates", () => {
	let temp_dir: string;
	const original_env = process.env.OCN_STATE_DIR;

	beforeEach(async () => {
		temp_dir = await mkdtemp(join(tmpdir(), "ocn-test-"));
		process.env.OCN_STATE_DIR = temp_dir;
	});

	afterEach(async () => {
		if (original_env !== undefined) {
			process.env.OCN_STATE_DIR = original_env;
		} else {
			delete process.env.OCN_STATE_DIR;
		}
		await rm(temp_dir, { recursive: true, force: true });
	});

	test("returns empty map when state dir is empty", async () => {
		const result = await readOcnStates();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.size).toBe(0);
		}
	});

	test("returns empty map when state dir does not exist", async () => {
		process.env.OCN_STATE_DIR = join(temp_dir, "nonexistent");
		const result = await readOcnStates();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.size).toBe(0);
		}
	});

	test("reads valid state file with alive PID", async () => {
		const pid = process.pid; // current process is always alive
		const state = {
			pid,
			directory: "/Users/tom/dev/test-repo",
			project: "test-repo",
			status: "busy",
			last_transition: "2026-01-01T00:00:00Z",
			session_id: "ses_test123",
		};
		await writeFile(join(temp_dir, `${pid}.json`), JSON.stringify(state));

		const result = await readOcnStates();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.size).toBe(1);
			const entry = result.value.get("/Users/tom/dev/test-repo");
			expect(entry).toBeDefined();
			expect(entry!.pid).toBe(pid);
			expect(entry!.status).toBe("busy");
			expect(entry!.session_id).toBe("ses_test123");
		}
	});

	test("filters out stale PIDs", async () => {
		const state = {
			pid: 99999999, // very unlikely to be a running process
			directory: "/Users/tom/dev/stale-repo",
			project: "stale-repo",
			status: "busy",
			last_transition: "2026-01-01T00:00:00Z",
			session_id: "ses_stale",
		};
		await writeFile(join(temp_dir, "99999999.json"), JSON.stringify(state));

		const result = await readOcnStates();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.size).toBe(0);
		}
	});

	test("skips malformed JSON files", async () => {
		await writeFile(join(temp_dir, "bad.json"), "not json {{{");
		// Also write a valid one with alive PID
		const pid = process.pid;
		const state = {
			pid,
			directory: "/Users/tom/dev/good-repo",
			project: "good-repo",
			status: "idle",
			last_transition: "2026-01-01T00:00:00Z",
			session_id: "ses_good",
		};
		await writeFile(join(temp_dir, `${pid}.json`), JSON.stringify(state));

		const result = await readOcnStates();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.size).toBe(1);
			expect(result.value.has("/Users/tom/dev/good-repo")).toBe(true);
		}
	});

	test("skips files with invalid status values", async () => {
		const pid = process.pid;
		const state = {
			pid,
			directory: "/Users/tom/dev/invalid",
			project: "invalid",
			status: "unknown_status",
			last_transition: "2026-01-01T00:00:00Z",
			session_id: "ses_invalid",
		};
		await writeFile(join(temp_dir, `${pid}.json`), JSON.stringify(state));

		const result = await readOcnStates();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.size).toBe(0);
		}
	});

	test("skips non-json files", async () => {
		await writeFile(join(temp_dir, "readme.txt"), "not a state file");
		const result = await readOcnStates();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.size).toBe(0);
		}
	});

	test("reads multiple state files", async () => {
		const pid = process.pid;
		const state1 = {
			pid,
			directory: "/Users/tom/dev/repo-a",
			project: "repo-a",
			status: "busy",
			last_transition: "2026-01-01T00:00:00Z",
			session_id: "ses_a",
		};
		const state2 = {
			pid,
			directory: "/Users/tom/dev/repo-b",
			project: "repo-b",
			status: "prompting",
			last_transition: "2026-01-01T00:00:00Z",
			session_id: "ses_b",
		};
		// Use different filenames (same pid but different entries)
		await writeFile(join(temp_dir, `${pid}.json`), JSON.stringify(state1));
		await writeFile(join(temp_dir, `${pid}_2.json`), JSON.stringify(state2));

		const result = await readOcnStates();
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.size).toBe(2);
			expect(result.value.get("/Users/tom/dev/repo-a")?.status).toBe("busy");
			expect(result.value.get("/Users/tom/dev/repo-b")?.status).toBe("prompting");
		}
	});
});
