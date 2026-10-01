import { matchesGlob } from "node:path";

export const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/** Directory names that never hold hand-written source. */
const SKIPPED_DIRS = new Set(["node_modules", "dist", "build", "coverage", "generated", "__generated__", ".generated"]);

/** Globs always excluded, on top of the user's `--exclude`. Also passed to jscpd. */
export const DEFAULT_EXCLUDES = [...[...SKIPPED_DIRS].map((dir) => `**/${dir}/**`), "**/*.d.ts", "**/*.d.mts", "**/*.d.cts", "**/*.generated.ts", "**/*.gen.ts"];

export function isTypeScript(path: string): boolean {
	return TS_EXTENSIONS.some((ext) => path.endsWith(ext)) && !/\.d\.[mc]?ts$/.test(path);
}

/** True for a TypeScript source path that no default or user exclude removes. */
export function isIncluded(path: string, excludes: string[]): boolean {
	if (!isTypeScript(path)) return false;
	const segments = path.split("/");
	if (segments.slice(0, -1).some((segment) => SKIPPED_DIRS.has(segment))) return false;
	if (/\.(generated|gen)\.[mc]?tsx?$/.test(path)) return false;
	return !excludes.some((glob) => matchesGlob(path, glob) || matchesGlob(path, `**/${glob}`));
}

/** Pathspecs for `git archive`, one per extension actually present, since a pathspec with no match is an error. */
export function archivePathspecs(paths: string[]): string[] {
	return TS_EXTENSIONS.filter((ext) => paths.some((path) => path.endsWith(ext))).map((ext) => `*${ext}`);
}
