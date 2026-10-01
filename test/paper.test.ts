import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { extractCallables, mass } from "../src/callables.ts";
import { findClones } from "../src/clones.ts";
import { erosion } from "../src/erosion.ts";
import { loadRules, runRules } from "../src/rules.ts";
import { snapshotMetrics } from "../src/snapshot.ts";
import { parseSource, type Source } from "../src/source.ts";
import type { Callable } from "../src/types.ts";
import { prVerbosity } from "../src/verbosity.ts";

const FIXTURES = fileURLToPath(new URL("./fixtures/paper/", import.meta.url));
const fixture = (path: string) => readFileSync(`${FIXTURES}${path}`, "utf8");
const callablesOf = (code: string) => extractCallables(parseSource("file.ts", code));
const erosionOf = (code: string) => erosion(callablesOf(code), 10);
const totalCc = (callables: Callable[]) =>
  callables.reduce((sum, callable) => sum + callable.cc, 0);
const totalSloc = (callables: Callable[]) =>
  callables.reduce((sum, callable) => sum + callable.sloc, 0);
const rules = loadRules();

function branchy(name: string, branches: number): string {
  // CC = 1 + branches, SLOC = branches + 4; every line is unique so jscpd finds no clone.
  const lines = Array.from(
    { length: branches },
    (_, index) => `\tif (x === ${index}) total += "${name}-${index}".length;`,
  );
  return `export function ${name}(x: number): number {\n\tlet total = 0;\n${lines.join("\n")}\n\treturn total;\n}\n`;
}

function callable(
  key: string,
  cc: number,
  sloc: number,
): Pick<Callable, "cc" | "mass"> & { key: string } {
  return { key, cc, mass: mass(cc, sloc) };
}

function fileVerbosity(src: Source, clones: Parameters<typeof prVerbosity>[2] = []) {
  // Every line counts as added, so this runs the real PR path over the whole file.
  const added = new Set(src.text.split("\n").map((_, index) => index + 1));
  return prVerbosity(
    [{ path: src.path, code: src.code, added }],
    runRules(src, rules),
    clones,
    rules,
  );
}

const lineOf = (text: string, needle: string) =>
  text.split("\n").findIndex((line) => line.includes(needle)) + 1;

describe("eq. 2: mass(f) = CC(f) × √SLOC(f), the square root lets complexity dominate", () => {
  it("eq. 2: doubling CC doubles mass", () => {
    for (const [cc, sloc] of [
      [1, 1],
      [3, 7],
      [11, 40],
    ] as const) {
      assert.equal(mass(2 * cc, sloc), 2 * mass(cc, sloc));
    }
  });

  it("eq. 2: quadrupling SLOC only doubles mass", () => {
    for (const [cc, sloc] of [
      [1, 1],
      [3, 9],
      [11, 25],
    ] as const) {
      assert.equal(mass(cc, 4 * sloc), 2 * mass(cc, sloc));
    }
  });

  it("eq. 2: from the same callable, growing CC moves mass more than growing length by the same factor", () => {
    const base = mass(5, 16);
    assert.equal(base, 20);
    assert.equal(mass(10, 16), 40); // CC × 2 → mass × 2
    assert.equal(mass(5, 32), 20 * Math.SQRT2); // SLOC × 2 → mass × √2
    assert.ok(mass(10, 16) > mass(5, 32));
  });
});

describe("eq. 3: erosion = mass share of callables with CC > 10", () => {
  it("eq. 3: strictly over the threshold, CC 10 is out and CC 11 is in", () => {
    assert.equal(erosionOf(branchy("at", 9)), 0);
    assert.equal(erosionOf(branchy("over", 10)), 1);
  });

  it("eq. 3: no callable over the threshold gives 0, every callable over gives 1, a mix lands strictly between", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const fixture = Array.from({ length: 1 + (seed % 6) }, (_, index) =>
        callable(`f${index}`, 1 + ((seed * (index + 3) * 7) % 25), 1 + ((seed * (index + 5)) % 60)),
      );
      const over = fixture.filter((f) => f.cc > 10).length;
      const value = erosion(fixture, 10);
      assert.ok(value >= 0 && value <= 1, `erosion ${value} out of [0,1] for seed ${seed}`);
      if (over === 0) assert.equal(value, 0, `seed ${seed}`);
      else if (over === fixture.length) assert.equal(value, 1, `seed ${seed}`);
      else assert.ok(value > 0 && value < 1, `seed ${seed}`);
    }
  });
});

describe("§2.3, §5: erosion measures concentration, not the amount of complexity", () => {
  const packed = [
    branchy("packed", 10),
    ...[1, 2, 3, 4].map((index) => branchy(`flat${index}`, 0)),
  ].join("\n");
  const spread = [1, 2, 3, 4, 5].map((index) => branchy(`part${index}`, 2)).join("\n");

  it("§2.3: equal total CC, function count and SLOC; branches packed into one function score higher erosion than spread out", () => {
    const [a, b] = [callablesOf(packed), callablesOf(spread)];
    assert.deepEqual([a.length, totalCc(a), totalSloc(a)], [b.length, totalCc(b), totalSloc(b)]);
    assert.equal(erosion(b, 10), 0);
    assert.ok(erosion(a, 10) > erosion(b, 10));
  });

  it("§5: aggregate complexity may fall while concentration worsens", () => {
    const before = callablesOf([1, 2, 3, 4].map((index) => branchy(`step${index}`, 5)).join("\n"));
    const after = callablesOf(
      [branchy("merged", 11), ...[1, 2, 3].map((index) => branchy(`stub${index}`, 0))].join("\n"),
    );
    assert.ok(totalCc(after) < totalCc(before), `total CC ${totalCc(before)} → ${totalCc(after)}`);
    assert.ok(erosion(after, 10) > erosion(before, 10));
  });
});

describe("Listing 1: findMatches over 5 checkpoints of code_search", () => {
  const trajectory = (shape: string) =>
    [1, 2, 3, 4, 5].map((step) => erosionOf(fixture(`listing1/${shape}-c${step}.ts`)));

  it("Listing 1: each new rule kind as an else-if branch in findMatches; erosion never drops and ends above 0", () => {
    const values = trajectory("chain");
    for (let step = 1; step < values.length; step++) {
      assert.ok(
        (values[step] ?? 0) >= (values[step - 1] ?? 0),
        `erosion fell at C${step + 1}: ${values.join(", ")}`,
      );
    }
    assert.ok((values.at(-1) ?? 0) > 0, `final erosion ${values.at(-1)}`);
  });

  it("Listing 1: each new rule kind as its own handler in a lookup table; erosion stays 0", () => {
    assert.deepEqual(trajectory("table"), [0, 0, 0, 0, 0]);
  });
});

describe("eq. 4: verbosity = |flagged ∪ clone lines| / LOC", () => {
  const dir = `${FIXTURES}eq4`;
  const texts = new Map(["left.ts", "right.ts"].map((path) => [path, fixture(`eq4/${path}`)]));
  const sources = [...texts].map(([path, text]) => parseSource(path, text));
  const doubled = lineOf(texts.get("left.ts") ?? "", "const long =");

  it("eq. 4: a line hit by two rules that is also a clone line counts once, with real rules and jscpd clones", async () => {
    const hits = sources.flatMap((src) => runRules(src, rules));
    const clones = await findClones(dir, []);
    for (const path of texts.keys()) {
      const onLine = hits.filter(
        (hit) => hit.file === path && hit.start <= doubled && doubled <= hit.end,
      );
      assert.deepEqual(
        onLine.map((hit) => hit.rule).sort(),
        ["single-use-return-var", "ternary-bool"],
        path,
      );
      assert.ok(
        clones.some((clone) =>
          [clone.a, clone.b].some(
            (side) => side.file === path && side.start <= doubled && doubled <= side.end,
          ),
        ),
        `${path}:${doubled} is not a clone line`,
      );
    }
    const files = sources.map((src) => ({
      path: src.path,
      code: src.code,
      added: new Set(src.text.split("\n").map((_, index) => index + 1)),
    }));
    const result = prVerbosity(files, hits, clones, rules);
    assert.equal(result.addedSloc, 20);
    assert.equal(result.flaggedLines, 2); // four hits, two lines
    assert.equal(result.cloneLines, 20);
    assert.equal(result.unionLines, 20);
    assert.equal(result.ratio, 1);
  });

  it("eq. 4: the whole-snapshot score dedupes the same line and stays in [0,1]", async () => {
    const snapshot = await snapshotMetrics(dir, texts, rules, 10, []);
    assert.equal(snapshot.sloc, 20);
    assert.equal(snapshot.flaggedLines, 2);
    assert.equal(snapshot.cloneLines, 20);
    assert.equal(snapshot.verbosity, 1);
  });
});

describe("Listing 2: verbose patterns from code_search, ported to TypeScript", () => {
  const verbose = parseSource("verbose.ts", fixture("listing2/verbose.ts"));
  const clean = parseSource("clean.ts", fixture("listing2/clean.ts"));

  it("Listing 2: the shipped rules flag the identity map, the length check around a loop, and the single-use variable", () => {
    const hits = runRules(verbose, rules).map((hit) => [hit.rule, hit.start]);
    assert.deepEqual(hits, [
      ["identity-map", lineOf(verbose.text, "const applicable = rules")],
      ["guarded-loop", lineOf(verbose.text, "if (matches.length > 0)")],
      ["single-use-return-var", lineOf(verbose.text, "const allMatches")],
    ]);
    const ratio = fileVerbosity(verbose).ratio;
    assert.ok(ratio > 0 && ratio < 1, `verbosity ${ratio}`);
  });

  it("Listing 2: the clean rewrite of the same code is not flagged", () => {
    assert.deepEqual(runRules(clean, rules), []);
  });
});

describe("eq. 4: verbosity is independent of erosion", () => {
  const pick = (condition: string) =>
    `export function pick(a: number, b: number): number {\n\tif (${condition}) return a;\n\treturn b;\n}\n`;

  it("eq. 4: a flagged pattern that adds no branches changes verbosity but not erosion", () => {
    const before = parseSource("file.ts", [branchy("grow", 10), pick("a > b")].join("\n"));
    const after = parseSource(
      "file.ts",
      [branchy("grow", 10), pick("(a > b) === true")].join("\n"),
    );
    const [cBefore, cAfter] = [extractCallables(before), extractCallables(after)];
    assert.ok(erosion(cBefore, 10) > 0 && erosion(cBefore, 10) < 1);
    assert.equal(erosion(cAfter, 10), erosion(cBefore, 10));
    assert.equal(fileVerbosity(before).flaggedLines, 0);
    assert.equal(fileVerbosity(after).flaggedLines, 1);
    assert.ok(fileVerbosity(after).ratio > fileVerbosity(before).ratio);
  });

  it("eq. 4: branches with no flagged pattern change erosion but not the flagged lines", () => {
    const before = parseSource(
      "file.ts",
      [pick("(a > b) === true"), branchy("grow", 8)].join("\n"),
    );
    const after = parseSource(
      "file.ts",
      [pick("(a > b) === true"), branchy("grow", 11)].join("\n"),
    );
    assert.ok(erosion(extractCallables(after), 10) > erosion(extractCallables(before), 10));
    const flagged = (src: Source) =>
      runRules(src, rules).map((hit) => [hit.rule, hit.start, hit.end]);
    assert.deepEqual(flagged(after), flagged(before));
    assert.equal(fileVerbosity(after).flaggedLines, fileVerbosity(before).flaggedLines);
  });
});
