import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractCallables, mass } from "../src/callables.ts";
import { classify, erosion, matchCallables, similarity, sortBySeverity } from "../src/erosion.ts";
import { parseSource } from "../src/source.ts";
import type { Callable } from "../src/types.ts";

function callable(key: string, cc: number, sloc: number, body: string[] = []): Callable {
  return {
    key,
    name: key,
    kind: "function_declaration",
    startLine: 1,
    endLine: sloc,
    cc,
    sloc,
    mass: mass(cc, sloc),
    body,
  };
}

const parsed = (code: string) => extractCallables(parseSource("file.ts", code));

describe("mass and erosion", () => {
  it("matches the hand-computed fixture: 250 / 272", () => {
    const fixture = [callable("a", 4, 16), callable("b", 2, 9), callable("c", 25, 100)];
    assert.deepEqual(
      fixture.map((f) => f.mass),
      [16, 6, 250],
    );
    assert.equal(erosion(fixture, 10), 250 / 272);
  });

  it("uses a strict CC > threshold, and the threshold is configurable", () => {
    const fixture = [callable("a", 10, 4), callable("b", 11, 4)];
    assert.equal(erosion(fixture, 10), 44 / 84);
    assert.equal(erosion(fixture, 9), 1);
    assert.equal(erosion(fixture, 11), 0);
  });

  it("is 0 with no callables", () => {
    assert.equal(erosion([], 10), 0);
  });
});

describe("matching callables between base and head", () => {
  it("matches by qualified key", () => {
    const pairs = matchCallables(
      [callable("A.run", 3, 4)],
      [callable("A.run", 5, 6), callable("fresh", 1, 1)],
    );
    assert.deepEqual(
      pairs.map((pair) => [pair.after.key, pair.before?.key ?? null]),
      [
        ["A.run", "A.run"],
        ["fresh", null],
      ],
    );
  });

  it("pairs a renamed function with its old self by body similarity", () => {
    const before = parsed(
      "function findMatch(xs) {\n\tconst out = [];\n\tfor (const x of xs) {\n\t\tif (x.ok) out.push(x);\n\t}\n\treturn out;\n}\n",
    );
    const after = parsed(
      "function findMatches(xs) {\n\tconst out = [];\n\tfor (const x of xs) {\n\t\tif (x.ok && x.live) out.push(x);\n\t}\n\treturn out;\n}\n",
    );
    const [pair] = matchCallables(before, after);
    assert.equal(pair?.before?.key, "findMatch");
    assert.equal(pair?.renamedFrom, "findMatch");
  });

  it("does not pair unrelated functions", () => {
    const before = parsed("function a(x) {\n\tconst y = x + 1;\n\treturn y * 2;\n}\n");
    const after = parsed("function b(s) {\n\tlog(s);\n\tthrow new Error(s);\n}\n");
    assert.equal(matchCallables(before, after)[0]?.before, null);
  });

  it("keeps anonymous callbacks matched when an unrelated callback is added elsewhere", () => {
    const before = parsed(`describe("x", () => {\n\tit("a", () => { if (p) q(); });\n});\n`);
    const after = parsed(
      `setup(() => {});\ndescribe("x", () => {\n\tit("new", () => {});\n\tit("a", () => { if (p) q(); if (r) s(); });\n});\n`,
    );
    const pair = matchCallables(before, after).find(
      (candidate) => candidate.after.key === '<describe("x") cb>.<it("a") cb>',
    );
    assert.equal(pair?.before?.cc, 2);
    assert.equal(pair?.after.cc, 3);
  });

  it("scores similarity as the Dice coefficient of body lines", () => {
    assert.equal(similarity(["a", "b", "c", "d"], ["a", "b", "c", "x"]), 0.75);
    assert.equal(similarity(["a"], ["a"]), 0);
  });
});

describe("classifying erosion changes", () => {
  const pairs = [
    { before: callable("crosses", 9, 9), after: callable("crosses", 14, 25) },
    { before: callable("worse", 12, 9), after: callable("worse", 15, 16) },
    { before: callable("same", 12, 9), after: callable("same", 12, 9) },
    { before: callable("split", 11, 16), after: callable("split", 6, 9) },
    { before: null, after: callable("born", 11, 4) },
    { before: null, after: callable("small", 3, 4) },
  ];

  it("reports crossed, born over, got worse and dropped under, in that order", () => {
    const changes = sortBySeverity(classify("a.ts", pairs, 10));
    assert.deepEqual(
      changes.map((change) => [change.kind, change.name]),
      [
        ["crossed", "crosses"],
        ["born", "born"],
        ["worse", "worse"],
        ["improved", "split"],
      ],
    );
    assert.deepEqual(changes[0]?.before, { cc: 9, sloc: 9, mass: 27 });
    assert.deepEqual(changes[0]?.after, { cc: 14, sloc: 25, mass: 70 });
  });

  it("honours a different threshold", () => {
    const kinds = classify("a.ts", pairs, 13).map((change) => `${change.kind}:${change.name}`);
    assert.deepEqual(kinds.sort(), ["crossed:crosses", "crossed:worse"]);
  });
});
