import type { Callable, ErosionChange, ErosionChangeKind, Metrics } from "./types.ts";

export type Pair = { before: Callable | null; after: Callable; renamedFrom?: string };

const RENAME_SIMILARITY = 0.6;

export function erosion(
  callables: Array<Pick<Callable, "cc" | "mass">>,
  threshold: number,
): number {
  let total = 0;
  let over = 0;
  for (const callable of callables) {
    total += callable.mass;
    if (callable.cc > threshold) over += callable.mass;
  }
  return total === 0 ? 0 : over / total;
}

export function matchCallables(before: Callable[], after: Callable[]): Pair[] {
  const byKey = new Map(before.map((callable) => [callable.key, callable]));
  const pairs: Pair[] = [];
  const unmatchedAfter: Callable[] = [];
  const used = new Set<string>();
  for (const callable of after) {
    const match = byKey.get(callable.key);
    if (match) {
      pairs.push({ before: match, after: callable });
      used.add(match.key);
    } else unmatchedAfter.push(callable);
  }
  const unmatchedBefore = before.filter((callable) => !used.has(callable.key));
  // Leftovers pair by body similarity, so a renamed callable keeps its history.
  const renamed = pickRenames(renameCandidates(unmatchedBefore, unmatchedAfter));
  for (const callable of unmatchedAfter) {
    const previous = renamed.get(callable);
    pairs.push(
      previous
        ? { before: previous, after: callable, renamedFrom: previous.key }
        : { before: null, after: callable },
    );
  }
  return pairs;
}

type RenameCandidate = { score: number; before: Callable; after: Callable };

function renameCandidates(removed: Callable[], added: Callable[]): RenameCandidate[] {
  const candidates: RenameCandidate[] = [];
  for (const next of added) {
    for (const previous of removed) {
      if (previous.kind !== next.kind) continue;
      const score = similarity(previous.body, next.body);
      if (score >= RENAME_SIMILARITY) candidates.push({ score, before: previous, after: next });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function pickRenames(candidates: RenameCandidate[]): Map<Callable, Callable> {
  const renamed = new Map<Callable, Callable>();
  const taken = new Set<Callable>();
  for (const candidate of candidates) {
    if (renamed.has(candidate.after) || taken.has(candidate.before)) continue;
    renamed.set(candidate.after, candidate.before);
    taken.add(candidate.before);
  }
  return renamed;
}

export function similarity(a: string[], b: string[]): number {
  if (a.length < 2 || b.length < 2) return 0;
  const counts = new Map<string, number>();
  for (const line of a) counts.set(line, (counts.get(line) ?? 0) + 1);
  let shared = 0;
  for (const line of b) {
    const left = counts.get(line) ?? 0;
    if (left > 0) {
      shared++;
      counts.set(line, left - 1);
    }
  }
  // Dice coefficient over the two line multisets.
  return (2 * shared) / (a.length + b.length);
}

export function classify(file: string, pairs: Pair[], threshold: number): ErosionChange[] {
  return pairs.map((pair) => changeFor(file, pair, threshold)).filter((change) => change !== null);
}

function changeFor(file: string, pair: Pair, threshold: number): ErosionChange | null {
  const after = metrics(pair.after);
  const before = pair.before ? metrics(pair.before) : null;
  const kind = changeKind(before, after, threshold);
  if (!kind) return null;
  const change: ErosionChange = {
    kind,
    file,
    name: pair.after.key,
    line: pair.after.startLine,
    before,
    after,
  };
  if (pair.renamedFrom) change.renamedFrom = pair.renamedFrom;
  return change;
}

function changeKind(
  before: Metrics | null,
  after: Metrics,
  threshold: number,
): ErosionChangeKind | null {
  if (after.cc <= threshold) return before !== null && before.cc > threshold ? "improved" : null;
  if (before === null) return "born";
  if (before.cc <= threshold) return "crossed";
  return after.mass > before.mass ? "worse" : null;
}

export function touchedPairs(pairs: Pair[]): Pair[] {
  return pairs.filter(
    (pair) =>
      !pair.before || pair.before.cc !== pair.after.cc || pair.before.sloc !== pair.after.sloc,
  );
}

const RANK: Record<ErosionChange["kind"], number> = { crossed: 0, born: 1, worse: 2, improved: 3 };

export function sortBySeverity(changes: ErosionChange[]): ErosionChange[] {
  const delta = (change: ErosionChange) => Math.abs(change.after.mass - (change.before?.mass ?? 0));
  return changes.toSorted(
    (a, b) =>
      RANK[a.kind] - RANK[b.kind] ||
      delta(b) - delta(a) ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
}

function metrics(callable: Callable): Metrics {
  return { cc: callable.cc, sloc: callable.sloc, mass: callable.mass };
}
