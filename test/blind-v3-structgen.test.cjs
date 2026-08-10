// Blind oracle: structure-generation prompt routing (v3 goal item 1
// "Structure generation"). The fn-gen prompt gains an optional `kind`
// ("function" default | "struct" | "enum"). For a type the INSTRUCTION must
// tell the model to complete the TYPE DEFINITION, staying strictly inside the
// one type; the doc comment carries the semantics (the header is nearly
// empty). The FUNCTION path stays byte-identical: kind omitted or "function"
// reproduces the exact v1 prompt bytes. Written against the surface only;
// never reads src/**. Expected red until prompt.ts routes by kind.
//
// Run: SKIP_LIVE=1 node --test test/blind-v3-structgen.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v3-structgen",
  `export { assembleFnGenPrompt } from "../src/core/prompt";\n`
);
const { assembleFnGenPrompt } = mod;
test.after(cleanup);

const FENCE = "```";

// The frozen v1 function instruction, pinned here so a drift is a test break.
const FN_INSTR =
  "Implement the function below. Reply with one fenced code block containing the complete function definition, signature and body. The block must contain only this one function: no imports, no other functions, no code before or after it. Output nothing outside the code block.";

// ---- Function path is byte-identical to v1 (the frozen identity) --------

const FN_INPUT = {
  signature: "fn add(a: i32, b: i32) -> i32",
  docComment: "/// Adds.",
  languageId: "rust",
  contextBlocks: [{ uri: "file:///w/a.rs", range: { startLine: 3, endLine: 9 }, text: "struct Acc;" }],
};

// The exact v1 bytes, hand-built from the phase-2 layout (same shape blind3
// pins), so "byte-identical" is checked against a literal, not the module
// echoing itself.
const V1_EXPECTED =
  `Context: file:///w/a.rs#L3-L9\n${FENCE}\nstruct Acc;\n${FENCE}` +
  `\n\n${FN_INSTR}\n\n${FENCE}rust\n/// Adds.\nfn add(a: i32, b: i32) -> i32\n${FENCE}`;

test("function path: kind omitted renders the exact v1 prompt bytes", () => {
  assert.strictEqual(assembleFnGenPrompt(FN_INPUT), V1_EXPECTED);
});

test("function path: kind=\"function\" is byte-identical to kind omitted", () => {
  assert.strictEqual(
    assembleFnGenPrompt({ ...FN_INPUT, kind: "function" }),
    assembleFnGenPrompt(FN_INPUT),
  );
});

// ---- Struct routing -----------------------------------------------------

const STRUCT_INPUT = {
  kind: "struct",
  signature: "pub struct ServerConfig",
  docComment: "/// Configuration for the server: bind address, port, and TLS toggle.",
  languageId: "rust",
};

test("struct path: instruction is TYPE-shaped, not the function instruction", () => {
  const prompt = assembleFnGenPrompt(STRUCT_INPUT);
  assert.ok(!prompt.includes("Implement the function"), "must NOT reuse the function instruction");
  assert.ok(/\bstruct\b/i.test(prompt), "the struct instruction names the struct");
  assert.ok(
    /definition/i.test(prompt) || /fields/i.test(prompt),
    "the instruction speaks of the type definition / fields, not a function body",
  );
});

test("struct path: one-type-only framing (no other items alongside the type)", () => {
  const prompt = assembleFnGenPrompt(STRUCT_INPUT).toLowerCase();
  assert.ok(prompt.includes("only"), "the instruction constrains the reply to only this one type");
  // Some phrasing that keeps other top-level items out of the reply.
  assert.ok(
    /no other|only this|no impl|no functions|before or after/.test(prompt),
    "the instruction forbids other items before/after the type",
  );
});

test("struct path: the header and the doc comment both reach the prompt", () => {
  const prompt = assembleFnGenPrompt(STRUCT_INPUT);
  assert.ok(prompt.includes("pub struct ServerConfig"), "the type header is in the target block");
  assert.ok(prompt.includes(STRUCT_INPUT.docComment), "the doc comment (the semantics) is carried verbatim");
});

test("struct path differs from the function path for the same header bytes", () => {
  const asStruct = assembleFnGenPrompt(STRUCT_INPUT);
  const asFn = assembleFnGenPrompt({ ...STRUCT_INPUT, kind: "function" });
  assert.notStrictEqual(asStruct, asFn, "kind must change the assembled bytes");
});

// ---- Enum routing -------------------------------------------------------

const ENUM_INPUT = {
  kind: "enum",
  signature: "pub enum Message",
  docComment: "/// A protocol message: a request, a response, or a heartbeat.",
  languageId: "rust",
};

test("enum path: instruction is TYPE-shaped and names the enum / its variants", () => {
  const prompt = assembleFnGenPrompt(ENUM_INPUT);
  assert.ok(!prompt.includes("Implement the function"), "must NOT reuse the function instruction");
  assert.ok(/\benum\b/i.test(prompt), "the enum instruction names the enum");
  assert.ok(
    /variant/i.test(prompt) || /definition/i.test(prompt),
    "the instruction speaks of variants / the type definition",
  );
});

test("enum path: header and doc comment carried, differs from function path", () => {
  const prompt = assembleFnGenPrompt(ENUM_INPUT);
  assert.ok(prompt.includes("pub enum Message"), "the enum header is in the target block");
  assert.ok(prompt.includes(ENUM_INPUT.docComment), "the doc comment is carried");
  assert.notStrictEqual(prompt, assembleFnGenPrompt({ ...ENUM_INPUT, kind: "function" }));
});

// Struct and enum instructions are not the same text (fields vs variants).
test("struct and enum instructions are distinct (fields vs variants)", () => {
  assert.notStrictEqual(
    assembleFnGenPrompt(STRUCT_INPUT).replace("pub struct ServerConfig", "").replace(STRUCT_INPUT.docComment, ""),
    assembleFnGenPrompt(ENUM_INPUT).replace("pub enum Message", "").replace(ENUM_INPUT.docComment, ""),
  );
});
