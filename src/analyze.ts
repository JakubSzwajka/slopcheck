import { setImmediate as nextTurn } from "node:timers/promises";
import { extractCallables } from "./callables.ts";
import { findClones } from "./clones.ts";
import { allLines, parseAddedLines } from "./diff.ts";
import { classify, matchCallables, type Pair, sortBySeverity, touchedPairs } from "./erosion.ts";
import { type ChangedFile, Git, GitError, WORKTREE } from "./git.ts";
import { archivePathspecs, isIncluded } from "./paths.ts";
import { loadRules, type Rule, runRules } from "./rules.ts";
import { snapshotMetricsInWorker } from "./snapshot.ts";
import { parseSource } from "./source.ts";
import { makeTemp, removeTemps } from "./temp.ts";
import type { Clone, ErosionChange, Report, RuleHit, SnapshotMetrics } from "./types.ts";
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

type Context = {
  git: Git;
  baseSha: string;
  headRef: string;
  options: Options;
  rules: Rule[];
  include: (path: string) => boolean;
  phase: (label: string) => void;
};

type Changes = { files: ChangedFile[]; untracked: Set<string>; added: Map<string, Set<number>> };

type FileScan = {
  erosion: ErosionChange[];
  hits: RuleHit[];
  sources: ChangedSource[];
  touched: Report["touched"];
};

async function run(options: Options): Promise<Report> {
  const phase = options.onPhase ?? (() => {});
  phase("reading the diff");
  const git = new Git(options.cwd);
  const baseSha = options.base ? resolve(git, options.base) : git.defaultBase();
  const headRef = options.head === WORKTREE ? WORKTREE : resolve(git, options.head);
  const include = (path: string) => isIncluded(path, options.excludes);
  const context: Context = { git, baseSha, headRef, options, rules: loadRules(), include, phase };

  const changes = readChanges(context);
  const scan = await scanChangedFiles(context, changes);

  const headPaths = git.listFiles(headRef).filter(include);
  phase("extracting head files");
  const headDir = headRef === WORKTREE ? git.root : await extract(git, headRef, headPaths);
  phase("scanning clones");
  const headClones = await clonesAt(context, headDir, changes.files.length);
  const verbosity = prVerbosity(scan.sources, scan.hits, headClones, context.rules);
  const repo = options.repo
    ? await repoSnapshots(context, { dir: headDir, paths: headPaths, clones: headClones })
    : null;

  return {
    base: { ref: options.base ?? "merge-base", sha: git.short(baseSha) },
    head: { ref: options.head, sha: headRef === WORKTREE ? null : git.short(headRef) },
    ccThreshold: options.ccThreshold,
    files: changes.files.map((file) => file.path),
    erosion: sortBySeverity(scan.erosion),
    touched: scan.touched,
    verbosity,
    repo,
  };
}

function readChanges({ git, baseSha, headRef, include }: Context): Changes {
  const files = git
    .changedFiles(baseSha, headRef)
    .filter((file) => file.status !== "D" && include(file.path));
  const untracked = new Set(
    files.filter((file) => file.status === "A" && headRef === WORKTREE).map((file) => file.path),
  );
  const diffPaths = files.filter((file) => !untracked.has(file.path)).flatMap(diffPathsOf);
  return { files, untracked, added: parseAddedLines(git.diffHunks(baseSha, headRef, diffPaths)) };
}

function diffPathsOf(file: ChangedFile): string[] {
  // A renamed file needs both its old and new path in the diff pathspec, or git cannot pair them.
  return file.oldPath && file.oldPath !== file.path ? [file.oldPath, file.path] : [file.path];
}

async function scanChangedFiles(context: Context, changes: Changes): Promise<FileScan> {
  const scan: FileScan = {
    erosion: [],
    hits: [],
    sources: [],
    touched: { callables: 0, maxCc: 0, maxCcName: null },
  };
  const count = changes.files.length;
  for (const [index, file] of changes.files.entries()) {
    context.phase(`parsing ${count} changed ${count === 1 ? "file" : "files"} (${index} done)`);
    await nextTurn(); // parsing is synchronous; yield so the spinner can draw between files
    await scanFile(context, changes, file, scan);
  }
  return scan;
}

async function scanFile(
  context: Context,
  changes: Changes,
  file: ChangedFile,
  scan: FileScan,
): Promise<void> {
  const { git, baseSha, headRef } = context;
  const head = parseSource(file.path, await git.read(headRef, file.path));
  const baseText = readBase(git, baseSha, file);
  const before =
    baseText === null ? [] : extractCallables(parseSource(file.oldPath ?? file.path, baseText));
  const pairs = matchCallables(before, extractCallables(head));
  scan.erosion.push(...classify(file.path, pairs, context.options.ccThreshold));
  countTouched(scan.touched, pairs);
  scan.hits.push(...runRules(head, context.rules));
  const added = changes.untracked.has(file.path)
    ? allLines(head.text)
    : (changes.added.get(file.path) ?? new Set<number>());
  scan.sources.push({ path: file.path, code: head.code, added });
}

function countTouched(touched: Report["touched"], pairs: Pair[]): void {
  for (const pair of touchedPairs(pairs)) {
    touched.callables++;
    if (pair.after.cc > touched.maxCc)
      Object.assign(touched, { maxCc: pair.after.cc, maxCcName: pair.after.key });
  }
}

async function clonesAt(
  { options, include }: Context,
  headDir: string,
  changedCount: number,
): Promise<Clone[]> {
  if (changedCount === 0 && !options.repo) return [];
  const clones = await findClones(headDir, options.excludes);
  return clones.filter((clone) => include(clone.a.file) && include(clone.b.file));
}

async function repoSnapshots(
  context: Context,
  head: { dir: string; paths: string[]; clones: Clone[] },
): Promise<NonNullable<Report["repo"]>> {
  const { git, baseSha, headRef, options, phase } = context;
  phase("extracting base files");
  const basePaths = git.listFiles(baseSha).filter(context.include);
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
  const headMetrics = snapshot(
    "head",
    snapshotMetricsInWorker({
      ...job,
      dir: head.dir,
      ref: headRef,
      paths: head.paths,
      clones: head.clones,
    }),
  );
  const [baseResult, headResult] = await Promise.all([base, headMetrics]);
  return { base: baseResult, head: headResult };
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
