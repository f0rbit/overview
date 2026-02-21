import { ok, err, type Result } from "@f0rbit/corpus";

export type GithubError =
	| { kind: "not_github_repo" }
	| { kind: "gh_cli_not_found" }
	| { kind: "gh_auth_required" }
	| { kind: "api_error"; cause: string }
	| { kind: "rate_limited" };

export interface GithubPR {
	number: number;
	title: string;
	state: string;
	review_decision: string | null;
	ci_status: "success" | "failure" | "pending" | "none";
	is_draft: boolean;
	author: string;
}

export interface GithubIssue {
	number: number;
	title: string;
	labels: string[];
	created_at: string;
}

export interface GithubWorkflowRun {
	name: string;
	status: string;
	conclusion: string | null;
	head_branch: string;
	duration_seconds: number | null;
}

export interface GithubRelease {
	tag_name: string;
	name: string;
	published_at: string;
	commits_since: number;
}

export interface GithubRepoData {
	prs: GithubPR[];
	issues: GithubIssue[];
	ci_runs: GithubWorkflowRun[];
	latest_release: GithubRelease | null;
}

let gh_available: boolean | null = null;

export function checkGhAvailable(): boolean {
	if (gh_available === null) {
		gh_available = Bun.which("gh") !== null;
	}
	return gh_available;
}

export function isGithubRemote(remote_url: string | null): boolean {
	if (!remote_url) return false;
	return remote_url.includes("github.com");
}

export function parseGhOwnerRepo(remote_url: string): { owner: string; repo: string } | null {
	const match = remote_url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
	if (match) return { owner: match[1]!, repo: match[2]! };
	return null;
}

function safeJsonParse<T>(text: string): Result<T, GithubError> {
	try {
		return ok(JSON.parse(text) as T);
	} catch {
		return err({ kind: "api_error", cause: "invalid JSON response from gh CLI" });
	}
}

async function gh(args: string[], cwd: string): Promise<Result<string, GithubError>> {
	if (!checkGhAvailable()) return err({ kind: "gh_cli_not_found" });

	const proc = Bun.spawn(["gh", ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exit_code = await proc.exited;

	if (exit_code !== 0) {
		if (stderr.includes("auth login")) return err({ kind: "gh_auth_required" });
		if (stderr.includes("rate limit")) return err({ kind: "rate_limited" });
		return err({ kind: "api_error", cause: stderr.trim() });
	}

	return ok(stdout);
}

interface RawPR {
	number: number;
	title: string;
	state: string;
	reviewDecision: string | null;
	statusCheckRollup: Array<{ state: string; status: string; conclusion: string }> | null;
	isDraft: boolean;
	author: { login: string };
}

function deriveCiStatus(checks: RawPR["statusCheckRollup"]): GithubPR["ci_status"] {
	if (!checks || checks.length === 0) return "none";
	const has_failure = checks.some(
		(c) => c.conclusion === "FAILURE" || c.conclusion === "failure",
	);
	if (has_failure) return "failure";
	const all_success = checks.every(
		(c) => c.conclusion === "SUCCESS" || c.conclusion === "success",
	);
	if (all_success) return "success";
	return "pending";
}

function mapPR(raw: RawPR): GithubPR {
	return {
		number: raw.number,
		title: raw.title,
		state: raw.state,
		review_decision: raw.reviewDecision ?? null,
		ci_status: deriveCiStatus(raw.statusCheckRollup),
		is_draft: raw.isDraft,
		author: raw.author?.login ?? "unknown",
	};
}

export async function collectPRs(cwd: string): Promise<Result<GithubPR[], GithubError>> {
	const result = await gh(
		["pr", "list", "--json", "number,title,state,reviewDecision,statusCheckRollup,isDraft,author", "--limit", "20"],
		cwd,
	);
	if (!result.ok) return result;

	const parsed = safeJsonParse<RawPR[]>(result.value);
	if (!parsed.ok) return parsed;

	return ok(parsed.value.map(mapPR));
}

interface RawIssue {
	number: number;
	title: string;
	labels: Array<{ name: string }>;
	createdAt: string;
}

export async function collectIssues(cwd: string): Promise<Result<GithubIssue[], GithubError>> {
	const result = await gh(
		["issue", "list", "--json", "number,title,labels,createdAt", "--limit", "10"],
		cwd,
	);
	if (!result.ok) return result;

	const parsed = safeJsonParse<RawIssue[]>(result.value);
	if (!parsed.ok) return parsed;

	return ok(
		parsed.value.map((raw) => ({
			number: raw.number,
			title: raw.title,
			labels: raw.labels.map((l) => l.name),
			created_at: raw.createdAt,
		})),
	);
}

interface RawWorkflowRun {
	name: string;
	status: string;
	conclusion: string | null;
	headBranch: string;
}

export async function collectCIRuns(cwd: string): Promise<Result<GithubWorkflowRun[], GithubError>> {
	const result = await gh(
		["run", "list", "--json", "name,status,conclusion,headBranch", "--limit", "10"],
		cwd,
	);
	if (!result.ok) return result;

	const parsed = safeJsonParse<RawWorkflowRun[]>(result.value);
	if (!parsed.ok) return parsed;

	return ok(
		parsed.value.map((raw) => ({
			name: raw.name,
			status: raw.status,
			conclusion: raw.conclusion ?? null,
			head_branch: raw.headBranch,
			duration_seconds: null,
		})),
	);
}

interface RawRelease {
	tagName: string;
	name: string;
	publishedAt: string;
}

async function countCommitsSince(tag: string, cwd: string): Promise<number> {
	const proc = Bun.spawn(["git", "rev-list", `${tag}..HEAD`, "--count"], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
	});

	const stdout = await new Response(proc.stdout).text();
	await proc.exited;

	const count = parseInt(stdout.trim(), 10);
	return Number.isNaN(count) ? 0 : count;
}

export async function collectRelease(cwd: string): Promise<Result<GithubRelease | null, GithubError>> {
	const result = await gh(
		["release", "view", "--json", "tagName,publishedAt,name"],
		cwd,
	);
	if (!result.ok) {
		if (result.error.kind === "api_error" && result.error.cause.includes("no releases")) {
			return ok(null);
		}
		return result;
	}

	const parsed = safeJsonParse<RawRelease>(result.value);
	if (!parsed.ok) return parsed;

	const raw = parsed.value;
	const commits_since = await countCommitsSince(raw.tagName, cwd);

	return ok({
		tag_name: raw.tagName,
		name: raw.name,
		published_at: raw.publishedAt,
		commits_since,
	});
}

function isFatalError(error: GithubError): boolean {
	return error.kind === "gh_auth_required" || error.kind === "rate_limited" || error.kind === "gh_cli_not_found";
}

export async function collectGithubData(
	repo_path: string,
	remote_url: string | null,
): Promise<Result<GithubRepoData, GithubError>> {
	if (!isGithubRemote(remote_url)) return err({ kind: "not_github_repo" });
	if (!checkGhAvailable()) return err({ kind: "gh_cli_not_found" });

	const [prs_result, issues_result, ci_result, release_result] = await Promise.all([
		collectPRs(repo_path),
		collectIssues(repo_path),
		collectCIRuns(repo_path),
		collectRelease(repo_path),
	]);

	const results = [prs_result, issues_result, ci_result, release_result];
	const fatal = results.find((r) => !r.ok && isFatalError(r.error));
	if (fatal && !fatal.ok) return fatal as Result<never, GithubError>;

	return ok({
		prs: prs_result.ok ? prs_result.value : [],
		issues: issues_result.ok ? issues_result.value : [],
		ci_runs: ci_result.ok ? ci_result.value : [],
		latest_release: release_result.ok ? release_result.value : null,
	});
}
