import { analyze } from "./analyze.ts";
import { parseArgs, UsageError } from "./args.ts";
import { type Progress, progressFor, silentProgress } from "./progress.ts";
import { formatLegend, formatReport } from "./report.ts";

export const HELP = `slopcheck: per-PR structural erosion and verbosity for TypeScript

usage:
  slopcheck [base] [head] [--cc-threshold N] [--exclude GLOB]... [--no-repo] [--no-legend] [--json]

  base   defaults to the merge-base of HEAD with origin's default branch
  head   defaults to HEAD; WORKTREE means the uncommitted working tree

options:
  --cc-threshold N  a callable with CC above N counts as eroded (default 10)
  --exclude GLOB    skip matching paths (repeatable), e.g. --exclude '**/*.test.ts'
  --no-repo         skip the whole-repo line at base and head (the slow part)
  --no-legend       skip the "How to read this" key printed before a text report
  --json            print the report as JSON (no key, no progress spinner)
  -h, --help        show this help

Run it inside a git repo. It is advisory: exit 0 on success, 2 on a usage or
runtime error, never a failing code for a bad score.
`;

export async function main(argv: string[]): Promise<void> {
  let progress: Progress = silentProgress;
  try {
    const args = parseArgs(argv);
    if (args.help) {
      process.stdout.write(HELP);
      return;
    }
    if (!args.json) {
      if (args.legend) process.stdout.write(formatLegend(args.ccThreshold));
      progress = progressFor(process.stderr);
    }
    const report = await analyze({
      cwd: process.cwd(),
      base: args.base,
      head: args.head,
      ccThreshold: args.ccThreshold,
      excludes: args.excludes,
      repo: args.repo,
      onPhase: progress.phase,
    });
    progress.stop();
    process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  } catch (error) {
    progress.stop();
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`slopcheck: ${message}\n`);
    if (error instanceof UsageError) process.stderr.write("run slopcheck --help for usage\n");
    process.exitCode = 2;
  }
}
