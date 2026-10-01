#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const limits = [
  { directory: "src", limit: 300 },
  { directory: "test", limit: 500 },
];

const offenses = [];
for (const rule of limits) {
  for (const path of await filesBelow(resolve(root, rule.directory))) {
    const lines = countLines(await readFile(path, "utf8"));
    if (lines > rule.limit) offenses.push({ path: relative(root, path), lines, limit: rule.limit });
  }
}

if (offenses.length > 0) {
  for (const offense of offenses.toSorted((left, right) => left.path.localeCompare(right.path))) {
    console.error(`${offense.path}: ${offense.lines} lines (limit ${offense.limit})`);
  }
  process.exitCode = 1;
} else {
  console.log("file size check passed");
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : entry.isFile() ? [path] : [];
    }),
  );
  return paths.flat();
}

function countLines(text) {
  if (text.length === 0) return 0;
  const newlineCount = text.match(/\n/g)?.length ?? 0;
  return newlineCount + (text.endsWith("\n") ? 0 : 1);
}
