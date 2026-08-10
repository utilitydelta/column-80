// Blind-oracle contract tests for the v5 local-symbol bug fix, PROMPT LEG.
// The fn-gen prompt today is signature+doc only, so the model cannot see that
// a type named in the doc is DEFINED in the same file, and it invents
// `use somecrate::LocalType;`. The prompt leg tells the model which referenced
// names are local so it never invents the import. Two NEW pieces:
//
//   A. assembleFnGenPrompt (src/core/prompt.ts) gains an optional
//      `localSymbols?: string[]` field on FnGenPromptInput. When non-empty it
//      renders an import-suppression section naming each symbol; when
//      absent/undefined/[] the prompt is BYTE-IDENTICAL to the pre-v5 bytes.
//   B. referencedLocalSymbols(signature, docComment, localDefs)
//      (NEW export from src/core/instructPostprocess.ts) -> the ordered subset
//      of localDefs that appear as a WHOLE WORD in signature + docComment.
//
// Written from the CONTRACT only; no implementation exists yet, so this file
// must run RED (except the frozen prompt-identity guard, which must keep
// PASSING). Run: SKIP_LIVE=1 node --test test/blind-v5-promptleg.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const { bundleCore } = require("./.blind-util.cjs");

const { mod, cleanup } = bundleCore(
  "blind-v5-promptleg",
  `export { assembleFnGenPrompt } from "../src/core/prompt";
export { referencedLocalSymbols } from "../src/core/instructPostprocess";\n`
);
const { assembleFnGenPrompt, referencedLocalSymbols } = mod;
test.after(cleanup);

// The final code fence holds the target signature. The exact instruction
// wording is the IMPLEMENTER'S to choose, so match tolerantly: any phrasing
// that tells the model the names are in scope and must not be imported.
// Deliberately does NOT match the frozen instruction's "no imports" (which is
// about the OUTPUT block, a different meaning) — the alternatives below name
// the local-scope concept the pre-v5 prompt never expresses.
const FENCE = "```";
const SUPPRESS_RE =
  /(do not import|don't import|not import|no `?use`?|already in scope|defined in this file|in this file|in scope|already defined)/i;

// A1/A2 use symbol names that are NOT present anywhere in the baseline
// signature/doc. In production localSymbols is a subset of names referenced in
// the signature, so a name-appears check would pass trivially against the
// signature bytes and prove nothing. Fresh names make "the field is rendered"
// the only way the check can pass — that is the honest RED discriminator.
const FRESH_SYMS = ["LocalWidget", "ScopeGuard", "PhaseTag"];

// A representative baseline FnGenPromptInput (signature + doc + a context
// block). localSymbols is the only variable across the identity tests below.
const BASE = {
  signature: "fn build(reg: &CohortRegister) -> Envelope",
  docComment: "/// Builds an Envelope from the CohortRegister.",
  languageId: "rust",
  contextBlocks: [
    {
      uri: "file:///w/alpha.rs",
      range: { startLine: 3, endLine: 9 },
      text: "struct Acc;",
    },
  ],
};

// ---------------------------------------------------------------------------
// A. assembleFnGenPrompt localSymbols rendering
// ---------------------------------------------------------------------------

// INVARIANT A1 (RED today): a NON-EMPTY localSymbols array renders a section
// that names every symbol AND carries an import-suppression instruction. The
// field is ignored by the pre-v5 impl, so the names are absent -> FAIL (red).
const nonEmptyCases = [
  ["single symbol", [FRESH_SYMS[0]]],
  ["two symbols", [FRESH_SYMS[0], FRESH_SYMS[1]]],
  ["three symbols", FRESH_SYMS],
];
for (const [name, localSymbols] of nonEmptyCases) {
  test(`A1 non-empty localSymbols renders a named import-suppression section (${name})`, () => {
    const prompt = assembleFnGenPrompt({ ...BASE, localSymbols });
    for (const sym of localSymbols) {
      assert.ok(prompt.includes(sym), `symbol ${sym} appears in the prompt`);
    }
    // Exact sentence is the implementer's; assert only that an
    // import-suppression / already-in-scope instruction is present.
    assert.ok(
      SUPPRESS_RE.test(prompt),
      "an import-suppression / already-in-scope instruction is present"
    );
  });
}

// INVARIANT A2 (RED today): the symbol names live OUTSIDE the final code fence
// that holds the target signature — they must not leak into the target code
// fence. Light structural check: the last fenced block (from the final
// occurrence of the fence-opening back one) must not contain the symbol names,
// and the suppression wording sits before that final fence.
test("A2 the local-symbol section sits outside the final signature code fence (no leak into target fence)", () => {
  const localSymbols = FRESH_SYMS;
  const prompt = assembleFnGenPrompt({ ...BASE, localSymbols });
  // Isolate the final fenced block: the tail from the last fence-open before
  // the signature. The signature must live inside it.
  const sigIdx = prompt.lastIndexOf(BASE.signature);
  assert.ok(sigIdx !== -1, "signature is present in the prompt");
  const fenceOpenIdx = prompt.lastIndexOf(FENCE, sigIdx);
  assert.ok(fenceOpenIdx !== -1, "a fence opens before the signature");
  const finalFenceBlock = prompt.slice(fenceOpenIdx);
  // The import-suppression instruction must be present (RED today) ...
  assert.ok(SUPPRESS_RE.test(prompt), "suppression instruction is present");
  // ... and it must sit BEFORE the final fence, never inside the target block.
  assert.ok(
    prompt.search(SUPPRESS_RE) < fenceOpenIdx,
    "suppression instruction precedes the final fence"
  );
  assert.ok(
    !SUPPRESS_RE.test(finalFenceBlock),
    "suppression instruction does not leak into the target signature fence"
  );
  // The provided symbol names must not leak into the target code fence either.
  for (const sym of localSymbols) {
    assert.ok(
      !finalFenceBlock.includes(sym),
      `symbol ${sym} does not leak into the final signature fence`
    );
  }
});

// INVARIANT A3 (LOAD-BEARING GUARD — must keep PASSING): absent, undefined, and
// [] localSymbols all produce the SAME BYTES as the pre-v5 call with no field.
// A regression here changes the v1 prompt bytes for every user. The field is
// ignored today so this passes trivially; it must stay === after the feature
// lands.
test("A3 frozen prompt-identity: absent == localSymbols:[] == localSymbols:undefined (byte-identical)", () => {
  const baseline = assembleFnGenPrompt({ ...BASE }); // no localSymbols field
  const empty = assembleFnGenPrompt({ ...BASE, localSymbols: [] });
  const undef = assembleFnGenPrompt({ ...BASE, localSymbols: undefined });
  assert.strictEqual(empty, baseline, "empty array must not change the bytes");
  assert.strictEqual(undef, baseline, "undefined must not change the bytes");
});

// INVARIANT A4 (LOAD-BEARING GUARD — must keep PASSING): the same identity holds
// for the minimal input shape (signature + docComment only, no context block),
// so the guard is not accidentally coupled to the presence of context.
test("A4 frozen prompt-identity holds for a minimal signature+doc input", () => {
  const minimal = { signature: "fn f() -> i32", docComment: "/// Adds." };
  const baseline = assembleFnGenPrompt({ ...minimal });
  assert.strictEqual(
    assembleFnGenPrompt({ ...minimal, localSymbols: [] }),
    baseline,
    "empty array == no field for minimal input"
  );
  assert.strictEqual(
    assembleFnGenPrompt({ ...minimal, localSymbols: undefined }),
    baseline,
    "undefined == no field for minimal input"
  );
});

// ---------------------------------------------------------------------------
// B. referencedLocalSymbols(signature, docComment, localDefs) -> string[]
// ---------------------------------------------------------------------------
// referencedLocalSymbols is undefined today, so every test below throws (red).

// INVARIANT B1: a local def named in the DOC is returned.
test("B1 local def named in the doc is returned", () => {
  const out = referencedLocalSymbols(
    "fn build() -> Envelope",
    "/// Builds from the CohortRegister.",
    new Set(["CohortRegister"])
  );
  assert.deepStrictEqual(out, ["CohortRegister"]);
});

// INVARIANT B2: a local def named in the SIGNATURE is returned.
test("B2 local def named in the signature is returned", () => {
  const out = referencedLocalSymbols(
    "fn build(reg: &CohortRegister) -> u8",
    undefined,
    new Set(["CohortRegister"])
  );
  assert.deepStrictEqual(out, ["CohortRegister"]);
});

// INVARIANT B3: a local def NOT mentioned anywhere is NOT returned.
test("B3 local def absent from signature and doc is not returned", () => {
  const out = referencedLocalSymbols(
    "fn build() -> u8",
    "/// nothing relevant here",
    new Set(["CohortRegister"])
  );
  assert.deepStrictEqual(out, []);
});

// INVARIANT B4: a name mentioned but NOT in localDefs is NOT returned — only
// local defs qualify.
test("B4 a mentioned name absent from localDefs is not returned", () => {
  const out = referencedLocalSymbols(
    "fn build(t: &Tile) -> Envelope",
    "/// uses Tile and Envelope",
    new Set(["CohortRegister"]) // neither Tile nor Envelope is local
  );
  assert.deepStrictEqual(out, []);
});

// INVARIANT B5: WHOLE-WORD only. localDefs has `Reg`; doc mentions
// `CohortRegister` (substring). `Reg` must NOT match.
test("B5 whole-word only: `Reg` does not match inside `CohortRegister`", () => {
  const out = referencedLocalSymbols(
    "fn build() -> u8",
    "/// touches CohortRegister only",
    new Set(["Reg"])
  );
  assert.deepStrictEqual(out, [], "substring must not match");
});

// INVARIANT B6: docComment undefined is allowed — match against signature only.
test("B6 undefined docComment matches against the signature alone", () => {
  const out = referencedLocalSymbols(
    "fn build(reg: &CohortRegister) -> u8",
    undefined,
    new Set(["CohortRegister"])
  );
  assert.deepStrictEqual(out, ["CohortRegister"]);
});

// INVARIANT B7: empty localDefs -> empty array.
test("B7 empty localDefs yields an empty array", () => {
  const out = referencedLocalSymbols(
    "fn build(reg: &CohortRegister) -> Envelope",
    "/// Builds from the CohortRegister.",
    new Set()
  );
  assert.deepStrictEqual(out, []);
});

// INVARIANT B8: only the referenced SUBSET is returned when localDefs holds
// both referenced and unreferenced names. Order-independent: compare sorted.
test("B8 returns exactly the referenced subset of localDefs (order-independent)", () => {
  const out = referencedLocalSymbols(
    "fn build(reg: &CohortRegister) -> Envelope",
    "/// Builds an Envelope.",
    new Set(["CohortRegister", "Envelope", "Unused", "AlsoUnused"])
  );
  assert.deepStrictEqual(
    [...out].sort(),
    ["CohortRegister", "Envelope"].sort(),
    "exactly the two referenced defs, no unreferenced ones"
  );
});

// INVARIANT B9: determinism — the same input yields the same output array
// across repeated calls (no set-iteration nondeterminism leaking through).
test("B9 output is deterministic across repeated calls", () => {
  const call = () =>
    referencedLocalSymbols(
      "fn build(reg: &CohortRegister) -> Envelope",
      "/// Builds an Envelope from the CohortRegister and a Phase.",
      new Set(["CohortRegister", "Envelope", "Phase"])
    );
  const a = call();
  const b = call();
  assert.deepStrictEqual(a, b, "repeated calls return identical arrays");
});

// INVARIANT B10 (ORDERING ASSUMPTION — flagged for triage): when order is
// asserted, we assume first-seen order scanning SIGNATURE first, then
// docComment. Here `Envelope` appears in the signature and `CohortRegister`
// only in the doc, so signature-first order is [Envelope, CohortRegister].
// If the impl fixes a different deterministic order, this fails RED and
// surfaces the ordering decision for triage rather than passing silently.
// (The set-equality check in B8 is the over-fit-proof guard; this pins order.)
test("B10 [ASSUMPTION] order is first-seen scanning signature then doc", () => {
  const out = referencedLocalSymbols(
    "fn build() -> Envelope",
    "/// Builds from the CohortRegister.",
    new Set(["CohortRegister", "Envelope"])
  );
  assert.deepStrictEqual(
    out,
    ["Envelope", "CohortRegister"],
    "signature-referenced Envelope precedes doc-only CohortRegister"
  );
});
