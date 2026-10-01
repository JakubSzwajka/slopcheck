import { hitLines, type Rule } from "./rules.ts";
import type { Clone, LineRange, PrVerbosity, RuleHit } from "./types.ts";

export type ChangedSource = { path: string; code: Set<number>; added: Set<number> };

const key = (file: string, line: number) => `${file}:${line}`;

export function prVerbosity(files: ChangedSource[], hits: RuleHit[], clones: Clone[], rules: Rule[]): PrVerbosity {
	const byPath = new Map(files.map((file) => [file.path, file]));
	const isAddedCode = (file: string, line: number) => {
		const source = byPath.get(file);
		return source !== undefined && source.added.has(line) && source.code.has(line);
	};
	const flagged = new Set<string>();
	const perRule = new Map<string, Set<string>>();
	const keptHits: RuleHit[] = [];
	for (const hit of hits) {
		const source = byPath.get(hit.file);
		if (!source) continue;
		const lines = hitLines(hit, source.code).filter((line) => source.added.has(line));
		if (lines.length === 0) continue;
		keptHits.push(hit);
		const ruleLines = perRule.get(hit.rule) ?? new Set<string>();
		for (const line of lines) {
			flagged.add(key(hit.file, line));
			ruleLines.add(key(hit.file, line));
		}
		perRule.set(hit.rule, ruleLines);
	}
	const cloned = new Set<string>();
	const keptClones: Clone[] = [];
	for (const clone of clones) {
		const sides = [clone.a, clone.b].map((side) => addedLinesIn(side, isAddedCode));
		if (sides.every((lines) => lines.length === 0)) continue;
		for (const line of sides.flat()) cloned.add(line);
		// Put the side that touches added lines first, so the report reads "new code ≈ where it came from".
		keptClones.push(sides[0]?.length ? clone : { lines: clone.lines, a: clone.b, b: clone.a });
	}
	keptClones.sort((a, b) => b.lines - a.lines);
	const union = new Set([...flagged, ...cloned]);
	let addedLines = 0;
	let addedSloc = 0;
	for (const file of files) {
		addedLines += file.added.size;
		for (const line of file.added) if (file.code.has(line)) addedSloc++;
	}
	const summaries = rules
		.map((rule) => ({ id: rule.id, label: rule.label, lines: perRule.get(rule.id)?.size ?? 0 }))
		.filter((summary) => summary.lines > 0)
		.sort((a, b) => b.lines - a.lines);
	return {
		addedLines,
		addedSloc,
		flaggedLines: flagged.size,
		cloneLines: cloned.size,
		unionLines: union.size,
		ratio: addedSloc === 0 ? 0 : union.size / addedSloc,
		rules: summaries,
		hits: keptHits,
		clones: keptClones,
	};
}

function addedLinesIn(side: LineRange, isAddedCode: (file: string, line: number) => boolean): string[] {
	const lines: string[] = [];
	for (let line = side.start; line <= side.end; line++) if (isAddedCode(side.file, line)) lines.push(key(side.file, line));
	return lines;
}

export function snapshotVerbosity(code: Map<string, Set<number>>, flagged: Set<string>, clones: Clone[]): { lines: Set<string>; cloneLines: number } {
	const lines = new Set(flagged);
	const cloned = new Set<string>();
	for (const clone of clones) {
		for (const side of [clone.a, clone.b]) {
			const fileCode = code.get(side.file);
			if (!fileCode) continue;
			for (let line = side.start; line <= side.end; line++) {
				if (fileCode.has(line)) cloned.add(key(side.file, line));
			}
		}
	}
	for (const line of cloned) lines.add(line);
	return { lines, cloneLines: cloned.size };
}
