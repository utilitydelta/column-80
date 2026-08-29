// White-box: the model's sentence reaches the file, or the table's does
// (session-v64 phase 4).
//
// The two files beside this one pin the pieces. This one presses the REAL
// command through the structural `vscode` stub with real detectors, and grades
// the ONE artefact that matters: the text handed to the consent gate. That text
// is what a developer would see in the diff.
//
// WHAT IS BEING DEFENDED. The comment's last sentence is the only thing a model
// may write into a person's source file. Everything in front of it - the
// detector's own detail and the measured call count - is the product's, and the
// model does not get to touch it. And every way the round can fail ends on the
// fixed phrase that has shipped since 2.5.0, so the product never plants a
// comment with no advice in it and never fails to plant because a model was
// away.
//
// ROWS
//    1  a sentence that survives the gate is what lands in the file
//    2  the detector's own words are UNCHANGED by the model's sentence
//    3  a refused sentence falls back to the table, and the channel says why
//    4  a dead backend falls back to the table, in DIFFERENT words
//    5  a closed tier gate plants the table's phrase and asks no model
//    6  the fix prompt carries the context blocks it was given
//    7  one transport read per row, spent on both rounds
//
// AMENDED 2026-08-29. The rows below graded the comment planted for the CLOCK
// row. The four honesty dimensions became a model judgement that day and no
// longer fire in the synchronous pass (ruling 3, the amendment at the end of
// session-v64/goal.md), so the graded row is `bool-param` instead. Nothing about
// what is being defended moved: the model still owns the last sentence and only
// the last sentence, and every failure still ends on the table's phrase.
//
// Run: SKIP_LIVE=1 node --test test/impl-v64-p4-gesture.test.cjs

const honestyStub = require("./.honesty-stub.cjs");
const test = require("node:test");
const assert = require("node:assert");
const { bundleWithVscodeStub } = require("./.vscode-stub.cjs");
const { bundleCore } = require("./.blind-util.cjs");

const host = bundleWithVscodeStub(
  "impl-v64-p4-gesture",
  `export { registerCriticize, CRITICIZE_COMMAND_ID } from "../src/vscode/criticize";\n`,
);
const core = bundleCore(
  "impl-v64-p4-gesture-core",
  `export { VOICE_PARTS } from "../src/core/criticizeVoice";\n`,
);
test.after(() => {
  host.cleanup();
  core.cleanup();
});

if (host.error) {
  test("harness sanity: the host bundle must build", () => {
    assert.fail(`bundleWithVscodeStub failed: ${host.error && host.error.message}`);
  });
} else {
  const vscode = host.vscode;
  const { VOICE_PARTS } = core.mod;

  // Takes a flag it never reads, so at least two dimensions fire on the
  // detectors' own reading rather than on a fixture pretending to.
  const SOURCE = [
    "const seen: Map<string, number> = new Map();",
    "/** Records the hit and answers whether it was the first one. */",
    "export function touch(key: string, warm: boolean): boolean {",
    "  const now = Date.now();",
    "  const first = !seen.has(key);",
    "  seen.set(key, now);",
    "  return first;",
    "}",
  ].join("\n");

  // The fix prompt's own opening line, so a test can tell the two rounds apart
  // the way a reader of the channel would.
  const FIX_PROMPT_MARK = "You are writing the LAST sentence";

  function makeDoc(text, languageId) {
    const state = { text, version: 1 };
    return {
      uri: vscode.Uri.parse("file:///v64p4/p.ts"),
      fileName: "/v64p4/p.ts",
      languageId,
      eol: 1,
      get version() {
        return state.version;
      },
      get isClosed() {
        return false;
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
  }

  /** One press. `answer(prompt)` decides what the model says to each round. */
  async function press({ answer, tierGate, wiring = {} } = {}) {
    const languageId = "typescript";
    const doc = makeDoc(SOURCE, languageId);
    const lines = SOURCE.split("\n");
    const headLine = lines.findIndex((l) => /\bfunction\s+\w+/.test(l)) + 1;
    let headOffset = 0;
    for (let i = 0; i < headLine - 1; i++) headOffset += lines[i].length + 1;
    headOffset += lines[headLine - 1].search(/\S/);

    globalThis.__C80_ACTIVE__ = { document: doc, selection: { active: new vscode.Position(headLine - 1, 0) } };
    globalThis.__C80_WARNINGS__ = [];
    globalThis.__C80_COMMANDS__ = {};
    globalThis.__C80_CALL_ROOTS__ = {};
    globalThis.__C80_INCOMING__ = {};
    globalThis.__C80_OUTGOING__ = {};

    const channel = [];
    const output = {
      name: "v64p4",
      appendLine: (l) => channel.push(l),
      append() {},
      show() {},
      hide() {},
      clear() {},
      dispose() {},
    };
    const presented = [];
    const prompts = [];
    let transportReads = 0;

    host.mod.registerCriticize({ subscriptions: [] }, output, {
      resolveFunction: async () => ({
        span: { start: headOffset, end: SOURCE.length },
        headOffset,
        signature: lines[headLine - 1].trim(),
        symbolName: "touch",
        languageId,
        kind: "function",
        bodyOnly: false,
        headerIndent: "",
      }),
      tierGate: async () => tierGate ?? { allowed: true },
      tierMessage: () => "the hardware tier disables function generation",
      transport: () => {
        transportReads += 1;
        return async (req) => {
          prompts.push(req.prompt);
          // THE HONESTY ROUND IS ANSWERED FOR THE FIXTURE. Since 2026-08-29
          // `clock` is a model's judgement, so `const now = Date.now();` no
          // longer produces a finding on its own and every row asserting one
          // would otherwise be measuring an absent model rather than the
          // plumbing under test. Scripting it here is the same move as
          // `answer: () => GOOD` scripting a fix sentence. Rows that DELIBERATELY
          // have no model (4 and 5) pass their own `answer` and get no honesty
          // verdict, which is the point of those rows.
          if (honestyStub.isHonestyPrompt(req.prompt)) {
            return { text: answer ? answer(req.prompt) : honestyStub.honestyReply(req.prompt, HONEST_VERDICT) };
          }
          return { text: answer ? answer(req.prompt) : "" };
        };
      },
      presenter: () => ({
        present: async (request) => {
          presented.push(request);
          return "reject";
        },
      }),
      ...wiring,
    });
    await globalThis.__C80_COMMANDS__[host.mod.CRITICIZE_COMMAND_ID]();
    return { channel, presented, prompts, transportReads };
  }

  /** What a working model says about this fixture: the one line that reads the
   *  clock, and nothing else. */
  const HONEST_VERDICT = { clock: /Date\.now/ };

  const fixRounds = (prompts) => prompts.filter((p) => p.includes(FIX_PROMPT_MARK));

  /**
   * The planted comments as PROSE, with the comment markers taken off and the
   * wrap undone.
   *
   * The comment is wrapped at column 80, so a sentence in the file is several
   * lines with `//     ` in front of each. A test that searched the raw text for
   * a phrase would fail on the wrap rather than on the product, which is a green
   * that grades the width.
   */
  const planted = (run) => {
    assert.strictEqual(run.presented.length, 1, `expected one proposal, got ${run.presented.length}`);
    return run.presented[0].text
      .split("\n")
      .filter((l) => l.trim().startsWith("//"))
      .map((l) => l.trim().replace(/^\/\/\s*/, ""))
      .join(" ")
      .replace(/\s+/g, " ");
  };
  /** The raw proposal, for the rows that need to see the file's own bytes. */
  const raw = (run) => run.presented[0].text;

  // An order that gets through the gate: it opens on a verb, hedges nothing,
  // speaks in no second person, and spends none of the blast clause's reserved
  // words on an unmeasured claim.
  const GOOD = "Split touch in two so each caller names the branch it wanted.";

  test("1: a sentence that survives the gate is the one planted in the file", async () => {
    const run = await press({ answer: honestyStub.withHonesty(HONEST_VERDICT, (p) => (p.includes(FIX_PROMPT_MARK) ? GOOD : "")) });
    assert.ok(fixRounds(run.prompts).length > 0, `no fix round ran at all:\n${run.channel.join("\n")}`);
    assert.ok(
      planted(run).includes(GOOD),
      `the model's sentence never reached the file:\n${raw(run)}`,
    );
    assert.strictEqual(
      planted(run).includes(VOICE_PARTS["bool-param"].order),
      false,
      "the table's phrase was planted alongside the model's; only one order goes in a comment",
    );
  });

  test("2: the detector's own words are untouched by the model's sentence", async () => {
    // The first two beats are measured and specific and they are the best part
    // of the comment. The model gets the third beat and nothing else.
    const run = await press({ answer: honestyStub.withHonesty(HONEST_VERDICT, (p) => (p.includes(FIX_PROMPT_MARK) ? GOOD : "")) });
    // Case-insensitively: the table writes its complaint lower case so it can
    // read as one sentence off the tag, and the join raises it when a fact
    // sentence went in front. The WORDS are what the model may not touch.
    assert.ok(
      planted(run).toLowerCase().includes(VOICE_PARTS["bool-param"].complaint.toLowerCase()),
      `the complaint half of the phrase was lost:\n${planted(run)}`,
    );
    // And the detector's own detail, which names THIS function's identifiers
    // and is the half a lookup table could never write.
    assert.ok(
      planted(run).includes("carries a decision the caller had already made"),
      `the detector's detail was lost:\n${planted(run)}`,
    );
  });

  test("3: a sentence the gate refuses falls back to the table, and the channel says why", async () => {
    // Second person is banned outright: the comment attacks the code and never
    // the author.
    const run = await press({
      answer: (p) => (p.includes(FIX_PROMPT_MARK) ? "You should consider splitting it in two." : ""),
    });
    assert.ok(
      planted(run).includes(VOICE_PARTS["bool-param"].order),
      `a refused sentence must leave the table's phrase behind:\n${planted(run)}`,
    );
    assert.strictEqual(
      planted(run).includes("You should consider"),
      false,
      "a sentence the gate refused was planted anyway",
    );
    const why = run.channel.filter((l) => l.includes("fix refused for"));
    assert.ok(why.length > 0, `nothing on the channel said why:\n${run.channel.join("\n")}`);
    assert.ok(
      why.some((l) => /hedged|second person/.test(l)),
      `the refusal did not name the rule it broke:\n${why.join("\n")}`,
    );
  });

  test("4: a dead backend falls back to the table, and it does not borrow the refusal's words", async () => {
    const run = await press({
      answer: () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      },
    });
    assert.ok(planted(run).includes(VOICE_PARTS["bool-param"].order), "an outage must still plant a complete comment");
    const down = run.channel.filter((l) => l.includes("fix never reached the model"));
    assert.ok(down.length > 0, `an outage printed no fix line at all:\n${run.channel.join("\n")}`);
    assert.ok(
      down.some((l) => l.includes("connect ECONNREFUSED 127.0.0.1:11434")),
      "the transport's own message is the sentence that ends a wrong triage in one line",
    );
    assert.strictEqual(
      run.channel.some((l) => l.includes("fix refused for")),
      false,
      "an outage was spelled as a refusal, which is the exact defect phase 1 of this session closed",
    );
  });

  test("5: a closed tier gate plants the table's phrase and asks no model anything", async () => {
    const run = await press({
      tierGate: { allowed: false, reason: "tier-disabled" },
      answer: () => {
        throw new Error("must not be called: the gate is closed");
      },
    });
    assert.strictEqual(run.transportReads, 0, "the transport was touched despite a closed gate");
    assert.ok(planted(run).includes(VOICE_PARTS["bool-param"].order), "a closed gate still plants a complete comment");
    // TIGHTENED BACK 2026-08-29. This row was briefly relaxed to two lines
    // while the honesty round swallowed the gate's reason and made the fix line
    // print a sentence of its own invention. That was a product defect, not a
    // contract change: a reader scanning for `fix skipped:` must learn WHY on
    // that line, not by correlating it with an earlier one. The reason now
    // travels with the absent session.
    assert.ok(
      run.channel.some((l) => l.includes("fix skipped:") && l.includes("tier-disabled")),
      `a closed gate must name itself on the fix line:\n${run.channel.join("\n")}`,
    );
    assert.ok(
      run.channel.some((l) => l.includes("honesty not judged") && l.includes("tier-disabled")),
      `and on the honesty line, because that round was refused by the same gate:\n${run.channel.join("\n")}`,
    );
  });

  test("6: the fix prompt carries the context, and the channel reports what it carried", async () => {
    const run = await press({ answer: honestyStub.withHonesty(HONEST_VERDICT, (p) => (p.includes(FIX_PROMPT_MARK) ? GOOD : "")) });
    const prompt = fixRounds(run.prompts)[0];
    // Arm B is free: the slice is already in hand, and it is what turns a
    // one-line prompt into one about this function.
    assert.match(prompt, /The whole function:/);
    assert.ok(prompt.includes("const first = !seen.has(key);"), "the body never reached the prompt");
    assert.match(prompt, /The signature: touch\(key: string, warm: boolean\)/);
    // And the context line, which names the absences too: this stub answers no
    // call hierarchy and registers no extractor.
    const line = run.channel.find((l) => l.includes("fix context (arm"));
    assert.notStrictEqual(line, undefined, `no context line was printed:\n${run.channel.join("\n")}`);
    assert.match(line, /no upstream call sites/);
    assert.match(line, /no callees/);
  });

  test("7: the transport is read once per row and spent on both rounds", async () => {
    // Two passes over the same rows meant two gate consults, two in-flight
    // claims and two answers to "which rows are worth a model round". One pass
    // has none of that, and this is the row that keeps it one.
    const run = await press({ answer: honestyStub.withHonesty(HONEST_VERDICT, (p) => (p.includes(FIX_PROMPT_MARK) ? GOOD : "")) });
    const rows = fixRounds(run.prompts).length;
    assert.ok(rows >= 2, `expected at least two elevated rows, got ${rows}`);
    // Plus ONE for the honesty round, which is per CARD rather than per row:
    // the four honesty dimensions are decided by a single model round since
    // 2026-08-29 (ruling 3, the amendment at the end of session-v64/goal.md).
    assert.strictEqual(
      run.transportReads,
      rows + 1,
      `the transport was read ${run.transportReads} times for ${rows} rows plus one honesty round`,
    );
    assert.strictEqual(
      run.prompts.length,
      rows * 2 + 1,
      "each row is one explain round and one fix round, and the card is one honesty round",
    );
  });
}
