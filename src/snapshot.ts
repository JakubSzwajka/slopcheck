import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { extractCallables } from "./callables.ts";
import { findClones } from "./clones.ts";
import { erosion } from "./erosion.ts";
import { type Rule, runRules } from "./rules.ts";
import { parseSource } from "./source.ts";
import type { Clone, SnapshotMetrics } from "./types.ts";
import { snapshotVerbosity } from "./verbosity.ts";

export async function snapshotMetrics(dir: string, texts: Map<string, string>, rules: Rule[], threshold: number, excludes: string[], clones?: Clone[]): Promise<SnapshotMetrics> {
	// Callers pass clones when jscpd already ran on the same tree.
	const allClones = clones ?? (await findClones(dir, excludes));
	const code = new Map<string, Set<number>>();
	const flagged = new Set<string>();
	const masses: Array<{ cc: number; mass: number }> = [];
	let sloc = 0;
	for (const [path, text] of texts) {
		const src = parseSource(path, text);
		code.set(path, src.code);
		sloc += src.code.size;
		for (const callable of extractCallables(src)) masses.push({ cc: callable.cc, mass: callable.mass });
		for (const hit of runRules(src, rules)) {
			for (let line = hit.start; line <= hit.end; line++) if (src.code.has(line)) flagged.add(`${path}:${line}`);
		}
	}
	const found = allClones.filter((clone) => code.has(clone.a.file) && code.has(clone.b.file));
	const verbosity = snapshotVerbosity(code, flagged, found);
	return {
		files: code.size,
		callables: masses.length,
		sloc,
		erosion: erosion(masses, threshold),
		verbosity: sloc === 0 ? 0 : verbosity.lines.size / sloc,
		flaggedLines: flagged.size,
		cloneLines: verbosity.cloneLines,
	};
}

export function readTexts(root: string, paths: string[]): Map<string, string> {
	const texts = new Map<string, string>();
	for (const path of paths) {
		try {
			texts.set(path, readFileSync(join(root, path), "utf8"));
		} catch {
			// deleted in the working tree
		}
	}
	return texts;
}

export type SnapshotJob = { root: string; ref: string; paths: string[]; dir: string; threshold: number; excludes: string[]; clones?: Clone[] };

export function snapshotMetricsInWorker(job: SnapshotJob): Promise<SnapshotMetrics> {
	// One worker each for base and head, so they run side by side and the main thread stays free for the spinner.
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL("./snapshot-worker.ts", import.meta.url), { workerData: job });
		worker.once("message", (metrics: SnapshotMetrics) => resolve(metrics));
		worker.once("error", reject);
		worker.once("exit", (code) => {
			if (code !== 0) reject(new Error(`snapshot worker exited with code ${code}`));
		});
	});
}
