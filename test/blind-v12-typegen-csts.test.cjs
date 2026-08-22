// Blind oracle (v12 type-gen, C# + TS): the PER-LANGUAGE type-instruction
// vocabulary of `assembleFnGenPrompt`. Today the fn-gen prompt takes
// kind: "function"|"struct"|"enum" and speaks a RUST-shaped noun ("fields" /
// "variants") plus the Rust-only "no impl blocks" framing for EVERY language.
// Phase 1 must extend the kind union to also accept "class"|"interface" and
// route the member noun BY languageId:
//   Rust  : struct->"fields", enum->"variants"   [FROZEN, byte-exact]
//   C#    : class/struct/enum -> "members"        (never fields/variants)
//   TS    : class/interface/enum -> "members"     (never variants)
// The non-Rust type instruction must NOT carry the Rust "no impl blocks"
// framing, must NOT reuse the function instruction ("Implement the function"),
// must constrain the reply to the one type ("only" + "no other"/"before or
// after"), and must carry the header + doc comment verbatim. The function path
// (kind omitted or "function") stays byte-identical to v1 for every language.
//
// Black-box: never reads src/**. The C#/TS type contracts are RED until
// prompt.ts routes by languageId; the frozen-Rust + function-path guards are
// GREEN today (a red guard means this file mismodelled the CURRENT bytes).
//
// Run: SKIP_LIVE=1 node --test test/blind-v12-typegen-csts.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v12-typegen-csts",
  `export { assembleFnGenPrompt } from "../src/core/prompt";\n`,
);
const { assembleFnGenPrompt } = mod;
test.after(cleanup);

// Turn a throw on a not-yet-supported kind into a clean RED assertion (a
// contract failure), not a bundle-level TypeError wall.
function render(input) {
  try {
    return assembleFnGenPrompt(input);
  } catch (e) {
    assert.fail(
      `assembleFnGenPrompt threw for languageId=${input.languageId} kind=${input.kind}: ${e.message}`,
    );
  }
}

// The frozen v1 function instruction (pinned so a drift is a break).
const FN_INSTR =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.";

// ===========================================================================
// FROZEN Rust type instruction — byte-exact. These are the shipped Rust bytes
// (v12 scout, Q5). A red guard here = this file mismodelled the true
// current Rust value; fix the PIN, never the contract.
// ===========================================================================

const RUST_STRUCT_INSTR =
  "Complete the struct definition below. Reply with one fenced code block containing the complete struct definition: the header and its fields, staying strictly inside this one type. The block must contain only this one struct: no other types, no impl blocks, no functions, no code before or after it. The doc comment above the header describes what the struct must hold. Output nothing outside the code block.";
const RUST_ENUM_INSTR =
  "Complete the enum definition below. Reply with one fenced code block containing the complete enum definition: the header and its variants, staying strictly inside this one type. The block must contain only this one enum: no other types, no impl blocks, no functions, no code before or after it. The doc comment above the header describes what the enum must hold. Output nothing outside the code block.";

const RUST_STRUCT_INPUT = {
  kind: "struct",
  signature: "pub struct ServerConfig",
  docComment: "/// Configuration for the server.",
  languageId: "rust",
};
const RUST_ENUM_INPUT = {
  kind: "enum",
  signature: "pub enum Message",
  docComment: "/// A protocol message.",
  languageId: "rust",
};

test("FROZEN: the Rust struct type instruction is byte-exact (fields, no-impl-blocks framing) [invariant: Rust bytes identical]", () => {
  const prompt = render(RUST_STRUCT_INPUT);
  assert.ok(
    prompt.includes(RUST_STRUCT_INSTR),
    `the frozen Rust struct instruction bytes moved. CAPTURED:\n${JSON.stringify(prompt)}`,
  );
  assert.ok(prompt.includes(RUST_STRUCT_INPUT.signature), "the struct header is carried");
  assert.ok(prompt.includes(RUST_STRUCT_INPUT.docComment), "the doc comment is carried");
});

test("FROZEN: the Rust enum type instruction is byte-exact (variants, no-impl-blocks framing) [invariant: Rust bytes identical]", () => {
  const prompt = render(RUST_ENUM_INPUT);
  assert.ok(
    prompt.includes(RUST_ENUM_INSTR),
    `the frozen Rust enum instruction bytes moved. CAPTURED:\n${JSON.stringify(prompt)}`,
  );
  assert.ok(prompt.includes(RUST_ENUM_INPUT.signature), "the enum header is carried");
  assert.ok(prompt.includes(RUST_ENUM_INPUT.docComment), "the doc comment is carried");
});

test("FROZEN: Rust struct and enum instructions are distinct (fields vs variants) [invariant: Rust bytes identical]", () => {
  assert.notStrictEqual(RUST_STRUCT_INSTR, RUST_ENUM_INSTR);
  assert.ok(render(RUST_STRUCT_INPUT).includes("fields"), "the Rust struct noun stays 'fields'");
  assert.ok(render(RUST_ENUM_INPUT).includes("variants"), "the Rust enum noun stays 'variants'");
});

// ===========================================================================
// FROZEN function path — byte-identical to v1 for every language. kind omitted
// and kind:"function" render the same bytes, and that instruction is the v1
// function instruction (never a type noun). GREEN today.
// ===========================================================================

const FN_CASES = [
  { languageId: "rust", signature: "fn add(a: i32, b: i32) -> i32", docComment: "/// Adds." },
  { languageId: "csharp", signature: "public int Foo()", docComment: "/// <summary>Foo.</summary>" },
  { languageId: "typescript", signature: "export function readOrder(o: Order): number", docComment: "/** Reads. */" },
];

for (const c of FN_CASES) {
  test(`FROZEN: ${c.languageId} function path — kind omitted === kind:"function", and is the v1 function instruction [invariant: function bytes identical]`, () => {
    const omitted = render(c);
    const explicit = render({ ...c, kind: "function" });
    assert.strictEqual(omitted, explicit, "kind omitted and kind:'function' must be byte-identical");
    assert.ok(omitted.includes(FN_INSTR), "the function path carries the exact v1 function instruction");
    assert.ok(!/\bvariants\b/i.test(omitted), "the function instruction never speaks of variants");
    assert.ok(!omitted.includes("no impl blocks"), "the function instruction never carries the Rust type framing");
  });
}

// ===========================================================================
// NEW CONTRACT — per-language type instruction for C# and TS. RED until
// prompt.ts routes "class"/"struct"/"enum"/"interface" by languageId.
// ===========================================================================

const TYPE_CASES = [
  { languageId: "csharp", kind: "class", signature: "public class ServerConfig", docComment: "/// <summary>Server config.</summary>" },
  { languageId: "csharp", kind: "struct", signature: "public struct Vec2", docComment: "/// <summary>A 2D vector.</summary>" },
  { languageId: "csharp", kind: "enum", signature: "public enum Color", docComment: "/// <summary>A colour.</summary>" },
  { languageId: "typescript", kind: "class", signature: "export class ServerConfig", docComment: "/** Server config. */" },
  { languageId: "typescript", kind: "interface", signature: "export interface Shape", docComment: "/** A shape. */" },
  { languageId: "typescript", kind: "enum", signature: "export enum Color", docComment: "/** A colour. */" },
];

for (const c of TYPE_CASES) {
  const tag = `${c.languageId} ${c.kind}`;

  // The load-bearing anti-bug contract: the member noun is "members", never the
  // Rust vocab ("fields"/"variants") and never the Rust-only "no impl blocks"
  // framing. C# struct/enum + TS enum are the ACCIDENTAL-Rust cases (reachable
  // today, wrongly served the Rust instruction); C#/TS class + TS interface are
  // not admitted at all today.
  test(`${tag}: type instruction uses the "members" noun, never the Rust vocab or impl framing [contract: per-language noun]`, () => {
    const prompt = render(c);
    const lower = prompt.toLowerCase();
    assert.ok(lower.includes("members"), `the ${tag} instruction must name the type's "members"`);
    assert.ok(!lower.includes("variants"), `the ${tag} instruction must not carry the Rust enum noun "variants"`);
    assert.ok(!lower.includes("no impl blocks"), `the ${tag} instruction must not carry the Rust-only "no impl blocks" framing`);
    assert.ok(!prompt.includes("Implement the function"), `the ${tag} instruction must not reuse the function instruction`);
  });

  test(`${tag}: reply is constrained to the one type (one-type framing, not the function path) [contract: single-type reply]`, () => {
    const prompt = render(c);
    const lower = prompt.toLowerCase();
    assert.ok(!prompt.includes("Implement the function"), "must not be the function instruction");
    assert.ok(lower.includes("only"), "the instruction constrains the reply to only this one type");
    assert.ok(/no other|before or after/.test(lower), "the instruction forbids other items before/after the type");
  });

  test(`${tag}: the header and doc comment are carried verbatim [contract: header + doc reach the prompt]`, () => {
    const prompt = render(c);
    assert.ok(prompt.includes(c.signature), "the type header is in the target block");
    assert.ok(prompt.includes(c.docComment), "the doc comment (the semantics) is carried verbatim");
  });

  test(`${tag}: differs from the function path for identical header bytes [contract: kind routes]`, () => {
    assert.notStrictEqual(render(c), render({ ...c, kind: "function" }), "kind must change the assembled bytes");
  });
}

// The accidental-Rust bug, named directly: a C# struct / C# enum / TS enum must
// NOT reproduce the frozen Rust instruction bytes.
const ACCIDENTAL = [
  { languageId: "csharp", kind: "struct", signature: "public struct Vec2", docComment: "/// x", frozen: RUST_STRUCT_INSTR },
  { languageId: "csharp", kind: "enum", signature: "public enum Color", docComment: "/// x", frozen: RUST_ENUM_INSTR },
  { languageId: "typescript", kind: "enum", signature: "export enum Color", docComment: "/** x */", frozen: RUST_ENUM_INSTR },
];
for (const c of ACCIDENTAL) {
  test(`${c.languageId} ${c.kind}: must NOT serve the accidental Rust instruction (the by-accident bug) [contract: de-Rust]`, () => {
    const prompt = render(c);
    assert.ok(!prompt.includes(c.frozen), `${c.languageId} ${c.kind} is served the RUST instruction verbatim — the accidental-Rust bug`);
  });
}
