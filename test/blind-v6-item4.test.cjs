// BLIND ORACLE - v6 P4 item 4: all-eligible surface injection.
//
// Black-box contract test for the SHIPPED `resolveSurfaceInjection`
// (src/vscode/oracleSurface.ts) against SURFACE-p4-item4.md (bars A1-A7) and
// investigation-item4.md. Written WITHOUT reading the resolveSurfaceInjection
// body - only its exported signature, the surface spec, and the
// impl9-injection / blind-v6-item1 reference patterns for headless bundling.
//
// The change under test: today resolveSurfaceInjection returns the surface for
// only the FIRST classifiable eligible diagnostic; item 4 makes it inject the
// surface for ALL classifiable eligible diagnostics in one round - collect,
// dedup by kind:type, combine with ONE shared FIRM_INSTRUCTION, cap at
// SURFACE_CAP with a drop log, and keep terminal steers short-circuiting.
//
// classifyHallucination (imported, called empirically - NOT assumed) confirms
// which wording maps to which kind, so each bar targets the class it claims.
//
// resolveSurfaceInjection signature (from the export, not the body):
//   (extractor, document, eligible, log, catalog?, resolution?, localDefs?)
//   currently -> Promise<string | undefined>. This test handles both a string
//   return and a { surface } object return.
//
// Run: SKIP_LIVE=1 node --test test/blind-v6-item4.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ---- Bundle exactly as impl9-injection / blind-v6-item1 do: minimal vscode
// stub + esbuild alias, then require the CJS bundle. classifyHallucination comes
// along so the wording -> class map is verified empirically, not assumed.
const STUB = path.join(__dirname, ".blind-v6-item4-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
module.exports = { Position, Range, languages: {}, window: {}, workspace: {}, ThemeColor: class {}, MarkdownString: class {} };\n`
);
const entry = path.join(__dirname, ".blind-v6-item4.entry.ts");
const outfile = path.join(__dirname, ".blind-v6-item4.bundle.cjs");
fs.writeFileSync(
  entry,
  `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";
export { classifyHallucination } from "../src/core/compilerDirected";\n`
);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { resolveSurfaceInjection, classifyHallucination } = require(outfile);
test.after(() => [STUB, entry, outfile].forEach((f) => fs.rmSync(f, { force: true })));

// A document over a text string with the offset math the glue uses (from impl9).
function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (pos) => {
    let o = 0;
    for (let i = 0; i < pos.line; i++) o += lines[i].length + 1;
    return o + pos.character;
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return { line: l, character: off - o };
      o += lines[l].length + 1;
    }
    return { line: lines.length - 1, character: 0 };
  };
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => text.slice(offsetAt(r.start), offsetAt(r.end)) };
}

// A diagnostic with one primary span, whose LINE we use both as the classifier's
// cursor and as the key the fake extractor answers on (so distinct receivers get
// distinct member lists / examples, mirroring the per-type rust-analyzer trip).
const diag = (code, message, span) => ({
  kind: "compile-error", level: "error", code, message,
  spans: [{ fileName: "src/main.rs", byteStart: 0, byteEnd: 0, lineStart: span.line + 1, lineEnd: span.line + 1, columnStart: span.character + 1, columnEnd: span.character + 3, isPrimary: true }],
  suggestions: [],
});

// The message forms each bar rides. Verified empirically below before use.
const methodMiss = (member, type) => `no method named \`${member}\` found for struct \`${type}\` in the current scope`;
const assocMiss = (member, type) => `no associated function or constant named \`${member}\` found for struct \`${type}\` in the current scope`;
const crateMiss = (crate) => `cannot find module or crate \`${crate}\` in this scope`;
const importMiss = (path) => `unresolved import \`${path}\``;

// The fake SurfaceExtractor. Keys BOTH resolvers on the cursor line (the only
// per-diagnostic handle the product passes to completeMembers - it gets just the
// cursor, no type name), so T1 and T2 come back with distinct member lists and
// examples. completeMembers returns a real `signature` field so a method miss
// renders as the SIGNATURES form; example returns a compiling one-liner so an
// assoc miss renders as the EXAMPLE form.
function keyedExtractor() {
  const calls = { members: [], examples: [] };
  return {
    calls,
    example: async (cursor, prefer) => {
      calls.examples.push({ line: cursor.line, prefer });
      return `let made = MadeAt${cursor.line}::new(); // prefer=${prefer}`;
    },
    completeMembers: async (cursor) => {
      calls.members.push({ line: cursor.line });
      return [{ name: `mem${cursor.line}`, signature: `mem${cursor.line}(&self) -> usize`, kind: "method" }];
    },
  };
}

// Normalise the return: the spec permits string OR { surface }.
const surfaceOf = (r) => (typeof r === "string" ? r : r && r.surface);
// Count non-overlapping occurrences of a literal substring.
const count = (hay, needle) => (hay ? hay.split(needle).length - 1 : 0);
// Total number of injected surface blocks in a payload.
const blockCount = (out) => count(out, "API surface for") + count(out, "Usage example for");

const SIGNATURES_MARK = "API surface for";
const EXAMPLE_MARK = "Usage example for";
const FIRM = "Call ONLY methods and constructors";
const DROP_IMPORT_MARK = "defined in this file";

// ---- Empirical classifier check: prove the wording -> class map every bar
// relies on, so a bar that "passes" tests the class it claims to. Do NOT assume.
test("classifier: wording maps to the class each bar targets (empirical)", () => {
  const m = classifyHallucination(diag("E0599", methodMiss("total", "Ledger"), { line: 0, character: 0 }));
  assert.strictEqual(m && m.kind, "unresolved-method", `method-miss must classify unresolved-method (got ${m && m.kind})`);
  assert.strictEqual(m.type, "Ledger", "the receiver type is extracted for dedup keying");
  const a = classifyHallucination(diag("E0599", assocMiss("new", "Roster"), { line: 0, character: 0 }));
  assert.strictEqual(a && a.kind, "unresolved-assoc", `assoc-miss must classify unresolved-assoc (got ${a && a.kind})`);
  const c = classifyHallucination(diag("E0433", crateMiss("somecrate"), { line: 0, character: 0 }));
  assert.strictEqual(c && c.kind, "unresolved-crate", `bare crate miss must classify unresolved-crate (got ${c && c.kind})`);
  const l = classifyHallucination(diag("E0432", importMiss("somecrate::Local"), { line: 0, character: 0 }), undefined, new Set(["Local"]));
  assert.strictEqual(l && l.kind, "local-symbol", `same-file import leaf must classify local-symbol (got ${l && l.kind})`);
  const none = classifyHallucination(diag("E0308", "mismatched types", { line: 0, character: 0 }));
  assert.strictEqual(none, undefined, "a plain type error is not a hallucination class");
});

// ---- A1: two DISTINCT method-miss types -> BOTH surfaces in one payload.
// RED on current first-eligible code (only the first type's block appears).
test("A1: two distinct method-miss types inject BOTH API surfaces in one payload", async () => {
  const ext = keyedExtractor();
  const out = surfaceOf(await resolveSurfaceInjection(ext, makeDoc("fn f() {}", "file:///x/main.rs"), [
    diag("E0599", methodMiss("total", "T1"), { line: 2, character: 4 }),
    diag("E0599", methodMiss("size", "T2"), { line: 3, character: 4 }),
  ], () => {}));
  assert.ok(out, "a payload is produced");
  assert.ok(out.includes("API surface for `T1`"), `expected T1's surface; got: ${out}`);
  assert.ok(out.includes("API surface for `T2`"), `expected T2's surface (all-eligible); got: ${out}`);
});

// ---- A2: two errors on the SAME type -> that type's surface appears ONCE.
// Guards the dedup (kind:type key). Passes trivially under first-eligible (only
// one block emitted); a naive all-eligible that skips dedup would emit two.
test("A2: two errors on the same type dedup to a single API surface block", async () => {
  const ext = keyedExtractor();
  const out = surfaceOf(await resolveSurfaceInjection(ext, makeDoc("fn f() {}", "file:///x"), [
    diag("E0599", methodMiss("total", "SameT"), { line: 2, character: 4 }),
    diag("E0599", methodMiss("grand", "SameT"), { line: 3, character: 4 }),
  ], () => {}));
  assert.ok(out, "a payload is produced");
  assert.strictEqual(count(out, "API surface for `SameT`"), 1, `SameT's surface must appear exactly once; got: ${out}`);
});

// ---- A3: a multi-surface payload carries EXACTLY ONE FIRM_INSTRUCTION and >=2
// blocks. RED now: current code emits only one block (fails the >=2 check).
test("A3: a multi-surface payload has one FIRM_INSTRUCTION and >=2 blocks", async () => {
  const ext = keyedExtractor();
  const out = surfaceOf(await resolveSurfaceInjection(ext, makeDoc("fn f() {}", "file:///x"), [
    diag("E0599", methodMiss("total", "Aye"), { line: 2, character: 4 }),
    diag("E0599", methodMiss("size", "Bee"), { line: 3, character: 4 }),
  ], () => {}));
  assert.ok(out, "a payload is produced");
  assert.ok(blockCount(out) >= 2, `expected >=2 surface blocks; got ${blockCount(out)} in: ${out}`);
  assert.strictEqual(count(out, FIRM), 1, `the FIRM_INSTRUCTION must appear exactly once; got ${count(out, FIRM)}`);
});

// ---- A4: per-class shape preserved in the combine (item 1 unregressed). A
// method miss renders as the member LIST (`API surface for`), an assoc miss as
// the worked EXAMPLE (`Usage example for`), both in one payload.
// RED now: first-eligible emits only the method block; the example is missing.
test("A4: method renders as API surface and assoc as Usage example in one payload", async () => {
  const ext = keyedExtractor();
  const out = surfaceOf(await resolveSurfaceInjection(ext, makeDoc("fn f() {}", "file:///x"), [
    diag("E0599", methodMiss("total", "MethT"), { line: 2, character: 4 }),
    diag("E0599", assocMiss("new", "AssocT"), { line: 3, character: 4 }),
  ], () => {}));
  assert.ok(out, "a payload is produced");
  assert.ok(out.includes(`${SIGNATURES_MARK} \`MethT\``), `method miss must render as API surface; got: ${out}`);
  assert.ok(out.includes(`${EXAMPLE_MARK} \`AssocT\``), `assoc miss must render as Usage example; got: ${out}`);
});

// ---- A5: more than SURFACE_CAP distinct types -> capped blocks + a drop log.
// Cap value is impl-chosen (spec recommends 4); assert cap-tolerantly: fewer
// than the 6 supplied, and a [repair] log line naming a drop/truncation.
// RED now: first-eligible emits one block and logs no drop.
test("A5: over SURFACE_CAP distinct types are capped and the drop is logged", async () => {
  const ext = keyedExtractor();
  const logs = [];
  const types = ["Ca", "Cb", "Cc", "Cd", "Ce", "Cf"]; // 6 distinct receivers
  const eligible = types.map((t, i) => diag("E0599", methodMiss(`bad${i}`, t), { line: 2 + i, character: 4 }));
  const out = surfaceOf(await resolveSurfaceInjection(ext, makeDoc("fn f() {}", "file:///x"), eligible, (line) => logs.push(line)));
  assert.ok(out, "a payload is produced");
  assert.ok(blockCount(out) >= 1, "at least one surface is injected");
  assert.ok(blockCount(out) < types.length, `payload must be capped below the ${types.length} eligible types; got ${blockCount(out)}`);
  assert.ok(logs.some((l) => /drop|truncat/i.test(l)), `a [repair] log line must name the dropped types; logs: ${JSON.stringify(logs)}`);
});

// ---- A6a: a STEERABLE unresolved-crate (catalog present) mixed with a method
// miss -> the payload is the catalog steer ALONE (short-circuit), not combined.
// GREEN now (the crate class returns the catalog and stops).
test("A6a: a steerable unresolved-crate short-circuits to the catalog, not combined", async () => {
  const ext = keyedExtractor();
  const out = surfaceOf(await resolveSurfaceInjection(
    ext,
    makeDoc("fn f() {}", "file:///x"),
    [
      diag("E0433", crateMiss("somecrate"), { line: 2, character: 4 }),
      diag("E0599", methodMiss("total", "Ledger"), { line: 3, character: 4 }),
    ],
    () => {},
    "CATALOG_BLOCK_SENTINEL",
  ));
  assert.strictEqual(out, "CATALOG_BLOCK_SENTINEL", `catalog must short-circuit (no method blocks combined); got: ${out}`);
  assert.ok(!out.includes(SIGNATURES_MARK), "no method surface is combined with the catalog steer");
});

// ---- A6b: a local-symbol (non-terminal) coexists with a method miss -> BOTH
// the drop-import steer and the method surface appear in one payload.
// RED now: first-eligible returns only the drop-import steer.
// (Constructed with the localDefs 7th arg, which classifies the import leaf as
// a same-file symbol - fakeable cleanly, so this sub-bar is covered.)
test("A6b: a local-symbol steer coexists with a method surface (non-terminal)", async () => {
  const ext = keyedExtractor();
  const out = surfaceOf(await resolveSurfaceInjection(
    ext,
    makeDoc("fn f() {}", "file:///x"),
    [
      diag("E0432", importMiss("somecrate::Local"), { line: 2, character: 4 }),
      diag("E0599", methodMiss("total", "Ledger"), { line: 3, character: 4 }),
    ],
    () => {},
    undefined,
    undefined,
    new Set(["Local"]),
  ));
  assert.ok(out, "a payload is produced");
  assert.ok(out.includes(DROP_IMPORT_MARK), `the drop-import steer must appear; got: ${out}`);
  assert.ok(out.includes("API surface for `Ledger`"), `the method surface must coexist with the local-symbol steer; got: ${out}`);
});

// ---- A9: empty-type E0599 guard. An E0599 with NO backticked receiver hits the
// classifier's fallback branch, which leaves type === "" (member/type are
// best-effort there). Two such errors on DISTINCT spans must NOT dedup to one via
// the empty type - the dedup falls back to span identity, so both surfaces are
// injected. A naive kind:type dedup would collapse them (empty == empty) to one.
const methodMissNoTicks = () => `no method named total found in the current scope`;
test("A9: two empty-type E0599 on distinct spans inject BOTH surfaces (span-identity dedup)", async () => {
  const ext = keyedExtractor();
  // Prove the classifier really leaves type === "" for this wording (empirical).
  const c0 = classifyHallucination(diag("E0599", methodMissNoTicks(), { line: 2, character: 4 }));
  assert.strictEqual(c0 && c0.kind, "unresolved-method", `no-ticks E0599 must classify unresolved-method (got ${c0 && c0.kind})`);
  assert.strictEqual(c0.type, "", `the fallback branch must leave type empty (got ${JSON.stringify(c0.type)})`);
  const out = surfaceOf(await resolveSurfaceInjection(ext, makeDoc("fn f() {}", "file:///x"), [
    diag("E0599", methodMissNoTicks(), { line: 2, character: 4 }),
    diag("E0599", methodMissNoTicks(), { line: 5, character: 4 }),
  ], () => {}));
  assert.ok(out, "a payload is produced");
  assert.strictEqual(blockCount(out), 2, `distinct empty-type spans must not collapse; got ${blockCount(out)} in: ${out}`);
});

// ---- F1 (member cap): a method miss whose receiver resolves MANY renderable
// method members -> the injected block is capped to <= the per-type member cap
// AND a [repair] log names the dropped methods. Guards the repair-leg port of
// the generate-side per-type cap (fnGen localTypeBlock): item 1 makes member-list
// the primary method-miss path and item 4 combines up to SURFACE_CAP types, so an
// uncapped list is worst-case ~120 signature lines past the codegen knee.
test("F1: a method miss with >cap renderable members is capped and the drop is logged", async () => {
  const N = 30; // more than any reasonable per-type cap (spec value 24)
  const logs = [];
  const ext = {
    example: async () => "",
    completeMembers: async () =>
      Array.from({ length: N }, (_, i) => ({ name: `meth${i}`, signature: `meth${i}(&self) -> usize`, kind: "method" })),
  };
  const out = surfaceOf(await resolveSurfaceInjection(ext, makeDoc("fn f() {}", "file:///x"), [
    diag("E0599", methodMiss("bad", "BigT"), { line: 2, character: 4 }),
  ], (line) => logs.push(line)));
  assert.ok(out, "a payload is produced");
  assert.ok(out.includes("API surface for `BigT`"), `expected BigT's surface; got: ${out}`);
  const sigCount = count(out, "(&self) -> usize");
  assert.ok(sigCount >= 1, "at least one signature is rendered");
  assert.ok(sigCount < N, `the member list must be capped below the ${N} supplied; got ${sigCount}`);
  assert.ok(logs.some((l) => /drop|truncat/i.test(l)), `a [repair] log must name the dropped methods; logs: ${JSON.stringify(logs)}`);
  assert.ok(logs.some((l) => l.includes(`meth${N - 1}`)), `the drop log must name a dropped method; logs: ${JSON.stringify(logs)}`);
});

// ---- A7: degrade / N=1 no-regression. Zero classifiable eligibles -> empty and
// no throw. Exactly one method miss -> a single API surface block (as today).
test("A7: zero classifiable eligibles yields empty and does not throw", async () => {
  const ext = keyedExtractor();
  const out = surfaceOf(await resolveSurfaceInjection(ext, makeDoc("fn f() {}", "file:///x"), [
    diag("E0308", "mismatched types", { line: 2, character: 4 }),
  ], () => {}));
  assert.ok(out === undefined || out === "", `no classifiable eligible must degrade to empty; got: ${JSON.stringify(out)}`);
});

test("A7: a single method miss yields one API surface block (N=1 unchanged)", async () => {
  const ext = keyedExtractor();
  const out = surfaceOf(await resolveSurfaceInjection(ext, makeDoc("fn f() {}", "file:///x"), [
    diag("E0599", methodMiss("total", "Solo"), { line: 2, character: 4 }),
  ], () => {}));
  assert.ok(out, "a payload is produced");
  assert.ok(out.includes("API surface for `Solo`"), `the single surface is injected; got: ${out}`);
  assert.strictEqual(blockCount(out), 1, `exactly one block for N=1; got ${blockCount(out)}`);
  assert.strictEqual(count(out, FIRM), 1, "the single FIRM_INSTRUCTION rides it");
});
