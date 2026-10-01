import { parentPort, workerData } from "node:worker_threads";
import { Git, WORKTREE } from "./git.ts";
import { loadRules } from "./rules.ts";
import type { SnapshotJob } from "./snapshot.ts";
import { readTexts, snapshotMetrics } from "./snapshot.ts";

const job = workerData as SnapshotJob;
const texts =
  job.ref === WORKTREE
    ? readTexts(job.root, job.paths)
    : new Git(job.root).readBlobs(job.ref, job.paths);
parentPort?.postMessage(
  await snapshotMetrics(job.dir, texts, loadRules(), job.threshold, job.excludes, job.clones),
);
