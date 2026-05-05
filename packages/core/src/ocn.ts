import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { type Result, ok } from "@f0rbit/corpus";
import type { OcnSessionStatus, OcnStatus } from "./types";

interface OcnStateFile {
	pid: number;
	directory: string;
	project: string;
	status: OcnSessionStatus;
	last_transition: string;
	session_id: string;
}

const VALID_STATUSES: Set<string> = new Set(["idle", "busy", "prompting", "error"]);

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function isValidState(data: unknown): data is OcnStateFile {
	if (typeof data !== "object" || data === null) return false;
	const obj = data as Record<string, unknown>;
	return (
		typeof obj.pid === "number" &&
		typeof obj.directory === "string" &&
		typeof obj.status === "string" &&
		VALID_STATUSES.has(obj.status) &&
		typeof obj.session_id === "string"
	);
}

export async function readOcnStates(): Promise<Result<Map<string, OcnStatus>, never>> {
	const state_dir = process.env.OCN_STATE_DIR ?? join(process.env.HOME ?? "~", ".local", "state", "ocn");
	const map = new Map<string, OcnStatus>();

	let entries: string[];
	try {
		const dir_entries = await readdir(state_dir);
		entries = dir_entries.filter((e) => e.endsWith(".json"));
	} catch {
		// State dir doesn't exist — ocn not installed or no sessions. Not an error.
		return ok(map);
	}

	for (const entry of entries) {
		const file_path = join(state_dir, entry);
		try {
			const data = await Bun.file(file_path).json();
			if (!isValidState(data)) continue;
			if (!isAlive(data.pid)) continue;

			map.set(data.directory, {
				pid: data.pid,
				status: data.status,
				session_id: data.session_id,
			});
		} catch {}
	}

	return ok(map);
}
