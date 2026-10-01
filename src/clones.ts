import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { DEFAULT_EXCLUDES } from "./paths.ts";
import type { Clone } from "./types.ts";

type JscpdSide = { name: string; start: number; end: number };
type JscpdReport = { duplicates?: Array<{ lines?: number; firstFile: JscpdSide; secondFile: JscpdSide }> };

function jscpdEntry(): string {
	const require = createRequire(import.meta.url);
	return join(dirname(require.resolve("jscpd/package.json")), "run-jscpd.js");
}

/**
 * Exact clones among the TypeScript files under `dir`, with jscpd's default
 * size limits (50 tokens, 5 lines). Paths come back relative to `dir`.
 */
export async function findClones(scanDir: string, excludes: string[]): Promise<Clone[]> {
	// Resolve symlinks (macOS /var -> /private/var) so jscpd's absolute paths relativize cleanly.
	const dir = realpathSync(scanDir);
	const out = mkdtempSync(join(tmpdir(), "slopcheck-jscpd-"));
	try {
		const ignore = [...DEFAULT_EXCLUDES, ...excludes.map((glob) => (glob.startsWith("**/") ? glob : `**/${glob}`))].join(",");
		const args = [jscpdEntry(), dir, "--pattern", "**/*.{ts,tsx,mts,cts}", "--ignore", ignore, "--reporters", "json", "--output", out, "--silent", "--no-tips", "--absolute"];
		const result = await runNode(args, dir);
		if (result.status !== 0) throw new Error(`jscpd failed (exit ${result.status}): ${result.output.trim().slice(0, 500)}`);
		const report = JSON.parse(readFileSync(join(out, "jscpd-report.json"), "utf8")) as JscpdReport;
		const side = (file: JscpdSide) => ({ file: toRelative(dir, file.name), start: file.start, end: file.end });
		return (report.duplicates ?? []).map((dup) => ({ lines: dup.lines ?? dup.firstFile.end - dup.firstFile.start + 1, a: side(dup.firstFile), b: side(dup.secondFile) }));
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
}

/** Async so the main thread stays free (the progress spinner keeps turning). */
function runNode(args: string[], cwd: string): Promise<{ status: number | null; output: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, JSCPD_NO_TIPS: "1" } });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (status) => resolve({ status, output: stderr || stdout }));
	});
}

function toRelative(dir: string, name: string): string {
	return (isAbsolute(name) ? relative(dir, name) : name).split("\\").join("/");
}
