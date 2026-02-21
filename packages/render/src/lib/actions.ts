import { ok, err, type Result } from "@f0rbit/corpus";

export type ActionError =
	| { kind: "not_found"; command: string }
	| { kind: "spawn_failed"; command: string; cause: string }
	| { kind: "exited_with_error"; command: string; code: number };

type SuspendCallbacks = {
	onSuspend: () => void;
	onResume: () => void;
};

async function launchSubprocess(
	command: string,
	args: string[],
	cwd: string,
	callbacks: SuspendCallbacks,
): Promise<Result<void, ActionError>> {
	callbacks.onSuspend();

	try {
		const proc = Bun.spawn([command, ...args], {
			cwd,
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		});

		await proc.exited;

		if (proc.exitCode !== 0 && proc.exitCode !== null) {
			return err({ kind: "exited_with_error", command, code: proc.exitCode });
		}

		return ok(undefined);
	} catch (e) {
		return err({ kind: "spawn_failed", command, cause: String(e) });
	} finally {
		callbacks.onResume();
	}
}

export async function launchGgi(
	repoPath: string,
	ggiCommand: string,
	callbacks: SuspendCallbacks,
): Promise<Result<void, ActionError>> {
	return launchSubprocess(ggiCommand, [], repoPath, callbacks);
}

export async function launchEditor(
	repoPath: string,
	editorCommand: string,
	callbacks: SuspendCallbacks,
): Promise<Result<void, ActionError>> {
	const resolved = editorCommand === "$EDITOR"
		? (process.env.EDITOR ?? process.env.VISUAL ?? "vim")
		: editorCommand;
	return launchSubprocess(resolved, ["."], repoPath, callbacks);
}

export async function launchSessionizer(
	repoPath: string,
	sessionizerCommand: string,
	callbacks: SuspendCallbacks,
): Promise<Result<void, ActionError>> {
	return launchSubprocess(sessionizerCommand, [repoPath], process.cwd(), callbacks);
}
