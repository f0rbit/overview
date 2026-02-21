import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function run(args: string[], cwd: string): Promise<void> {
	const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" });
	const code = await proc.exited;
	if (code !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`Command failed: ${args.join(" ")}\n${stderr}`);
	}
}

export async function createTempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "overview-test-"));
}

export async function cleanupTempDir(dir: string): Promise<void> {
	await rm(dir, { recursive: true, force: true });
}

export async function initRepo(dir: string, name: string): Promise<string> {
	const repo_path = join(dir, name);
	await Bun.spawn(["mkdir", "-p", repo_path]).exited;
	await run(["git", "init"], repo_path);
	await run(["git", "config", "user.email", "test@test.com"], repo_path);
	await run(["git", "config", "user.name", "Test User"], repo_path);
	await Bun.write(join(repo_path, "README.md"), "# " + name);
	await run(["git", "add", "."], repo_path);
	await run(["git", "commit", "-m", "initial commit"], repo_path);
	return repo_path;
}

export async function addCommit(
	repoPath: string,
	filename: string,
	content: string,
	message: string,
): Promise<void> {
	await Bun.write(join(repoPath, filename), content);
	await run(["git", "add", filename], repoPath);
	await run(["git", "commit", "-m", message], repoPath);
}

export async function createBranch(repoPath: string, branchName: string): Promise<void> {
	await run(["git", "checkout", "-b", branchName], repoPath);
}

export async function modifyFile(repoPath: string, filename: string, content: string): Promise<void> {
	await Bun.write(join(repoPath, filename), content);
}

export async function addUntracked(repoPath: string, filename: string, content: string): Promise<void> {
	await Bun.write(join(repoPath, filename), content);
}

export async function stashChanges(repoPath: string): Promise<void> {
	await Bun.write(join(repoPath, "README.md"), "stash content");
	await run(["git", "stash"], repoPath);
}
