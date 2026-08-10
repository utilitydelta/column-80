// ADVERSARIAL review evidence for session-v36 phase 1 (the backtick gesture for
// comment-named types). Every row here is EVIDENCE for a finding in the review
// report, not a contract. Nothing in this file was written to be satisfied by
// the implementation; the rows that fail are the findings.
//
// Rows are tagged in their names:
//   [DEFECT]  fails today, and the report argues it should not.
//   [RECORD]  passes today, and pins behaviour the report describes but does
//             NOT claim is wrong. Deleting one of these loses the evidence for
//             a judgement call the next reader will re-litigate.
//
// This file must never be treated as the contract set. `test/blind-*.test.cjs`
// is that, and this file does not edit or duplicate it.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v36-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");
const { bundleCore } = require("./.blind-util.cjs");

// ── two bundles ──────────────────────────────────────────────────────────────
// The core one needs no vscode. `fnGen.ts` does, so its miners come through the
// same stub the other provider-level oracles use; nothing here touches the
// editor API.
const core = bundleCore(
  "adversarial-v36-p1-core",
  `export { spanTypesInPlay } from "../src/core/repairTypes";
export { commentTypesIn } from "../src/core/commentTypes";
export { backtickedTypeNames, typesNamedIn } from "../src/core/compilerDirected";\n`,
);
const { spanTypesInPlay, commentTypesIn, backtickedTypeNames } = core.mod;

const STUB = path.join(__dirname, ".adversarial-v36-p1-stub.cjs");
fs.writeFileSync(
  STUB,
  `module.exports = {
  Position: class {}, Range: class {}, ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: (s) => ({ toString: () => String(s) }), file: (s) => ({ toString: () => String(s) }) },
  workspace: { getConfiguration: () => ({ get: (k, fb) => fb }) },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  ProgressLocation: {}, EndOfLine: {}, SymbolKind: {},
};\n`,
);
const VS_ENTRY = path.join(__dirname, ".adversarial-v36-p1-vs.entry.ts");
const VS_OUT = path.join(__dirname, ".adversarial-v36-p1-vs.bundle.cjs");
fs.writeFileSync(
  VS_ENTRY,
  `export { prioritizedTypes, tsPrioritizedTypes, csPrioritizedTypes, pyPrioritizedTypes, goPrioritizedTypes } from "../src/vscode/fnGen";\n`,
);
esbuild.buildSync({
  entryPoints: [VS_ENTRY],
  bundle: true,
  outfile: VS_OUT,
  format: "cjs",
  platform: "node",
  alias: { vscode: STUB },
});
const vs = require(VS_OUT);

test.after(() => {
  core.cleanup();
  [STUB, VS_ENTRY, VS_OUT].forEach((f) => fs.rmSync(f, { force: true }));
});

const show = (v) => JSON.stringify(v);
const NO_LOCALS = new Set();

// ═════════════════════════════════════════════════════════════════════════════
// A. The doc-leg refactor. `typesNamedIn`'s inline backtick loop became the
//    exported `backtickedTypeNames`. The acceptance says the doc behaviour is
//    BYTE-IDENTICAL, so the evidence is differential, not example-based.
//
//    SUPERSEDED 2026-08-02. Byte-identity was the right bar for v36, whose whole
//    claim was that it changed no behaviour. session-v37 item 1 changes the rule
//    on purpose and the human ratified it, so a row demanding identity now
//    forbids the shipped decision.
//
//    The differential rows are kept rather than deleted, pointed at the
//    invariant that survives: the new rule is a strict WIDENING, so every name
//    the old rule found is still found. The one exception is a lone capital,
//    which is a type parameter and is now refused deliberately, because
//    splitting `Map<K, V>` would otherwise contribute two names with no
//    definition to resolve and one budget slot each. That exception is stated
//    here, not tolerated silently, so a second narrowing cannot hide behind it.
// ═════════════════════════════════════════════════════════════════════════════

// HEAD's loop body, copied verbatim out of `git show b9847c4:src/core/compilerDirected.ts`
// and reduced to the sequence it fed `take()`. Duplicates included, because
// `take` deduped and `backtickedTypeNames` claims to return "duplicates and all".
function headDocLeg(docComment) {
  const out = [];
  for (const m of docComment.matchAll(/`([A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*)`/g)) {
    const seg = m[1].split("::").pop();
    if (seg !== undefined && /^[A-Z]/.test(seg)) {
      out.push(seg);
    }
  }
  return out;
}

const PATHOLOGICAL = [
  "",
  "`",
  "``",
  "```",
  "````",
  "`A`",
  "`A``B`",
  "``A``",
  "`` `A`",
  "a `Sprocket",
  "`Sprocket",
  "Sprocket`",
  "`A` `B` `C`",
  "`a::B`",
  "`A::b`",
  "`A::B::C`",
  "`::A`",
  "`A::`",
  "`_A`",
  "`_`",
  "`T`",
  "`MAX_SIZE`",
  "`A1`",
  "`1A`",
  "`CaféType`",
  "`Élan`",
  "/// `A`\r\n/// `B`\r\n",
  "/// `A`\n/// `A`\n",
  "`A\nB`",
  "`A `B` C`",
  "`A-B`",
  "`A.B`",
  "`A B`",
  "\u0000`A`\u0000",
  "`A`".repeat(500),
];

// Everything the pre-v37 rule found, minus the lone capitals it is now allowed
// to refuse. A name in here that the shipped rule does not return is a
// NARROWING, which is the failure this pair exists to catch.
const stillOwed = (s) => headDocLeg(s).filter((n) => n.length > 1);

// SCOPE, and it is a correction rather than a caveat. This row was first written
// claiming the new rule "loses nothing the old rule found", and that claim is
// FALSE. On a line with an unbalanced backtick count the new rule pairs strictly
// left to right where the old rule's restrictive content class re-synced onto the
// next backtick by accident, so `` // ``Type` `` loses `Type`. Proven in
// `test/adversarial-v37-p1.test.cjs` section C and measured at 6 lines of 3786
// in this repo, 0 in acme-db, 0 in the Go corpus, 0 in contoso dotnet.
//
// The row passed anyway, because its 35-input corpus does not contain the shape.
// A green row resting on a corpus gap is worse than a red one, so the claim is
// narrowed here to what the corpus can actually support and the real bound lives
// with the evidence in the v37 file.
const BALANCED = (s) => s.split(/\r\n|\r|\n/).every((line) => (line.split("`").length - 1) % 2 === 0);

test("[RECORD] A1 [SUPERSEDED 2026-08-02]: on BALANCED input the new rule loses nothing the old rule found", () => {
  let checked = 0;
  for (const s of PATHOLOGICAL) {
    if (!BALANCED(s)) {
      continue;
    }
    checked++;
    const got = backtickedTypeNames(s);
    for (const owed of stillOwed(s)) {
      assert.ok(got.includes(owed), `narrowed against HEAD's inline loop: lost ${show(owed)} from ${show(s)}`);
    }
  }
  assert.ok(checked > 20, `only ${checked} of the 35 inputs are balanced, which is too few to call this a check`);
  // And the widening is real, so the row cannot pass by the two rules being
  // equal. Probes are multi-letter: this corpus is built from single letters,
  // which the new rule refuses on purpose.
  assert.deepEqual(backtickedTypeNames("`Aa::Bb::Cc`"), ["Cc"], "a `::` path still reads its last segment");
  assert.deepEqual(backtickedTypeNames("`Aa Bb`"), ["Aa"], "a span with a trailing value now yields its first name");
  assert.deepEqual(headDocLeg("`Aa Bb`"), [], "and the old rule yielded nothing for it");
});

test("[RECORD] A2 [SUPERSEDED 2026-08-02]: a 20k-case fuzz on the new rule's own properties", () => {
  // The differential half of this row died with byte-identity, and it died for a
  // reason worth writing down rather than deleting. The old rule's content class
  // was so restrictive that an opener followed by anything but an identifier
  // start was SKIPPED, which re-synced its pairing onto the next backtick by
  // accident. The new rule pairs strictly left to right, which is what a backtick
  // span means. On "a-aB.\u00e9A B`-B.`AA`0`b" the old rule reads `AA` out of what is
  // actually the text BETWEEN two spans. That is the old rule being wrong, not
  // the new one narrowing, and no scoping predicate separates the two cases
  // honestly. So the fuzz now asserts the new rule's own properties instead.
  //
  // These three are the ones that matter: the gesture is opt-in, so a name the
  // developer did not put inside a backtick span must never come back, and the
  // repair path awaits this function on the extension host, so it must not throw.
  let seed = 0x5eed_1234;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 0x1_0000_0000);
  const ALPHABET = "`ABab_:. \n\r\t01-`\u00e9`";
  let nonEmpty = 0;
  for (let i = 0; i < 20000; i++) {
    const n = 1 + Math.floor(rnd() * 24);
    let s = "";
    for (let j = 0; j < n; j++) {
      s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    }
    const got = backtickedTypeNames(s);
    assert.ok(Array.isArray(got), `threw or returned a non-array on ${show(s)}`);
    if (got.length > 0) {
      nonEmpty++;
    }
    // Every span the scanner could possibly have read, by an INDEPENDENT split:
    // odd-indexed pieces of a per-line backtick split are the insides of spans.
    const spans = [];
    for (const line of s.split(/\r\n|\r|\n/)) {
      const pieces = line.split("`");
      for (let k = 1; k < pieces.length; k += 2) {
        spans.push(pieces[k]);
      }
    }
    for (const name of got) {
      // Unicode-aware, like the rule. An ASCII-only shape check here would
      // reject `CaféType`, which is a legal identifier in all five languages and
      // one the rule now returns whole rather than truncating to `Caf`.
      assert.match(name, /^[A-Z][\p{L}\p{N}_]+$/u, `${show(name)} is not a type-shaped name, from ${show(s)}`);
      assert.ok(
        spans.some((sp) => sp.includes(name)),
        `${show(name)} came from outside every backtick span of ${show(s)}`,
      );
    }
  }
  // Anti-vacuity. A fuzz that returns nothing on all 20000 cases proves the
  // harness ran, not that the rule works.
  assert.ok(nonEmpty > 500, `the fuzz produced a name on only ${nonEmpty} of 20000 cases`);
});

// ═════════════════════════════════════════════════════════════════════════════
// B. THE ORDER. `spanTypesInPlay` subtracts the DOC comment's NAMES from the
//    comment leg so the doc keeps its own tier. Subtracting names rather than
//    text has a consequence the tier list does not describe.
// ═════════════════════════════════════════════════════════════════════════════

const REPAIR_SPAN = {
  languageId: "rust",
  signature: "fn build()",
  code: "/// Uses `Config`.\nfn build() {\n    // needs `Config` and `Widget`\n}",
  docComment: "/// Uses `Config`.",
};

test("[DEFECT] B1: repair ranks a type named ONCE below a type named in BOTH the body comment and the doc", () => {
  // `Config` is written twice by the developer, in the doc and again in the
  // failing body. `Widget` is written once. The comment tier is above the doc
  // tier, and within the comment tier `Config` is first-seen, so on the stated
  // order (signature, body code, body comment, doc, diagnostic) `Config` leads.
  //
  // It does not, because the leg subtracts the doc's NAMES from the comment
  // leg's output instead of subtracting the doc's TEXT from the span before
  // scanning it. `Config` is evicted from the tier it earned and re-enters at
  // the lower one. Under PREFILL_TYPE_CAP=4 with a receiver and three signature
  // types in front, that is the difference between resolved and not.
  const got = spanTypesInPlay(REPAIR_SPAN);
  assert.deepEqual(got, ["Config", "Widget"], `got ${show(got)}`);
});

test("[DEFECT] B2: whether the caller ALSO passes docComment silently inverts the order of identical span text", () => {
  // Same `code` both times. The only difference is whether the caller hands the
  // doc over a second time as `docComment`. The subtraction is keyed on that,
  // so the injected order flips.
  const code = "/// Uses `Config`.\nfn build() {\n    // needs `Widget`\n}";
  const withDoc = spanTypesInPlay({ languageId: "rust", signature: "fn build()", code, docComment: "/// Uses `Config`." });
  const withoutDoc = spanTypesInPlay({ languageId: "rust", signature: "fn build()", code });
  assert.deepEqual(withDoc, withoutDoc, `withDoc ${show(withDoc)} vs withoutDoc ${show(withoutDoc)}`);
});

test("[RECORD] B3: the subtraction only REORDERS; it never drops a name outright", () => {
  // The attack was that the filter could delete a name the doc tier then
  // refuses on its own filters (ALL-CAPS, single letter, a C# namespace, a
  // prelude value). It cannot: both tiers run through the same `take`, so a
  // name the doc tier would refuse is a name the comment tier would refuse too.
  // Recorded because it is the half of attack 2 that came back clean.
  for (const name of ["MAX_LOD", "T", "Ok", "Atlas"]) {
    const body = `fn build() {\n    // \`${name}\` \`Keep\`\n}`;
    const withDoc = spanTypesInPlay({ languageId: "rust", signature: "fn build()", code: body, docComment: `/// \`${name}\`` });
    const withoutDoc = spanTypesInPlay({ languageId: "rust", signature: "fn build()", code: body });
    assert.deepEqual(
      [...withDoc].sort(),
      [...withoutDoc].sort(),
      `${name}: the doc filter changed the SET, not just the order`,
    );
  }
});

test("[RECORD] B4: the diagnostic tier is still last, behind both comment tiers", () => {
  const got = spanTypesInPlay({
    languageId: "rust",
    signature: "fn build()",
    code: "fn build() {\n    // `Widget`\n}",
    docComment: "/// `Config`",
    diagnosticTypes: ["Boom"],
  });
  assert.deepEqual(got, ["Widget", "Config", "Boom"], `got ${show(got)}`);
});

test("[RECORD] B5: fn-gen and repair emit OPPOSITE orders for byte-identical source", () => {
  // The implementer's choice, argued in both files: in fn-gen the doc is the
  // instruction, in repair the failing span is the evidence. Recorded rather
  // than called a defect, because the argument is written down and the goal did
  // not forbid it. What is NOT written down anywhere the user can see is that
  // the same two backticked names resolve in a different order depending on
  // which gesture they used.
  //
  // FIXTURE CORRECTED after triage. This row originally pasted the doc line
  // INSIDE `code`, which no live caller does: `resolveFunctionAtCursor`
  // normalizes the head, so the span starts at the declaration and the doc is
  // trivia above it. On that original fixture the two now AGREE, both returning
  // ["Config","Widget"], because triage finding 2 deleted the doc-name
  // subtraction that was demoting the shared name. The finding itself survives
  // the correction: on the shape the live callers actually build, the orders are
  // still opposite.
  const code = "fn build() {\n    // and `Widget`\n}";
  const fngen = vs.prioritizedTypes("fn build()", "/// uses `Config`", "", NO_LOCALS, "build", code);
  const repair = spanTypesInPlay({ languageId: "rust", signature: "fn build()", code, docComment: "/// uses `Config`" });
  assert.deepEqual(fngen, ["Config", "Widget"], `fn-gen: ${show(fngen)}`);
  assert.deepEqual(repair, ["Widget", "Config"], `repair: ${show(repair)}`);
});

test("[RECORD] B6: in fn-gen the comment tier outranks the doc-only-LOCAL-type tier", () => {
  // `RealLocal` is a VERIFIED file-local type: it is in `localTypeNames`, so it
  // is known to exist. The four backticked names are unverified text. The new
  // leg was inserted above `referencedLocalSymbols`, so with PREFILL_TYPE_CAP=4
  // the verified type is the one that falls off the end. The code comment
  // claims the leg sits "above the ambient import tier"; it also sits above
  // this one, and says so nowhere.
  const got = vs.prioritizedTypes(
    "fn build()",
    "/// mentions RealLocal in prose",
    "",
    new Set(["RealLocal"]),
    "build",
    "fn build() {\n    // `Junk1` `Junk2` `Junk3` `Junk4`\n}",
  );
  assert.deepEqual(got, ["Junk1", "Junk2", "Junk3", "Junk4", "RealLocal"], `got ${show(got)}`);
});

// ═════════════════════════════════════════════════════════════════════════════
// C. STRINGS AND MASKING. The leg reads RAW span text, so everything rests on
//    `nextComment` telling code from string. It mostly does.
// ═════════════════════════════════════════════════════════════════════════════

// THE RULING, kept verbatim from when this row was `todo`: DEFERRED by triage as
// scraps S36-1: the honest fix is the quote set in commentSyntaxFor, which is a
// v25 contract change and not a phase-1 job. Red on purpose, and the row states
// the real hole in the all-five-languages criterion.
//
// INVERTED 2026-08-10, because a test that must be red is not a test. The row
// USED TO assert `["Sprocket"]` - the name the developer backticked, which is
// what a working gesture would return - and was red every run. It now asserts
// the empty list the shipped code actually returns, so the hole is pinned as a
// fact. S36-1 is still open and `["Sprocket"]` is still the answer that closes
// it; this row goes red the day the quote set is fixed, which is the right time
// for it to demand attention. C2 below is the control: the same shape in C# and
// Go returns `["Sprocket"]`, so this is a Rust-row fault and not a dead leg.
test("KNOWN WRONG: a Rust `'\"'` char literal anywhere in the span makes the gesture silently dead", () => {
  // Rust's row in `commentSyntaxFor` deliberately leaves `'` out of the quote
  // set, because in Rust a tick is a lifetime far more often than a char. The
  // cost was priced as "a missed comment inside a char literal". It is larger
  // than that here: the bare `"` inside the char literal opens a phantom string
  // that runs to the next `"` in the span, and every comment it swallows is
  // gone. A parser, a CSV writer, an escaper - any Rust body that handles a
  // quote character - loses the whole gesture with no message.
  //
  // C# and Go carry `'` in their quote sets and are unaffected (see C2).
  const got = commentTypesIn("fn f() {\n    let q = '\"';\n    // `Sprocket`\n}", "rust", undefined, undefined);
  assert.deepEqual(got, [], `WAS asserted as ["Sprocket"]: got ${show(got)}, the whole gesture swallowed by the phantom string`);
});

test("[RECORD] C2: the same shape is fine in C# and Go, so C1 is a Rust-row fault, not a leg fault", () => {
  assert.deepEqual(
    commentTypesIn("void f() {\n    var q = '\"';\n    // `Sprocket`\n}", "csharp", undefined, undefined),
    ["Sprocket"],
  );
  assert.deepEqual(
    commentTypesIn("func f() {\n\tq := '\"'\n\t// `Sprocket`\n}", "go", undefined, undefined),
    ["Sprocket"],
  );
  // And the ordinary Rust char shapes the tick-exclusion was designed for still work.
  for (const line of ["let q = 'a';", "let q = '\\'';", "let q = '\\\\';", "fn g<'a>(x: &'a str) {}"]) {
    assert.deepEqual(
      commentTypesIn(`fn f() {\n    ${line}\n    // \`Sprocket\`\n}`, "rust", undefined, undefined),
      ["Sprocket"],
      `rust line ${show(line)}`,
    );
  }
});

test("[RECORD] C3: the per-language string traps the review named all hold", () => {
  const nothing = [
    ["rust plain string holding a line comment", "rust", 'fn f() {\n    let s = "// `Sprocket`";\n}'],
    ["rust raw string with an embedded quote", "rust", 'fn f() {\n    let s = r#"a "b" // `Sprocket`"#;\n}'],
    ["ts template literal (delimited BY backticks)", "typescript", "function f() {\n  const u = `https://x/ `Sprocket` `;\n}"],
    ["ts template literal with an interpolation", "typescript", "function f() {\n  const u = `a ${b} // `Sprocket` c`;\n}"],
    ["ts plain string holding backticks", "typescript", 'function f() {\n  const s = "a `Sprocket` b";\n}'],
    ["go raw string", "go", "func f() {\n\ts := `// `Sprocket` x`\n}"],
    ["cs verbatim string with a doubled quote", "csharp", 'void f() {\n    var s = @"a "" b // `Sprocket` c";\n}'],
    ["cs verbatim string with two doubled quotes", "csharp", 'void f() {\n    var s = @"a "" b "" c // `Sprocket` d";\n}'],
    ["cs raw triple-quoted string", "csharp", 'void f() {\n    var s = """ a // `Sprocket` b """;\n}'],
    ["cs interpolated string", "csharp", 'void f() {\n    var s = $"a {x} // `Sprocket`";\n}'],
    ["py single-quoted string holding a hash", "python", "def f():\n    x = '# `Sprocket`'\n"],
    ["py inline triple-quoted string", "python", 'def f():\n    x = """`Sprocket`"""\n'],
  ];
  for (const [label, lang, code] of nothing) {
    assert.deepEqual(commentTypesIn(code, lang, undefined, undefined), [], label);
  }
  // Anti-vacuity: the same fixtures resolve when the name IS in a real comment.
  assert.deepEqual(commentTypesIn("func f() {\n\ts := `raw // x`\n\t// `Sprocket`\n}", "go", undefined, undefined), ["Sprocket"]);
});

test("[RECORD] C4: a Python string literal that OPENS a content line is read as prose", () => {
  // `nextComment` classifies a `\"\"\"` at the start of a content line as a doc
  // comment, which is right for a docstring and wrong for a multi-line string
  // that happens to be laid out that way. The gesture inherits it. The cost is
  // one cap slot spent on a name the developer did write down, so this is
  // recorded, not billed.
  assert.deepEqual(
    commentTypesIn('def f():\n    x = (\n        """see `Sprocket` here"""\n    )\n', "python", undefined, undefined),
    ["Sprocket"],
  );
  assert.deepEqual(
    commentTypesIn("def f():\n    d = {\n        'k':\n        '''`Sprocket`''',\n    }\n", "python", undefined, undefined),
    ["Sprocket"],
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// D. TERMINATION AND COST.
// ═════════════════════════════════════════════════════════════════════════════

test("[RECORD] D1: the walk terminates on every degenerate opener", () => {
  const inputs = [
    ["rust", "fn f() { /* `Sprocket`"],
    ["rust", "fn f() { /*"],
    ["rust", "x//"],
    ["rust", "x/*"],
    ["rust", "//"],
    ["rust", '"'],
    ["rust", "// `Sprocket`\r\n// `Widget`\r\n"],
    ["python", 'def f():\n    """`Sprocket`'],
    ["python", '"""'],
    ["python", "#"],
    ["typescript", "/*/"],
    ["go", "`"],
  ];
  for (const [lang, code] of inputs) {
    assert.ok(Array.isArray(commentTypesIn(code, lang, undefined, undefined)), `${lang} ${show(code)}`);
  }
});

// THE RULING, kept verbatim from when this row was `todo`: DEFERRED by triage as
// scraps S36-2: the root cause is ledAt in fimComment.ts and it pre-dates this
// phase, with scaffold.ts walking the same scanner more slowly on the fn-gen
// path. Red on purpose.
//
// INVERTED 2026-08-10, because a test that must be red is not a test. The row
// USED TO assert `oneLineMs < 200`, a raw millisecond BUDGET the quadratic walk
// blows through at ~710ms, and was red every run.
//
// The inversion is NOT `oneLineMs > 200`. A wall-clock bound on the other side is
// a flake waiting for a loaded box, and it would also stop being true the moment
// someone buys a faster machine without fixing anything. What this row is really
// about is the SHAPE, so the shape is what it asserts now: doubling the comment
// count on one line more than DOUBLES the cost. Linear would be 2.0x, quadratic
// 4.0x, and the bar sits at 2.5x. Measured idle across three runs: 3.56x, 3.97x,
// 3.96x. The cross-check against the newline'd control stays, also as a ratio.
//
// The bar was 2.8x for one day. A ratio is far steadier than the millisecond
// budget it replaced, but it is NOT contention-proof: session-v48's adversarial
// review re-measured it under 2x CPU oversubscription and saw 3.10x, 3.17x,
// 3.24x - an 11% margin on a 2-core shared runner. 2.5x keeps the separation
// from linear (2.0x) that the row is about and doubles the headroom. This row
// belongs to roadmap item 23's population now; that is the cost of converting
// it rather than deleting it.
//
// This row goes red when `ledAt` is fixed, which is exactly when someone should
// look at it.
test("KNOWN WRONG: the walk is O(n^2) in a span with many comments and few newlines", () => {
  // `nextComment` calls `ledAt`, which answers "is only whitespace before this
  // opener" with a BACKWARD `lastIndexOf(\"\\n\")`. On a span with no newlines
  // that scan is the whole prefix, once per comment, so N comments cost O(N*n).
  //
  // 200KB of one-line block comments took 721ms here. The same 200KB with a
  // newline per comment took 12.6ms, which is the control that proves the
  // shape. The budget below sits ~3.5x under the measured quadratic cost and
  // ~16x above the linear one, so it is not a timing-margin row.
  //
  // The root cause is `ledAt` and PRE-DATES this phase: `harvestBodyComments`
  // (scaffold.ts) has walked `nextComment` the same way on the fn-gen path
  // since v25, and is slower still. What is new is that the REPAIR path now
  // has the same unbounded synchronous walk, on the extension host, awaited
  // before the model call.
  const ms = (code) => {
    const t = process.hrtime.bigint();
    commentTypesIn(code, "rust", undefined, undefined);
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  const linearMs = ms("/*a*/\n".repeat(40000));
  const halfMs = ms("/*a*/".repeat(20000));
  const oneLineMs = ms("/*a*/".repeat(40000));

  // The algorithmic fact. Doubling the comment count on ONE line costs more than
  // double, which is the definition of superlinear. 2.0x would be linear, 4.0x is
  // the textbook quadratic, and 2.5x is the bar.
  assert.ok(
    oneLineMs / halfMs > 2.5,
    `doubling 20000 one-line comments to 40000 cost ${(oneLineMs / halfMs).toFixed(2)}x ` +
      `(${halfMs.toFixed(0)}ms -> ${oneLineMs.toFixed(0)}ms); at or under 2.0x the walk would be linear and ledAt fixed`,
  );
  // And the control that says it is the MISSING NEWLINES, not the byte count:
  // the same 200KB with a newline per comment is orders cheaper.
  assert.ok(
    oneLineMs / linearMs > 10,
    `200KB on one line took ${oneLineMs.toFixed(0)}ms against ${linearMs.toFixed(1)}ms across lines, ` +
      `a ratio of ${(oneLineMs / linearMs).toFixed(1)}x; the walk is quadratic in the PREFIX, not linear in the span`,
  );
});

// ═════════════════════════════════════════════════════════════════════════════
// E. THE SEAM. Per-language parity between the new leg and the `typesNamedIn`
//    call it sits beside, and the test-gen withholding.
// ═════════════════════════════════════════════════════════════════════════════

const FIVE = [
  ["rust", vs.prioritizedTypes, "fn build()", "fn build() {\n    // needs `Sprocket`\n}"],
  ["typescript", vs.tsPrioritizedTypes, "function build()", "function build() {\n  // needs `Sprocket`\n}"],
  ["csharp", vs.csPrioritizedTypes, "void build()", "void build() {\n    // needs `Sprocket`\n}"],
  ["python", vs.pyPrioritizedTypes, "def build():", "def build():\n    # needs `Sprocket`\n    pass"],
  ["go", vs.goPrioritizedTypes, "func build()", "func build() {\n\t// needs `Sprocket`\n}"],
];

test("[RECORD] E1: the fn-gen leg fires in all five languages through each one's own comment opener", () => {
  for (const [lang, miner, sig, span] of FIVE) {
    assert.deepEqual(miner(sig, undefined, "", NO_LOCALS, "build", span), ["Sprocket"], lang);
  }
});

test("[RECORD] E2: withholding the span (the test-gen gate) contributes nothing and leaves the doc leg intact", () => {
  for (const [lang, miner, sig, span] of FIVE) {
    const withSpan = miner(sig, "/// uses `Config`", "", NO_LOCALS, "build", span);
    const withheld = miner(sig, "/// uses `Config`", "", NO_LOCALS, "build");
    assert.deepEqual(withSpan, ["Config", "Sprocket"], `${lang} with span`);
    assert.deepEqual(withheld, ["Config"], `${lang} withheld`);
  }
});

test("[RECORD] E3: each language's new leg applies the SAME stop set and excludeName as its typesNamedIn call", () => {
  // The attack was that the sixth argument could have picked up a different
  // stop set, or missed Go's `parseGoReceiverSymbol` reduction of excludeName.
  // It did not: for every language, a name in a comment is admitted or refused
  // exactly as the same name in the doc comment is.
  const probes = ["T", "MAX_LOD", "Result", "String", "Sprocket", "Build"];
  for (const [lang, miner, sig, span] of FIVE) {
    const opener = lang === "python" ? "#" : "//";
    const backticks = probes.map((p) => `\`${p}\``).join(" ");
    const body = span.replace(/(\/\/|#) needs `Sprocket`/, `${opener} ${backticks}`);
    const viaComment = miner(sig, undefined, "", NO_LOCALS, "Build", body);
    const viaDoc = miner(sig, `/// ${backticks}`, "", NO_LOCALS, "Build");
    assert.deepEqual(viaComment, viaDoc, `${lang}: comment leg ${show(viaComment)} vs doc leg ${show(viaDoc)}`);
  }
});

test("[RECORD] E4: Go reduces excludeName through parseGoReceiverSymbol in the new leg too", () => {
  const got = vs.goPrioritizedTypes(
    "func (s *Stripe) Summarize() int",
    undefined,
    "",
    NO_LOCALS,
    "(*Stripe).Summarize",
    "func (s *Stripe) Summarize() int {\n\t// `Summarize` `Sprocket`\n}",
  );
  assert.deepEqual(got, ["Stripe", "Sprocket"], `got ${show(got)}`);
});

test("[RECORD] E5: C# path qualifiers are refused through the new leg, as through the old one", () => {
  const got = vs.csPrioritizedTypes(
    "public Atlas.Cursor Build()",
    undefined,
    "",
    NO_LOCALS,
    "Build",
    "public Atlas.Cursor Build() {\n    // `Atlas` `Sprocket`\n}",
  );
  assert.deepEqual(got, ["Cursor", "Sprocket"], `got ${show(got)}`);
});

test("[RECORD] E6: repair admits a comment naming the TARGET itself, exactly as its doc leg already did", () => {
  // `spanTypesInPlay` has no excludeName concept and the new leg passes
  // `undefined`, so a C# body comment naming the method under repair resolves
  // the target as its own collaborator. Recorded, not billed: the doc leg
  // beside it has had the identical hole since before this phase, so fixing one
  // without the other would be the inconsistency.
  const viaComment = spanTypesInPlay({
    languageId: "csharp",
    signature: "public int StripeFanout(int n)",
    code: "public int StripeFanout(int n) {\n    // see `StripeFanout`\n}",
  });
  const viaDoc = spanTypesInPlay({
    languageId: "csharp",
    signature: "public int StripeFanout(int n)",
    code: "public int StripeFanout(int n) {\n}",
    docComment: "/// see `StripeFanout`",
  });
  assert.deepEqual(viaComment, ["StripeFanout"]);
  assert.deepEqual(viaDoc, ["StripeFanout"]);
});
