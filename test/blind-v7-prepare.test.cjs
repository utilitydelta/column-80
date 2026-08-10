// v7 Phase 2 prepare-contract oracle for `resolvePrefill` (src/vscode/fnGen.ts),
// now unified onto the ONE cross-file resolver (src/core/crossFileShape.ts). This
// SUPERSEDES blind-v6-item2b.test.cjs: item2b's fake predated `definition()`, and
// its undefined-`definition()` greens MASKED the F2 regression (a resolvable-but-
// empty library stub pre-empting the worked example). This test is authored to the
// definition()-first contract, so both just-landed regression fixes are first-class
// oracles:
//   F1 — a doc-only LOCAL type (named only in the doc, defined in-file, absent from
//        the signature and any `use`) is anchored at its OWN def site and gets its
//        shape + methods injected again (findTypeReference falls back to
//        localTypeDefs.get(type)).
//   F2 — the shape path is taken only when the resolver derived something USEFUL
//        (methods OR fields); an empty/private-fields library stub falls through to
//        the worked example() (the fastbloom bar).
// The still-valid item2b invariants are ported to this contract: P5 (hover struct
// def rides the local block), P2/P4 (local -> member list, external -> example),
// P6/P6b (member cap + drop log; fields ahead of methods do not starve methods),
// FIRM-once, and P3 (prioritization: named/local survive, use-mined externals
// dropped lowest-first). The obsolete-internal item2b assertions
// (membersOfType-at-the-def-LINE) are deliberately dropped — the new design
// legitimately changed HOW anchoring works.
//
// Every assertion is black-box on the OUTPUT STRING plus the recorded
// example()/definition() call counts and captured log lines. Headless:
// esbuild-bundles resolvePrefill against a vscode stub (alias {vscode:STUB}) whose
// workspace.openTextDocument serves a uri->text map via globalThis.__V7_FILES__, so
// the resolver's openFile can read the def files the recursive walk anchors in.
//
// Run: SKIP_LIVE=1 node --test test/blind-v7-prepare.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// --- vscode stub (mechanics copied wholesale from blind-v7-prepare-xfile). ------
const STUB = path.join(__dirname, ".blind-v7-prepare-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
class Selection extends Range {}
class WorkspaceEdit {}
class EventEmitter { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} }
class ThemeColor {}
class MarkdownString {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (arg) => (typeof arg === "string" ? arg : (arg && arg.toString ? arg.toString() : String(arg)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: {},
  workspace: {
    openTextDocument: (arg) => {
      const files = globalThis.__V7_FILES__ || {};
      const key = keyOf(arg);
      const text = files[key];
      return Promise.resolve({ uri: mkUri(key), getText: () => text });
    },
  },
};\n`
);

const entry = path.join(__dirname, ".blind-v7-prepare.entry.ts");
const outfile = path.join(__dirname, ".blind-v7-prepare.bundle.cjs");
fs.writeFileSync(entry, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
esbuild.buildSync({ entryPoints: [entry], bundle: true, outfile, format: "cjs", platform: "node", alias: { vscode: STUB } });
const { resolvePrefill } = require(outfile);
test.after(() => [STUB, entry, outfile].forEach((f) => fs.rmSync(f, { force: true })));

// --- Fake vscode.TextDocument over a source string (same mechanics as the xfile
// seam): getText() returns the full buffer or a sliced range; positionAt/offsetAt
// do the UTF-16 offset math; uri.toString() is stable. ------------------------
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
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

// The identifier word covering a cursor, mirroring crossFileShape.identifierAt —
// the fakes key their answers off "which type token is the cursor on".
function wordAt(text, cursor) {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  const w = line.slice(s, e);
  return w.length > 0 ? w : undefined;
}

// A member with a rendered fn signature (renderMemberSignatures reads .signature).
const member = (name, signature) => ({ name, signature, kind: "method" });
// A field member: no .signature, so renderMemberSignatures drops it (data, not a
// method) — the mechanism P6b relies on.
const field = (name) => ({ name, kind: "field" });

// --- A recording, position-aware fake SurfaceExtractor built from a per-test
// config. `defTypes[name] = { uri, hover?, members? }` are the types definition()
// resolves (its def lives in `uri`, a file served in `files`); hover/members answer
// by the type at the DEF cursor. `examples[name]` is the worked example returned
// for that type via example(cursor, prefer=name). A type NOT in defTypes is an
// unresolvable external — definition() returns undefined — so it can only reach the
// example path. All other extractor methods degrade to empty/undefined. -------
function makeExtractor(cfg) {
  const files = cfg.files;
  const defTypes = cfg.defTypes || {};
  const examples = cfg.examples || {};
  const knownDef = new Set(Object.keys(defTypes));
  const calls = { definition: [], hoverSurface: [], membersOfType: [], example: [], completeMembers: [], qualifyImport: [] };

  // Which resolvable (def-carrying) type a cursor sits on: the exact word when it
  // is a known def type, else the first known def type on the cursor's line.
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && knownDef.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    for (const t of knownDef) {
      if (new RegExp(`\\b${t}\\b`).test(line)) return t;
    }
    return undefined;
  };

  // A DefinitionLocation at the `struct <type>` name token in the type's def file.
  const defLocFor = (typeName) => {
    const uri = defTypes[typeName].uri;
    const lines = files[uri].split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\bstruct ${typeName}\\b`).test(l));
    const ch = lines[ln].indexOf(typeName, lines[ln].indexOf("struct"));
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + typeName.length } };
  };

  const ext = {
    definition: async (cursor) => {
      calls.definition.push(cursor);
      const t = typeAtCursor(cursor.uri, cursor);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (cursor) => {
      calls.hoverSurface.push(cursor);
      const t = typeAtCursor(cursor.uri, cursor);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async (cursor) => {
      calls.membersOfType.push(cursor);
      const t = typeAtCursor(cursor.uri, cursor);
      return (t && defTypes[t].members) || [];
    },
    example: async (cursor, prefer) => {
      calls.example.push({ cursor, prefer });
      return examples[prefer];
    },
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
  return { ext, calls };
}

// A plain ResolvedFunction over `text` (span = the fn's body, UTF-16 offsets).
function resolvedFor(text, { signature, docComment, fnName = "target" }) {
  const start = text.indexOf("fn " + fnName);
  const end = text.indexOf("}", start) + 1;
  return { span: { start, end }, signature, docComment, symbolName: fnName, languageId: "rust", kind: "function" };
}

// Run `fn` with the uri->text map installed for the resolver's openFile.
function withFiles(files, fn) {
  globalThis.__V7_FILES__ = files;
  return Promise.resolve()
    .then(fn)
    .finally(() => { delete globalThis.__V7_FILES__; });
}

// ===========================================================================
// 1. F1 REGRESSION GUARD — doc-only LOCAL type gets its shape.
// `T` is defined in-file and named ONLY in the doc ("Tally the register T"); the
// signature does NOT name it and there is NO `use T`. It must anchor at its own
// def site and inject BOTH its method (tally_cohort) and its data shape
// (by_cohort / `pub struct T`), calling definition() for it. RED before the F1
// fix (findTypeReference had no localTypeDefs fallback → T dropped, zero blocks).
// ===========================================================================
const F1_URI = "file:///w/f1.rs";
const F1_SRC = `struct T {
    by_cohort: HashMap<u32, Vec<u64>>,
}

impl T {
    fn tally_cohort(&self, cohort: u32) -> usize { 0 }
}

fn target() -> usize {
    todo!()
}
`;

test("F1: doc-only local type T is anchored at its own def and gets shape + methods", async () => {
  await withFiles({ [F1_URI]: F1_SRC }, async () => {
    const { ext, calls } = makeExtractor({
      files: { [F1_URI]: F1_SRC },
      defTypes: {
        T: {
          uri: F1_URI,
          hover: "pub struct T { by_cohort: HashMap<u32, Vec<u64>> }",
          members: [member("tally_cohort", "tally_cohort(&self, u32) -> usize")],
        },
      },
    });
    const doc = makeDoc(F1_SRC, F1_URI);
    const resolved = resolvedFor(F1_SRC, { signature: "fn target() -> usize", docComment: "Tally the register T for a cohort." });
    const out = (await resolvePrefill(ext, doc, resolved, () => {})) || "";

    // The method (API-surface block) and the data shape (from hover) are both back.
    assert.ok(out.includes("tally_cohort("), `T's method must be injected. OUT:\n${out}`);
    assert.ok(out.includes("by_cohort"), `T's field (data shape from hover) must be injected. OUT:\n${out}`);
    assert.ok(out.includes("pub struct T"), `T's struct def (data shape from hover) must be injected. OUT:\n${out}`);
    // Crossing to the def REQUIRES definition() — the black-box liveness signal.
    assert.ok(calls.definition.length >= 1, `definition() must be called for T; got ${calls.definition.length}`);
  });
});

// ===========================================================================
// 2. F2 REGRESSION GUARD — library type with an empty/private shape gets the
// EXAMPLE, not a sparse shape block. `E` is named in the signature + imported;
// its hover is a `/* private fields */` stub (parsed fields = none) and it has no
// methods, so the resolver derives an EMPTY shape. That empty shape must NOT
// pre-empt the worked example. RED before the F2 fix (the `shape.types.has(E)`
// gate took the shape path on any resolved type → sparse stub + firm instruction
// pointing at a nonexistent surface, and example() never called).
// ===========================================================================
const F2_URI = "file:///w/f2.rs";
const F2_DOMAIN = "file:///w/ext_e.rs";
const F2_SRC = `use ext::E;

fn target(e: E) -> usize {
    todo!()
}
`;
const F2_DOMAIN_SRC = `pub struct E { /* private fields */ }\n`;

test("F2: a resolvable-but-empty library stub falls through to the worked example", async () => {
  await withFiles({ [F2_URI]: F2_SRC, [F2_DOMAIN]: F2_DOMAIN_SRC }, async () => {
    const { ext, calls } = makeExtractor({
      files: { [F2_URI]: F2_SRC, [F2_DOMAIN]: F2_DOMAIN_SRC },
      defTypes: {
        E: { uri: F2_DOMAIN, hover: "pub struct E { /* private fields */ }", members: [] },
      },
      examples: { E: "let e = ext::E::with_capacity(1024);" },
    });
    const doc = makeDoc(F2_SRC, F2_URI);
    const resolved = resolvedFor(F2_SRC, { signature: "fn target(e: E) -> usize", docComment: "Uses an external filter." });
    const out = (await resolvePrefill(ext, doc, resolved, () => {})) || "";

    assert.match(out, /Usage example for `E`/, `E must get the usage-example block. OUT:\n${out}`);
    assert.ok(out.includes("ext::E::with_capacity(1024)"), `the worked example is the payload. OUT:\n${out}`);
    assert.ok(!/Data shape of `E`/.test(out), `the sparse stub data-shape must NOT be injected. OUT:\n${out}`);
    assert.ok(!/API surface for `E`/.test(out), `no (empty) API-surface block for the stub. OUT:\n${out}`);
    assert.ok(calls.example.some((c) => c.prefer === "E"), `example() must be called for E; got ${JSON.stringify(calls.example.map((c) => c.prefer))}`);
  });
});

// ===========================================================================
// 3. P5 (port) — the hover struct def rides the local type's block: `pub struct
// Ledger` + a field present ALONGSIDE the member list. Here the local type is
// SIGNATURE-named (a different anchor path than F1's doc-only), proving the
// hover-def rides regardless of how the type was anchored.
// ===========================================================================
const P5_URI = "file:///w/p5.rs";
const P5_SRC = `struct Ledger {
    running_balance: u64,
}

impl Ledger {
    fn post_entry(&mut self, minor_units: i64) {}
}

fn target(led: Ledger) -> u64 {
    todo!()
}
`;

test("P5: the hover struct def rides the local type's block, alongside the member list", async () => {
  await withFiles({ [P5_URI]: P5_SRC }, async () => {
    const { ext } = makeExtractor({
      files: { [P5_URI]: P5_SRC },
      defTypes: {
        Ledger: {
          uri: P5_URI,
          hover: "pub struct Ledger { running_balance: u64 }",
          members: [member("post_entry", "post_entry(&mut self, i64)")],
        },
      },
    });
    const doc = makeDoc(P5_SRC, P5_URI);
    const resolved = resolvedFor(P5_SRC, { signature: "fn target(led: Ledger) -> u64", docComment: "Post to the ledger." });
    const out = (await resolvePrefill(ext, doc, resolved, () => {})) || "";

    assert.ok(out.includes("pub struct Ledger"), `struct def (data shape) injected. OUT:\n${out}`);
    assert.ok(out.includes("running_balance"), `the field name is present. OUT:\n${out}`);
    assert.ok(out.includes("post_entry("), `the member list rides the same block. OUT:\n${out}`);
  });
});

// ===========================================================================
// 4. P2/P4 (port) — a local type gets the member LIST (not an example); an
// external type gets the EXAMPLE (not a member list). `Ledger` is local (resolves
// to a struct + method); `Bloomer` is an unresolvable external (definition()
// undefined) with a worked example.
// ===========================================================================
const P24_URI = "file:///w/p24.rs";
const P24_SRC = `use ext::Bloomer;

struct Ledger {
    running_balance: u64,
}

impl Ledger {
    fn post_entry(&mut self, minor_units: i64) {}
}

fn target(led: Ledger) -> u64 {
    todo!()
}
`;

test("P2/P4: local type -> member list, external type -> usage example (never crossed)", async () => {
  await withFiles({ [P24_URI]: P24_SRC }, async () => {
    const { ext, calls } = makeExtractor({
      files: { [P24_URI]: P24_SRC },
      defTypes: {
        Ledger: {
          uri: P24_URI,
          hover: "pub struct Ledger { running_balance: u64 }",
          members: [member("post_entry", "post_entry(&mut self, i64)")],
        },
      },
      examples: { Bloomer: "let b = ext::Bloomer::with_num_bits(1024);" },
    });
    const doc = makeDoc(P24_SRC, P24_URI);
    const resolved = resolvedFor(P24_SRC, { signature: "fn target(led: Ledger) -> u64", docComment: "Post to the ledger, sized by `Bloomer`." });
    const out = (await resolvePrefill(ext, doc, resolved, () => {})) || "";

    // Local: member list, NOT an example.
    assert.match(out, /API surface for `Ledger`/, `local Ledger gets the member list. OUT:\n${out}`);
    assert.ok(out.includes("post_entry("), `Ledger's real method is present. OUT:\n${out}`);
    assert.ok(!/Usage example for `Ledger`/.test(out), `local Ledger must NOT get a usage example. OUT:\n${out}`);
    assert.ok(!calls.example.some((c) => c.prefer === "Ledger"), `example() must not be resolved for the local type.`);
    // External: example, NOT a member list.
    assert.match(out, /Usage example for `Bloomer`/, `external Bloomer gets the example. OUT:\n${out}`);
    assert.ok(out.includes("ext::Bloomer::with_num_bits(1024)"), `the worked example is the payload. OUT:\n${out}`);
    assert.ok(!/API surface for `Bloomer`/.test(out), `external Bloomer must NOT get a member list. OUT:\n${out}`);
  });
});

// ===========================================================================
// 5a. P6 (port) — member cap. A local type with more than MEMBER_CAP (24) methods
// is truncated and the drop is LOGGED (no silent full render).
// ===========================================================================
const CAP_URI = "file:///w/cap.rs";
const CAP_SRC = `struct Wide {
    n: u32,
}

impl Wide {
}

fn target(w: Wide) -> u32 {
    todo!()
}
`;

test("P6: over-cap members are truncated and the drop is logged", async () => {
  await withFiles({ [CAP_URI]: CAP_SRC }, async () => {
    // 120, not 30. RE-CUT by session-v48 phase 1 (docs/supersessions.md): the
    // per-type member cap is derived from the context stop's budget now
    // (`memberCapFor`), so the install default's 48 already swallowed a 30-member
    // fixture whole and the row passed while truncating nothing. The subject is
    // "over-cap members are truncated and the drop is logged", so the fixture is
    // sized well past any stop's cap and the row no longer names a number - a
    // literal here would pin the dial's default rather than the truncation.
    const MANY = 120;
    const many = Array.from({ length: MANY }, (_, i) => member(`meth${i}`, `meth${i}(&self) -> u32`));
    const { ext } = makeExtractor({
      files: { [CAP_URI]: CAP_SRC },
      defTypes: { Wide: { uri: CAP_URI, hover: "pub struct Wide { n: u32 }", members: many } },
    });
    const doc = makeDoc(CAP_SRC, CAP_URI);
    const resolved = resolvedFor(CAP_SRC, { signature: "fn target(w: Wide) -> u32", docComment: "Use the wide type." });
    const logs = [];
    const out = (await resolvePrefill(ext, doc, resolved, (l) => logs.push(l))) || "";

    assert.ok(out.includes("meth0("), `a within-cap method is rendered. OUT:\n${out}`);
    const rendered = (out.match(/meth\d+\(/g) || []).length;
    assert.ok(rendered < MANY, `the over-cap tail is truncated; ${rendered} of ${MANY} rendered. OUT:\n${out}`);
    assert.ok(!out.includes(`meth${MANY - 1}(`), `the last over-cap method is truncated. OUT:\n${out}`);
    assert.ok(logs.some((l) => /drop|truncat/i.test(l)), `a log line names what was dropped; got: ${JSON.stringify(logs)}`);
  });
});

// ===========================================================================
// 5b. P6b (port) — many FIELDS ahead of the methods do not STARVE the rendered
// methods. membersOfType returns 30 fields (no signature — renderMemberSignatures
// drops them) BEFORE two real methods. The resolver's `methods` are already
// field-free, so the MEMBER_CAP applies to renderables and both real methods
// survive (a naive raw slice(0,cap) would keep only fields and render "").
// ===========================================================================
test("P6b: fields ahead of the methods do not starve the member list", async () => {
  await withFiles({ [CAP_URI]: CAP_SRC }, async () => {
    const members = [
      ...Array.from({ length: 30 }, (_, i) => field(`fld${i}`)),
      member("post_entry", "post_entry(&mut self, i64)"),
      member("tally_cohort", "tally_cohort(&self, u32) -> usize"),
    ];
    const { ext } = makeExtractor({
      files: { [CAP_URI]: CAP_SRC },
      defTypes: { Wide: { uri: CAP_URI, hover: "pub struct Wide { n: u32 }", members } },
    });
    const doc = makeDoc(CAP_SRC, CAP_URI);
    const resolved = resolvedFor(CAP_SRC, { signature: "fn target(w: Wide) -> u32", docComment: "Use the wide type." });
    const out = (await resolvePrefill(ext, doc, resolved, () => {})) || "";

    assert.match(out, /API surface for `Wide`/, `the member list survives the leading fields. OUT:\n${out}`);
    assert.ok(out.includes("post_entry("), `the first method survives ahead-of-it fields. OUT:\n${out}`);
    assert.ok(out.includes("tally_cohort("), `the second method survives too. OUT:\n${out}`);
  });
});

// ===========================================================================
// 6. FIRM-once (port) — a multi-type prefill contains the FIRM_INSTRUCTION exactly
// ONCE, not once per block. Local `Ledger` (member list) + external `Bloomer`
// (example) assemble TWO blocks; the one shared instruction governs the whole
// surface.
// ===========================================================================
test("FIRM-once: a multi-type prefill contains the firm instruction exactly once", async () => {
  await withFiles({ [P24_URI]: P24_SRC }, async () => {
    const { ext } = makeExtractor({
      files: { [P24_URI]: P24_SRC },
      defTypes: {
        Ledger: {
          uri: P24_URI,
          hover: "pub struct Ledger { running_balance: u64 }",
          members: [member("post_entry", "post_entry(&mut self, i64)")],
        },
      },
      examples: { Bloomer: "let b = ext::Bloomer::with_num_bits(1024);" },
    });
    const doc = makeDoc(P24_SRC, P24_URI);
    const resolved = resolvedFor(P24_SRC, { signature: "fn target(led: Ledger) -> u64", docComment: "Post to the ledger, sized by `Bloomer`." });
    const out = (await resolvePrefill(ext, doc, resolved, () => {})) || "";

    const occurrences = (out.match(/Call ONLY methods and constructors/g) || []).length;
    assert.strictEqual(occurrences, 1, `FIRM_INSTRUCTION appears exactly once; got ${occurrences}. OUT:\n${out}`);
    // Sanity: the prefill really did assemble multiple distinct blocks.
    assert.match(out, /API surface for `Ledger`/, `block 1 present. OUT:\n${out}`);
    assert.match(out, /Usage example for `Bloomer`/, `block 2 present. OUT:\n${out}`);
  });
});

// ===========================================================================
// 7. P3 (port) — prioritization. Signature-named local `A` and doc-named local `T`
// both survive the ROOT CAP; the use-mined externals U1..U10 are dropped
// lowest-first. The anti-regression: a relevant local type is NEVER sacrificed to
// keep the ambient `use` set. Ordering is [A (sig), T (doc), U1..U10 (uses)], so
// the tail of the `use` tier is what gives way. The cap is the context dial's
// `rootCap` since session-v48 phase 1 and the row deliberately does not name its
// value; it names the ORDER, which is what the row is for.
// ===========================================================================
const P3_URI = "file:///w/p3.rs";
// TEN use-mined externals, not six. RE-CUT by session-v48 phase 1
// (docs/supersessions.md): the root cap is the context dial's now and the
// install default admits 8, so A + T + U1..U6 all fit and nothing was dropped -
// the row passed while measuring no prioritization at all. The subject is
// unchanged: more candidates than the cap admits, locals ahead of the ambient
// `use` tier.
const P3_EXTERNALS = 10;
const P3_SRC = `${Array.from({ length: P3_EXTERNALS }, (_, i) => `use ext::U${i + 1};`).join("\n")}

struct A {
    n: u32,
}

impl A {
    fn seed(&self) -> u32 { 0 }
}

struct T {
    by_cohort: HashMap<u32, Vec<u64>>,
}

impl T {
    fn tally_cohort(&self, cohort: u32) -> usize { 0 }
}

fn target(a: A) -> usize {
    todo!()
}
`;

test("P3: named/local A and T survive the budget; use-mined externals are dropped, never the reverse", async () => {
  await withFiles({ [P3_URI]: P3_SRC }, async () => {
    const { ext } = makeExtractor({
      files: { [P3_URI]: P3_SRC },
      defTypes: {
        A: { uri: P3_URI, hover: "pub struct A { n: u32 }", members: [member("seed", "seed(&self) -> u32")] },
        T: {
          uri: P3_URI,
          hover: "pub struct T { by_cohort: HashMap<u32, Vec<u64>> }",
          members: [member("tally_cohort", "tally_cohort(&self, u32) -> usize")],
        },
      },
      examples: Object.fromEntries(
        Array.from({ length: P3_EXTERNALS }, (_, i) => [`U${i + 1}`, `let u${i + 1} = ext::U${i + 1}::new();`]),
      ),
    });
    const doc = makeDoc(P3_SRC, P3_URI);
    const resolved = resolvedFor(P3_SRC, { signature: "fn target(a: A) -> usize", docComment: "Fold A into the register T." });
    const out = (await resolvePrefill(ext, doc, resolved, () => {})) || "";

    assert.match(out, /API surface for `A`/, `signature-named local A survives. OUT:\n${out}`);
    assert.match(out, /API surface for `T`/, `doc-named local T survives (the anti-regression). OUT:\n${out}`);
    const externalsKept = (out.match(/Usage example for `U\d+`/g) || []).length;
    assert.ok(
      externalsKept < P3_EXTERNALS,
      `at least one use-mined external is dropped by the budget (kept ${externalsKept}/${P3_EXTERNALS}). OUT:\n${out}`,
    );
    // The core bar: T is never sacrificed to keep the full use-mined set.
    assert.ok(
      !(externalsKept === P3_EXTERNALS && !/API surface for `T`/.test(out)),
      `never keep all U1..U${P3_EXTERNALS} while dropping T.`,
    );
  });
});
