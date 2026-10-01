import { setImmediate as nextTurn } from "node:timers/promises";
import { extractCallables } from "./callables.ts";
import { findClones } from "./clones.ts";
import { allLines, parseAddedLines } from "./diff.ts";
import { classify, matchCallables, sortBySeverity, touchedPairs } from "./erosion.ts";
import { type ChangedFile, Git, GitError, WORKTREE } from "./git.ts";
import { archivePathspecs, isIncluded } from "./paths.ts";
import { loadRules, runRules } from "./rules.ts";
import { snapshotMetricsInWorker } from "./snapshot.ts";
import { parseSource } from "./source.ts";
import { makeTemp, removeTemps } from "./temp.ts";
import type { ErosionChange, Report, RuleHit, SnapshotMetrics } from "./types.ts";
import { type ChangedSource, prVerbosity } from "./verbosity.ts";

export type Options = {
  cwd: string;
  base: string | null;
  head: string;
  ccThreshold: number;
  excludes: string[];
  repo: boolean;
  onPhase?: (label: string) => void;
};

export async function analyze(options: Options): Promise<Report> {
  try {
    return await run(options);
  } finally {
    removeTemps();
  }
}

async function run(options: Options): Promise<Report> {
  const phase = options.onPhase ?? (() => {});
  phase("reading the diff");
  const git = new Git(options.cwd);
  const baseSha = options.base ? resolve(git, options.base) : git.defaultBase();
  const headRef = options.head === WORKTREE ? WORKTREE : resolve(git, options.head);
  const rules = loadRules();
  const include = (path: string) => isIncluded(path, options.excludes);

  const changed = git
    .changedFiles(baseSha, headRef)
    .filter((file) => file.status !== "D" && include(file.path));
  const untracked = new Set(
    changed.filter((file) => file.status === "A" && headRef === WORKTREE).map((file) => file.path),
  );
  const diffPaths = changed
    .filter((file) => !untracked.has(file.path))
    .flatMap((file) =>
      file.oldPath && file.oldPath !== file.path ? [file.oldPath, file.path] : [file.path],
    );
  const added = parseAddedLines(git.diffHunks(baseSha, headRef, diffPaths));

  const erosion: ErosionChange[] = [];
  const hits: RuleHit[] = [];
  const sources: ChangedSource[] = [];
  const touched: Report["touched"] = { callables: 0, maxCc: 0, maxCcName: null };
  for (const [index, file] of changed.entries()) {
    phase(
      `parsing ${changed.length} changed ${changed.length === 1 ? "file" : "files"} (${index} done)`,
    );
    await nextTurn(); // parsing is synchronous; yield so the spinner can draw between files
    const head = parseSource(file.path, await git.read(headRef, file.path));
    const baseText = readBase(git, baseSha, file);
    const before =
      baseText === null ? [] : extractCallables(parseSource(file.oldPath ?? file.path, baseText));
    const pairs = matchCallables(before, extractCallables(head));
    erosion.push(...classify(file.path, pairs, options.ccThreshold));
    for (const pair of touchedPairs(pairs)) {
      touched.callables++;
      if (pair.after.cc > touched.maxCc)
        Object.assign(touched, { maxCc: pair.after.cc, maxCcName: pair.after.key });
    }
    hits.push(...runRules(head, rules));
    sources.push({
      path: file.path,
      code: head.code,
      added: untracked.has(file.path) ? allLines(head.text) : (added.get(file.path) ?? new Set()),
    });
  }

  const headPaths = git.listFiles(headRef).filter(include);
  phase("extracting head files");
  const headDir = headRef === WORKTREE ? git.root : await extract(git, headRef, headPaths);
  phase("scanning clones");
  const headClones =
    changed.length === 0 && !options.repo
      ? []
      : (await findClones(headDir, options.excludes)).filter(
          (clone) => include(clone.a.file) && include(clone.b.file),
        );
  const verbosity = prVerbosity(sources, hits, headClones, rules);

  let repo: Report["repo"] = null;
  if (options.repo) {
    phase("extracting base files");
    const basePaths = git.listFiles(baseSha).filter(include);
    const baseDir = await extract(git, baseSha, basePaths);
    const job = { root: git.root, threshold: options.ccThreshold, excludes: options.excludes };
    const pending = new Set(["base", "head"]);
    const snapshot = async (side: string, metrics: Promise<SnapshotMetrics>) => {
      const done = await metrics;
      pending.delete(side);
      if (pending.size > 0) phase(`${[...pending][0]} snapshot (whole repo)`);
      return done;
    };
    phase("base and head snapshots (whole repo)");
    const base = snapshot(
      "base",
      snapshotMetricsInWorker({ ...job, dir: baseDir, ref: baseSha, paths: basePaths }),
    );
    const head = snapshot(
      "head",
      snapshotMetricsInWorker({
        ...job,
        dir: headDir,
        ref: headRef,
        paths: headPaths,
        clones: headClones,
      }),
    );
    const [baseMetrics, headMetrics] = await Promise.all([base, head]);
    repo = { base: baseMetrics, head: headMetrics };
  }

  return {
    base: { ref: options.base ?? "merge-base", sha: git.short(baseSha) },
    head: { ref: options.head, sha: headRef === WORKTREE ? null : git.short(headRef) },
    ccThreshold: options.ccThreshold,
    files: changed.map((file) => file.path),
    erosion: sortBySeverity(erosion),
    touched,
    verbosity,
    repo,
  };
}

function resolve(git: Git, ref: string): string {
  try {
    return git.sha(ref);
  } catch {
    throw new GitError(`unknown revision: ${ref}`);
  }
}

function readBase(git: Git, base: string, file: ChangedFile): string | null {
  if (!file.oldPath) return null;
  try {
    return git.show(base, file.oldPath);
  } catch {
    return null;
  }
}

async function extract(git: Git, ref: string, paths: string[]): Promise<string> {
  const dir = makeTemp("slopcheck-snapshot-");
  const pathspecs = archivePathspecs(paths);
  if (pathspecs.length > 0) await git.archive(ref, dir, pathspecs);
  return dir;
}
