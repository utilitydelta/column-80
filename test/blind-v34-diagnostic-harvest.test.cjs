// BLIND ORACLE - session-v34 items 2 and 3: "repair injects for the diagnostics it
// actually gets", and "an unclassified diagnostic must say so".
//
// Black-box. Nothing here has read src/vscode/oracleSurface.ts or
// src/core/compilerDirected.ts. The only product file opened was
// src/core/compilerOracle.ts, for the `Diagnostic` / `DiagnosticSpan` field names,
// plus the `SurfaceExtractor` method list so the fake answers the hooks that exist
// rather than invented ones. Every assertion is on the STRING
// `resolveSurfaceInjection` returns and on the LOG LINES its `log` callback
// receives. The harness mechanics are copied from blind-v7-repair-xfile
// (cursor-faithful fake extractor + minimal vscode stub + esbuild bundle) and
// impl-v30-p2-langdispatch (the `languageId` on the document, which is what makes
// the non-rust row expressible).
//
// THE CONTRACT, from session-v34/goal.md items 2 and 3, and nothing else.
//
//   Item 2. The diagnostic NAMES the type; resolve that name and inject its
//   definition. Harvest backticked identifiers from the MESSAGE and from the SPAN
//   LABELS, resolve them through the existing cross-file resolver, inject what
//   resolves. Worked examples the goal gives verbatim:
//     missing field `acked_versions` in initializer of `SampledAggregate`
//       -> names SampledAggregate
//     the trait bound `ApiKeysConfig: serde::Deserialize<'de>` is not satisfied
//       -> names ApiKeysConfig
//     expected `Bar`, found `Baz`
//       -> names both
//   Item 1's stdlib exclusion applies on the repair round too: a type whose
//   definition lives in the Rust sysroot renders nothing, and the drop says so.
//
//   Item 3. Every error that reaches repair and produces no surface logs the CODE
//   and the REASON. Silence is what hid item 2 for two sessions.
//
// WHAT IS DELIBERATELY NOT TESTED. The goal says nothing about block ordering,
// byte caps, how many harvested names may be injected at once, or the wording of
// any log line, so none of that is asserted. The log rows assert that the code is
// named and that SOME reason vocabulary is present; any wording satisfies them and
// only silence fails.
//
// THE ONE FAILURE MODE HERE THAT IS NOT A CONTRACT FAILURE. The fake extractor is
// CURSOR-FAITHFUL, the blind-v7-repair-xfile discipline: it resolves a type only
// when the cursor sits on that type's own token in the document (or on a line
// carrying exactly one known type name), because that is how rust-analyzer
// behaves. So an implementation that harvests the right name but resolves it
// through a route this fake cannot serve - a workspace-symbol lookup by bare name,
// say - would red a harvest row for a harness reason. It is cheap to tell apart:
// the payload is simply absent and the recorded hover cursors show the name was
// never looked for in the document. Every harvested name below appears as a real
// token in the fixture source, so the document route is always available.
//
// STATE at authoring, 11 rows, 10 green and 1 RED. Items 2 and 3 are largely
// built already: the channel shows `class=harvest via=diagnostic-name`, the
// message and the span label are both harvested, a lowercase field name is not
// taken for a type, and an error that buys nothing names its code and its reason.
// The one red is the stdlib leg. On the sysroot row the product ASKS for
// PathBuf's definition, gets the sysroot URI, renders nothing for it and stops
// before the hover - the provenance rule is working - and then says nothing at
// all: the only log line is `for=Ledger`. Item 1's guard rail ("the existing drop
// log stays and gains the reason. A type skipped for being stdlib must say so")
// and item 3's principle both want that line. The recorded HOVER-ASKED /
// DEF-ASKED lists in the failure output are what prove this is a silent product
// drop and not the fake failing to answer.
//
// Run: SKIP_LIVE=1 node --test test/blind-v34-diagnostic-harvest.test.cjs
// Add V34_DEBUG=1 to print every row's channel and payload, green rows included.

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness: minimal vscode stub + esbuild alias, then require the CJS bundle.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v34-harvest-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s), scheme: "file" });
module.exports = {
  Position, Range, ThemeColor: class {}, MarkdownString: class {},
  Uri: { parse: mkUri, file: mkUri },
  languages: {}, window: {},
  commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__V34_FILES__ || {};
      const key = typeof arg === "string" ? arg : (arg && arg.toString ? arg.toString() : String(arg));
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v34-harvest.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v34-harvest.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";\n`);
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

// A broken bundle must be ONE loud failure, never a wall of TypeErrors that could
// be mistaken for contract failures.
test("bundle guard: resolveSurfaceInjection builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.strictEqual(typeof B.resolveSurfaceInjection, "function", "resolveSurfaceInjection must be exported");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// ===========================================================================
// The fixture. One rust file that NAMES every type any diagnostic below quotes,
// so a document-anchored resolver always has a real token to hover. Each
// diagnostic's primary span is placed where rustc actually puts it, which for the
// trait-bound and mismatched-type rows is NOT on the type token - that is what
// makes them harvest rows rather than hover-at-the-span rows.
// ===========================================================================

const MAIN_URI = "file:///work/proj/src/lib.rs";
const MAIN_SRC = `use crate::domain::SampledAggregate;
use crate::domain::Order;
use crate::keys::ApiKeysConfig;
use crate::shape::Bar;
use crate::shape::Baz;
use crate::ledger::Ledger;
use std::path::PathBuf;

pub fn roll_up(epoch: u64) -> SampledAggregate {
    SampledAggregate { epoch }
}

pub fn load(cfg: ApiKeysConfig) -> Bar {
    let parsed = from_slice(&cfg)?;
    parsed
}

pub fn widen(b: Baz) -> Bar {
    b
}

pub fn persist(root: PathBuf, ledger: Ledger) {
    write_all(&ledger, &root);
}

pub fn tally() {
    let acc = Default::default();
}

pub fn town(o: &Order) -> String {
    o.city.clone()
}
`;

// A csharp document, for the row that says the backtick harvest is Rust's.
const CS_URI = "file:///work/proj/src/Roll.cs";
const CS_SRC = `namespace P;

public class Roll
{
    public int RollUp()
    {
        return 0;
    }
}
`;

const SYSROOT_URI =
  "file:///home/u/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/lib/rustlib/src/rust/library/std/src/path.rs";

// The sentinel strings. Each is unique, so its appearance in a payload is proof of
// exactly one wrong move and nothing else.
const PATHBUF_PRIVATE = "inner: OsString";
const PATHBUF_METHOD = "from_u8_slice";
const FIELD_TRAP = "WRONG_HARVEST_FIELD_SENTINEL";

// Every name the fake can resolve, with its hover, its definition file and its
// member list. `PathBuf`'s definition is in the Rust sysroot; every other one is
// in the project. `acked_versions` is resolvable ON PURPOSE: it is the field name
// out of the E0063 message, and making it answer is the only way the "a field is
// not a type" row can be passed by the RULE rather than by the fake running out
// of answers.
const NAMES = {
  SampledAggregate: {
    defUri: "file:///work/proj/src/domain/sampled.rs",
    hover: "pub struct SampledAggregate { pub epoch: u64, pub acked_versions: Vec<u64> }",
    members: [
      { name: "epoch", kind: "field", signature: "epoch: u64" },
      { name: "acked_versions", kind: "field", signature: "acked_versions: Vec<u64>" },
    ],
  },
  ApiKeysConfig: {
    defUri: "file:///work/proj/src/keys.rs",
    hover: "pub struct ApiKeysConfig { pub primary_rw: [u8; 32], pub secondary_ro: [u8; 32] }",
    members: [
      { name: "primary_rw", kind: "field", signature: "primary_rw: [u8; 32]" },
      { name: "secondary_ro", kind: "field", signature: "secondary_ro: [u8; 32]" },
    ],
  },
  Bar: {
    defUri: "file:///work/proj/src/shape/bar.rs",
    hover: "pub struct Bar { pub bar_slot: u32 }",
    members: [{ name: "bar_slot", kind: "field", signature: "bar_slot: u32" }],
  },
  Baz: {
    defUri: "file:///work/proj/src/shape/baz.rs",
    hover: "pub struct Baz { pub baz_slot: u32 }",
    members: [{ name: "baz_slot", kind: "field", signature: "baz_slot: u32" }],
  },
  Ledger: {
    defUri: "file:///work/proj/src/ledger.rs",
    hover: "pub struct Ledger { pub ledger_seq: u64 }",
    members: [{ name: "ledger_seq", kind: "field", signature: "ledger_seq: u64" }],
  },
  Order: {
    defUri: "file:///work/proj/src/domain/order.rs",
    hover: "pub struct Order { pub reference: String, pub placed_by: Customer }",
    members: [
      { name: "reference", kind: "field", signature: "reference: String" },
      { name: "placed_by", kind: "field", signature: "placed_by: Customer" },
    ],
  },
  PathBuf: {
    defUri: SYSROOT_URI,
    hover: `pub struct PathBuf { ${PATHBUF_PRIVATE} }`,
    members: [
      { name: PATHBUF_METHOD, kind: "method", signature: `${PATHBUF_METHOD}(s: &[u8]) -> &Path` },
      { name: "as_u8_slice", kind: "method", signature: "as_u8_slice(&self) -> &[u8]" },
      { name: "push", kind: "method", signature: "push<P: AsRef<Path>>(&mut self, path: P)" },
    ],
  },
  acked_versions: {
    defUri: "file:///work/proj/src/domain/acked.rs",
    hover: `pub struct ${FIELD_TRAP} { pub trap: u8 }`,
    members: [{ name: FIELD_TRAP, kind: "field", signature: `${FIELD_TRAP}: u8` }],
  },
};

// The def files, so a resolver that opens the definition document finds the same
// shape the hover reports.
const DEF_FILES = {};
for (const [name, rec] of Object.entries(NAMES)) DEF_FILES[rec.defUri] = `${rec.hover}\n`;

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
};

function makeDoc(text, uriStr, languageId) {
  const lines = text.split("\n");
  const offsetAt = (p) => {
    let o = 0;
    for (let i = 0; i < Math.min(p.line, lines.length); i++) o += lines[i].length + 1;
    return Math.min(o + p.character, text.length);
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
    languageId,
    uri: { toString: () => uriStr, fsPath: uriStr, path: uriStr, scheme: "file" },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

// Cursor-faithful: a type resolves when the cursor is ON its own token, or when
// the cursor's line carries exactly one known type name (the nearby-token slack
// blind-v24-p2's fake also allows). Never otherwise - a hover at a dead field
// access returns undefined, which is what rust-analyzer does and what stopped an
// earlier fake from masking a real gap.
function makeExtractor(srcByUri) {
  const calls = { hoverSurface: [], definition: [], membersOfType: [], completeMembers: [], example: [], qualifyImport: [] };
  // What the fake was ASKED about, in words. This is what tells a real red (the
  // product resolved the name and dropped it silently) from a harness red (the
  // name was never looked for in the document at all).
  const asked = { hover: [], definition: [] };
  const nameAt = (cursor) => {
    const text = srcByUri[cursor && cursor.uri] ?? srcByUri[MAIN_URI];
    const w = wordAt(text, cursor);
    if (w && NAMES[w]) return w;
    const line = (text || "").split("\n")[cursor.line] ?? "";
    const onLine = Object.keys(NAMES).filter((n) => new RegExp(`\\b${n}\\b`).test(line));
    return onLine.length === 1 ? onLine[0] : undefined;
  };
  const defLoc = (name) => {
    const uri = NAMES[name].defUri;
    const r = { startLine: 0, startCharacter: 11, endLine: 0, endCharacter: 11 + name.length };
    return {
      uri,
      range: { ...r, start: { line: 0, character: 11 }, end: { line: 0, character: 11 + name.length } },
      line: 0,
      character: 11,
      position: { line: 0, character: 11 },
    };
  };
  return {
    calls,
    asked,
    hoverSurface: async (cursor) => {
      calls.hoverSurface.push(cursor);
      const n = nameAt(cursor);
      asked.hover.push(n || wordAt(srcByUri[cursor && cursor.uri] ?? srcByUri[MAIN_URI], cursor) || "(nothing)");
      return n ? { signature: NAMES[n].hover } : undefined;
    },
    definition: async (cursor) => {
      calls.definition.push(cursor);
      const n = nameAt(cursor);
      asked.definition.push(n || "(nothing)");
      return n ? defLoc(n) : undefined;
    },
    membersOfType: async (cursor) => {
      calls.membersOfType.push(cursor);
      const byDef = Object.entries(NAMES).find(([, rec]) => rec.defUri === (cursor && cursor.uri));
      if (byDef) return byDef[1].members;
      const n = nameAt(cursor);
      return n ? NAMES[n].members : [];
    },
    // No `.`/`::` trigger site is under test, so the completion leg is empty -
    // the blind-v7-repair-xfile shape.
    completeMembers: async (cursor) => {
      calls.completeMembers.push(cursor);
      return [];
    },
    example: async (cursor, prefer) => {
      calls.example.push(prefer);
      return undefined;
    },
    qualifyImport: async (cursor) => {
      calls.qualifyImport.push(cursor);
      return undefined;
    },
  };
}

// ---- Diagnostics, built at real offsets in the fixture source.

function spanAt(src, fileName, lineNeedle, token, label) {
  const at = src.indexOf(lineNeedle);
  assert.ok(at >= 0, `fixture bug: ${JSON.stringify(lineNeedle)} not in source`);
  const lineIdx = src.slice(0, at).split("\n").length - 1;
  const lineText = src.split("\n")[lineIdx];
  const col = lineText.indexOf(token);
  assert.ok(col >= 0, `fixture bug: ${JSON.stringify(token)} not on ${JSON.stringify(lineText)}`);
  const lineStartOffset = src.split("\n").slice(0, lineIdx).reduce((a, l) => a + l.length + 1, 0);
  return {
    fileName,
    byteStart: lineStartOffset + col,
    byteEnd: lineStartOffset + col + token.length,
    lineStart: lineIdx + 1,
    lineEnd: lineIdx + 1,
    columnStart: col + 1,
    columnEnd: col + 1 + token.length,
    isPrimary: true,
    ...(label === undefined ? {} : { label }),
  };
}

const diag = (code, message, span) => ({
  kind: "compile-error",
  level: "error",
  code,
  message,
  spans: [span],
  suggestions: [],
  rendered: `error[${code}]: ${message}`,
});

const RS_FILE = "src/lib.rs";
const rsSpan = (lineNeedle, token, label) => spanAt(MAIN_SRC, RS_FILE, lineNeedle, token, label);

const surfaceOf = (r) => (typeof r === "string" ? r : r && r.surface);

async function run(diagnostics, { uri = MAIN_URI, src = MAIN_SRC, languageId = "rust" } = {}) {
  const files = { ...DEF_FILES, [uri]: src };
  const ext = makeExtractor({ ...files });
  const logs = [];
  globalThis.__V34_FILES__ = files;
  let out;
  try {
    out = await B.resolveSurfaceInjection(ext, makeDoc(src, uri, languageId), diagnostics, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__V34_FILES__;
  }
  const text = surfaceOf(out) || "";
  // V34_DEBUG=1 prints every row's channel and payload, green rows included. A
  // green whose log lines nobody has read is a green nobody has checked.
  if (process.env.V34_DEBUG) {
    console.log(`\n--- ${diagnostics.map((d) => d.code).join(",")} on ${languageId}\n${logs.join("\n") || "(no log lines)"}\n${text || "(no payload)"}`);
  }
  return { out: surfaceOf(out), text, logs, calls: ext.calls, asked: ext.asked };
}

const dump = (r) =>
  `\n  HOVER-ASKED=${JSON.stringify(r.asked.hover)}\n  DEF-ASKED=${JSON.stringify(r.asked.definition)}` +
  `\n  LOGS=${JSON.stringify(r.logs, null, 1)}\n  PAYLOAD:\n${r.text || "(none)"}`;

// The types a payload actually renders a BLOCK for: a backticked bare identifier
// on a line that a fence opens within the next two lines. Copied from
// blind-v24-p2-surface's headerTypes, so "which types did this payload describe"
// is read the same way in both files.
function headerTypes(out) {
  const lines = (out || "").split("\n");
  const names = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(lines[i]);
    if (!m) continue;
    const fenced = (lines[i + 1] || "").startsWith("```") || (lines[i + 2] || "").startsWith("```");
    if (!fenced) continue;
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}

// Item 3 asks for the CODE and a REASON. The wording is not specified, so the
// reason side is a generous vocabulary: any of these satisfies it, and only
// silence - or a line that names the code and says nothing else - fails.
const NO_SURFACE_REASON =
  /unclassif|not classif|no class|unrecognis|unrecogniz|unknown|no surface|nothing|no type|no name|no identifier|no backtick|unresolved|not resolved|did not resolve|does not resolve|resolved no|no definition|no candidate|no member|empty|no shape|skip|drop|reason/i;

// Item 1's guard rail: a type skipped for being stdlib must SAY so.
const STDLIB_REASON = /\bstd\b|\bcore\b|\balloc\b|stdlib|sysroot|standard library|toolchain|rustup|prelude|foreign/i;

function assertNoSurfaceLogged(r, code, where) {
  const named = r.logs.filter((l) => l.includes(code));
  assert.ok(
    named.length > 0,
    `${where}: item 3 - an error that produces no surface must LOG ITS CODE (${code}) on the repair channel. Silence is what hid item 2 for two sessions.${dump(r)}`,
  );
  assert.ok(
    named.some((l) => NO_SURFACE_REASON.test(l.replace(code, ""))),
    `${where}: item 3 - the line naming ${code} must also carry a REASON, in any wording. A bare code is half the contract.${dump(r)}`,
  );
}

// ===========================================================================
// Row 1. The goal's highest-value row. E0063 is the top unclassified error in the
// bodies and the top error in the generated test modules, and the goal says one
// struct definition addresses three of the nine measured failures on its own. The
// message names the struct being initialised; that struct's real field list is the
// injection.
// ===========================================================================
btest("E0063 `missing field ... in initializer of \\`SampledAggregate\\`` injects SampledAggregate's definition", async () => {
  const r = await run([
    diag(
      "E0063",
      "missing field `acked_versions` in initializer of `SampledAggregate`",
      rsSpan("    SampledAggregate { epoch }", "SampledAggregate"),
    ),
  ]);
  assert.ok(r.out, `item 2 - E0063 must produce a surface; today nothing classifies and repair goes out with none.${dump(r)}`);
  assert.match(r.text, /\bSampledAggregate\b/, `the payload must NAME the struct the message named.${dump(r)}`);
  assert.ok(
    r.text.includes("acked_versions") && r.text.includes("epoch"),
    `the payload must carry the struct's REAL fields - the missing one and the rest - because a field list is the whole answer to E0063.${dump(r)}`,
  );
  assert.ok(
    headerTypes(r.text).includes("SampledAggregate"),
    `SampledAggregate must get a rendered block of its own, not a passing mention. headers=${JSON.stringify(headerTypes(r.text))}${dump(r)}`,
  );
});

// ===========================================================================
// Row 2. The trait bound from the goal's own screenshot row. The named type is the
// SUBJECT of the bound, `ApiKeysConfig`. The rest of that backtick span is a path
// segment and a generic trait with a lifetime argument, and neither is the type
// the diagnostic is about. The primary span sits on the failing call, not on the
// type token, so only a message harvest reaches the name.
// ===========================================================================
btest("E0277 `the trait bound \\`ApiKeysConfig: serde::Deserialize<'de>\\`` injects ApiKeysConfig, not serde and not the trait", async () => {
  const r = await run([
    diag(
      "E0277",
      "the trait bound `ApiKeysConfig: serde::Deserialize<'de>` is not satisfied",
      rsSpan("    let parsed = from_slice(&cfg)?;", "from_slice"),
    ),
  ]);
  assert.ok(r.out, `item 2 - E0277 is 4 of the 25 measured failures and must produce a surface.${dump(r)}`);
  assert.match(r.text, /\bApiKeysConfig\b/, `the payload must NAME the subject of the trait bound.${dump(r)}`);
  assert.ok(
    r.text.includes("primary_rw") && r.text.includes("secondary_ro"),
    `ApiKeysConfig's own definition must be rendered.${dump(r)}`,
  );
  const headers = headerTypes(r.text);
  assert.ok(headers.includes("ApiKeysConfig"), `ApiKeysConfig must get a block of its own. headers=${JSON.stringify(headers)}${dump(r)}`);
  assert.ok(
    !headers.includes("serde"),
    `\`serde\` is a crate path segment, not the named type; it must not get a block. headers=${JSON.stringify(headers)}${dump(r)}`,
  );
  assert.ok(
    !r.text.includes("Deserialize<'de>") && !r.text.includes("'de"),
    `the trait's generic argument list must not be carried into the payload as if it were a type name.${dump(r)}`,
  );
});

// ===========================================================================
// Row 3. The harvest reads SPAN LABELS, not only the message. rustc puts
// "expected `Bar`, found `Baz`" on the span; the message is the bare "mismatched
// types" and names nothing. E0308 is the single largest code in the measured set
// at 6 of 25, so a harvest that only reads messages leaves the biggest one out.
// ===========================================================================
btest("E0308 whose SPAN LABEL is `expected \\`Bar\\`, found \\`Baz\\`` injects BOTH types", async () => {
  const r = await run([
    diag("E0308", "mismatched types", rsSpan("    b\n}", "b", "expected `Bar`, found `Baz`")),
  ]);
  assert.ok(r.out, `item 2 - the label names two types and the harvest must read labels.${dump(r)}`);
  const headers = headerTypes(r.text);
  for (const t of ["Bar", "Baz"]) {
    assert.ok(headers.includes(t), `\`${t}\` from the span label must get a rendered block. headers=${JSON.stringify(headers)}${dump(r)}`);
  }
  assert.ok(
    r.text.includes("bar_slot") && r.text.includes("baz_slot"),
    `both definitions must be rendered, expected and found alike.${dump(r)}`,
  );
});

// ===========================================================================
// Row 4. Item 1's stdlib exclusion applies on the repair round too. A harvested
// name whose DEFINITION lives in the Rust sysroot renders nothing: the goal calls
// PathBuf's private field and its private internals a leak worse than injecting
// nothing, under a header reading "use these exact names, do not invent". The name
// may still be named; what must not appear is its rendered shape. The
// project-local half of the same label proves the row is not just "nothing
// rendered at all".
// ===========================================================================
btest("a harvested name whose definition is in the Rust sysroot renders nothing, and the drop says why", async () => {
  const r = await run([
    diag(
      "E0308",
      "mismatched types",
      rsSpan("    write_all(&ledger, &root);", "write_all", "expected `PathBuf`, found `Ledger`"),
    ),
  ]);
  assert.ok(
    !r.text.includes(PATHBUF_PRIVATE),
    `a sysroot type's data shape must not be rendered; \`${PATHBUF_PRIVATE}\` is a private field of a type the model has known since pretraining.${dump(r)}`,
  );
  assert.ok(
    !r.text.includes(PATHBUF_METHOD),
    `a sysroot type's members must not be rendered; \`${PATHBUF_METHOD}\` is a private internal.${dump(r)}`,
  );
  assert.ok(
    !headerTypes(r.text).includes("PathBuf"),
    `PathBuf must get no rendered block. headers=${JSON.stringify(headerTypes(r.text))}${dump(r)}`,
  );
  // The paired positive: the project-local type on the SAME label still renders,
  // so the row cannot pass by the whole harvest being dead.
  assert.ok(r.out, `the project-local half of the label must still produce a surface.${dump(r)}`);
  assert.ok(r.text.includes("ledger_seq"), `Ledger is project-local and must render its definition.${dump(r)}`);
  // Item 1's guard rail: the drop log gains the reason.
  const named = r.logs.filter((l) => l.includes("PathBuf"));
  assert.ok(named.length > 0, `the skipped type must be NAMED on the channel.${dump(r)}`);
  assert.ok(
    named.some((l) => STDLIB_REASON.test(l)),
    `a type skipped for being stdlib must SAY so, in any wording.${dump(r)}`,
  );
});

// ===========================================================================
// Row 5. Item 3, both shapes of producing nothing. E0282's message carries no
// backticked identifier at all, so there is nothing to harvest. E0600's does, and
// the name resolves to nothing. Either way repair goes out with no surface, and
// either way the code and the reason must reach the channel: the goal's own
// sentence is that silence is how item 2 hid for two sessions.
// ===========================================================================
btest("E0282 with no backticked identifier produces no surface AND logs its code with a reason", async () => {
  const r = await run([
    diag("E0282", "type annotations needed", rsSpan("    let acc = Default::default();", "acc")),
  ]);
  assert.strictEqual(r.out, undefined, `nothing is harvestable, so nothing must be invented.${dump(r)}`);
  assertNoSurfaceLogged(r, "E0282", "E0282");
});

btest("E0600 whose harvested name resolves to nothing produces no surface AND logs its code with a reason", async () => {
  const r = await run([
    diag("E0600", "cannot apply unary operator `-` to type `Phantom`", rsSpan("    let acc = Default::default();", "acc")),
  ]);
  assert.strictEqual(r.out, undefined, `\`Phantom\` resolves to nothing, and an unresolvable name must inject nothing.${dump(r)}`);
  assertNoSurfaceLogged(r, "E0600", "E0600");
});

// ===========================================================================
// Row 5c. Item 3 says EVERY error that produces no surface logs its code and its
// reason. The case that reads as covered and is easiest to miss is the MIXED
// round: one diagnostic resolves, another does not, and the payload is not empty.
// A whole-payload-was-empty line cannot carry this claim, because the payload was
// not empty.
// ===========================================================================
btest("item 3 is per-error: in a mixed round the diagnostic that bought nothing is still logged with a reason", async () => {
  const r = await run([
    diag(
      "E0063",
      "missing field `acked_versions` in initializer of `SampledAggregate`",
      rsSpan("    SampledAggregate { epoch }", "SampledAggregate"),
    ),
    diag("E0282", "type annotations needed", rsSpan("    let acc = Default::default();", "acc")),
  ]);
  assert.ok(r.out, `the resolvable half must still inject.${dump(r)}`);
  assert.match(r.text, /\bSampledAggregate\b/, `the resolvable half is SampledAggregate.${dump(r)}`);
  assertNoSurfaceLogged(r, "E0282", "mixed round");
});

// ===========================================================================
// Row 6. The field name in "missing field `acked_versions`" is a FIELD, not a
// type. A lowercase snake_case backtick never names a type in Rust. The fake
// resolves `acked_versions` to a sentinel struct on purpose, so this row can only
// be passed by the rule and not by the fake running out of answers.
// ===========================================================================
btest("the field name in `missing field \\`acked_versions\\`` is not injected as a type", async () => {
  const r = await run([
    diag(
      "E0063",
      "missing field `acked_versions` in initializer of `SampledAggregate`",
      rsSpan("    SampledAggregate { epoch }", "SampledAggregate"),
    ),
  ]);
  assert.ok(
    !r.text.includes(FIELD_TRAP),
    `a lowercase snake_case backtick is a field, not a type: harvesting \`acked_versions\` as a type name resolved a sentinel into the payload.${dump(r)}`,
  );
  assert.ok(
    !headerTypes(r.text).includes("acked_versions"),
    `\`acked_versions\` must get no block of its own. headers=${JSON.stringify(headerTypes(r.text))}${dump(r)}`,
  );
});

// ===========================================================================
// Row 7. The seven already-classified codes keep working. E0609 is 4 of the 25
// measured failures and has its own shipped leg, whose fixed form hovers at a real
// reference to the receiver type rather than at the dead field cursor. Item 2
// replaces a code-by-code table with a rule and must not cost the table's rows.
// ===========================================================================
btest("regression: E0609 `no field \\`city\\` on type \\`Order\\`` still injects Order's real fields", async () => {
  const r = await run([
    diag("E0609", "no field `city` on type `Order`", rsSpan("    o.city.clone()", "city")),
  ]);
  assert.ok(r.out, `the shipped E0609 leg must still produce a payload.${dump(r)}`);
  assert.match(r.text, /\bOrder\b/, `the receiver Order is still named.${dump(r)}`);
  assert.ok(
    r.text.includes("reference") && r.text.includes("placed_by"),
    `Order's REAL fields are still injected.${dump(r)}`,
  );
  assert.ok(!/\bcity\b/.test(r.text), `the invented field name must still not be echoed as real.${dump(r)}`);
});

// ===========================================================================
// Row 8. The harvest is Rust's. Backticks around identifiers are rustc's own
// convention for naming a type; nothing says another compiler's diagnostic text
// means the same thing, and v30 already had to fix a round of exactly this - a
// pyright rule name matched against rustc's error codes. A rustc-shaped diagnostic
// arriving against a csharp document must inject nothing, while the identical
// diagnostic against the rust document injects (row 1), which is what makes this a
// dispatch claim rather than a tautology.
// ===========================================================================
btest("the harvest is Rust's: a rustc-shaped diagnostic on a csharp document is unchanged", async () => {
  const d = [
    diag("E0063", "missing field `acked_versions` in initializer of `SampledAggregate`", {
      fileName: "src/Roll.cs",
      byteStart: 0,
      byteEnd: 6,
      lineStart: 5,
      lineEnd: 5,
      columnStart: 9,
      columnEnd: 15,
      isPrimary: true,
    }),
  ];
  const cs = await run(d, { uri: CS_URI, src: CS_SRC, languageId: "csharp" });
  assert.strictEqual(
    cs.out,
    undefined,
    `rustc's backtick convention must not be applied to a csharp document.${dump(cs)}`,
  );
  const py = await run(d, { uri: CS_URI, src: CS_SRC, languageId: "python" });
  assert.strictEqual(py.out, undefined, `nor to a python document.${dump(py)}`);
  // The paired positive, in this same test, so "undefined" cannot be this
  // harness answering nothing to everything: the IDENTICAL diagnostic against the
  // rust document injects.
  const rs = await run([
    diag(
      "E0063",
      "missing field `acked_versions` in initializer of `SampledAggregate`",
      rsSpan("    SampledAggregate { epoch }", "SampledAggregate"),
    ),
  ]);
  assert.ok(rs.out, `paired positive: the same diagnostic on the RUST document must inject, or this row proves nothing.${dump(rs)}`);
});
