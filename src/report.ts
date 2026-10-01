import type { ErosionChange, LineRange, Report } from "./types.ts";

const MAX_CLONES = 5;
const MAX_HITS = 6;

const SYMBOL: Record<ErosionChange["kind"], string> = {
  crossed: "✗",
  born: "✗",
  worse: "▲",
  improved: "✓",
};

export function formatLegend(ccThreshold: number): string {
  return `How to read this
  CC         1 + branches in one function: if, loops, case, catch, ?:, &&, ||, ??
             over ${ccThreshold} (--cc-threshold) is hard to change safely
  mass       CC × √lines, the complexity one function carries
  ✗          crossed over the threshold, or new and already over
  ▲          was over, and its mass grew
  ✓          dropped under the threshold
  flagged    added lines that match a waste rule (rules/*.yml)
  clone      added lines that copy code elsewhere in the repo
  Repo       erosion = share of mass in functions over the threshold
             verbosity = flagged or clone lines / all code lines
             both run 0 to 1, lower is better

`;
}

export function formatReport(report: Report): string {
  const head = report.head.sha ?? "WORKTREE";
  const lines = [
    `Slop check  base ${report.base.sha} → head ${head}   (${report.files.length} TS ${report.files.length === 1 ? "file" : "files"} changed)`,
  ];
  lines.push("Erosion", ...erosionLines(report));
  lines.push("Verbosity (added lines only)", ...verbosityLines(report));
  lines.push(repoLine(report));
  return `${lines.join("\n")}\n`;
}

function erosionLines(report: Report): string[] {
  const threshold = `CC>${report.ccThreshold}`;
  const { callables, maxCc, maxCcName } = report.touched;
  const touched =
    callables === 0
      ? "no callables new or changed"
      : `${callables} ${plural(callables, "callable")} new or changed, max CC ${maxCc} in ${maxCcName}`;
  if (report.erosion.length === 0)
    return [`  nothing crossed, grew over, or dropped under ${threshold}  (${touched})`];
  const rows = report.erosion.map((change) => {
    const { before, after } = change;
    const cc = before ? `CC ${before.cc} → ${after.cc}` : `CC ${after.cc}`;
    let massText = "";
    let note = "";
    switch (change.kind) {
      case "crossed":
        massText = `mass ${round(before?.mass)} → ${round(after.mass)}`;
        note = `now over ${threshold}`;
        break;
      case "born":
        massText = `mass ${round(after.mass)}`;
        note = `new, born over ${threshold}`;
        break;
      case "worse":
        massText = `mass +${delta(after.mass - (before?.mass ?? 0))}`;
        note = "already over, got worse";
        break;
      case "improved":
        note = "now under";
        break;
    }
    if (change.renamedFrom) note += ` (was ${change.renamedFrom})`;
    return [
      `${SYMBOL[change.kind]} ${change.name}${change.name.endsWith(">") ? "" : "()"}`,
      cc,
      massText,
      note,
      `${change.file}:${change.line}`,
    ];
  });
  return table(rows).map((row) => `  ${row}`);
}

function verbosityLines(report: Report): string[] {
  const v = report.verbosity;
  const out: string[] = [];
  const ruleList = v.rules.map((rule) => `${rule.label} ×${rule.lines}`).join(", ");
  out.push(
    `  ${v.flaggedLines} flagged ${plural(v.flaggedLines, "line")}${ruleList ? `  (${ruleList})` : ""}`,
  );
  for (const hit of v.hits.slice(0, MAX_HITS))
    out.push(`      ${hit.file}:${hit.start}  ${hit.rule}`);
  if (v.hits.length > MAX_HITS) out.push(`      … ${v.hits.length - MAX_HITS} more`);
  const cloneHead = `  ${v.cloneLines} clone ${plural(v.cloneLines, "line")}`;
  const clones = v.clones
    .slice(0, MAX_CLONES)
    .map((clone) => `${range(clone.a)} ≈ ${range(clone.b)}`);
  if (clones.length === 0) out.push(cloneHead);
  else {
    out.push(`${cloneHead}   ${clones[0]}`);
    const pad = " ".repeat(cloneHead.length + 3);
    for (const clone of clones.slice(1)) out.push(`${pad}${clone}`);
    if (v.clones.length > MAX_CLONES) out.push(`${pad}… ${v.clones.length - MAX_CLONES} more`);
  }
  out.push(`  ${v.unionLines} of ${v.addedSloc} added code lines flagged (${v.ratio.toFixed(3)})`);
  return out;
}

function repoLine(report: Report): string {
  if (!report.repo) return "Repo: skipped (--no-repo)";
  const { base, head } = report.repo;
  return `Repo: erosion ${base.erosion.toFixed(3)} → ${head.erosion.toFixed(3)}   verbosity ${base.verbosity.toFixed(3)} → ${head.verbosity.toFixed(3)}`;
}

function table(rows: string[][]): string[] {
  const widths: number[] = [];
  for (const row of rows)
    row.forEach((cell, index) => (widths[index] = Math.max(widths[index] ?? 0, [...cell].length)));
  return rows.map((row) =>
    row
      .map((cell, index) =>
        index === row.length - 1
          ? cell
          : cell + " ".repeat((widths[index] ?? 0) - [...cell].length),
      )
      .join("  ")
      .trimEnd(),
  );
}

function range(side: LineRange): string {
  return `${side.file}:${side.start}-${side.end}`;
}

function round(value: number | undefined): string {
  return String(Math.round(value ?? 0));
}

function delta(value: number): string {
  // One decimal below 10, so a small mass growth never reads as +0.
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
