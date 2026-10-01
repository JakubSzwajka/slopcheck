import { spawn, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const WORKTREE = "WORKTREE";

export type ChangedFile = { path: string; oldPath: string | null; status: string };

export class GitError extends Error {}

export class Git {
	readonly root: string;

	constructor(cwd: string) {
		this.root = run(cwd, ["rev-parse", "--show-toplevel"]).trim();
	}

	run(args: string[]): string {
		return run(this.root, args);
	}

	sha(ref: string): string {
		return this.run(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
	}

	short(sha: string): string {
		return this.run(["rev-parse", "--short", sha]).trim();
	}

	/** Merge-base of HEAD with origin's default branch. */
	defaultBase(): string {
		const candidates = ["origin/HEAD", "origin/main", "origin/master"];
		for (const ref of candidates) {
			const ok = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: this.root }).status === 0;
			if (ok) return this.run(["merge-base", "HEAD", ref]).trim();
		}
		throw new GitError("cannot find origin's default branch; pass a base ref");
	}

	/** Range arguments for diff: `base head`, or just `base` against the working tree. */
	private range(base: string, head: string): string[] {
		return head === WORKTREE ? [base] : [base, head];
	}

	changedFiles(base: string, head: string): ChangedFile[] {
		const out = this.run(["diff", "--name-status", "-z", "-M", "--no-ext-diff", ...this.range(base, head)]);
		const parts = out.split("\0").filter(Boolean);
		const files: ChangedFile[] = [];
		for (let index = 0; index < parts.length; ) {
			const status = parts[index++] ?? "";
			if (status.startsWith("R") || status.startsWith("C")) {
				const oldPath = parts[index++] ?? "";
				const path = parts[index++] ?? "";
				files.push({ status: status[0] ?? "R", path, oldPath: status.startsWith("R") ? oldPath : null });
			} else {
				const path = parts[index++] ?? "";
				files.push({ status: status[0] ?? "M", path, oldPath: status.startsWith("A") ? null : path });
			}
		}
		if (head === WORKTREE) {
			for (const path of this.untracked()) files.push({ status: "A", path, oldPath: null });
		}
		return files;
	}

	untracked(): string[] {
		return this.run(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
	}

	/** Unified diff with no context, for reading added-line numbers from hunk headers. */
	diffHunks(base: string, head: string, paths: string[]): string {
		if (paths.length === 0) return "";
		return this.run(["diff", "-U0", "-M", "--no-color", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", ...this.range(base, head), "--", ...paths]);
	}

	show(ref: string, path: string): string {
		return this.run(["show", `${ref}:${path}`]);
	}

	async read(ref: string, path: string): Promise<string> {
		return ref === WORKTREE ? readFile(join(this.root, path), "utf8") : this.show(ref, path);
	}

	readBlobs(ref: string, paths: string[]): Map<string, string> {
		const blobs = new Map<string, string>();
		if (paths.length === 0) return blobs;
		// Reading blobs from git avoids the first-read cost of freshly extracted files.
		const input = paths.map((path) => `${ref}:${path}\n`).join("");
		const result = spawnSync("git", ["cat-file", "--batch"], { cwd: this.root, input, maxBuffer: 2 * 1024 * 1024 * 1024 });
		if (result.status !== 0) throw new GitError(`git cat-file --batch: ${result.stderr.toString().trim()}`);
		const out = result.stdout;
		let offset = 0;
		for (const path of paths) {
			const newline = out.indexOf(10, offset);
			const header = out.subarray(offset, newline).toString();
			offset = newline + 1;
			const match = /^\S+ (\S+) (\d+)$/.exec(header);
			if (!match) continue; // "<ref:path> missing"
			const size = Number(match[2]);
			if (match[1] === "blob") blobs.set(path, out.subarray(offset, offset + size).toString("utf8"));
			offset += size + 1;
		}
		return blobs;
	}

	/** Tracked paths at a ref, or tracked plus untracked-not-ignored for the working tree. */
	listFiles(ref: string): string[] {
		const tracked = ref === WORKTREE ? this.run(["ls-files", "-z"]) : this.run(["ls-tree", "-r", "-z", "--name-only", ref]);
		const files = tracked.split("\0").filter(Boolean);
		return ref === WORKTREE ? [...files, ...this.untracked()] : files;
	}

	/** `git archive ref -- pathspecs | tar -x -C dir`. Never checks anything out. */
	archive(ref: string, dir: string, pathspecs: string[]): Promise<void> {
		return new Promise((resolve, reject) => {
			const git = spawn("git", ["archive", "--format=tar", ref, "--", ...pathspecs], { cwd: this.root, stdio: ["ignore", "pipe", "pipe"] });
			const tar = spawn("tar", ["-x", "-f", "-", "-C", dir], { stdio: ["pipe", "ignore", "pipe"] });
			let stderr = "";
			git.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			tar.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			git.stdout.pipe(tar.stdin);
			let pending = 2;
			let failed = false;
			const done = (code: number | null) => {
				if (code !== 0) failed = true;
				if (--pending > 0) return;
				if (failed) reject(new GitError(`git archive ${ref} failed: ${stderr.trim()}`));
				else resolve();
			};
			git.on("close", done);
			tar.on("close", done);
			git.on("error", reject);
			tar.on("error", reject);
		});
	}
}

function run(cwd: string, args: string[]): string {
	const result = spawnSync("git", ["-c", "core.quotePath=false", ...args], { cwd, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
	if (result.error) throw new GitError(`git ${args[0]}: ${result.error.message}`);
	if (result.status !== 0) throw new GitError(`git ${args.join(" ")}: ${result.stderr.trim() || `exit ${result.status}`}`);
	return result.stdout;
}
