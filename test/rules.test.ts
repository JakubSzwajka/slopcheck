import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { loadRules, runRules } from "../src/rules.ts";
import { parseSource } from "../src/source.ts";

const TESTS_DIR = fileURLToPath(new URL("../rule-tests/", import.meta.url));
const rules = loadRules();

type RuleTest = { id: string; valid: string[]; invalid: string[] };
const tests = readdirSync(TESTS_DIR)
  .filter((name) => name.endsWith("-test.yml"))
  .map((name) => parseYaml(readFileSync(join(TESTS_DIR, name), "utf8")) as RuleTest);

describe("AST-grep rules", () => {
  it("has between 10 and 15 rules, each with at least one valid and one invalid case", () => {
    assert.ok(rules.length >= 10 && rules.length <= 15, `${rules.length} rules`);
    for (const rule of rules) {
      const test = tests.find((candidate) => candidate.id === rule.id);
      assert.ok(test, `rule ${rule.id} has no rule-tests/${rule.id}-test.yml`);
      assert.ok(
        test.valid.length > 0 && test.invalid.length > 0,
        `rule ${rule.id} needs valid and invalid cases`,
      );
    }
  });

  for (const test of tests) {
    const rule = rules.find((candidate) => candidate.id === test.id);
    describe(test.id, () => {
      for (const [ext, label] of [
        [".ts", "TS"],
        [".tsx", "TSX"],
      ] as const) {
        it(`flags every invalid case (${label})`, () => {
          assert.ok(rule, `no rule ${test.id}`);
          for (const code of test.invalid) {
            const hits = runRules(parseSource(`case${ext}`, code), [rule]);
            assert.ok(hits.length > 0, `expected a hit in: ${code}`);
          }
        });
        it(`leaves every valid case alone (${label})`, () => {
          assert.ok(rule, `no rule ${test.id}`);
          for (const code of test.valid) {
            const hits = runRules(parseSource(`case${ext}`, code), [rule]);
            assert.equal(hits.length, 0, `unexpected hit in: ${code}`);
          }
        });
      }
    });
  }

  it("finds a hit nested inside another rule's hit", () => {
    const hits = runRules(
      parseSource("a.ts", "const ok = (a > b) === true ? true : false;\n"),
      rules,
    );
    assert.deepEqual(hits.map((hit) => hit.rule).sort(), ["compare-bool-literal", "ternary-bool"]);
  });

  it("flags only the first line for block-wrapping rules", () => {
    const guarded = rules.find((rule) => rule.id === "guarded-loop");
    assert.ok(guarded);
    const hits = runRules(parseSource("a.ts", "if (xs.length) {\n  xs.forEach(use);\n}\n"), [
      guarded,
    ]);
    assert.deepEqual(
      hits.map((hit) => [hit.start, hit.end]),
      [[1, 1]],
    );
  });
});
