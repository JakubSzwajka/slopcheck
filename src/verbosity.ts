import { hitLines, type Rule } from "./rules.ts";
import type { Clone, LineRange, PrVerbosity, RuleHit, RuleSummary } from "./types.ts";

export type ChangedSource = { path: string; code: Set<number>; added: Set<number> };

const key = (file: string, line: number) => `${file}:${line}`;

export function prVerbosity(
  files: ChangedSource[],
  hits: RuleHit[],
  clones: Clone[],
  rules: Rule[],
): PrVerbosity {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const flagged = flaggedOnAdded(byPath, hits);
  const cloned = clonesOnAdded(byPath, clones);
  const union = new Set([...flagged.lines, ...cloned.lines]);
  const { addedLines, addedSloc } = countAdded(files);
  return {
    addedLines,
    addedSloc,
    flaggedLines: flagged.lines.size,
    cloneLines: cloned.lines.size,
    unionLines: union.size,
    ratio: addedSloc === 0 ? 0 : union.size / addedSloc,
    rules: ruleSummaries(rules, flagged.perRule),
    hits: flagged.hits,
    clones: cloned.clones,
  };
}

function flaggedOnAdded(
  byPath: Map<string, ChangedSource>,
  hits: RuleHit[],
): { lines: Set<string>; perRule: Map<string, Set<string>>; hits: RuleHit[] } {
  const lines = new Set<string>();
  const perRule = new Map<string, Set<string>>();
  const kept: RuleHit[] = [];
  for (const hit of hits) {
    const source = byPath.get(hit.file);
    if (!source) continue;
    const added = hitLines(hit, source.code).filter((line) => source.added.has(line));
    if (added.length === 0) continue;
    kept.push(hit);
    const ruleLines = perRule.get(hit.rule) ?? new Set<string>();
    for (const line of added) {
      lines.add(key(hit.file, line));
      ruleLines.add(key(hit.file, line));
    }
    perRule.set(hit.rule, ruleLines);
  }
  return { lines, perRule, hits: kept };
}

function clonesOnAdded(
  byPath: Map<string, ChangedSource>,
  clones: Clone[],
): { lines: Set<string>; clones: Clone[] } {
  const isAddedCode = (file: string, line: number) => {
    const source = byPath.get(file);
    return source !== undefined && source.added.has(line) && source.code.has(line);
  };
  const lines = new Set<string>();
  const kept: Clone[] = [];
  for (const clone of clones) {
    const sides = [clone.a, clone.b].map((side) => addedLinesIn(side, isAddedCode));
    if (sides.every((sideLines) => sideLines.length === 0)) continue;
    for (const line of sides.flat()) lines.add(line);
    // Put the side that touches added lines first, so the report reads "new code ≈ where it came from".
    kept.push(sides[0]?.length ? clone : { lines: clone.lines, a: clone.b, b: clone.a });
  }
  kept.sort((a, b) => b.lines - a.lines);
  return { lines, clones: kept };
}

function countAdded(files: ChangedSource[]): { addedLines: number; addedSloc: number } {
  let addedLines = 0;
  let addedSloc = 0;
  for (const file of files) {
    addedLines += file.added.size;
    for (const line of file.added) if (file.code.has(line)) addedSloc++;
  }
  return { addedLines, addedSloc };
}

function ruleSummaries(rules: Rule[], perRule: Map<string, Set<string>>): RuleSummary[] {
  return rules
    .map((rule) => ({ id: rule.id, label: rule.label, lines: perRule.get(rule.id)?.size ?? 0 }))
    .filter((summary) => summary.lines > 0)
    .sort((a, b) => b.lines - a.lines);
}

function addedLinesIn(
  side: LineRange,
  isAddedCode: (file: string, line: number) => boolean,
): string[] {
  const lines: string[] = [];
  for (let line = side.start; line <= side.end; line++)
    if (isAddedCode(side.file, line)) lines.push(key(side.file, line));
  return lines;
}

export function snapshotVerbosity(
  code: Map<string, Set<number>>,
  flagged: Set<string>,
  clones: Clone[],
): { lines: Set<string>; cloneLines: number } {
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
