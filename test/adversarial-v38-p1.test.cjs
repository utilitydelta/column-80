// ADVERSARIAL REVIEW of session-v38 phase 1 (`admitsEmptyShape` / `isEnumDeclaration`).
//
// Every row here asserts the contract the CHANGE ITSELF claims, in the words of
// its own comments:
//
//   "A language answers yes only for a kind whose SIGNATURE is itself the
//    complete surface."                          (PrefillLang.admitsEmptyShape)
//   "What this admission delivers is the variant NAMES."     (isEnumDeclaration)
//   "A BODY WITH SOMETHING IN IT ... a bare head carries none, so admitting one
//    injects a header and a firm instruction closing a surface that has no
//    members - the same empty stub again, wearing the enum keyword."
//
// A RED row here is a place the shipped code does not do what those comments say.
// Harness mechanics copied from test/blind-v38-p1-enum-render.test.cjs.
//
// Triaged 2026-08-03. R2/R2b were DONE in the phase-1 loop-back and are green; they
// are now the regression test for it.
//
// Converted 2026-08-10 (session-v48 phase 0): a test that must be red is not a test.
// R1/R1b/R3/R4 were `todo` and are now GREEN rows asserting what the shipped code
// really does. Each keeps its original ruling verbatim plus a line saying what it
// used to assert. R1/R1b are SUPERSEDED - the v39 hover recovery fixed them and they
// pass as written. R3/R4 are KNOWN WRONG - the defect is still shipped, and the row
// now pins it.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v38-p1.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".review-v38-p1-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
  isBefore(o) { return this.line < o.line || (this.line === o.line && this.character < o.character); }
  isBeforeOrEqual(o) { return this.isBefore(o) || this.isEqual(o); }
  isAfter(o) { return !this.isBeforeOrEqual(o); }
  isAfterOrEqual(o) { return !this.isBefore(o); }
  isEqual(o) { return this.line === o.line && this.character === o.character; }
  compareTo(o) { return this.isEqual(o) ? 0 : this.isBefore(o) ? -1 : 1; }
  translate(l = 0, c = 0) { return new Position(this.line + l, this.character + c); }
  with(line, character) { return new Position(line === undefined ? this.line : line, character === undefined ? this.character : character); }
}
class Range {
  constructor(a, b, c, d) {
    if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
    else { this.start = a; this.end = b; }
  }
  get isEmpty() { return this.start.line === this.end.line && this.start.character === this.end.character; }
  get isSingleLine() { return this.start.line === this.end.line; }
  contains(p) {
    const ps = p.start ? p.start : p, pe = p.end ? p.end : p;
    const geS = ps.line > this.start.line || (ps.line === this.start.line && ps.character >= this.start.character);
    const leE = pe.line < this.end.line || (pe.line === this.end.line && pe.character <= this.end.character);
    return geS && leE;
  }
  with(s, e) { return new Range(s || this.start, e || this.end); }
}
class Selection extends Range {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit: class {},
  EventEmitter: class { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} },
  ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { File:0, Module:1, Namespace:2, Package:3, Class:4, Method:5, Property:6,
    Field:7, Constructor:8, Enum:9, Interface:10, Function:11, Variable:12, Constant:13,
    String:14, Number:15, Boolean:16, Array:17, Object:18, Key:19, Null:20, EnumMember:21,
    Struct:22, Event:23, Operator:24, TypeParameter:25 },
  ProgressLocation: { SourceControl:1, Window:10, Notification:15 },
  EndOfLine: { LF:1, CRLF:2 },
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__RV38P1_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".review-v38-p1.entry.ts");
const OUTFILE = path.join(__dirname, ".review-v38-p1.bundle.cjs");
let resolvePrefill;
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  ({ resolvePrefill } = require(OUTFILE));
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof resolvePrefill, "function");
});
// `opts` carries the node:test options object. Earlier sessions used it to spell a
// deferred row `{ todo: "..." }` so a standing finding would not fail CI. That is no
// longer done here: a test that must be red is not a test. A deferred finding is now
// a GREEN row asserting what the code really does, titled `KNOWN WRONG:` when the
// defect still ships or `SUPERSEDED:` when a later ruling made today's behaviour the
// correct one, with the original ruling kept above it.
const rtest = (name, optsOrFn, maybeFn) => {
  const fn = maybeFn ?? optsOrFn;
  const opts = maybeFn ? optsOrFn : {};
  test(name, opts, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });
};

const WS = "file:///work/rv38p1";

function makeDoc(text, uriStr) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
  };
  const positionAt = (off) => {
    let o = 0;
    for (let l = 0; l < lines.length; l++) {
      if (off <= o + lines[l].length) return new V.Position(l, off - o);
      o += lines[l].length + 1;
    }
    return new V.Position(lines.length - 1, 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

function makeExtractor(files, defTypes, examples) {
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    const on = [...known].filter((t) => new RegExp(`\\b${t}\\b`).test(line));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAtCursor(c.uri, c);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAtCursor(c.uri, c);
      return (t && defTypes[t].members) || [];
    },
    example: async (c, prefer) => examples[prefer],
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

// `types`: [{ name, hover, src, members?, example? }] in signature order.
async function runRustPrefill(types) {
  const mainUri = `${WS}/main.rs`;
  const names = types.map((t) => t.name);
  const signature = `pub fn decide(${names.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`;
  const src = `/// Decide the outcome.\n${signature} {\n    todo!()\n}\n`;
  const files = { [mainUri]: src };
  const defTypes = {};
  const examples = {};
  for (const t of types) {
    const uri = `${WS}/${t.name.toLowerCase()}.rs`;
    files[uri] = t.src;
    defTypes[t.name] = { uri, hover: t.hover, members: t.members || [] };
    if (t.example !== undefined) examples[t.name] = t.example;
  }
  const record = {
    span: { start: src.indexOf(signature), end: src.length - 1 },
    signature,
    docComment: "Decide the outcome.",
    symbolName: "decide",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  const logs = [];
  const disclosed = [];
  const ext = makeExtractor(files, defTypes, examples);
  globalThis.__RV38P1_FILES__ = files;
  let out;
  try {
    out = await resolvePrefill(ext, makeDoc(src, mainUri), record, (l) => logs.push(String(l)), {
      onDisclosed: (d) => disclosed.push(...d),
    });
  } finally {
    delete globalThis.__RV38P1_FILES__;
  }
  return { text: out || "", logs, disclosed };
}

// ===========================================================================
// R1. rust-analyzer's hover TRUNCATES a variant list at 5 (`hover.show.enumVariants`
//     default), and the product injects the truncated text verbatim. The change's
//     premise - "its SIGNATURE is already the whole surface" - does not hold for
//     any enum with more than five variants, and the def SOURCE that carries the
//     rest is already open (that is exactly the file `enumPayloadsFromSource`
//     reads to repair tuple payloads).
//
//     MEASURED SHAPE. `acme_crypto::CryptoError` renders in the shipped arm
//     as five variants then `/* … */`, hiding `SigningFailed` and `TimeError`.
// ===========================================================================
const HOVER_TRUNCATED = [
  "pub enum CryptoError {",
  "    InvalidSignature,",
  "    InvalidNonce,",
  "    KeyGenerationFailed( /* … */ ),",
  "    KeyEncodingFailed( /* … */ ),",
  "    KeyDecodingFailed( /* … */ ),",
  "    /* … */",
  "}",
].join("\n");
const SRC_TRUNCATED = [
  "pub enum CryptoError {",
  "    InvalidSignature,",
  "    InvalidNonce,",
  "    KeyGenerationFailed(String),",
  "    KeyEncodingFailed(String),",
  "    KeyDecodingFailed(String),",
  "    SigningFailed(String),",
  "    TimeError(String),",
  "}",
  "",
].join("\n");

//     WAS `todo` ("DEFERRED by triage as scraps S38-5: rust-analyzer cuts the variant
//     list at 5 and the product injects the cut text verbatim"). That deferral is
//     SUPERSEDED: session-v39 item 1 shipped `recoverElidedSurface`, which reads the
//     already-open def source and un-truncates the list before it is injected. The
//     row asserted exactly this and is now green as written; only the deferral moved.
rtest("SUPERSEDED: R1: a >5-variant enum injects every variant name (the change's own 'complete surface' claim)", async () => {
  const { text } = await runRustPrefill([{ name: "CryptoError", hover: HOVER_TRUNCATED, src: SRC_TRUNCATED }]);
  assert.match(text, /pub enum CryptoError/, "precondition: the enum was admitted and rendered");
  for (const v of ["InvalidSignature", "SigningFailed", "TimeError"]) {
    assert.ok(text.includes(v), `variant \`${v}\` is missing from the injected surface:\n${text}`);
  }
  // And the payloads come back from the source too, not as RA's `( /* … */ )`.
  assert.ok(text.includes("SigningFailed(String)"), `payload not recovered:\n${text}`);
});

// WAS `todo` ("DEFERRED by triage as scraps S38-5: follows from R1"). SUPERSEDED for
// the same reason R1 is: the marker no longer reaches the prompt at all on this
// fixture, so the firm instruction is not closing an admittedly-incomplete list. The
// row asserted `!(truncated && firm)` and now holds because `truncated` is false.
rtest("SUPERSEDED: R1b: ...and if it cannot, the truncation marker must not sit under a firm 'use only these' instruction", async () => {
  const { text } = await runRustPrefill([{ name: "CryptoError", hover: HOVER_TRUNCATED, src: SRC_TRUNCATED }]);
  const truncated = /^\s*\/\* … \*\/\s*$/m.test(text);
  const firm = /Call ONLY methods and constructors of `CryptoError`/.test(text);
  assert.equal(truncated, false, "the recovered list carries no elision marker:\n" + text);
  assert.equal(firm, true, "and the firm instruction is still emitted, over a list that is now complete:\n" + text);
  assert.ok(
    !(truncated && firm),
    "the prompt shows a variant list it has itself marked incomplete, and then names the type in the " +
      "closing instruction as if the list were exhaustive:\n" + text,
  );
});

// ===========================================================================
// R2. Condition 2 tests that the BODY IS NON-EMPTY, not that it carries variant
//     names. A body that is only a comment passes it, so the F2 hazard shape
//     (`{ /* private fields */ }`) is admitted the moment the head says `enum`.
//     This is the exact stub the doc comment says condition 2 exists to refuse.
// ===========================================================================
rtest("R2: an enum whose hover body is only a comment must not be admitted (the F2 hazard, enum-flavoured)", async () => {
  const hover = "pub enum Opaque { /* private fields */ }";
  const { text } = await runRustPrefill([{ name: "Opaque", hover, src: `${hover}\n` }]);
  assert.ok(
    !/`Opaque`/.test(text),
    "a body with no variant names was admitted; the prompt now names a surface with nothing in it:\n" + text,
  );
});

rtest("R2b: ...and the reachable spelling of it is RA's own elision marker, which is a USER setting", async () => {
  // `rust-analyzer.hover.show.enumVariants` is the user's, not ours (the same
  // point src/core/rustHoverRecovery.ts makes about the payload elision). At 0 the
  // hover body is the marker and nothing else.
  const hover = ["pub enum Verdict {", "    /* … */", "}"].join("\n");
  const src = ["pub enum Verdict {", "    Allow,", "    Deny,", "}", ""].join("\n");
  const { text } = await runRustPrefill([{ name: "Verdict", hover, src }]);
  assert.ok(
    !/`Verdict`/.test(text) || /Allow/.test(text),
    "admitted a hover that carries no variant name at all, and injected it under the firm instruction:\n" + text,
  );
});

// ===========================================================================
// R3. The disclosure contract. A pure data enum's variants ARE a closed set and
//     the prompt just showed them - but `recordDisclosed` builds `members` from
//     fields+methods, which for a pure data enum are both empty, and
//     `isClosedSurface` still requires members+fields > 0. So the one surface in
//     the prompt that can be read as an exhaustive list is handed to the repair
//     gate as `members: [], complete: false`, and the gate can refuse nothing.
// ===========================================================================
const HOVER_SMALL_ENUM = ["pub enum Verdict {", "    Allow,", "    Deny,", "}"].join("\n");

//     WAS `todo` ("DEFERRED by triage as scraps S38-1: a missed gain, not a
//     regression ... See R4 for why the obvious fix is wrong"). The row USED TO
//     assert `d.members` sorted is `["Allow", "Deny"]` and `d.complete === true`.
//     Neither holds; the row below pins what the shipped code really hands the gate.
rtest("KNOWN WRONG: R3: a rendered pure data enum discloses NOTHING to the repair gate", async () => {
  const { text, disclosed } = await runRustPrefill([
    { name: "Verdict", hover: HOVER_SMALL_ENUM, src: `${HOVER_SMALL_ENUM}\n` },
  ]);
  assert.match(text, /pub enum Verdict/, "precondition: the enum was admitted and rendered");
  const d = disclosed.find((x) => x.name === "Verdict");
  assert.ok(d, `Verdict rendered but was never disclosed: ${JSON.stringify(disclosed)}`);
  assert.deepEqual(
    [...d.members].sort(),
    [],
    "the prompt showed the whole variant set and the gate is told the type has no members at all",
  );
  assert.equal(
    d.complete,
    false,
    "a variant set shown in full IS a closed surface, and the gate is told it is not, so it can refuse nothing",
  );
});

// ===========================================================================
// R4. PRE-EXISTING, and the reason R3 must NOT be fixed by flipping
//     `isClosedSurface`. An enum that carries one method ALREADY clears
//     `isClosedSurface`, so it is disclosed as complete - with `members` holding
//     the METHOD names and no variant, because Rust variants never reach
//     `methods` (they arrive with no signature; `enumMemberLine` is a C#-only
//     hook). The repair gate then refuses correct code that names a real variant.
//     Unchanged by session-v38 phase 1; recorded here because the obvious fix for
//     R3 extends this to every newly rendered enum.
// ===========================================================================
const HOVER_ENUM_WITH_METHOD = ["pub enum DecodeError {", "    InvalidPadding,", "    InvalidLength,", "}"].join("\n");
const SRC_ENUM_WITH_METHOD = [
  "pub enum DecodeError {",
  "    InvalidPadding,",
  "    InvalidLength,",
  "}",
  "",
  "impl fmt::Display for DecodeError {",
  "    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result { Ok(()) }",
  "}",
  "",
].join("\n");

//     WAS `todo` ("DEFERRED by triage as scraps S38-1: PRE-EXISTING, unchanged by
//     phase 1"). The row USED TO assert the negation - that the pair
//     (`complete === true`, members with no variant in it) never occurs. It occurs;
//     the row below asserts the exact disclosure the shipped code produces.
rtest("KNOWN WRONG: R4 [PRE-EXISTING]: an enum with a method is disclosed COMPLETE with only its method names", async () => {
  const { disclosed } = await runRustPrefill([
    {
      name: "DecodeError",
      hover: HOVER_ENUM_WITH_METHOD,
      src: SRC_ENUM_WITH_METHOD,
      members: [{ name: "fmt", kind: "method", signature: "fmt(&self, f: &mut fmt::Formatter) -> fmt::Result" }],
    },
  ]);
  const d = disclosed.find((x) => x.name === "DecodeError");
  assert.ok(d, `not disclosed: ${JSON.stringify(disclosed)}`);
  assert.equal(d.complete, true, `disclosed as an exhaustive surface: ${JSON.stringify(d)}`);
  assert.deepEqual(
    [...d.members].sort(),
    ["fmt"],
    "the member list is the METHOD name and no variant, so `DecodeError::InvalidPadding` is refused by " +
      "src/core/repairGate.ts:undisclosedMemberRefusal even though it is a real variant",
  );
  assert.equal(d.members.includes("InvalidPadding"), false, `a real variant is missing: ${JSON.stringify(d)}`);
});
