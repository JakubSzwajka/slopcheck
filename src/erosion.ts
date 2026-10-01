import type { Callable, ErosionChange, Metrics } from "./types.ts";

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
  const candidates: Array<{ score: number; before: Callable; after: Callable }> = [];
  for (const next of unmatchedAfter) {
    for (const previous of unmatchedBefore) {
      if (previous.kind !== next.kind) continue;
      const score = similarity(previous.body, next.body);
      if (score >= RENAME_SIMILARITY) candidates.push({ score, before: previous, after: next });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const renamed = new Map<Callable, Callable>();
  const taken = new Set<Callable>();
  for (const candidate of candidates) {
    if (renamed.has(candidate.after) || taken.has(candidate.before)) continue;
    renamed.set(candidate.after, candidate.before);
    taken.add(candidate.before);
  }
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
  const changes: ErosionChange[] = [];
  for (const pair of pairs) {
    const after = metrics(pair.after);
    const before = pair.before ? metrics(pair.before) : null;
    const overAfter = after.cc > threshold;
    const overBefore = before !== null && before.cc > threshold;
    let kind: ErosionChange["kind"] | null = null;
    if (overAfter && before === null) kind = "born";
    else if (overAfter && !overBefore) kind = "crossed";
    else if (overAfter && overBefore && after.mass > (before?.mass ?? 0)) kind = "worse";
    else if (!overAfter && overBefore) kind = "improved";
    if (!kind) continue;
    const change: ErosionChange = {
      kind,
      file,
      name: pair.after.key,
      line: pair.after.startLine,
      before,
      after,
    };
    if (pair.renamedFrom) change.renamedFrom = pair.renamedFrom;
    changes.push(change);
  }
  return changes;
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
