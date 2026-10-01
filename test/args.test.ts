import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseArgs, UsageError } from "../src/args.ts";

const DEFAULTS = {
  help: false,
  json: false,
  legend: true,
  repo: true,
  ccThreshold: 10,
  excludes: [],
  base: null,
  head: "HEAD",
};

describe("parseArgs", () => {
  it("returns the defaults for no arguments", () => {
    assert.deepEqual(parseArgs([]), DEFAULTS);
  });

  it("reads switches, refs and repeated value flags in either form", () => {
    const args = parseArgs([
      "main",
      "--json",
      "--no-legend",
      "--no-repo",
      "-h",
      "--exclude",
      "a/**",
      "--exclude=b/**",
      "--cc-threshold=7",
      "feature",
    ]);
    assert.deepEqual(args, {
      help: true,
      json: true,
      legend: false,
      repo: false,
      ccThreshold: 7,
      excludes: ["a/**", "b/**"],
      base: "main",
      head: "feature",
    });
    assert.equal(parseArgs(["--cc-threshold", "12"]).ccThreshold, 12);
    assert.equal(parseArgs(["--help"]).help, true);
  });

  it("ignores an inline value on a switch and keeps a lone dash as a ref", () => {
    assert.equal(parseArgs(["--json=no"]).json, true);
    assert.equal(parseArgs(["-"]).base, "-");
  });

  it("rejects bad input with a usage error", () => {
    const cases: Array<[string[], RegExp]> = [
      [["--exclude"], /^--exclude needs a value$/],
      [["--exclude="], /^--exclude needs a value$/],
      [["--cc-threshold", "x"], /^--cc-threshold needs a positive integer, got x$/],
      [["--cc-threshold=0"], /^--cc-threshold needs a positive integer, got 0$/],
      [["--cc-threshold", "1.5"], /^--cc-threshold needs a positive integer, got 1.5$/],
      [["--nope=1"], /^unknown option --nope=1$/],
      [["-x"], /^unknown option -x$/],
      [["a", "b", "c"], /^expected at most two refs, got 3$/],
    ];
    for (const [argv, message] of cases)
      assert.throws(
        () => parseArgs(argv),
        (error: unknown) => error instanceof UsageError && message.test(error.message),
        argv.join(" "),
      );
  });
});
