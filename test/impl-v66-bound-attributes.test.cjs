// session-v66: a dictated head reads through its attribute and decorator lines. Measured
// 2026-09-02 in the host tier: a dictated Rust enum served `#[derive(Debug)]` as its first
// line, the line bound stopped there, and the doc comment landed over a bare attribute with
// no enum under it. The rule is scoped to dictated requests (`headThroughAttributes`);
// keystroke FIM keeps the bound it was measured with.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");
const { mod, cleanup } = bundleCore("impl-v66-bound-attributes", 'export * from "../src/core/fimBound";\n');
const { headLineIndex, boundContinuation, boundReached } = mod;
const pp = bundleCore("impl-v66-bound-attributes-pp", 'export * from "../src/core/postprocess";\n');
test.after(() => { cleanup(); pp.cleanup(); });

test("the whole pipeline (postprocessBounded): the text the stream stopped on keeps its head under the attribute for a dictated request, and keystroke FIM keeps its one line", () => {
  // The exact text the product's stream stop fired on, 2026-09-02 (`[fim] bound stop after 32
  // chars`), which the safe-tail retract then cut back to the attribute alone.
  const raw = "#[derive(Debug)]\nstruct Point {\n";
  const dictated = pp.mod.postprocessBounded(raw, { suffix: "", currentLinePrefix: "", multiline: true, bound: { languageId: "rust", currentLinePrefix: "", headThroughAttributes: true } });
  assert.strictEqual(dictated.text, "#[derive(Debug)]\nstruct Point {");
  assert.strictEqual(dictated.bound.keptLines, 2);
  const keystroke = pp.mod.postprocessBounded(raw, { suffix: "", currentLinePrefix: "", multiline: true, bound: { languageId: "rust", currentLinePrefix: "" } });
  assert.strictEqual(keystroke.text, "#[derive(Debug)]");
  const cs = pp.mod.postprocessBounded("[Serializable]\npublic class Point\n", { suffix: "", currentLinePrefix: "", multiline: true, bound: { languageId: "csharp", currentLinePrefix: "", headThroughAttributes: true } });
  assert.strictEqual(cs.text, "[Serializable]\npublic class Point");
});

const ctx = (languageId, headThroughAttributes) => ({ languageId, currentLinePrefix: "", ...(headThroughAttributes ? { headThroughAttributes: true } : {}) });

test("headLineIndex: attribute lines are skipped only when the context asks, and only when a content line follows", () => {
  const rust = ["#[derive(Debug)]", "pub enum Kind {", "    Small,", "}"];
  assert.strictEqual(headLineIndex(rust, 0, ctx("rust", true)), 1);
  assert.strictEqual(headLineIndex(rust, 0, ctx("rust", false)), 0, "keystroke FIM is untouched");
  assert.strictEqual(headLineIndex(["#[derive(Debug)]", "#[serde(rename_all = \"snake_case\")]", "pub struct P {"], 0, ctx("rust", true)), 2, "several attributes");
  assert.strictEqual(headLineIndex(["#[derive(Debug)]"], 0, ctx("rust", true)), 0, "an attribute with nothing under it is the head");
  assert.strictEqual(headLineIndex(["#[derive(Debug)]", ""], 0, ctx("rust", true)), 0, "an attribute followed by a blank line is the head");
  assert.strictEqual(headLineIndex(["[Serializable]", "public class P", "{", "}"], 0, ctx("csharp", true)), 1);
  assert.strictEqual(headLineIndex(["@dataclass", "class P:", "    x: int"], 0, ctx("python", true)), 1);
  assert.strictEqual(headLineIndex(["@Component({ selector: 'x' })", "export class X {", "}"], 0, ctx("typescript", true)), 1);
  assert.strictEqual(headLineIndex(["// comment", "type Kind int"], 0, ctx("go", true)), 0, "go has no attribute lines");
  assert.strictEqual(headLineIndex(["", "#[derive(Debug)]", "pub struct P;"], 1, ctx("rust", true)), 2, "the lead of blank lines is respected");
});

test("boundContinuation: a dictated Rust enum keeps the attribute AND the head under it; the declaration bound then serves the head and stops, as it does for any head", () => {
  const raw = "#[derive(Debug)]\npub enum Kind {\n    Small,\n    Medium,\n    Large,\n}\nfn after() {}\n";
  const dictated = boundContinuation(raw, ctx("rust", true));
  assert.ok(dictated.text.startsWith("#[derive(Debug)]\npub enum Kind {"), dictated.text);
  assert.ok(!dictated.text.includes("fn after"), "and never runs past the construct");
  const keystroke = boundContinuation(raw, ctx("rust", false));
  assert.strictEqual(keystroke.text.trimEnd(), "#[derive(Debug)]", `keystroke FIM still bounds at the attribute line: ${JSON.stringify(keystroke.text)}`);
});

test("the seal: a head under an attribute line still counts as ONE head line, so its open brace is not closed into `{}`", () => {
  const r = boundContinuation("#[derive(Debug)]\npub enum Kind {\n    Small,\n    Medium,\n    Large,\n}\n", ctx("rust", true));
  assert.strictEqual(r.text.trimEnd(), "#[derive(Debug)]\npub enum Kind {", JSON.stringify(r.text));
  const plain = boundContinuation("pub enum Kind {\n    Small,\n    Medium,\n    Large,\n}\n", ctx("rust", true));
  assert.strictEqual(plain.text.trimEnd(), "pub enum Kind {", `unchanged without the attribute: ${JSON.stringify(plain.text)}`);
});

test("the streaming stop and the final bound count the cap from the same line (review round 2, finding 2)", () => {
  // Four content lines past the attribute: the stop must not fire one line early.
  const raw = "#[inline]\npub fn place(\n    name: &str,\n    x: f64,\n    y: f64,\n) {\n";
  const c = ctx("rust", true);
  let stopAt = -1;
  for (let i = 1; i <= raw.length; i++) {
    if (boundReached(raw.slice(0, i), c)) { stopAt = i; break; }
  }
  assert.ok(stopAt > 0, "the stop fires");
  const prefix = boundContinuation(raw.slice(0, stopAt), c).text;
  const whole = boundContinuation(raw, c).text;
  assert.strictEqual(prefix, whole, `the prefix at the stop serves what the whole serves: ${JSON.stringify(prefix)} vs ${JSON.stringify(whole)}`);
});

test("boundReached, the streaming stop: attribute lines alone never decide a dictated bound; the head under them does", () => {
  assert.strictEqual(boundReached("#[derive(Debug)]\n", ctx("rust", true)), false, "waiting for the head");
  assert.strictEqual(boundReached("#[derive(Debug)]\n#[serde(default)]\n", ctx("rust", true)), false, "still waiting");
  // Keystroke FIM: a lone complete line is not a decided cut while the stream runs (measured
  // pre-existing behaviour); the final bound still cuts at the attribute line.
  assert.strictEqual(boundReached("#[derive(Debug)]\n", ctx("rust", false)), false);
  assert.strictEqual(boundReached("#[derive(Debug)]\npub enum Kind {\n", ctx("rust", true)), true, "the head opened a block: decided");
  assert.strictEqual(boundReached("#[derive(Debug)]\npub struct Unit;\n", ctx("rust", true)), true, "the head ended a statement: decided");
  assert.strictEqual(boundReached("@dataclass\n", ctx("python", true)), false);
  assert.strictEqual(boundReached("@dataclass\nclass P:\n", ctx("python", true)), true);
  assert.strictEqual(boundReached("[Serializable]\n", ctx("csharp", true)), false);
});

test("boundContinuation: a C# attribute over a class, and a Python decorator over a class, read through to the head", () => {
  const cs = boundContinuation("[Serializable]\npublic class Point\n{\n    public double X;\n}\n", ctx("csharp", true));
  assert.ok(cs.text.startsWith("[Serializable]\npublic class Point"), cs.text);
  const py = boundContinuation("@dataclass\nclass Point:\n    x: float\n    y: float\n\nORIGIN = Point(0, 0)\n", ctx("python", true));
  assert.ok(py.text.startsWith("@dataclass\nclass Point:"), py.text);
  assert.ok(!py.text.includes("ORIGIN"), `stops at the construct: ${JSON.stringify(py.text)}`);
});

test("a dictated head with no attribute is bounded exactly as before", () => {
  for (const [lang, raw] of [["rust", "pub struct Unit;\nfn x() {}\n"], ["typescript", "export type Id = string;\nconst y = 1;\n"], ["python", "class Kind(Enum):\n    A = 1\n\nz = 2\n"]]) {
    const a = boundContinuation(raw, ctx(lang, true));
    const b = boundContinuation(raw, ctx(lang, false));
    assert.strictEqual(a.text, b.text, `${lang}: the flag changes nothing without an attribute line`);
  }
});
