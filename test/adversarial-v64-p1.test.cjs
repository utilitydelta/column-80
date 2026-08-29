// ADVERSARIAL REVIEW - session-v64 phase 1: the swallow, and the reporter.
//
// Attacks `src/core/criticizeExplain.ts` (ExplainFailure, judge, the `report`
// parameter), `src/core/criticizeGesture.ts` (`explainedLine`), and the wiring
// in `src/vscode/criticize.ts` (`withExplanations`). Drives the REAL command
// through the structural `vscode` stub with real detectors, so what fails a
// row here is the product's own scoring, not a fixture pretending to be one.
//
// SECTION 5 WAS WRITTEN THE OTHER WAY ROUND FIRST. The original review found
// that `withExplanations`'s per-row catch checked `isCancellation` imported
// from `./inFlight` (only `err instanceof Error && name === "AbortError"`),
// while `explainFinding` rethrows on a WIDER predicate (also "Canceled" and
// "CancellationError", the two names vscode's own cancellation actually
// carries). A round cancelled under either of those two names was correctly
// rethrown by `explainFinding`, then MISCLASSIFIED by the narrower check as an
// ordinary "unavailable" failure, tallied on the summary line, with the walk
// carrying on to the next row instead of stopping. Those two rows asserted the
// defect reproduced, and did.
//
// The fix exports `isExplainCancellation` from `criticizeExplain.ts` (the same
// predicate `explainFinding` rethrows on) and has `withExplanations` check it
// too. Section 5 now pins the fixed behaviour: both spellings propagate out of
// the explainer pass, the walk stops at the first round, and nothing lands on
// the tally. `5-control` is unchanged - it was already the passing anchor
// proving the mismatch was a real name gap and not a harness artifact.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v64-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleWithVscodeStub } = require("./.vscode-stub.cjs");
const { bundleCore } = require("./.blind-util.cjs");

const host = bundleWithVscodeStub(
  "adv-v64-p1-host",
  `export { registerCriticize, CRITICIZE_COMMAND_ID } from "../src/vscode/criticize";\n`,
);
const core = bundleCore(
  "adv-v64-p1-core",
  `export { explainedLine } from "../src/core/criticizeGesture";\n`,
);
test.after(() => {
  host.cleanup();
  core.cleanup();
});

// ---------------------------------------------------------------------------
// 3'. `explainedLine` with pathological inputs, direct.
// ---------------------------------------------------------------------------

test("3'. explainedLine: pathological inputs do not throw and keep the counts legible", () => {
  const { explainedLine } = core.mod;

  // Negative counts: the function trusts its caller's arithmetic and must not
  // crash on it, whatever it prints.
  assert.doesNotThrow(() => explainedLine(-1, 2, []));
  assert.doesNotThrow(() => explainedLine(0, -5, []));

  // A non-array `failures`. The signature says `readonly ExplainFailure[]`, but
  // JS does not enforce that at the call boundary, and `withExplanations` is
  // the only real caller today - a defensive floor here is what stands between
  // a future caller's bug and a thrown exception on every render.
  let line;
  assert.doesNotThrow(() => {
    line = explainedLine(0, 2, /** @type any */ (null));
  }, "a null failures argument must not throw");
  assert.strictEqual(typeof line, "string");
  assert.doesNotThrow(() => explainedLine(0, 2, "not an array"));
  assert.doesNotThrow(() => explainedLine(0, 2, 42));

  // A failure object with a missing or unrecognised `kind`. It must not be
  // silently absorbed into one of the three known buckets, and it must not
  // throw either.
  let weird;
  assert.doesNotThrow(() => {
    weird = explainedLine(0, 1, [{ kind: "mystery", detail: "??" }]);
  });
  assert.strictEqual(typeof weird, "string");
  let missingKind;
  assert.doesNotThrow(() => {
    missingKind = explainedLine(0, 1, [{ detail: "no kind at all" }]);
  });
  assert.strictEqual(typeof missingKind, "string");

  // A huge failure list: no quadratic blowup, no crash.
  const huge = Array.from({ length: 50000 }, (_, i) => ({
    kind: i % 3 === 0 ? "unavailable" : i % 3 === 1 ? "silent" : "unusable",
    detail: `failure ${i}`,
  }));
  const start = Date.now();
  const hugeLine = explainedLine(0, 50000, huge);
  assert.strictEqual(typeof hugeLine, "string");
  assert.ok(Date.now() - start < 2000, "explainedLine on 50k failures took too long");
});

test("3''. explainedLine: an unrecognised-kind failure is not silently counted as one of the three known kinds", () => {
  const { explainedLine } = core.mod;
  const known = explainedLine(0, 1, [{ kind: "unavailable", detail: "x" }]);
  const unknown = explainedLine(0, 1, [{ kind: "mystery", detail: "x" }]);
  // If the unknown kind fell through into "unavailable" (e.g. by an `!==
  // "silent" && !== "unusable"` style default), these two lines would be
  // identical. They are not allowed to be: an unrecognised kind is a shape the
  // detector side does not currently emit, but the function has no static
  // guarantee against it, and this proves it is not quietly reclassified as an
  // outage it did not report.
  assert.notStrictEqual(
    known,
    unknown,
    `an unrecognised failure kind rendered identically to "unavailable": ${unknown}`,
  );
});

if (host.error) {
  test("harness sanity: the host bundle must build", () => {
    assert.fail(`bundleWithVscodeStub failed: ${host.error && host.error.message}`);
  });
} else {
  const vscode = host.vscode;

  // A TypeScript function that fires at least two elevated dimensions on its
  // own: it reads the clock (Date.now()) and mutates-then-returns (command-query
  // separation), the same fixture `impl-v61-p4-explain.test.cjs` uses to prove a
  // real card fires real findings.
  const SOURCE = [
    "const seen: Map<string, number> = new Map();",
    "const warmed: Set<string> = new Set();",
    "/** Records the hit and answers whether it was the first one. */",
    "export function touch(key: string, warm: boolean): boolean {",
    "  const now = Date.now();",
    "  const first = !seen.has(key);",
    "  seen.set(key, now);",
    "  if (warm) {",
    "    warmed.add(key);",
    "  }",
    "  return first;",
    "}",
  ].join("\n");

  function makeDoc(text, languageId) {
    const state = { text, version: 1, closed: false };
    const doc = {
      uri: vscode.Uri.parse("file:///adv64/p.ts"),
      fileName: "/adv64/p.ts",
      languageId,
      eol: 1,
      get version() {
        return state.version;
      },
      get isClosed() {
        return state.closed;
      },
      get lineCount() {
        return state.text.split("\n").length;
      },
      getText: () => state.text,
      positionAt: (off) => {
        const lines = state.text.split("\n");
        let o = 0;
        for (let l = 0; l < lines.length; l++) {
          if (off <= o + lines[l].length) return new vscode.Position(l, off - o);
          o += lines[l].length + 1;
        }
        return new vscode.Position(lines.length - 1, lines[lines.length - 1].length);
      },
      offsetAt: (p) => {
        const lines = state.text.split("\n");
        let o = 0;
        for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
        return Math.min(o + p.character, state.text.length);
      },
      lineAt: (arg) => {
        const lines = state.text.split("\n");
        const t = lines[typeof arg === "number" ? arg : arg.line] ?? "";
        const m = t.match(/\S/);
        return {
          text: t,
          range: new vscode.Range(0, 0, 0, t.length),
          firstNonWhitespaceCharacterIndex: m ? m.index : t.length,
          isEmptyOrWhitespace: !m,
        };
      },
    };
    return { doc, state };
  }

  /**
   * Presses the gesture once, with a caller-controlled transport GETTER
   * (`makeTransport`) so each explain round can behave differently: throw a
   * plain error, throw a cancellation under either spelling, resolve empty,
   * or resolve real prose. `tierGate` defaults to open so the explainer always
   * reaches a transport.
   */
  async function press(source, { languageId = "typescript", makeTransport, tierGate } = {}) {
    const { doc, state } = makeDoc(source, languageId);
    const lines = source.split("\n");
    const headLine = lines.findIndex((l) => /\bfunction\s+\w+/.test(l)) + 1;
    const endLine = lines.length; // last line is the closing brace
    let headOffset = 0;
    for (let i = 0; i < headLine - 1; i++) headOffset += lines[i].length + 1;
    headOffset += lines[headLine - 1].search(/\S/);
    let spanEnd = source.length;

    globalThis.__C80_ACTIVE__ = { document: doc, selection: { active: new vscode.Position(headLine - 1, 0) } };
    globalThis.__C80_WARNINGS__ = [];
    globalThis.__C80_COMMANDS__ = {};
    const channel = [];
    const output = {
      name: "adv64",
      appendLine: (l) => channel.push(l),
      append() {},
      show() {},
      hide() {},
      clear() {},
      dispose() {},
    };
    const presenter = {
      present: async () => "reject",
    };

    host.mod.registerCriticize({ subscriptions: [] }, output, {
      resolveFunction: async () => ({
        span: { start: headOffset, end: spanEnd },
        headOffset,
        signature: lines[headLine - 1].trim(),
        symbolName: (/function\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[headLine - 1]) ?? [])[1] ?? "f",
        languageId,
        kind: "function",
        bodyOnly: false,
        headerIndent: (lines[headLine - 1].match(/^[ \t]*/) ?? [""])[0],
      }),
      tierGate: async () => tierGate ?? { allowed: true },
      tierMessage: () => undefined,
      transport: makeTransport,
      presenter: () => presenter,
    });
    await globalThis.__C80_COMMANDS__[host.mod.CRITICIZE_COMMAND_ID]();
    return { channel, state, doc, warnings: globalThis.__C80_WARNINGS__ };
  }

  // -------------------------------------------------------------------------
  // Sanity: the fixture actually reaches two-or-more explain rounds. If this
  // fails, every test below proves nothing about the loop.
  // -------------------------------------------------------------------------

  test("harness sanity: the fixture fires at least two elevated rows and the explainer reaches a transport for each", async () => {
    let calls = 0;
    const run = await press(SOURCE, {
      makeTransport: () => {
        calls += 1;
        return async () => ({ text: "" });
      },
    });
    assert.ok(
      calls >= 2,
      `expected >= 2 explain rounds so the loop's own behaviour is exercised; got ${calls}. channel:\n${run.channel.join("\n")}`,
    );
  });

  // -------------------------------------------------------------------------
  // 1. Every no-prose path names itself distinguishably, and none collide.
  // -------------------------------------------------------------------------

  test("1a. a transport getter that throws synchronously (not the round) is reported the same as a thrown round", async () => {
    const run = await press(SOURCE, {
      makeTransport: () => {
        throw new Error("no client configured for this tier");
      },
    });
    const line = run.channel.find((l) => /explained \d+ of \d+ elevated row/.test(l));
    assert.notStrictEqual(line, undefined, `no summary line printed. channel:\n${run.channel.join("\n")}`);
    assert.strictEqual(
      line.toLowerCase().includes("reach"),
      true,
      `a transport-getter throw did not read as unreachable: ${line}`,
    );
    assert.strictEqual(
      run.channel.some((l) => l.includes("no client configured for this tier")),
      true,
      `the getter's own message never reached the channel:\n${run.channel.join("\n")}`,
    );
  });

  test("1b. a closed tier gate prints no explainedLine at all, and is not confused with a live-but-silent model", async () => {
    const run = await press(SOURCE, {
      tierGate: { allowed: false, reason: "tier-disabled" },
      makeTransport: () => {
        throw new Error("must not be called: the gate is closed");
      },
    });
    assert.strictEqual(
      run.channel.some((l) => /explained \d+ of \d+ elevated row/.test(l)),
      false,
      `a closed gate printed an explainedLine, which claims a round ran when none did:\n${run.channel.join("\n")}`,
    );
    assert.strictEqual(
      run.channel.some((l) => l.includes("must not be called")),
      false,
      "the transport was invoked despite the gate being closed",
    );
  });

  // -------------------------------------------------------------------------
  // 2. Is the reporter called more than once per round, or double-counted
  //    against the row-loop's own catch?
  // -------------------------------------------------------------------------

  test("2. a thrown round is reported EXACTLY ONCE on the tally, not once by explainFinding's reporter and again by the row-loop catch", async () => {
    // NOTE: `wiring.transport()` is now shared by a SECOND pass this file does
    // not otherwise exercise - a later fix round also calls it per elevated
    // row (`src/vscode/criticize.ts` around its own "fix" wiring). A raw call
    // counter across `makeTransport` invocations therefore counts BOTH
    // passes' rounds, not just the explainer's. The invariant this test pins
    // - one `explainer skipped:` line per explain-pass failure, matching the
    // explainer's OWN denominator - is read entirely off the channel's own
    // explain-pass lines instead, so it stays true regardless of what other
    // passes also happen to call the same transport getter.
    let round = 0;
    const run = await press(SOURCE, {
      makeTransport: () => {
        round += 1;
        const n = round;
        return async () => {
          throw new Error(`round ${n} down`);
        };
      },
    });
    const summary = run.channel.find((l) => /explained \d+ of \d+ elevated row/.test(l));
    assert.notStrictEqual(summary, undefined, `no explainedLine tally printed. channel:\n${run.channel.join("\n")}`);
    const total = Number(/of (\d+) elevated row/.exec(summary)[1]);

    const skipped = run.channel.filter((l) => l.includes("explainer skipped:") && l.includes("down"));
    // One explainerSkippedLine per FAILED explain round, not two. If the
    // row-loop's outer catch also fired for the same throw, this count
    // doubles against the explainer's own denominator.
    assert.strictEqual(
      skipped.length,
      total,
      `expected exactly one skipped-line per failing explain round (denominator ${total}), got ` +
        `${skipped.length}:\n${run.channel.join("\n")}`,
    );
  });

  // -------------------------------------------------------------------------
  // 5. Cancellation: `withExplanations`'s own catch now checks the SAME
  //    predicate `explainFinding` rethrows on (`isExplainCancellation`,
  //    exported for exactly this reason), alongside the narrower
  //    `./inFlight` one. A round cancelled under either vscode spelling must
  //    propagate out of the explainer pass rather than being swallowed as an
  //    "unavailable" failure, and the walk must stop at that row rather than
  //    visiting the next one.
  // -------------------------------------------------------------------------

  for (const name of ["Canceled", "CancellationError"]) {
    test(`5. a round cancelled under the vscode spelling '${name}' (not 'AbortError') propagates out of the explainer pass and stops the walk`, async () => {
      let round = 0;
      const run = await press(SOURCE, {
        makeTransport: () => {
          round += 1;
          return async () => {
            const err = new Error("user cancelled");
            err.name = name;
            throw err;
          };
        },
      });

      // The walk must stop AT the cancelled row: this fixture has two
      // elevated rows, and a second round means the cancellation was
      // swallowed and the loop moved on.
      assert.strictEqual(
        round,
        1,
        `expected a '${name}' cancellation to stop the walk after its own round; ${round} round(s) ran. ` +
          `channel:\n${run.channel.join("\n")}`,
      );
      // Nothing lands on the tally: a cancellation that propagates never
      // reaches the `explainedLine` call at all, so no summary line should
      // print - not one with a count, and certainly not one claiming an
      // unreachable backend.
      const summaryLine = run.channel.find((l) => /explained \d+ of \d+ elevated row/.test(l));
      assert.strictEqual(
        summaryLine,
        undefined,
        `a '${name}' cancellation must not reach the tally at all, but got: ${summaryLine}`,
      );
      assert.strictEqual(
        run.channel.some((l) => l.toLowerCase().includes("unreachable")),
        false,
        `a '${name}' cancellation must never be described as an unreachable backend. channel:\n${run.channel.join("\n")}`,
      );
      // The row-loop's own `explainer skipped:` line is for FAILURES, and a
      // cancellation is not one - it must not appear there either.
      assert.strictEqual(
        run.channel.some((l) => l.includes("explainer skipped:") && l.includes(name)),
        false,
        `a '${name}' cancellation must not be logged as a skipped round. channel:\n${run.channel.join("\n")}`,
      );
      // The gesture must not have reached the propose stage: the cancellation
      // ended the gesture before there was anything left to propose.
      assert.strictEqual(
        run.channel.some((l) => l.includes("proposing")),
        false,
        `a '${name}' cancellation reached the propose stage instead of ending the gesture:\n${run.channel.join("\n")}`,
      );
    });
  }

  test("5-control. a round cancelled under the REAL AbortController spelling ('AbortError') is NOT tallied, proving the mismatch above is about the name, not about cancellation in general", async () => {
    let round = 0;
    const run = await press(SOURCE, {
      makeTransport: () => {
        round += 1;
        return async () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        };
      },
    });
    // With the spelling the two `isCancellation`s agree on, the walk should
    // stop after the first round: this is the CONTROL showing the harness can
    // detect a real stop when one happens.
    assert.strictEqual(
      round,
      1,
      `an 'AbortError' cancellation should stop the walk after the first round; ${round} ran. This is the ` +
        `control proving the '5.' findings above are a real name mismatch, not a harness artifact.`,
    );
  });

  // -------------------------------------------------------------------------
  // 3. explainedLine with pathological inputs (no host needed for the ones
  //    the bundle already exports; this exercises them through the channel).
  // -------------------------------------------------------------------------

  test("3. a detail containing a newline is not split across the explain-failure lines specifically", async () => {
    const run = await press(SOURCE, {
      makeTransport: () => async () => {
        throw new Error("line one\nline two\nline three");
      },
    });
    // `failureDetail` takes only the first line for the per-round skip line.
    // Scoped to the lines THIS phase writes (not the scorecard render, which
    // is legitimately multi-line as one `appendLine` call for a different
    // reason entirely).
    const explainLines = run.channel.filter(
      (l) => l.includes("explainer skipped:") || /explained \d+ of \d+ elevated row/.test(l),
    );
    assert.ok(explainLines.length > 0, `no explain-failure lines were printed at all:\n${run.channel.join("\n")}`);
    const offenders = explainLines.filter((l) => l.includes("\n"));
    assert.strictEqual(
      offenders.length,
      0,
      `an explain-failure line embedded a raw newline:\n${JSON.stringify(offenders)}`,
    );
    assert.strictEqual(
      explainLines.some((l) => l.includes("line two") || l.includes("line three")),
      false,
      `the detail leaked lines past the first into the channel:\n${JSON.stringify(explainLines)}`,
    );
  });
}
