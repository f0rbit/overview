import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { readFile, lstat } from "node:fs/promises";

export interface WatcherOptions {
	/** Debounce interval in ms (default 500) */
	debounce_ms?: number;
	/** Callback when a repo changes */
	on_change: (repoPath: string) => void;
}

export interface RepoWatcher {
	/** Start watching a list of repo paths */
	watch(repoPaths: string[]): void;
	/** Stop watching all repos */
	close(): void;
	/** Add a single repo to watch */
	add(repoPath: string): void;
	/** Remove a single repo from watching */
	remove(repoPath: string): void;
}

async function resolveGitDir(repo_path: string): Promise<string | null> {
	const git_path = join(repo_path, ".git");
	try {
		const stats = await lstat(git_path);
		if (stats.isDirectory()) return git_path;
		if (stats.isFile()) {
			const content = await readFile(git_path, "utf-8");
			const match = content.match(/^gitdir:\s*(.+)$/m);
			const target = match?.[1]?.trim();
			if (!target) return null;
			return target.startsWith("/") ? target : join(repo_path, target);
		}
		return null;
	} catch {
		return null;
	}
}

function tryWatch(
	target: string,
	options: { recursive?: boolean },
	callback: () => void,
): FSWatcher | null {
	try {
		const watcher = watch(target, options, callback);
		watcher.on("error", () => {});
		return watcher;
	} catch {
		return null;
	}
}

export function createRepoWatcher(options: WatcherOptions): RepoWatcher {
	const debounce_ms = options.debounce_ms ?? 500;
	const watchers = new Map<string, FSWatcher[]>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	function debouncedChange(repo_path: string) {
		const existing = timers.get(repo_path);
		if (existing) clearTimeout(existing);
		timers.set(
			repo_path,
			setTimeout(() => {
				timers.delete(repo_path);
				options.on_change(repo_path);
			}, debounce_ms),
		);
	}

	async function addRepo(repo_path: string) {
		if (watchers.has(repo_path)) return;

		const git_dir = await resolveGitDir(repo_path);
		if (!git_dir) {
			console.warn(`[watcher] skipping ${repo_path}: could not resolve .git directory`);
			return;
		}

		const repo_watchers: FSWatcher[] = [];
		const on_event = () => debouncedChange(repo_path);

		const index_watcher = tryWatch(join(git_dir, "index"), {}, on_event);
		if (index_watcher) repo_watchers.push(index_watcher);

		const refs_watcher = tryWatch(join(git_dir, "refs"), { recursive: true }, on_event);
		if (refs_watcher) repo_watchers.push(refs_watcher);

		if (repo_watchers.length === 0) {
			console.warn(`[watcher] skipping ${repo_path}: no watchable targets`);
			return;
		}

		watchers.set(repo_path, repo_watchers);
	}

	function removeRepo(repo_path: string) {
		const repo_watchers = watchers.get(repo_path);
		if (repo_watchers) {
			repo_watchers.forEach((w) => w.close());
			watchers.delete(repo_path);
		}
		const timer = timers.get(repo_path);
		if (timer) {
			clearTimeout(timer);
			timers.delete(repo_path);
		}
	}

	return {
		watch(repo_paths: string[]) {
			repo_paths.forEach((p) => addRepo(p));
		},
		close() {
			watchers.forEach((ws) => ws.forEach((w) => w.close()));
			watchers.clear();
			timers.forEach((t) => clearTimeout(t));
			timers.clear();
		},
		add(repo_path: string) {
			addRepo(repo_path);
		},
		remove(repo_path: string) {
			removeRepo(repo_path);
		},
	};
}
