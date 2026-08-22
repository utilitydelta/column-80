// Blind oracle (v12 type-gen, PYTHON): two contracts, both from the surface
// spec + the Python scout's ground truth ONLY. Never reads src/**.
//
//   PART A — the pure Python type-kind classifier (a NEW pure core function
//   Phase 2 adds; RED until then). It reads a class HEADER (decorator line(s)
//   through the `class NAME(bases):` line) and returns "class" | "enum".
//   Python is the hard end: pyright reports Class(5) for plain class,
//   @dataclass, AND Enum subclass (scout-py.md Q1), so the kind cannot tell
//   them apart — the SOUND signal is the base list on the header line. An enum
//   base is `Enum`/`IntEnum`/`StrEnum`/`Flag`/`IntFlag`, or ANY name ending in
//   `Enum` (scout-py.md 2d). A plain class or @dataclass has no enum base.
//
//     ASSUMED NAME/SIGNATURE (the implementer must conform, or negotiate by
//     matching a different name — this pin is the spec):
//       pyTypeGenKind(headerLines: string[]): "class" | "enum"
//       exported from src/core/pyExtraction.ts
//     where headerLines are the class's header lines: the decorator line(s)
//     from range.start.line, plus the `class NAME(bases):` line at
//     selectionRange.start.line. An enum base ANYWHERE in the base list wins.
//
//   PART B — the PER-LANGUAGE Python type-instruction vocabulary of
//   `assembleFnGenPrompt` (src/core/prompt). Phase 2 adds the Python member
//   nouns: a Python CLASS instruction names the type's "attributes" (Python
//   vocabulary), a Python ENUM instruction names the enum's "members". Neither
//   carries "fields"/"variants" (Rust), "no impl blocks" (Rust), nor "Implement
//   the function". FROZEN: Rust struct->"fields" / enum->"variants" byte-exact,
//   and the Python FUNCTION path (kind omitted / "function") is the exact v1
//   function instruction. A red FROZEN guard = this file mismodelled current
//   bytes; fix the guard, not the contract.
//
// Run: SKIP_LIVE=1 node --test test/blind-v12-typegen-python.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

// Bundle both surfaces. pyExtraction takes an injected runner / is pure and
// never imports vscode, so it bundles headless (same as blind-v11-pyextractor).
let mod = {};
let bundleErr;
let cleanup = () => {};
try {
  const b = bundleCore(
    "blind-v12-typegen-python",
    `export { assembleFnGenPrompt } from "../src/core/prompt";\n` +
      `export { pyTypeGenKind } from "../src/core/pyExtraction";\n`,
  );
  mod = b.mod;
  cleanup = b.cleanup;
} catch (e) {
  bundleErr = e;
}
test.after(() => cleanup());

const { assembleFnGenPrompt, pyTypeGenKind } = mod;

// A red-bundle test skips (not fails) the body so a RED run is one loud failure
// at the bundle guard rather than a wall of TypeErrors.
const gtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip(`surface bundle failed to build: ${bundleErr.message}`);
    return fn(ctx);
  });

test("bundle guard: prompt + pyExtraction (pyTypeGenKind) build headless", () => {
  if (bundleErr) assert.fail(`surface bundle failed: ${bundleErr.message}`);
  assert.strictEqual(typeof assembleFnGenPrompt, "function", "assembleFnGenPrompt exported");
  assert.strictEqual(
    typeof pyTypeGenKind,
    "function",
    'pyTypeGenKind not exported from src/core/pyExtraction (assumed name "pyTypeGenKind(headerLines: string[])")',
  );
});

// ===========================================================================
// PART A — pyTypeGenKind classifier. RED until Phase 2 adds it.
// Each row: headerLines -> expected kind, and the invariant it pins.
// ===========================================================================

const CLASSIFY_CASES = [
  // --- enum bases: the six named enum bases + the *Enum convention + anywhere-in-list ---
  { header: ["class Color(Enum):"], want: "enum", why: "bare Enum base" },
  { header: ["class Color(IntEnum):"], want: "enum", why: "IntEnum base" },
  { header: ["class Color(StrEnum):"], want: "enum", why: "StrEnum base" },
  { header: ["class Perm(Flag):"], want: "enum", why: "Flag base" },
  { header: ["class Perm(IntFlag):"], want: "enum", why: "IntFlag base" },
  { header: ["class X(MyCustomEnum):"], want: "enum", why: "any base name ending in Enum" },
  { header: ["class Multi(Base, Enum):"], want: "enum", why: "enum base anywhere in the base list" },
  {
    header: ["class Color(Enum, metaclass=ABCMeta):"],
    want: "enum",
    why: "enum base alongside a metaclass keyword arg",
  },

  // --- plain / dataclass: no enum base -> "class" ---
  { header: ["class ServerConfig:"], want: "class", why: "plain class, no base list" },
  { header: ["@dataclass", "class Point:"], want: "class", why: "@dataclass decorator does not make it an enum" },
  { header: ["class Sub(ServerConfig):"], want: "class", why: "non-enum base is still a class" },
  { header: ["class C:"], want: "class", why: "no base list at all" },

  // --- robustness / near-miss traps ---
  {
    header: ["class Enumerable(Sequence):"],
    want: "class",
    why: "the NAME contains 'Enum' but the BASE does not — classify on the base, not the class name",
  },
  {
    header: ["class Color( Enum ):"],
    want: "enum",
    why: "whitespace inside the base list is tolerated",
  },
  {
    header: ["@dataclass", "@final", "class Point(Base):"],
    want: "class",
    why: "multiple decorator lines, non-enum base",
  },
  {
    header: ["class Mix(A, B, StrEnum, C):"],
    want: "enum",
    why: "enum base in the middle of a longer base list",
  },
];

for (const c of CLASSIFY_CASES) {
  gtest(
    `pyTypeGenKind(${JSON.stringify(c.header)}) === "${c.want}" [contract: ${c.why}]`,
    () => {
      const got = pyTypeGenKind(c.header);
      assert.strictEqual(
        got,
        c.want,
        `${c.why}: expected "${c.want}", got ${JSON.stringify(got)}`,
      );
    },
  );
}

// A multi-line base list (a base list that wraps across newlines) — the header
// lines still carry the enum base somewhere in the joined text.
gtest('pyTypeGenKind: a base list split across header lines still finds the enum base [contract: newline-tolerant base scan]', () => {
  const header = ["class Wide(", "    Base,", "    Enum,", "):"];
  assert.strictEqual(
    pyTypeGenKind(header),
    "enum",
    "an enum base on a continuation line of the base list must still classify as enum",
  );
});

// ===========================================================================
// PART B — assembleFnGenPrompt per-language Python vocabulary.
// ===========================================================================

// Turn a throw on a not-yet-supported input into a clean RED assertion rather
// than a bundle-level TypeError.
function render(input) {
  if (bundleErr) assert.fail(`surface bundle failed: ${bundleErr.message}`);
  try {
    return assembleFnGenPrompt(input);
  } catch (e) {
    assert.fail(`assembleFnGenPrompt threw for languageId=${input.languageId} kind=${input.kind}: ${e.message}`);
  }
}

// The frozen v1 function instruction (pinned so a drift is a break).
const FN_INSTR =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.";

// The shipped Rust type instructions (the scout's Q5), pinned for the
// FROZEN cross-guard: a Python change must not disturb Rust bytes.
const RUST_STRUCT_INSTR =
  "Complete the struct definition below. Reply with one fenced code block containing the complete struct definition: the header and its fields, staying strictly inside this one type. The block must contain only this one struct: no other types, no impl blocks, no functions, no code before or after it. The doc comment above the header describes what the struct must hold. Output nothing outside the code block.";
const RUST_ENUM_INSTR =
  "Complete the enum definition below. Reply with one fenced code block containing the complete enum definition: the header and its variants, staying strictly inside this one type. The block must contain only this one enum: no other types, no impl blocks, no functions, no code before or after it. The doc comment above the header describes what the enum must hold. Output nothing outside the code block.";

// ---- FROZEN Rust type bytes (GREEN today) -------------------------------

const RUST_STRUCT_INPUT = { kind: "struct", signature: "pub struct ServerConfig", docComment: "/// Configuration for the server.", languageId: "rust" };
const RUST_ENUM_INPUT = { kind: "enum", signature: "pub enum Message", docComment: "/// A protocol message.", languageId: "rust" };

gtest('FROZEN: Rust struct instruction stays "fields", byte-exact [invariant: Rust bytes identical]', () => {
  const prompt = render(RUST_STRUCT_INPUT);
  assert.ok(prompt.includes(RUST_STRUCT_INSTR), `the frozen Rust struct instruction bytes moved. CAPTURED:\n${JSON.stringify(prompt)}`);
});
gtest('FROZEN: Rust enum instruction stays "variants", byte-exact [invariant: Rust bytes identical]', () => {
  const prompt = render(RUST_ENUM_INPUT);
  assert.ok(prompt.includes(RUST_ENUM_INSTR), `the frozen Rust enum instruction bytes moved. CAPTURED:\n${JSON.stringify(prompt)}`);
});

// ---- FROZEN Python function path (GREEN today) --------------------------

const PY_FN = {
  languageId: "python",
  signature: "def add(a: int, b: int) -> int:",
  docComment: '"""Adds."""',
};

gtest('FROZEN: Python function path — kind omitted === kind:"function", and is the v1 function instruction [invariant: function bytes identical]', () => {
  const omitted = render(PY_FN);
  const explicit = render({ ...PY_FN, kind: "function" });
  assert.strictEqual(omitted, explicit, "kind omitted and kind:'function' must be byte-identical");
  assert.ok(omitted.includes(FN_INSTR), "the Python function path carries the exact v1 function instruction");
  assert.ok(!/\bvariants\b/i.test(omitted), "the function instruction never speaks of variants");
  assert.ok(!/\battributes\b/i.test(omitted), "the function instruction never speaks of attributes");
  assert.ok(!omitted.includes("no impl blocks"), "the function instruction never carries the Rust type framing");
});

// ---- NEW: Python class -> "attributes" ----------------------------------

const PY_CLASS = {
  kind: "class",
  languageId: "python",
  signature: "class ServerConfig:",
  docComment: '"""A server config: bind address, port, and TLS toggle."""',
};

gtest('Python class: instruction names the type\'s "attributes" (Python vocab), never fields/variants/impl/function [contract: Python class noun]', () => {
  const prompt = render(PY_CLASS);
  const lower = prompt.toLowerCase();
  assert.ok(lower.includes("attributes"), 'the Python class instruction must name the type\'s "attributes"');
  assert.ok(!lower.includes("fields"), 'the Python class instruction must not carry the Rust struct noun "fields"');
  assert.ok(!lower.includes("variants"), 'the Python class instruction must not carry the Rust enum noun "variants"');
  assert.ok(!lower.includes("no impl blocks"), 'the Python class instruction must not carry the Rust-only "no impl blocks" framing');
  assert.ok(!prompt.includes("Implement the function"), "the Python class instruction must not reuse the function instruction");
});

gtest("Python class: one-type framing constrains the reply to only this one type [contract: single-type reply]", () => {
  const lower = render(PY_CLASS).toLowerCase();
  assert.ok(lower.includes("only"), "the instruction constrains the reply to only this one type");
  assert.ok(/no other|before or after/.test(lower), "the instruction forbids other items before/after the type");
});

gtest("Python class: header and doc comment carried verbatim; differs from the function path [contract: header+doc, kind routes]", () => {
  const prompt = render(PY_CLASS);
  assert.ok(prompt.includes(PY_CLASS.signature), "the class header is in the target block");
  assert.ok(prompt.includes(PY_CLASS.docComment), "the doc comment (the semantics) is carried verbatim");
  assert.notStrictEqual(prompt, render({ ...PY_CLASS, kind: "function" }), "kind must change the assembled bytes");
});

// ---- NEW: Python enum -> "members" --------------------------------------

const PY_ENUM = {
  kind: "enum",
  languageId: "python",
  signature: "class Color(Enum):",
  docComment: '"""A colour: one of red, green, or blue."""',
};

gtest('Python enum: instruction names the enum\'s "members" (NAME = value), never "variants" (that is Rust) [contract: Python enum noun]', () => {
  const prompt = render(PY_ENUM);
  const lower = prompt.toLowerCase();
  assert.ok(lower.includes("members"), 'the Python enum instruction must name the enum\'s "members"');
  assert.ok(!lower.includes("variants"), 'the Python enum instruction must not carry the Rust enum noun "variants"');
  assert.ok(!lower.includes("no impl blocks"), 'the Python enum instruction must not carry the Rust-only "no impl blocks" framing');
  assert.ok(!prompt.includes("Implement the function"), "the Python enum instruction must not reuse the function instruction");
});

gtest("Python enum: one-type framing, header and doc carried, differs from function path [contract: single-type + header+doc]", () => {
  const prompt = render(PY_ENUM);
  const lower = prompt.toLowerCase();
  assert.ok(lower.includes("only"), "the instruction constrains the reply to only this one type");
  assert.ok(/no other|before or after/.test(lower), "the instruction forbids other items before/after the type");
  assert.ok(prompt.includes(PY_ENUM.signature), "the enum header is in the target block");
  assert.ok(prompt.includes(PY_ENUM.docComment), "the doc comment is carried");
  assert.notStrictEqual(prompt, render({ ...PY_ENUM, kind: "function" }), "kind must change the assembled bytes");
});

// Python class and enum instructions are distinct nouns (attributes vs members).
gtest("Python class and enum instructions are distinct (attributes vs members) [contract: per-kind noun]", () => {
  const classInstr = render(PY_CLASS).replace(PY_CLASS.signature, "").replace(PY_CLASS.docComment, "");
  const enumInstr = render(PY_ENUM).replace(PY_ENUM.signature, "").replace(PY_ENUM.docComment, "");
  assert.notStrictEqual(classInstr, enumInstr, "the class and enum instructions must not be identical text");
});

// The de-Rust guard, named directly: a Python type must NOT reproduce the
// frozen Rust instruction bytes.
gtest("Python class must NOT serve the accidental Rust struct instruction [contract: de-Rust]", () => {
  assert.ok(!render(PY_CLASS).includes(RUST_STRUCT_INSTR), "the Python class is served the RUST struct instruction verbatim");
});
gtest("Python enum must NOT serve the accidental Rust enum instruction [contract: de-Rust]", () => {
  assert.ok(!render(PY_ENUM).includes(RUST_ENUM_INSTR), "the Python enum is served the RUST enum instruction verbatim");
});
