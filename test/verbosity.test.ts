import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allLines, parseAddedLines } from "../src/diff.ts";
import { isIncluded } from "../src/paths.ts";
import { loadRules, runRules } from "../src/rules.ts";
import { parseSource } from "../src/source.ts";
import { prVerbosity, snapshotVerbosity } from "../src/verbosity.ts";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -3,0 +4,2 @@ function x() {
+  const y = 1;
+  return y;
@@ -10 +12 @@ other
-old
+new
@@ -20,3 +23,0 @@ gone
-a
-b
-c
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+one
+two
+three
diff --git a/src/old.ts b/src/renamed.ts
similarity index 90%
rename from src/old.ts
rename to src/renamed.ts
--- a/src/old.ts
+++ b/src/renamed.ts
@@ -5,0 +6 @@
+added
diff --git a/src/deleted.ts b/src/deleted.ts
deleted file mode 100644
--- a/src/deleted.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-x
-y
`;

describe("added lines from diff hunks", () => {
  it("reads head-side line numbers, including single-line and empty hunks, new and renamed files", () => {
    const added = parseAddedLines(DIFF);
    assert.deepEqual([...(added.get("src/a.ts") ?? [])], [4, 5, 12]);
    assert.deepEqual([...(added.get("src/new.ts") ?? [])], [1, 2, 3]);
    assert.deepEqual([...(added.get("src/renamed.ts") ?? [])], [6]);
    assert.equal(added.has("src/deleted.ts"), false);
  });

  it("treats every line of an untracked file as added", () => {
    assert.deepEqual([...allLines("a\nb\n")], [1, 2]);
    assert.deepEqual([...allLines("a\nb")], [1, 2]);
  });
});

describe("verbosity on added lines", () => {
  const rules = loadRules();
  const code = [
    "function old() {", // 1
    "\tconst x = compute();", // 2 (not added)
    "\treturn x;", // 3
    "}", // 4
    "function added() {", // 5
    "\tconst y = compute();", // 6 added
    "\treturn y;", // 7 added
    "}", // 8
    "", // 9 added, blank
    "const ok = flag ? true : false;", // 10 added
  ].join("\n");
  const src = parseSource("src/a.ts", code);
  const hits = runRules(src, rules);

  it("keeps only rule hits on added lines", () => {
    const result = prVerbosity(
      [{ path: "src/a.ts", code: src.code, added: new Set([5, 6, 7, 8, 9, 10]) }],
      hits,
      [],
      rules,
    );
    assert.equal(result.flaggedLines, 2);
    assert.deepEqual(
      result.hits.map((hit) => [hit.rule, hit.start]),
      [
        ["single-use-return-var", 6],
        ["ternary-bool", 10],
      ],
    );
    assert.equal(result.addedLines, 6);
    assert.equal(result.addedSloc, 5);
    assert.equal(result.ratio, 2 / 5);
  });

  it("keeps clones that overlap added lines, puts the added side first, and counts a line hit twice once", () => {
    const clones = [
      {
        lines: 4,
        a: { file: "src/b.ts", start: 1, end: 4 },
        b: { file: "src/a.ts", start: 5, end: 8 },
      },
      {
        lines: 4,
        a: { file: "src/a.ts", start: 1, end: 4 },
        b: { file: "src/c.ts", start: 1, end: 4 },
      },
    ];
    const result = prVerbosity(
      [{ path: "src/a.ts", code: src.code, added: new Set([5, 6, 7, 8, 9, 10]) }],
      hits,
      clones,
      rules,
    );
    assert.equal(result.clones.length, 1);
    assert.equal(result.clones[0]?.a.file, "src/a.ts");
    assert.equal(result.cloneLines, 4);
    assert.equal(result.unionLines, 5); // lines 5-8 cloned, 6 also flagged, plus line 10
  });

  it("computes whole-snapshot verbosity over code lines only", () => {
    const codeMap = new Map([["src/a.ts", src.code]]);
    const result = snapshotVerbosity(codeMap, new Set(["src/a.ts:2"]), [
      {
        lines: 3,
        a: { file: "src/a.ts", start: 1, end: 3 },
        b: { file: "src/a.ts", start: 8, end: 10 },
      },
    ]);
    assert.equal(result.cloneLines, 5); // 1, 2, 3, 8, 10 (9 is blank)
    assert.equal(result.lines.size, 5);
  });
});

describe("file filter", () => {
  it("keeps TS sources and drops declarations, vendored, built and generated paths", () => {
    const keep = ["src/a.ts", "src/b.tsx", "lib/c.mts", "lib/d.cts"];
    const drop = [
      "src/a.d.ts",
      "node_modules/x/a.ts",
      "pkg/dist/a.ts",
      "build/a.ts",
      "coverage/a.ts",
      "src/__generated__/a.ts",
      "src/a.js",
      "src/api.generated.ts",
    ];
    for (const path of keep) assert.equal(isIncluded(path, []), true, path);
    for (const path of drop) assert.equal(isIncluded(path, []), false, path);
  });

  it("applies --exclude globs", () => {
    assert.equal(isIncluded("src/a.test.ts", ["**/*.test.ts"]), false);
    assert.equal(isIncluded("src/a.test.ts", ["*.test.ts"]), false);
    assert.equal(isIncluded("tests/a.ts", ["tests/**"]), false);
    assert.equal(isIncluded("src/a.ts", ["tests/**"]), true);
  });
});
