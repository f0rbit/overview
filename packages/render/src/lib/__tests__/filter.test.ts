import { describe, test, expect } from "bun:test";
import type { RepoNode, RepoStatus } from "@overview/core";
import { filterTree, sortTree, searchRepos, nextFilter, nextSort } from "../filter";

// ── helpers ────────────────────────────────────────────────────────────────

function makeRepo(name: string, health: string, opts: { head_time?: number; display_path?: string } = {}): RepoNode {
	return {
		name,
		path: `/dev/${name}`,
		type: "repo",
		status: {
			health,
			head_time: opts.head_time ?? 0,
			display_path: opts.display_path ?? `/dev/${name}`,
		} as any as RepoStatus,
		worktrees: [],
		children: [],
		depth: 0,
		expanded: false,
	};
}

function makeDir(name: string, children: RepoNode[]): RepoNode {
	return {
		name,
		path: `/dev/${name}`,
		type: "directory",
		status: null,
		worktrees: [],
		children,
		depth: 0,
		expanded: false,
	};
}

// ── filterTree ─────────────────────────────────────────────────────────────

describe("filterTree", () => {
	const clean_repo = makeRepo("clean-app", "clean");
	const dirty_repo = makeRepo("dirty-app", "dirty");
	const ahead_repo = makeRepo("ahead-app", "ahead");
	const behind_repo = makeRepo("behind-app", "behind");
	const diverged_repo = makeRepo("diverged-app", "diverged");
	const conflict_repo = makeRepo("conflict-app", "conflict");
	const all_repos = [clean_repo, dirty_repo, ahead_repo, behind_repo, diverged_repo, conflict_repo];

	test("'all' returns all nodes unchanged", () => {
		const result = filterTree(all_repos, "all");
		expect(result).toBe(all_repos);
	});

	test("'dirty' filters to only non-clean repos", () => {
		const result = filterTree(all_repos, "dirty");
		const names = result.map((n) => n.name);
		expect(names).toEqual(["dirty-app", "ahead-app", "behind-app", "diverged-app", "conflict-app"]);
	});

	test("'clean' filters to only clean repos", () => {
		const result = filterTree(all_repos, "clean");
		expect(result.map((n) => n.name)).toEqual(["clean-app"]);
	});

	test("'ahead' includes ahead and diverged", () => {
		const result = filterTree(all_repos, "ahead");
		expect(result.map((n) => n.name)).toEqual(["ahead-app", "diverged-app"]);
	});

	test("'behind' includes behind and diverged", () => {
		const result = filterTree(all_repos, "behind");
		expect(result.map((n) => n.name)).toEqual(["behind-app", "diverged-app"]);
	});

	test("directory with no matching children is removed", () => {
		const dir = makeDir("projects", [clean_repo]);
		const result = filterTree([dir], "dirty");
		expect(result).toEqual([]);
	});

	test("directory keeps only matching children", () => {
		const dir = makeDir("projects", [clean_repo, dirty_repo, ahead_repo]);
		const result = filterTree([dir], "clean");
		expect(result).toHaveLength(1);
		expect(result[0]!.type).toBe("directory");
		expect(result[0]!.children.map((n) => n.name)).toEqual(["clean-app"]);
	});

	test("nested directories are pruned recursively", () => {
		const inner = makeDir("inner", [clean_repo]);
		const outer = makeDir("outer", [inner]);
		const result = filterTree([outer], "dirty");
		expect(result).toEqual([]);
	});

	test("nested directories keep matching descendants", () => {
		const inner = makeDir("inner", [dirty_repo, clean_repo]);
		const outer = makeDir("outer", [inner, ahead_repo]);
		const result = filterTree([outer], "dirty");
		expect(result).toHaveLength(1);
		expect(result[0]!.children).toHaveLength(2);
		expect(result[0]!.children[0]!.name).toBe("inner");
		expect(result[0]!.children[0]!.children.map((n) => n.name)).toEqual(["dirty-app"]);
		expect(result[0]!.children[1]!.name).toBe("ahead-app");
	});
});

// ── sortTree ───────────────────────────────────────────────────────────────

describe("sortTree", () => {
	test("'name' sorts repos alphabetically", () => {
		const repos = [makeRepo("zeta", "clean"), makeRepo("alpha", "clean"), makeRepo("mu", "clean")];
		const result = sortTree(repos, "name");
		expect(result.map((n) => n.name)).toEqual(["alpha", "mu", "zeta"]);
	});

	test("'status' sorts by health priority", () => {
		const repos = [
			makeRepo("r-clean", "clean"),
			makeRepo("r-conflict", "conflict"),
			makeRepo("r-ahead", "ahead"),
			makeRepo("r-dirty", "dirty"),
			makeRepo("r-behind", "behind"),
			makeRepo("r-diverged", "diverged"),
		];
		const result = sortTree(repos, "status");
		expect(result.map((n) => n.name)).toEqual([
			"r-conflict",
			"r-diverged",
			"r-ahead",
			"r-behind",
			"r-dirty",
			"r-clean",
		]);
	});

	test("'status' uses name as tiebreaker", () => {
		const repos = [makeRepo("beta", "dirty"), makeRepo("alpha", "dirty")];
		const result = sortTree(repos, "status");
		expect(result.map((n) => n.name)).toEqual(["alpha", "beta"]);
	});

	test("'last-commit' sorts by head_time descending", () => {
		const repos = [
			makeRepo("old", "clean", { head_time: 100 }),
			makeRepo("new", "clean", { head_time: 300 }),
			makeRepo("mid", "clean", { head_time: 200 }),
		];
		const result = sortTree(repos, "last-commit");
		expect(result.map((n) => n.name)).toEqual(["new", "mid", "old"]);
	});

	test("'last-commit' uses name as tiebreaker", () => {
		const repos = [
			makeRepo("beta", "clean", { head_time: 100 }),
			makeRepo("alpha", "clean", { head_time: 100 }),
		];
		const result = sortTree(repos, "last-commit");
		expect(result.map((n) => n.name)).toEqual(["alpha", "beta"]);
	});

	test("directories come before repos", () => {
		const dir = makeDir("a-dir", [makeRepo("inner", "clean")]);
		const repo = makeRepo("a-repo", "clean");
		const result = sortTree([repo, dir], "name");
		expect(result[0]!.type).toBe("directory");
		expect(result[1]!.type).toBe("repo");
	});

	test("directories are sorted by name", () => {
		const dir_z = makeDir("zulu", [makeRepo("x", "clean")]);
		const dir_a = makeDir("alpha", [makeRepo("y", "clean")]);
		const result = sortTree([dir_z, dir_a], "name");
		expect(result.map((n) => n.name)).toEqual(["alpha", "zulu"]);
	});

	test("children inside directories are also sorted", () => {
		const dir = makeDir("proj", [
			makeRepo("zeta", "clean"),
			makeRepo("alpha", "clean"),
		]);
		const result = sortTree([dir], "name");
		expect(result[0]!.children.map((n) => n.name)).toEqual(["alpha", "zeta"]);
	});
});

// ── searchRepos ────────────────────────────────────────────────────────────

describe("searchRepos", () => {
	const repos = [
		makeRepo("overview", "clean", { display_path: "dev/overview" }),
		makeRepo("devpad", "dirty", { display_path: "dev/devpad" }),
		makeRepo("corpus", "clean", { display_path: "work/corpus" }),
	];

	test("matches by name (case insensitive)", () => {
		const result = searchRepos(repos, "OVERVIEW");
		expect(result.map((n) => n.name)).toEqual(["overview"]);
	});

	test("matches by display_path (case insensitive)", () => {
		const result = searchRepos(repos, "WORK/");
		expect(result.map((n) => n.name)).toEqual(["corpus"]);
	});

	test("partial match works", () => {
		const result = searchRepos(repos, "dev");
		expect(result.map((n) => n.name)).toEqual(["overview", "devpad"]);
	});

	test("flattens directory structure in results", () => {
		const dir = makeDir("projects", [repos[0]!, repos[1]!]);
		const result = searchRepos([dir, repos[2]!], "corpus");
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("corpus");
		expect(result[0]!.type).toBe("repo");
	});

	test("flattens nested directories", () => {
		const inner = makeDir("inner", [repos[0]!]);
		const outer = makeDir("outer", [inner, repos[1]!]);
		const result = searchRepos([outer, repos[2]!], "overview");
		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("overview");
	});

	test("returns empty array for no matches", () => {
		const result = searchRepos(repos, "nonexistent");
		expect(result).toEqual([]);
	});
});

// ── nextFilter ─────────────────────────────────────────────────────────────

describe("nextFilter", () => {
	test("cycles through filter modes", () => {
		expect(nextFilter("all")).toBe("dirty");
		expect(nextFilter("dirty")).toBe("clean");
		expect(nextFilter("clean")).toBe("ahead");
		expect(nextFilter("ahead")).toBe("behind");
		expect(nextFilter("behind")).toBe("all");
	});
});

// ── nextSort ───────────────────────────────────────────────────────────────

describe("nextSort", () => {
	test("cycles through sort modes", () => {
		expect(nextSort("name")).toBe("status");
		expect(nextSort("status")).toBe("last-commit");
		expect(nextSort("last-commit")).toBe("name");
	});
});
