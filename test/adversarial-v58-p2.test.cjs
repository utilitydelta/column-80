// Adversarial review: session-v58 phase 2, the two repair toasts and the
// widened line-break set (src/vscode/toastText.ts, src/vscode/oracleSurface.ts).
//
// Written AFTER the implementation and after the blind oracle
// (test/blind-v58-p2-repair-onelines.test.cjs, 32 rows green). Its job is the
// opposite of the oracle's: every row here is an attempt to break the thing,
// and a row that stays green is a claim of CLEAN, not decoration.
//
// Branch point HEAD bb32501 (phase 1). Contract: session-v58/contract-phase2.md
// with its two amendments.
//
// THE TRAP THIS FILE OBEYS. A raw U+2028 or U+2029 anywhere in a .cjs file -
// inside a comment included - makes the file fail to parse, because JS treats
// both as line terminators. Every separator here is built with
// String.fromCharCode and there is not one raw occurrence in the file.
//
// WHAT IS ATTACKED, group by group:
//   A  C6, the regression clause. The widening may only ADD cut points.
//   B  hasMoreThanOneLine against the rule it replaced, and every live copy of
//      the rule it replaced.
//   C  the refine site's `tail`, its punctuation, and what a hostile
//      Diagnostic.message or symbolName does to the composed sentence.
//   D  the two new channel lines: they carry a raw "\n" on purpose, so the row
//      forgery route phase 1 closed for [http-body] is re-asked here.
//   E  import direction.
//   F  tierDisabledToast, now a wrapper.
//
// Run: node --test test/adversarial-v58-p2.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { execFileSync } = require("node:child_process");
const { bundleCore } = require("./.blind-util.cjs");

// ---------------------------------------------------------------------------
// The break set, built by code point.
// ---------------------------------------------------------------------------

const LF = "\n";
const CR = "\r";
const CRLF = "\r\n";
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const NEL = String.fromCharCode(0x0085);

const BREAKS = [
  ["LF", LF],
  ["CRLF", CRLF],
  ["bare CR", CR],
  ["U+2028", LS],
  ["U+2029", PS],
  ["U+0085 NEL", NEL],
];

/** JSON, with the three invisible separators named rather than emitted. */
const show = (s) =>
  JSON.stringify(String(s)).split(LS).join("<U+2028>").split(PS).join("<U+2029>").split(NEL).join("<U+0085>");

// ---------------------------------------------------------------------------
// Bundles and source reads.
// ---------------------------------------------------------------------------

const SRC = path.join(__dirname, "..", "src");
const readSrc = (rel) => fs.readFileSync(path.join(SRC, rel), "utf8");

const leaf = bundleCore(
  "adv-v58-p2-leaf",
  `export { firstLine, hasMoreThanOneLine, oneLineWithPointer, tierDisabledToast } from "../src/vscode/toastText";\n`,
);
const { firstLine, hasMoreThanOneLine, oneLineWithPointer, tierDisabledToast } = leaf.mod;

const core = bundleCore(
  "adv-v58-p2-core",
  `export { TsOracle } from "../src/core/tsOracle";
export * as anthropic from "../src/core/anthropicInstruct";\n`,
);
const { TsOracle } = core.mod;
const { makeAnthropicInstruct } = core.mod.anthropic;

test.after(() => {
  leaf.cleanup();
  core.cleanup();
});

// ---------------------------------------------------------------------------
// The branch point, reimplemented rather than snapshotted. Both of these are
// transcriptions of HEAD bb32501's src/vscode/toastText.ts, which is what C6
// measures against.
// ---------------------------------------------------------------------------

const bpFirstLine = (s) => (s ?? "").split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
const bpTierToast = (why, end = "") => {
  const one = bpFirstLine(why);
  return one === why.trim() ? `${one}${end}` : `${one}${end} The full message is in the output channel.`;
};

/** The superseded pointer rule, as an expression over the CURRENT firstLine.
 *  Amendment 1 replaced it because trim() strips U+2028/U+2029 and not NEL. */
const supersededPointerRule = (why) => firstLine(why) !== (why ?? "").trim();

/** Every string of up to `depth` atoms, with an optional separator after each.
 *  Small alphabet, exhaustive: the shapes that break a cut rule are blank
 *  segments, leading and trailing whitespace, and runs of separators. */
function corpus(atoms, seps, depth) {
  const out = [];
  const walk = (left, s) => {
    if (left === 0) {
      out.push(s);
      return;
    }
    for (const a of atoms) for (const sep of seps) walk(left - 1, s + a + sep);
  };
  walk(depth, "");
  return out;
}

const ATOMS = ["", " ", "a", "  b  ", "\t", "x."];

/** Strings the product actually produces or carries, LF-only. */
const PRODUCT_LF_STRINGS = [
  undefined,
  "",
  "function generation is disabled",
  "EACCES: permission denied, mkdir '/x'",
  "Anthropic 500 Internal Server Error: {\"error\":{\"message\":\"overloaded\"}}",
  "Ollama 503 Service Unavailable: {\"error\":\"model not found\"}",
  "Claude Code exited 1: Error: connection closed",
  "error[E0308]: mismatched types\n  expected `u64`, found `&str`\n  note: in this expansion",
  "Type '{ leaf: number; }[]' is not assignable to type 'Leaf[]'.\n" +
    "  Type '{ leaf: number; }' is not assignable to type 'Leaf'.\n" +
    "    Types of property 'leaf' are incompatible.\n" +
    "      Type 'number' is not assignable to type 'string'.",
  'the hardware tier could not be resolved. Re-run "Column 80: Select Hardware Tier"',
  "\n\n",
  "trailing\n",
];

// ===========================================================================
// A. C6 - the regression clause. The widening may only ADD cut points.
// ===========================================================================

test("A1 [CLEAN]: on 1296 exhaustive LF-only strings the widened cut lands exactly where the branch point's did", () => {
  const all = corpus(ATOMS, ["", LF], 3);
  assert.ok(all.length > 1000, `harness: corpus too small (${all.length})`);
  for (const s of all) {
    assert.strictEqual(
      firstLine(s),
      bpFirstLine(s),
      `C6: LF-only input ${show(s)} moved its cut. Branch point ${show(bpFirstLine(s))}, widened ${show(firstLine(s))}.`,
    );
  }
});

test("A2 [CLEAN]: the same holds on the strings the product actually produces", () => {
  for (const s of PRODUCT_LF_STRINGS) {
    for (const c of [CR, LS, PS, NEL]) {
      assert.ok(!(s ?? "").includes(c), `harness: ${show(s)} is not LF-only, so this row would be testing C5.`);
    }
    assert.strictEqual(firstLine(s), bpFirstLine(s), `C6: product string ${show(s)} moved its cut.`);
  }
});

// The sharp one named in the review brief. `\r\n` is matched as ONE alternative
// before the character class, so a Windows-authored message must not gain a
// blank leading segment, an empty toast, or a different first line.
test("A3 [CLEAN]: 5832 CRLF-and-LF strings cut identically, with no blank segment and no emptied toast", () => {
  const all = corpus(ATOMS, ["", CRLF, LF], 3).filter((s) => !/\r(?!\n)/.test(s));
  assert.ok(all.length > 5000, `harness: corpus too small (${all.length})`);
  for (const s of all) {
    assert.strictEqual(firstLine(s), bpFirstLine(s), `C6: CRLF input ${show(s)} moved its cut.`);
    assert.strictEqual(
      tierDisabledToast(s, "."),
      bpTierToast(s, "."),
      `C6: CRLF input ${show(s)} produced a different disabled-tier toast than the branch point.`,
    );
    if (s.trim() !== "") {
      assert.notStrictEqual(firstLine(s), "", `C6: CRLF input ${show(s)} emptied a toast that had text in it.`);
    }
  }
});

// A bare CR is an ADDED cut point, so the first line is allowed to move. What is
// not allowed is emptying a notification that had text in it - the failure mode
// a leading-CR message would produce if the widened split left a blank segment
// in front and the finder did not skip it.
test("A4 [CLEAN]: across 13824 CR-bearing strings the added cut never empties a toast the branch point filled", () => {
  const all = corpus(ATOMS, ["", CR, CRLF, LF], 3);
  assert.ok(all.length > 13000, `harness: corpus too small (${all.length})`);
  for (const s of all) {
    if (bpFirstLine(s) !== "") {
      assert.notStrictEqual(firstLine(s), "", `C6: ${show(s)} had text at the branch point and toasts empty now.`);
    }
  }
});

// A capture group in a split pattern makes String.prototype.split interleave the
// captured separators into the result array, so `find` could return a separator
// as the "first line". LINE_BREAKS has none today; this pins that.
test("A5 [CLEAN]: the split pattern has no capture group, so no separator can be returned as the first line", () => {
  const src = readSrc("vscode/toastText.ts");
  const m = /const LINE_BREAKS = (\/.*\/)[a-z]*;/.exec(src);
  assert.ok(m, `harness: LINE_BREAKS is no longer a regex literal named that; found nothing in toastText.ts.`);
  assert.ok(
    !/\((?!\?)/.test(m[1]),
    `the split pattern ${m[1]} grew a capturing group. split() interleaves captures into the segment list, so ` +
      `firstLine could return a line break as the first line.`,
  );
  for (const [name, sep] of BREAKS) {
    const got = firstLine(sep + sep + "text");
    assert.strictEqual(got, "text", `a ${name} separator leaked into the segment list: ${show(got)}`);
  }
});

// ===========================================================================
// B. hasMoreThanOneLine against the rule it replaced.
// ===========================================================================

test("B1 [CLEAN]: on every LF-only string the new pointer rule answers what the old comparison answered", () => {
  const all = [...corpus(ATOMS, ["", LF], 3), ...PRODUCT_LF_STRINGS.filter((s) => s !== undefined)];
  for (const s of all) {
    assert.strictEqual(
      hasMoreThanOneLine(s),
      supersededPointerRule(s),
      `amendment 1 / C6: the pointer rule moved on LF-only input ${show(s)}. Old rule said ` +
        `${supersededPointerRule(s)}, hasMoreThanOneLine says ${hasMoreThanOneLine(s)}.`,
    );
  }
  for (const edge of [undefined, "", " ", LF, LF + LF, "a" + LF, LF + "a", "a" + LF + " " + LF]) {
    assert.strictEqual(
      hasMoreThanOneLine(edge),
      edge === undefined ? false : supersededPointerRule(edge),
      `amendment 1: edge ${show(edge)} disagrees.`,
    );
  }
});

/** Source with its comments removed, so a pin searches CODE.
 *
 *  Load bearing here: the fix for this row added a coupling comment that quotes
 *  the superseded expression verbatim, and a pin over the raw file matches that
 *  quotation and stays red forever. `://` is spared so a URL in a string does
 *  not swallow the rest of its line. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const at = line.search(/(^|[^:])\/\//);
      return at < 0 ? line : line.slice(0, at === 0 ? 0 : at + 1);
    })
    .join("\n");

// Amendment 1 ruled the pointer question is "more than one non-blank segment",
// precisely because trim()'s own set is uneven across the six breaks. This row
// found fnGen.ts rendering the SAME pointer sentence from an inline copy of the
// superseded comparison, over the SAME now-widened firstLine. It is fixed: the
// site imports hasMoreThanOneLine and calls it. The row stays as the pin that
// keeps the rule stated in one place.
//
// WHAT THIS ROW ASSERTS, and why it is not the divergence list. The four NEL
// divergences below are computed from two expressions this file can evaluate on
// its own - the superseded comparison over the widened firstLine, against
// hasMoreThanOneLine - so they are non-empty BY CONSTRUCTION, whatever the tree
// does. That is the point of amendment 1 rather than a fact about the product,
// and a row asserting they are empty could never go green. The product property
// is the one the defect actually named: no site outside the leaf runs the
// removed rule. The divergences ride along in the failure message as the
// evidence for why a stale copy would matter.
test("B2 [CLEAN]: no site outside the leaf still infers the pointer from the superseded comparison", () => {
  const disagree = [];
  for (const why of ["a tier message" + NEL, NEL + "a tier message", NEL, "a" + NEL + " " + NEL]) {
    if (supersededPointerRule(why) !== hasMoreThanOneLine(why)) disagree.push(show(why));
  }
  assert.ok(disagree.length > 0, "harness: the two rules must still diverge somewhere, or this pin guards nothing.");
  const hits = [];
  for (const rel of ["vscode/fnGen.ts", "vscode/oracleSurface.ts", "vscode/tightenDocComment.ts", "vscode/firstRun.ts"]) {
    const code = stripComments(readSrc(rel));
    const m = /firstLine\((\w+)\) === \1\.trim\(\)/.exec(code);
    if (m) hits.push(`${rel}:${code.slice(0, m.index).split("\n").length} runs \`${m[0]}\``);
  }
  assert.deepStrictEqual(
    hits,
    [],
    `amendment 1 says the pointer is owed when the message has more than one non-blank segment, "uniform across ` +
      `all six break forms", and the leaf exports hasMoreThanOneLine so every surface can say it the same way. ` +
      `A site still inferring it from \`firstLine(x) === x.trim()\` over the WIDENED firstLine disagrees with the ` +
      `leaf on ${disagree.join(", ")}: the toast appends "The full message is in the output channel." while the ` +
      `channel holds nothing the toast does not, which is the false promise amendment 1 was written to stop.`,
  );
});

// ===========================================================================
// C. The refine site: the tail, the punctuation, and hostile inputs.
// ===========================================================================

// The two sentences, transcribed from src/vscode/oracleSurface.ts. The row below
// pins them against the source so a rewording turns this group red rather than
// letting it drift into testing prose that no longer exists.
const REFINE_END = ".";
const REFINE_TAIL = " Undo it with the editor's own undo (the build was clean before this change).";
const refineText = (msg, { code = "TS2322: ", sym = "pick", n = 1 } = {}) =>
  `Column 80: the refine of ${sym} introduced ${n} error${n === 1 ? "" : "s"} that were not there before. ` +
  `First: ${code}${msg}`;
const giveUpText = (msg, { code = "TS2322: ", sym = "pick", n = 1 } = {}) =>
  `Column 80: repair stopped with ${n} error${n === 1 ? "" : "s"} still in ${sym}. First: ${code}${msg}`;

/** What the branch point rendered: the raw message, interpolated whole. */
const bpRefine = (msg, o) => refineText(msg, o) + REFINE_END + REFINE_TAIL;
const bpGiveUp = (msg, o) => giveUpText(msg, o);
/** What the tree renders now. */
const nowRefine = (msg, o) => oneLineWithPointer(refineText(msg, o), REFINE_END, REFINE_TAIL);
const nowGiveUp = (msg, o) => oneLineWithPointer(giveUpText(msg, o));

test("C0 [CLEAN]: the two sentences this group models are still the ones oracleSurface.ts composes", () => {
  const src = readSrc("vscode/oracleSurface.ts");
  for (const frag of [
    "Column 80: repair stopped with ${errors.length} error${errors.length === 1 ? \"\" : \"s\"} still in ",
    "that were not there before. ",
    "First: ${code0}${first.message}",
    REFINE_TAIL,
  ]) {
    assert.ok(src.includes(frag), `harness: oracleSurface.ts no longer composes ${JSON.stringify(frag)}.`);
  }
  assert.ok(
    /oneLineWithPointer\(\s*`Column 80: the refine of/.test(src.replace(/\/\/[^\n]*\n/g, "")),
    "harness: the refine toast no longer goes through oneLineWithPointer.",
  );
});

// The undo instruction is the actionable half and is passed as `tail`, so it has
// to survive whatever the diagnostic is. Eight hostile shapes, including one
// whose text IS the tail.
const HOSTILE_MESSAGES = {
  "four-line assignability": "Type 'A' is not assignable to type 'B'.\n  Type 'C'.\n    Types differ.\n      Type 'D'.",
  "empty first segment": "\nType 'x' is not assignable",
  "whitespace only": "   ",
  empty: "",
  "one bare CR": "head" + CR + "tail",
  "one NEL": "head" + NEL + "tail",
  "the tail, verbatim": REFINE_TAIL.trim() + "\n  and an elaboration",
  "nothing but breaks": LF + CR + NEL + LS,
};

test("C1 [CLEAN]: the undo clause survives every hostile diagnostic, unbroken and never doubled by accident", () => {
  for (const [name, msg] of Object.entries(HOSTILE_MESSAGES)) {
    const got = nowRefine(msg);
    for (const [bname, c] of [["LF", LF], ["CR", CR], ["U+2028", LS], ["U+2029", PS], ["NEL", NEL]]) {
      assert.ok(!got.includes(c), `C1: [${name}] left a ${bname} in the notification: ${show(got)}`);
    }
    // lastIndexOf, not indexOf: the "the tail, verbatim" shape puts the same
    // sentence inside the diagnostic, and the clause under test is the one the
    // `tail` parameter appended. A diagnostic that quotes the product's own
    // sentence makes the toast say it twice, which is cosmetic and only
    // reachable if a compiler ever emits that sentence.
    const at = got.lastIndexOf(REFINE_TAIL.trim());
    assert.ok(at >= 0, `C4: [${name}] swallowed the undo clause: ${show(got)}`);
    const after = got.slice(at + REFINE_TAIL.trim().length).trim();
    assert.ok(
      after === "" || /^The full message is in the output channel\.$/.test(after),
      `C4 / amendment 2: [${name}] put ${show(after)} after the undo clause; only the pointer may follow it.`,
    );
    assert.ok(/\bpick\b/.test(got) && /\b1 error\b/.test(got), `C4: [${name}] lost the symbol or the count.`);
  }
});

// `end` is applied AFTER the cut, so the caller's period cannot be eaten. The
// branch point's own doubled period (tsc messages end in ".") is out of scope
// for the phase and must be preserved exactly, not quietly tidied.
test("C2 [CLEAN]: punctuation is unchanged - no new '..' and none of the branch point's own removed", () => {
  const single = "Cannot find name 'missingIdentifier'.";
  assert.strictEqual(
    nowRefine(single),
    bpRefine(single),
    "C2 / falsifier 2: a single-line diagnostic must render byte-identically to the branch point, doubled " +
      "period and all.",
  );
  const noPeriod = "Cannot find name 'x'";
  assert.strictEqual(nowRefine(noPeriod), bpRefine(noPeriod), "C2: a message with no trailing period is unchanged.");
  const multi = "Type 'A' is not assignable.\n  Type 'C' is not assignable.";
  assert.ok(
    nowRefine(multi).includes("Type 'A' is not assignable.." + REFINE_TAIL),
    `C2: the branch point's doubled period is the phase's to keep, not to fix: ${show(nowRefine(multi))}`,
  );
  // The give-up site passes no `end`, exactly as the branch point had none.
  assert.strictEqual(nowGiveUp(single), bpGiveUp(single), "C2: the give-up sentence is unchanged on one line.");
  assert.ok(!nowGiveUp(single).endsWith(".."), "C2: the give-up site must not have grown a period.");
});

// introduced.length === 0 cannot reach the refine notification: the function
// returns before it. Pinned at the source, because a later edit that moves the
// early return would make `introduced[0]` undefined and throw inside a toast.
test("C3 [CLEAN]: an introduced.length of zero cannot reach the refine notification", () => {
  const src = readSrc("vscode/oracleSurface.ts");
  const guard = src.indexOf("if (introduced.length === 0) {");
  const first = src.indexOf("const first = introduced[0];");
  assert.ok(guard >= 0 && first > guard, "the introduced.length === 0 early return no longer precedes introduced[0].");
  const between = src.slice(guard, first);
  assert.ok(
    /outcome\("clean"\);\s*\n\s*return;/.test(between),
    `the zero case no longer returns before the notification is composed: ${JSON.stringify(between.slice(-200))}`,
  );
});

// DOCUMENTED, not a defect claim: no route was found that puts a line break in
// symbolName, so this row asserts the behaviour rather than condemning it. It is
// here because the failure is silent and total - the count and the whole
// "First:" clause vanish, and on the give-up surface the pointer glues itself to
// a half word with no period in front of it.
test("C4 [CLEAN, documented]: a line break inside symbolName silently truncates both sentences", () => {
  const got = nowGiveUp("Type 'A' is not assignable", { sym: "pi" + LF + "ck", n: 2 });
  assert.strictEqual(
    got,
    "Column 80: repair stopped with 2 errors still in pi The full message is in the output channel.",
    "if this string changes, the hazard changed with it and the worry in the review needs re-reading",
  );
  const r = nowRefine("Type 'A' is not assignable", { sym: "pi" + LF + "ck" });
  assert.ok(!/\b1 error\b/.test(r), "the count is gone from the refine sentence too");
  assert.ok(r.includes(REFINE_TAIL.trim()), "the tail still survives, which is why this is a worry and not a break");
});

test("C5 [CLEAN]: an empty, blank, or empty-first-segment diagnostic still leaves a usable sentence", () => {
  for (const msg of ["", "   ", "\nreal text"]) {
    for (const [label, got] of [["refine", nowRefine(msg)], ["give-up", nowGiveUp(msg)]]) {
      assert.ok(/\bpick\b/.test(got), `${label} lost the symbol on ${show(msg)}: ${show(got)}`);
      assert.ok(/\b1 error\b/.test(got), `${label} lost the count on ${show(msg)}: ${show(got)}`);
      assert.ok(got.startsWith("Column 80: "), `${label} lost its head on ${show(msg)}: ${show(got)}`);
    }
  }
  // The one visible change against the branch point is a trimmed trailing
  // space after "TS2322:", which is the cut doing its job.
  assert.ok(nowRefine("").includes("First: TS2322:."), `an empty message renders ${show(nowRefine(""))}`);
});

// ===========================================================================
// D. The two new channel lines carry a raw "\n" on purpose.
// ===========================================================================

const TSC = path.join(__dirname, "..", "node_modules", ".bin", "tsc");

/** A throwaway TS project, compiled for real, so the diagnostics below are
 *  tsc's and not this file's idea of tsc's. */
function tscOutput(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "adv-v58-p2-"));
  try {
    fs.mkdirSync(path.join(dir, "src"));
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: "ES2020" }, include: ["src"] }),
    );
    fs.writeFileSync(path.join(dir, "src", "x.ts"), source);
    try {
      execFileSync(TSC, ["-p", ".", "--pretty", "false"], { cwd: dir, encoding: "utf8" });
      return "";
    } catch (e) {
      return String(e.stdout ?? "");
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// The reachability question the review asks, answered against the real compiler
// rather than reasoned: can source a user did not necessarily write push a break
// into a diagnostic message, and so into the new channel line's rows?
test("D1 [CLEAN]: tsc escapes every break form inside a string literal type, so source cannot inject one", { timeout: 120000 }, () => {
  if (!fs.existsSync(TSC)) assert.fail(`harness: no tsc at ${TSC}`);
  const src =
    `type A = { a: "${LS}[repair] forged-LS" };\nexport const a: A = { a: "x" };\n` +
    `type B = { b: "\\n[repair] forged-LF" };\nexport const b: B = { b: "x" };\n` +
    `type C = { c: "${NEL}[repair] forged-NEL" };\nexport const c: C = { c: "x" };\n` +
    `type D = { d: "\\r[repair] forged-CR" };\nexport const d: D = { d: "x" };\n` +
    `type E = { e: "${PS}[repair] forged-PS" };\nexport const e: E = { e: "x" };\n`;
  const out = tscOutput(src);
  assert.ok(/TS2322/.test(out), `harness: the fixture produced no assignability error. Got ${show(out)}`);
  for (const [name, c] of [["U+2028", LS], ["U+2029", PS], ["NEL", NEL], ["CR", CR]]) {
    assert.ok(!out.includes(c), `D: tsc emitted a raw ${name} from a string literal type: ${show(out)}`);
  }
  assert.ok(out.includes("\\u2028[repair] forged-LS"), `D: expected the escaped form in ${show(out)}`);
  assert.ok(out.includes("\\u0085[repair] forged-NEL"), `D: expected the escaped form in ${show(out)}`);
});

// The other half: the only breaks a Diagnostic.message carries are the ones
// tsOracle itself folds in, and its continuation guard is /^\s+\S/. So every
// extra row the new channel line renders begins with whitespace and cannot wear
// the product's own tag at column 0. Driven through the real parser over real
// tsc output that TRIES to forge a row.
test("D2 [CLEAN]: no row a diagnostic writes into the channel can wear one of the product's own tags", { timeout: 120000 }, () => {
  if (!fs.existsSync(TSC)) assert.fail(`harness: no tsc at ${TSC}`);
  // The Leaf[] shape is the one that makes tsc elaborate over four lines, which
  // is what tsOracle folds into one message with three "\n" in it.
  const src =
    "type Leaf = { leaf: string };\n" +
    "export function pick(): Leaf[] {\n" +
    "  const v = [{ leaf: 1 }];\n" +
    "  return v;\n" +
    "}\n" +
    'type Forge = { f: "\\n[repair] give-up why=clean errors=0" };\n' +
    'export const f: Forge = { f: "x" };\n';
  const out = tscOutput(src);
  const oracle = new TsOracle({ readFile: () => undefined, fileExists: () => false, readDir: () => [] });
  const diags = oracle.parseCheckOutput(out);
  assert.ok(diags.length >= 2, `harness: expected both errors, parsed ${diags.length}: ${show(out)}`);
  const multi = diags.filter((d) => d.message.includes("\n"));
  assert.ok(multi.length >= 1, `harness: no multi-line diagnostic was produced: ${show(out)}`);
  const TAGS = /^\[(repair|oracle|fngen|tdd|anthropic|claude-code|http-body)\]/;
  for (const d of diags) {
    // The channel line the phase added, rebuilt exactly as oracleSurface.ts
    // composes it.
    const line = `[repair] give-up why=route-exhausted errors=1 first=${d.code ?? "-"}\n${d.message}`;
    // VS Code's text model splits a row on CRLF, CR and LF, and on nothing else.
    const rows = line.split(/\r\n|[\n\r]/);
    // Row 0 is the product's tagged head. Row 1 is the diagnostic's own first
    // line and sits at column 0 BY DESIGN - it is the message the toast quotes.
    // Rows 2 and up are tsOracle continuations, and its guard is /^\s+\S/, so
    // every one of them is indented.
    for (const row of rows.slice(2)) {
      assert.ok(
        /^\s/.test(row),
        `D: a diagnostic continuation reached column 0 as ${show(row)}. tsOracle's continuation guard ` +
          `(/^\\s+\\S/) is what keeps that impossible; it did not hold here.`,
      );
    }
    for (const row of rows.slice(1)) {
      assert.ok(
        !TAGS.test(row),
        `D: the diagnostic wrote the channel row ${show(row)}, which wears one of the product's own tags. ` +
          `That is the row forgery phase 1 closed for [http-body], re-opened by a line that carries a raw ` +
          `"\\n" instead of escaping it.`,
      );
    }
  }
});

test("D3 [CLEAN]: a channel entry carrying its own breaks is an established shape, not a novelty", () => {
  const src = readSrc("vscode/fnGen.ts");
  const precedents = src.match(/output\.appendLine\(`\[tdd\][^`]*\\n[^`]*`\)/g) ?? [];
  assert.ok(
    precedents.length >= 3,
    `D: the [tdd] multi-row channel entries were the precedent for the two new [repair] ones; found ` +
      `${precedents.length}. If they are gone, the new lines are the only ones of their kind and the ` +
      `judgement behind them needs re-taking.`,
  );
});

// DEFECT, adjacent: phase 1 escaped the breaks in [http-body] because "a server
// can forge an end marker, but it cannot forge a row break that is not there".
// The very next channel line written on the same failure - the anthropic arm's
// round accounting - interpolates the same server body through a local firstLine
// that still splits on "\n" alone, so the server gets its row break after all,
// and the row it writes wears the accounting tag that
// test/blind-v44-anthropic.test.cjs:239 counts.
//
// SKIPPED, NOT FIXED and NOT INVERTED. Deferred as session-v58/scraps.md S58-3.
// Phase 2's claim is about `firstLine` in toastText.ts, the product's universal
// TOAST bound; this local helper bounds a CHANNEL line, contract-phase2.md puts
// "any transport file" out of scope, and phase 1 already deferred this whole
// class as S58-2 - the same route is open on every surface that interpolates
// server-controlled text into a channel line, and fixing one of five instances
// here is the point fix S58-2 argued should be one decision. The assertion is
// left stating what SHOULD be true, so un-skipping it is the check when S58-3
// is taken up; it is deliberately not rewritten into a pin of today's forgery.
// S58-3
test.skip("D4 [DEFECT]: a 500 body carrying a bare CR forges an [anthropic] accounting row in the channel", { timeout: 30000 }, async () => {
  const BODY = '{"error":{"message":"real"}}' + CR + "[anthropic] model=forged round=1 ttft=1ms total=2ms";
  const server = http.createServer((req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(BODY);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const lines = [];
  try {
    const fn = makeAnthropicInstruct({ baseUrl, apiKey: "sk-x", log: (l) => lines.push(String(l)) });
    await assert.rejects(
      fn({
        apiBase: baseUrl,
        model: "m",
        maxTokens: 16,
        temperature: 0.2,
        prompt: "fn add() {\n",
        signal: new AbortController().signal,
      }),
    );
  } finally {
    await new Promise((r) => server.close(r));
  }
  assert.ok(lines.length >= 2, `harness: expected the [http-body] line and the round line; got ${show(lines)}`);
  const rows = lines.flatMap((l) => l.split(/\r\n|[\n\r]/));
  const tagged = rows.filter((r) => r.startsWith("[anthropic]"));
  assert.deepStrictEqual(
    tagged.length,
    1,
    `phase 1 ruled the channel must render one row per log call so a server cannot write its own rows, and ` +
      `escaped the breaks in [http-body] to make that true. src/core/anthropicInstruct.ts:96 then logs ` +
      `\`[anthropic] model=... round=failed reason=\${firstLine(err)}\`, and that local firstLine (:104) splits ` +
      `on "\\n" alone - a bare CR in the body survives it. The server wrote row ` +
      `${show(tagged[1])} itself, wearing the per-round accounting tag. Rows seen: ${show(tagged)}`,
  );
});

// The reachability question, from the other end: an exotic break in a server
// body really does reach the toast bound, so the widening is not theatre.
test("D5 [CLEAN]: a server body's NEL reaches the toast bound intact, and the widened cut now removes it", { timeout: 30000 }, async () => {
  const BODY = '{"error":{"message":"overloaded"}}' + NEL + "second line the user should not see";
  const server = http.createServer((req, res) => {
    res.writeHead(503, {});
    res.end(BODY);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  let err;
  try {
    const fn = makeAnthropicInstruct({ baseUrl, apiKey: "sk-x", log: () => {} });
    try {
      await fn({
        apiBase: baseUrl,
        model: "m",
        maxTokens: 16,
        temperature: 0.2,
        prompt: "fn add() {\n",
        signal: new AbortController().signal,
      });
    } catch (e) {
      err = e;
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
  assert.ok(err && err.message.includes(NEL), `harness: the NEL did not survive into the error: ${show(err)}`);
  // src/vscode/fnGen.ts:5503 is what a gesture catch-all does with that message.
  assert.ok(!firstLine(err.message).includes(NEL), "the widened cut must remove it");
  assert.ok(bpFirstLine(err.message).includes(NEL), "and the branch point's cut did not - so the case was live");
});

// ===========================================================================
// E. Import direction.
// ===========================================================================

test("E1 [CLEAN]: toastText.ts still imports nothing, so the new oracleSurface edge cannot cycle", () => {
  const leafSrc = readSrc("vscode/toastText.ts");
  const imports = leafSrc.match(/^\s*import\s/gm) ?? [];
  assert.deepStrictEqual(
    imports,
    [],
    `toastText.ts must import nothing. oracleSurface.ts, fnGen.ts, tightenDocComment.ts and firstRun.ts all ` +
      `take a value edge to it, and fnGen registers three of those four.`,
  );
  assert.ok(!/require\(/.test(leafSrc), "toastText.ts must not require() its way to an edge either.");
  const surface = readSrc("vscode/oracleSurface.ts");
  assert.ok(/import \{ oneLineWithPointer \} from "\.\/toastText"/.test(surface), "the new edge is not there.");
  assert.ok(
    !/from "\.\/oracleSurface"/.test(leafSrc) && !/from "\.\/fnGen"/.test(leafSrc),
    "the leaf grew an edge back to a registrar.",
  );
});

// ===========================================================================
// F. tierDisabledToast, now a wrapper.
// ===========================================================================

test("F1 [CLEAN]: the v57 tier pins are unmoved, and `end` is still applied after the cut", () => {
  // The four shapes test/blind-v57-p3-tier-message.test.cjs pins.
  assert.strictEqual(tierDisabledToast("function generation is disabled"), "function generation is disabled");
  assert.strictEqual(tierDisabledToast("function generation is disabled", "."), "function generation is disabled.");
  assert.strictEqual(
    tierDisabledToast("head\ntail"),
    "head The full message is in the output channel.",
    "a cut message gets the pointer",
  );
  assert.strictEqual(
    tierDisabledToast("head\ntail", "."),
    "head. The full message is in the output channel.",
    "the caller's punctuation lands on the CUT sentence, before the pointer, never inside the cut",
  );
  // A caller that pre-glues its own period still loses it to the cut. That is
  // the documented reason `end` exists and it must keep behaving that way.
  assert.strictEqual(
    tierDisabledToast("head\ntail."),
    "head The full message is in the output channel.",
    "a pre-glued period on a multi-line why is still eaten by the cut - the hazard the `end` parameter exists for",
  );
});

test("F2 [CLEAN]: on the whole CRLF-and-LF corpus the wrapper is byte-identical to the function it replaced", () => {
  for (const s of corpus(ATOMS, ["", CRLF, LF], 3).filter((x) => !/\r(?!\n)/.test(x))) {
    for (const end of ["", ".", " -"]) {
      assert.strictEqual(
        tierDisabledToast(s, end),
        bpTierToast(s, end),
        `tierDisabledToast moved on ${show(s)} with end ${show(end)}.`,
      );
    }
  }
});
