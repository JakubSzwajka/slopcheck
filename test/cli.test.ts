import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Report } from "../src/types.ts";

const BIN = fileURLToPath(new URL("./support/cli-entry.ts", import.meta.url));

function branchy(name: string, branches: number): string {
  // The name in every line keeps jscpd from seeing the fixtures as clones of each other.
  const lines = Array.from(
    { length: branches },
    (_, index) => `\tif (x === ${index}) total += "${name}-${index}".length;`,
  );
  return `export function ${name}(x: number): number {\n\tlet total = 0;\n${lines.join("\n")}\n\treturn total;\n}\n`;
}

const DUPLICATED = `export function tally(rows: number[]): number {
	let sum = 0;
	for (const row of rows) {
		const doubled = row * 2 + 1;
		const tripled = doubled * 3 - 7;
		sum += tripled > 10 ? tripled : doubled;
		sum -= Math.floor(sum / 1000) * 1000;
	}
	console.log("tally", sum, rows.length, rows[0], rows[rows.length - 1]);
	return sum;
}
`;

let repo = "";

function git(...args: string[]): string {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(path: string, text: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function slopcheck(...args: string[]) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd: repo, encoding: "utf8" });
}

function json(...args: string[]): Report {
  const result = slopcheck(...args, "--json");
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as Report;
}

before(() => {
  repo = mkdtempSync(join(tmpdir(), "slopcheck-test-repo-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  write("src/grow.ts", branchy("grow", 8));
  write("src/worse.ts", branchy("worse", 12));
  write("src/split.ts", branchy("split", 11));
  write("src/old-name.ts", `${branchy("moved", 12)}\nexport const keep = 1;\n`);
  write("src/types.d.ts", "export declare function x(): void;\n");
  git("add", ".");
  git("commit", "-q", "-m", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

  write("src/grow.ts", branchy("grow", 13));
  write("src/worse.ts", branchy("worse", 16));
  write("src/split.ts", branchy("split", 4));
  git("mv", "src/old-name.ts", "src/new-name.ts");
  write("src/new-name.ts", `${branchy("moved", 14)}\nexport const keep = 1;\n`);
  write("src/born.ts", `${branchy("born", 12)}\n${DUPLICATED}`);
  write("src/copy.ts", DUPLICATED.replace("tally", "tallyAgain"));
  write(
    "src/flag.ts",
    "export function single(): number {\n\tconst value = Math.random();\n\treturn value;\n}\n",
  );
  git("add", ".");
  git("commit", "-q", "-m", "head");
});

after(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("slopcheck CLI", () => {
  it("prints help and exits 0", () => {
    const result = slopcheck("--help");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /usage:/);
  });

  it("exits 2 on a usage error and on an unknown ref", () => {
    assert.equal(slopcheck("--bogus").status, 2);
    assert.equal(slopcheck("--cc-threshold", "x").status, 2);
    const unknown = slopcheck("no-such-ref", "HEAD");
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown revision: no-such-ref/);
  });

  it("reports erosion changes per callable, following a renamed file", () => {
    const report = json("HEAD~1", "HEAD", "--no-repo");
    const byName = Object.fromEntries(report.erosion.map((change) => [change.name, change]));
    assert.equal(byName.grow?.kind, "crossed");
    assert.deepEqual([byName.grow?.before?.cc, byName.grow?.after.cc], [9, 14]);
    assert.equal(byName.worse?.kind, "worse");
    assert.equal(byName.split?.kind, "improved");
    assert.equal(byName.born?.kind, "born");
    assert.equal(byName.moved?.kind, "worse", "renamed file keeps its base version");
    assert.equal(byName.moved?.file, "src/new-name.ts");
    assert.deepEqual(
      report.erosion.map((change) => change.kind),
      ["crossed", "born", "worse", "worse", "improved"],
    );
    assert.equal(report.files.includes("src/types.d.ts"), false);
    assert.equal(report.repo, null);
  });

  it("reports verbosity on added lines, with clones between two new files", () => {
    const report = json("HEAD~1", "HEAD", "--no-repo");
    assert.deepEqual(
      report.verbosity.hits.map((hit) => [hit.rule, hit.file, hit.start]),
      [["single-use-return-var", "src/flag.ts", 2]],
    );
    assert.ok(report.verbosity.clones.length >= 1, "expected the duplicated function to be found");
    const files = new Set(report.verbosity.clones.flatMap((clone) => [clone.a.file, clone.b.file]));
    assert.deepEqual([...files].sort(), ["src/born.ts", "src/copy.ts"]);
    assert.ok(report.verbosity.cloneLines >= 20);
  });

  it("defaults base to the merge-base with origin's default branch and adds the repo line", () => {
    const report = json("--cc-threshold", "10");
    assert.equal(report.base.sha, git("rev-parse", "--short", "HEAD~1"));
    assert.ok(report.repo);
    assert.ok(report.repo.head.erosion > report.repo.base.erosion);
    assert.ok(report.repo.head.verbosity > report.repo.base.verbosity);
    assert.equal(report.repo.base.files, 4);
  });

  it("prints the compact text report", () => {
    const result = slopcheck("HEAD~1", "HEAD", "--no-legend");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Slop check {2}base \w+ → head \w+/);
    assert.match(result.stdout, /✗ grow\(\)\s+CC 9 → 14\s+mass \d+ → \d+\s+now over CC>10/);
    assert.match(result.stdout, /▲ worse\(\)/);
    assert.match(result.stdout, /✓ split\(\)\s+CC 12 → 5/);
    assert.match(result.stdout, /1 flagged line {2}\(single-use var ×1\)/);
    assert.match(
      result.stdout,
      /clone lines {3}src\/(born|copy)\.ts:\d+-\d+ ≈ src\/(born|copy)\.ts:\d+-\d+/,
    );
    assert.match(
      result.stdout,
      /Repo: erosion \d\.\d{3} → \d\.\d{3} {3}verbosity \d\.\d{3} → \d\.\d{3}/,
    );
  });

  it("prints the legend before a text report by default, with the real threshold", () => {
    const result = slopcheck("HEAD~1", "HEAD", "--no-repo", "--cc-threshold", "12");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^How to read this\n/);
    assert.match(result.stdout, /over 12 \(--cc-threshold\)/);
    assert.ok(result.stdout.indexOf("How to read this") < result.stdout.indexOf("Slop check"));
    assert.doesNotMatch(result.stdout, /—/, "no em dashes in the legend");
  });

  it("hides the legend with --no-legend and with --json", () => {
    const plain = slopcheck("HEAD~1", "HEAD", "--no-repo", "--no-legend");
    assert.equal(plain.status, 0, plain.stderr);
    assert.match(plain.stdout, /^Slop check/);
    const asJson = slopcheck("HEAD~1", "HEAD", "--no-repo", "--json");
    assert.equal(asJson.status, 0, asJson.stderr);
    assert.doesNotMatch(asJson.stdout, /How to read this/);
    assert.doesNotThrow(() => JSON.parse(asJson.stdout));
  });

  it("writes no spinner bytes to stderr when stderr is not a terminal", () => {
    for (const args of [
      ["HEAD~1", "HEAD"],
      ["HEAD~1", "HEAD", "--json"],
    ]) {
      const result = slopcheck(...args);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "", `stderr for ${args.join(" ")}`);
      assert.doesNotMatch(result.stdout, /\x1b|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
    }
  });

  it("checks the uncommitted working tree with WORKTREE, including untracked files", () => {
    write("src/grow.ts", branchy("grow", 20));
    write("src/untracked.ts", branchy("fresh", 11));
    try {
      const report = json("HEAD", "WORKTREE", "--no-repo");
      assert.equal(report.head.sha, null);
      const byName = Object.fromEntries(report.erosion.map((change) => [change.name, change]));
      assert.equal(byName.grow?.kind, "worse");
      assert.equal(byName.fresh?.kind, "born");
    } finally {
      git("checkout", "-q", "--", "src/grow.ts");
      rmSync(join(repo, "src/untracked.ts"));
    }
  });

  it("leaves the repository and the temp dir clean", () => {
    const before = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("slopcheck-snapshot-"),
    ).length;
    slopcheck("HEAD~1", "HEAD");
    assert.equal(git("status", "--porcelain"), "");
    assert.equal(git("worktree", "list").split("\n").length, 1);
    const afterRun = readdirSync(tmpdir()).filter((name) =>
      name.startsWith("slopcheck-snapshot-"),
    ).length;
    assert.equal(afterRun, before);
  });
});
