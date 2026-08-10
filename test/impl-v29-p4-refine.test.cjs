// The pure decisions the refine gesture adds, white-box: the budget, the target
// scan, the own-span drop, the prompt bytes, and the introduced-error diff.
//
// Every one of these is a decision the vscode layer only executes. What is NOT
// here is the ordering (propose, then check) - that is a sequence of vscode
// calls and it is pinned in impl-v29-p4-refine-flow.test.cjs against a stubbed
// host.
//
// Run: SKIP_LIVE=1 node --test test/impl-v29-p4-refine.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "impl-v29-p4-refine",
  `export {
     REFINE_ROUND_CAP, RefineBudget, refineTargets, usageSitesOutsideSpan,
     assembleRefinePrompt, introducedErrors, usageHeaderFor,
   } from "../src/core/refine";`,
);
test.after(cleanup);

const {
  REFINE_ROUND_CAP,
  RefineBudget,
  refineTargets,
  usageSitesOutsideSpan,
  assembleRefinePrompt,
  introducedErrors,
  usageHeaderFor,
} = mod;

// ---------------------------------------------------------------- the budget
//
// The whole reason this exists is that a style pass must not eat one of the two
// rounds product invariant 4 reserves for the compiler. These rows pin that it
// is a separate counter and that it is structurally one.

test("the refine budget is one round, and it is not the repair cap", () => {
  assert.equal(REFINE_ROUND_CAP, 1);
});

test("the budget grants exactly one round and then declines with a reason", () => {
  const budget = new RefineBudget();
  assert.equal(budget.roundsUsed, 0);
  assert.deepEqual(budget.next(), { kind: "refine", round: 1 });
  assert.equal(budget.roundsUsed, 1);
  assert.deepEqual(budget.next(), { kind: "decline", why: "budget-exhausted" });
  assert.deepEqual(budget.next(), { kind: "decline", why: "budget-exhausted" });
  assert.equal(budget.roundsUsed, 1);
});

test("two budgets do not share a counter", () => {
  const a = new RefineBudget();
  const b = new RefineBudget();
  a.next();
  assert.equal(a.roundsUsed, 1);
  assert.equal(b.roundsUsed, 0);
  assert.equal(b.next().kind, "refine");
});

// --------------------------------------------------------------- the targets

const CS_SPAN = [
  "public async Task<int> CountAlerts(Monitor monitor)",
  "{",
  "    var events = _store.LoadEvents(monitor.Serial);",
  "    // we used to call events.Prune() here",
  '    var label = "monitor.Rebuild()";',
  "    return events.Where(e => e.Level == Severity.High).Count();",
  "}",
].join("\n");

test("a member CALL is a target; a member read and a comment and a string are not", () => {
  const targets = refineTargets({
    languageId: "csharp",
    code: CS_SPAN,
    spanStartLine: 40,
    spanStartCharacter: 4,
    signature: "public async Task<int> CountAlerts(Monitor monitor)",
    max: 20,
  });
  const members = targets.filter((t) => t.via === "member").map((t) => t.name);
  assert.deepEqual(members, ["LoadEvents", "Where", "Count"]);
  // Prune sits in a comment, Rebuild in a string literal: neither is called.
  assert.equal(targets.some((t) => t.name === "Prune"), false);
  assert.equal(targets.some((t) => t.name === "Rebuild"), false);
  // A member READ (`monitor.Serial`, `e.Level`) opens no parameter list, so it
  // carries no call shape to learn.
  assert.equal(targets.some((t) => t.name === "Serial"), false);
});

test("members lead, types follow", () => {
  const targets = refineTargets({
    languageId: "csharp",
    code: CS_SPAN,
    spanStartLine: 0,
    spanStartCharacter: 0,
    signature: "public async Task<int> CountAlerts(Monitor monitor)",
    max: 20,
  });
  const firstType = targets.findIndex((t) => t.via === "type");
  const lastMember = targets.map((t) => t.via).lastIndexOf("member");
  assert.ok(firstType > lastMember, `types must follow members: ${JSON.stringify(targets)}`);
  assert.ok(targets.some((t) => t.via === "type" && t.name === "Severity"));
});

test("a target's position is a DOCUMENT cursor: line 0 is offset by the span column, later lines are not", () => {
  const code = "fn go() {\n    grid.enroll(t);\n}";
  const targets = refineTargets({
    languageId: "rust",
    code,
    spanStartLine: 100,
    spanStartCharacter: 7,
    max: 5,
  });
  const enroll = targets.find((t) => t.name === "enroll");
  assert.equal(enroll.line, 101);
  // "    grid." is 9 characters, so `enroll` starts at column 9 - unshifted,
  // because only the first line of a span begins mid-line.
  assert.equal(enroll.character, 9);
});

test("the target cap is a budget, not a preference", () => {
  const code = "fn go() {\n  a.one();\n  b.two();\n  c.three();\n  d.four();\n}";
  const targets = refineTargets({ languageId: "rust", code, spanStartLine: 0, spanStartCharacter: 0, max: 2 });
  assert.deepEqual(targets.map((t) => t.name), ["one", "two"]);
});

test("names that sit after a dot but resolve to no user symbol are not targets", () => {
  const code = "async fn go() {\n    client.send(req).await;\n}";
  const targets = refineTargets({ languageId: "rust", code, spanStartLine: 0, spanStartCharacter: 0, max: 10 });
  assert.deepEqual(targets.filter((t) => t.via === "member").map((t) => t.name), ["send"]);
});

test("a span with nothing to look up returns nothing rather than a guess", () => {
  const targets = refineTargets({
    languageId: "rust",
    code: "fn total() -> usize {\n    let mut n = 0;\n    n += 1;\n    n\n}",
    spanStartLine: 0,
    spanStartCharacter: 0,
    max: 6,
  });
  assert.deepEqual(targets, []);
});

test("the same name twice is one target", () => {
  const code = "fn go() {\n  a.push(1);\n  a.push(2);\n}";
  const targets = refineTargets({ languageId: "rust", code, spanStartLine: 0, spanStartCharacter: 0, max: 6 });
  assert.deepEqual(targets.map((t) => t.name), ["push"]);
});

// ------------------------------------------------------ the own-span drop
//
// Every target cursor sits INSIDE the span being rewritten, so the provider
// always answers with at least the site that was asked about. Handing that back
// shows the model the code it is being asked to improve and calls it an idiom.

test("the function's own uses are dropped, in that file only, and only in range", () => {
  const span = { uri: "file:///a/src/m.rs", startLine: 10, endLine: 20 };
  const sites = usageSitesOutsideSpan(
    [
      { uri: "file:///a/src/m.rs", line: 9 },
      { uri: "file:///a/src/m.rs", line: 10 },
      { uri: "file:///a/src/m.rs", line: 15 },
      { uri: "file:///a/src/m.rs", line: 20 },
      { uri: "file:///a/src/m.rs", line: 21 },
      { uri: "file:///a/src/other.rs", line: 15 },
    ],
    span,
  );
  assert.deepEqual(sites, [
    { uri: "file:///a/src/m.rs", line: 9 },
    { uri: "file:///a/src/m.rs", line: 21 },
    { uri: "file:///a/src/other.rs", line: 15 },
  ]);
});

test("a function whose symbols are used nowhere else yields no sites at all", () => {
  const sites = usageSitesOutsideSpan(
    [{ uri: "file:///a/src/m.rs", line: 12 }],
    { uri: "file:///a/src/m.rs", startLine: 10, endLine: 20 },
  );
  assert.deepEqual(sites, []);
});

// ----------------------------------------------------------- the prompt bytes

const USAGE = ["How this repository already calls `enroll`:\n```\ngrid.enroll(t, Band::Regional);\n```"];

test("the prompt is deterministic and its sections are in the injected order", () => {
  const input = {
    languageId: "rust",
    code: "fn go() {\n    grid.enroll(t);\n}",
    usage: USAGE,
    surface: "Types in play:\n- Grid",
  };
  const a = assembleRefinePrompt(input);
  const b = assembleRefinePrompt(input);
  assert.equal(a, b);
  assert.ok(a.indexOf("Types in play:") < a.indexOf("How this repository already calls"));
  // Usage sits NEAREST the code: v28 measured the model reaching for whatever is
  // closest, and the idiom is what this round is for.
  assert.ok(a.indexOf("How this repository already calls") < a.indexOf("compiles and is correct"));
});

test("the prompt states the premise (it compiles) and forbids a behaviour change", () => {
  const p = assembleRefinePrompt({ languageId: "rust", code: "fn go() {}", usage: USAGE });
  assert.match(p, /compiles and is correct/);
  assert.match(p, /Do not change what it does/);
  assert.match(p, /Do not change its name, its signature/);
  assert.match(p, /reply with it unchanged/);
  assert.match(p, /Output nothing outside the code block/);
});

test("the refine prompt carries no diagnostics section, because there are none", () => {
  const p = assembleRefinePrompt({ languageId: "rust", code: "fn go() {}", usage: USAGE });
  assert.equal(p.includes("Compiler diagnostics"), false);
  assert.equal(p.includes("failed the compiler check"), false);
});

test("staged context leads, exactly as it does in generation and repair", () => {
  const p = assembleRefinePrompt({
    languageId: "rust",
    code: "fn go() {}",
    usage: USAGE,
    surface: "Types in play:\n- Grid",
    contextBlocks: [
      { uri: "file:///a/src/notes.rs", range: { startLine: 0, endLine: 0 }, text: "// house rule" },
    ],
  });
  assert.ok(p.indexOf("house rule") < p.indexOf("Types in play:"));
});

test("a bodyOnly target is asked for a body, never a whole definition", () => {
  const p = assembleRefinePrompt({
    languageId: "python",
    code: "    return 1\n",
    bodyOnly: true,
    usage: USAGE,
  });
  assert.match(p, /ONLY the body/);
  assert.match(p, /do not repeat the signature, the header, or the docstring/);
});

test("a type target is asked about the type, in the type's own word", () => {
  const p = assembleRefinePrompt({ languageId: "csharp", code: "class A {}", kind: "class", usage: USAGE });
  assert.match(p, /The class below compiles and is correct/);
  assert.match(p, /complete class definition/);
});

test("the usage header names the symbol", () => {
  assert.equal(usageHeaderFor("enroll"), "How this repository already calls `enroll`:");
});

// ------------------------------------------------- the introduced-error diff

const err = (code, message, fileName, line = 1) => ({
  level: "error",
  code,
  message,
  rendered: message,
  spans: [{ fileName, isPrimary: true, byteStart: line * 10, byteEnd: line * 10 + 4, line, column: 1 }],
});
const warn = (code, message, fileName) => ({ ...err(code, message, fileName), level: "warning" });

test("a refine that changed nothing the compiler sees introduces nothing", () => {
  const before = [err("CS0246", "type not found", "A.cs")];
  assert.deepEqual(introducedErrors(before, before), []);
});

test("a new error is reported even when the file already had a different one", () => {
  const before = [err("CS0246", "type not found", "A.cs")];
  const after = [err("CS0246", "type not found", "A.cs"), err("CS1061", "no member Foo", "A.cs")];
  const introduced = introducedErrors(before, after);
  assert.equal(introduced.length, 1);
  assert.equal(introduced[0].code, "CS1061");
});

// The diff must survive the whole point of the gesture: a rewritten body moves
// every line below it.
test("the diff keys on the message, not the position, so a body rewrite is not the whole file", () => {
  const before = [err("CS0246", "type not found", "A.cs", 12)];
  const after = [err("CS0246", "type not found", "A.cs", 400)];
  assert.deepEqual(introducedErrors(before, after), []);
});

test("a SECOND instance of an error the file already had once is introduced", () => {
  const before = [err("CS1061", "no member Foo", "A.cs")];
  const after = [err("CS1061", "no member Foo", "A.cs"), err("CS1061", "no member Foo", "A.cs")];
  assert.equal(introducedErrors(before, after).length, 1);
});

test("the same message in a different file is a different fault", () => {
  const before = [err("CS1061", "no member Foo", "A.cs")];
  const after = [err("CS1061", "no member Foo", "B.cs")];
  const introduced = introducedErrors(before, after);
  assert.equal(introduced.length, 1);
  assert.equal(introduced[0].spans[0].fileName, "B.cs");
});

test("warnings are not errors: a refine that adds one introduces nothing", () => {
  const before = [];
  const after = [warn("CS8604", "possible null", "A.cs")];
  assert.deepEqual(introducedErrors(before, after), []);
});

test("an error the refine FIXED is not reported as introduced", () => {
  const before = [err("CS1061", "no member Foo", "A.cs")];
  assert.deepEqual(introducedErrors(before, []), []);
});

// ###########################################################################
// Review finding 2: masking that eats the span.
//
// `maskNonCode`'s literal scanner is C-shaped, and two ordinary shapes defeat
// it: a Rust lifetime tick (an odd apostrophe count) and a C# verbatim string
// ending in a backslash. When it loses, it blanks everything after the opener,
// and a function full of calls reports no targets at all - so the human is told
// there is nothing here. The guard is not a fixed scanner, it is a floor.
// ###########################################################################

test("a rust lifetime tick does not blank the span's targets", () => {
  const withTick = [
    "fn head(input: &'static str) -> Option<&str> {",
    "    let cleaned = input.trim();",
    "    cleaned.split_whitespace().next()",
    "}",
  ].join("\n");
  const targets = refineTargets({
    code: withTick,
    languageId: "rust",
    spanStartLine: 10,
    spanStartCharacter: 0,
    max: 6,
  });
  const names = targets.map((t) => t.name);
  assert.ok(names.includes("trim"), `the lifetime tick swallowed the body: ${JSON.stringify(names)}`);
  assert.ok(names.includes("split_whitespace"), JSON.stringify(names));
});

test("a C# verbatim path string does not blank the span's targets", () => {
  const verbatim = [
    "public void Scan()",
    "{",
    '    var root = @"C:\\data\\";',
    "    var files = _io.GetFiles(root);",
    "    _log.Info(files.Count);",
    "}",
  ].join("\n");
  const names = refineTargets({
    code: verbatim,
    languageId: "csharp",
    spanStartLine: 3,
    spanStartCharacter: 0,
    max: 6,
  }).map((t) => t.name);
  assert.ok(names.includes("GetFiles"), `the verbatim string swallowed the body: ${JSON.stringify(names)}`);
});

// The guard must not cost the masking its normal job: a name that appears ONLY
// in a comment or a string, in a span masking handles correctly, is still not a
// call this function makes.
test("ordinary masking still applies where the scanner is right", () => {
  const ordinary = [
    "fn run(&self) {",
    "    // this used to call self.legacy_reset()",
    '    let label = "shutdown_now";',
    "    self.state.reset(label);",
    "}",
  ].join("\n");
  const names = refineTargets({
    code: ordinary,
    languageId: "rust",
    spanStartLine: 0,
    spanStartCharacter: 0,
    max: 6,
  }).map((t) => t.name);
  assert.ok(names.includes("reset"), JSON.stringify(names));
  assert.ok(!names.includes("legacy_reset"), `a name from a comment reached the provider: ${JSON.stringify(names)}`);
});
