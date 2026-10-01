#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const work = mkdtempSync(join(tmpdir(), "slopcheck-pack-smoke-"));

try {
  const packed = run("npm", ["pack", "--silent", "--pack-destination", work], root).trim();
  const tarball = join(work, packed.split("\n").at(-1) ?? "");

  const app = join(work, "app");
  mkdirSync(app);
  run("npm", ["init", "-y"], app);
  run("npm", ["install", "--no-audit", "--no-fund", tarball], app);
  const bin = join(app, "node_modules", ".bin", "slopcheck");

  const help = run(bin, ["--help"], app);
  if (!help.includes("slopcheck")) throw new Error(`unexpected --help output:\n${help}`);
  console.log("--help ok");

  const repo = join(work, "repo");
  mkdirSync(repo);
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.email", "smoke@example.com"],
    ["config", "user.name", "smoke"],
  ]) {
    run("git", args, repo);
  }
  writeFileSync(join(repo, "a.ts"), "export const one = 1;\n");
  commit(repo, "base");
  writeFileSync(
    join(repo, "a.ts"),
    "export function pick(x: number): number {\n  if (x > 1) return 1;\n  return 0;\n}\n",
  );
  commit(repo, "head");

  const report = JSON.parse(run(bin, ["HEAD~1", "HEAD", "--json"], repo));
  if (report.touched?.maxCcName !== "pick") {
    throw new Error(`unexpected diff report:\n${JSON.stringify(report)}`);
  }
  console.log(
    `diff run ok: ${report.files.length} file, max CC ${report.touched.maxCc} in ${report.touched.maxCcName}`,
  );
  console.log("pack smoke passed");
} finally {
  rmSync(work, { recursive: true, force: true });
}

function commit(repo, message) {
  run("git", ["add", "-A"], repo);
  run("git", ["commit", "-q", "-m", message], repo);
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}
