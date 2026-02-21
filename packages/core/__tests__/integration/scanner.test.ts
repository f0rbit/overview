import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { scanDirectory, scanAndCollect } from "../../src/index";
import {
	createTempDir,
	cleanupTempDir,
	initRepo,
	addCommit,
	modifyFile,
	addUntracked,
} from "../helpers";

describe("scanner integration", () => {
	let temp_dir: string;

	beforeAll(async () => {
		temp_dir = await createTempDir();
	});

	afterAll(async () => {
		await cleanupTempDir(temp_dir);
	});

	test("discovers repos at root level", async () => {
		const dir = join(temp_dir, "root-level");
		await mkdir(dir, { recursive: true });
		await initRepo(dir, "repo-a");
		await initRepo(dir, "repo-b");
		await initRepo(dir, "repo-c");

		const result = await scanDirectory(dir, { depth: 1, ignore: [] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const repos = result.value.filter((n) => n.type === "repo");
		expect(repos.length).toBe(3);
		expect(repos.map((r) => r.name).sort()).toEqual(["repo-a", "repo-b", "repo-c"]);
	});

	test("discovers nested repos", async () => {
		const dir = join(temp_dir, "nested");
		await mkdir(dir, { recursive: true });
		const nested_path = join(dir, "a", "b");
		await mkdir(nested_path, { recursive: true });
		await initRepo(nested_path, "repo1");

		const result = await scanDirectory(dir, { depth: 4, ignore: [] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const find_repo = (nodes: typeof result.value): boolean =>
			nodes.some((n) => (n.type === "repo" && n.name === "repo1") || find_repo(n.children));

		expect(find_repo(result.value)).toBe(true);
	});

	test("ignores directories matching ignore patterns", async () => {
		const dir = join(temp_dir, "ignore-test");
		await mkdir(dir, { recursive: true });
		await initRepo(dir, "good-repo");
		const nm_dir = join(dir, "node_modules");
		await mkdir(nm_dir, { recursive: true });
		await initRepo(nm_dir, "hidden-repo");

		const result = await scanDirectory(dir, { depth: 2, ignore: ["node_modules"] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const all_names = flatNames(result.value);
		expect(all_names).toContain("good-repo");
		expect(all_names).not.toContain("node_modules");
		expect(all_names).not.toContain("hidden-repo");
	});

	test("collects status for clean repo", async () => {
		const dir = join(temp_dir, "clean-test");
		await mkdir(dir, { recursive: true });
		await initRepo(dir, "clean-repo");
		await addCommit(join(dir, "clean-repo"), "file.txt", "content", "add file");

		const result = await scanAndCollect(dir, { depth: 1, ignore: [] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const repo = result.value.find((n) => n.name === "clean-repo");
		expect(repo).toBeDefined();
		expect(repo!.status).not.toBeNull();
		expect(repo!.status!.is_clean).toBe(true);
		expect(repo!.status!.health).toBe("clean");
	});

	test("detects dirty state", async () => {
		const dir = join(temp_dir, "dirty-test");
		await mkdir(dir, { recursive: true });
		const repo_path = await initRepo(dir, "dirty-repo");
		await addCommit(repo_path, "file.txt", "original", "add file");
		await modifyFile(repo_path, "file.txt", "modified content");

		const result = await scanAndCollect(dir, { depth: 1, ignore: [] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const repo = result.value.find((n) => n.name === "dirty-repo");
		expect(repo).toBeDefined();
		expect(repo!.status).not.toBeNull();
		expect(repo!.status!.modified_count).toBeGreaterThan(0);
		expect(repo!.status!.health).toBe("dirty");
	});

	test("detects untracked files", async () => {
		const dir = join(temp_dir, "untracked-test");
		await mkdir(dir, { recursive: true });
		const repo_path = await initRepo(dir, "untracked-repo");
		await addUntracked(repo_path, "new-file.txt", "untracked content");

		const result = await scanAndCollect(dir, { depth: 1, ignore: [] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const repo = result.value.find((n) => n.name === "untracked-repo");
		expect(repo).toBeDefined();
		expect(repo!.status).not.toBeNull();
		expect(repo!.status!.untracked_count).toBeGreaterThan(0);
	});

	test("returns empty array for empty directory", async () => {
		const dir = join(temp_dir, "empty-test");
		await mkdir(dir, { recursive: true });

		const result = await scanDirectory(dir, { depth: 1, ignore: [] });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toEqual([]);
	});
});

function flatNames(nodes: { name: string; children: typeof nodes }[]): string[] {
	return nodes.flatMap((n) => [n.name, ...flatNames(n.children)]);
}
