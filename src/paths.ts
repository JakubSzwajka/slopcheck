import { matchesGlob } from "node:path";

export const TS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

const NON_SOURCE_DIRS = new Set(["node_modules", "dist", "build", "coverage", "generated", "__generated__", ".generated"]);

export const DEFAULT_EXCLUDES = [...[...NON_SOURCE_DIRS].map((dir) => `**/${dir}/**`), "**/*.d.ts", "**/*.d.mts", "**/*.d.cts", "**/*.generated.ts", "**/*.gen.ts"];

export function isTypeScript(path: string): boolean {
	return TS_EXTENSIONS.some((ext) => path.endsWith(ext)) && !/\.d\.[mc]?ts$/.test(path);
}

export function isIncluded(path: string, excludes: string[]): boolean {
	if (!isTypeScript(path)) return false;
	const segments = path.split("/");
	if (segments.slice(0, -1).some((segment) => NON_SOURCE_DIRS.has(segment))) return false;
	if (/\.(generated|gen)\.[mc]?tsx?$/.test(path)) return false;
	return !excludes.some((glob) => matchesGlob(path, glob) || matchesGlob(path, `**/${glob}`));
}

export function archivePathspecs(paths: string[]): string[] {
	// Only extensions actually present: git archive fails on a pathspec that matches nothing.
	return TS_EXTENSIONS.filter((ext) => paths.some((path) => path.endsWith(ext))).map((ext) => `*${ext}`);
}
