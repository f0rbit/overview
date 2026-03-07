import { describe, test, expect } from "bun:test";
import { normalizeGitUrl, matchRepoToProject, type DevpadProject } from "../src/devpad";

const project = (overrides: Partial<DevpadProject> = {}): DevpadProject => ({
	id: "id-1",
	project_id: "my-repo",
	name: "My Repo",
	description: null,
	status: "DEVELOPMENT",
	repo_url: null,
	...overrides,
});

// ── normalizeGitUrl ────────────────────────────────────────────────────────

describe("normalizeGitUrl", () => {
	test("strips .git suffix", () => {
		expect(normalizeGitUrl("https://github.com/owner/repo.git")).toBe(
			"https://github.com/owner/repo",
		);
	});

	test("strips trailing slash", () => {
		expect(normalizeGitUrl("https://github.com/owner/repo/")).toBe(
			"https://github.com/owner/repo",
		);
	});

	test("converts SSH to HTTPS", () => {
		expect(normalizeGitUrl("git@github.com:owner/repo.git")).toBe(
			"https://github.com/owner/repo",
		);
	});

	test("lowercases everything", () => {
		expect(normalizeGitUrl("https://GitHub.COM/Owner/Repo")).toBe(
			"https://github.com/owner/repo",
		);
	});

	test("trims whitespace", () => {
		expect(normalizeGitUrl("  https://github.com/owner/repo  ")).toBe(
			"https://github.com/owner/repo",
		);
	});

	test("handles already-clean URLs", () => {
		expect(normalizeGitUrl("https://github.com/owner/repo")).toBe(
			"https://github.com/owner/repo",
		);
	});

	test("strips .git and trailing slash together", () => {
		expect(normalizeGitUrl("https://github.com/owner/repo.git")).toBe(
			"https://github.com/owner/repo",
		);
	});

	test("converts SSH without .git suffix", () => {
		expect(normalizeGitUrl("git@github.com:owner/repo")).toBe(
			"https://github.com/owner/repo",
		);
	});
});

// ── matchRepoToProject ────────────────────────────────────────────────────

describe("matchRepoToProject", () => {
	test("matches by normalized remote_url", () => {
		const p = project({ repo_url: "https://github.com/owner/my-repo" });
		const result = matchRepoToProject("https://github.com/owner/my-repo.git", "unrelated", [p]);
		expect(result).toBe(p);
	});

	test("falls back to repo_name matching project_id", () => {
		const p = project({ project_id: "cool-project" });
		const result = matchRepoToProject("https://github.com/owner/other", "cool-project", [p]);
		expect(result).toBe(p);
	});

	test("returns null when no match", () => {
		const p = project({ repo_url: "https://github.com/owner/something-else" });
		const result = matchRepoToProject("https://github.com/owner/no-match", "no-match", [p]);
		expect(result).toBeNull();
	});

	test("handles null remote_url — skips URL matching, tries name", () => {
		const p = project({ project_id: "my-repo" });
		const result = matchRepoToProject(null, "my-repo", [p]);
		expect(result).toBe(p);
	});

	test("handles null remote_url with no name match", () => {
		const p = project({ project_id: "other" });
		const result = matchRepoToProject(null, "no-match", [p]);
		expect(result).toBeNull();
	});

	test("handles projects with null repo_url — skips them for URL match", () => {
		const p1 = project({ id: "p1", repo_url: null, project_id: "not-this" });
		const p2 = project({ id: "p2", repo_url: "https://github.com/owner/target", project_id: "not-this-either" });
		const result = matchRepoToProject("https://github.com/owner/target", "unrelated", [p1, p2]);
		expect(result).toBe(p2);
	});

	test("SSH and HTTPS match each other", () => {
		const p = project({ repo_url: "git@github.com:owner/repo.git" });
		const result = matchRepoToProject("https://github.com/owner/repo", "unrelated", [p]);
		expect(result).toBe(p);
	});

	test("URL match takes priority over name match", () => {
		const p_url = project({ id: "p-url", repo_url: "https://github.com/owner/repo", project_id: "wrong-name" });
		const p_name = project({ id: "p-name", repo_url: null, project_id: "repo" });
		const result = matchRepoToProject("https://github.com/owner/repo", "repo", [p_url, p_name]);
		expect(result).toBe(p_url);
	});

	test("returns null for empty projects array", () => {
		const result = matchRepoToProject("https://github.com/owner/repo", "repo", []);
		expect(result).toBeNull();
	});
});
