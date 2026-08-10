// ADVERSARIAL REVIEW - session-v34 items 1, 2 and 3.
//
// Every row here is an ATTACK on the shipped harvest pass and its logging, not a
// restatement of the contract. Harness mechanics (vscode stub, esbuild bundle,
// cursor-faithful fake extractor) are copied from
// test/blind-v34-diagnostic-harvest.test.cjs so both files drive the same entry
// point the same way. Nothing here edits an existing test or any src file.
//
// Run: SKIP_LIVE=1 node --test test/review-v34-harvest.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".review-v34-vscode-stub.cjs");
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
      const files = globalThis.__RV34_FILES__ || {};
      const key = typeof arg === "string" ? arg : (arg && arg.toString ? arg.toString() : String(arg));
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".review-v34.entry.ts");
const OUTFILE = path.join(__dirname, ".review-v34.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";
export { isRustSysrootDef } from "../src/core/crossFileShape";
export { harvestDiagnosticTypes } from "../src/core/compilerDirected";
export { contextBoundsFor, DEFAULT_CONTEXT_STOP, surfaceCapFor } from "../src/core/budgetProfile";
`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.strictEqual(typeof B.resolveSurfaceInjection, "function");
  assert.strictEqual(typeof B.isRustSysrootDef, "function");
  assert.strictEqual(typeof B.harvestDiagnosticTypes, "function");
});
const rtest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// ===========================================================================
// The fixture: the goal's own `load_api_keys` row, written the way the model
// actually writes it - the struct is imported from another module, so the
// generated file names `ApiKeysConfig` and does NOT name `Deserialize` (the
// derive lives on the struct's own file, which is where serde is imported).
// ===========================================================================

const MAIN_URI = "file:///work/proj/src/api_keys.rs";
const MAIN_SRC = `use crate::keys::ApiKeysConfig;
use crate::keys::ApiKeysError;

/// Load the api keys from \`data_root\`.
pub fn load_api_keys(data_root: &Path) -> Result<Option<ApiKeysConfig>, ApiKeysError> {
    let text = read_to_string(data_root.join("api_keys.json"))?;
    let cfg = serde_json::from_str::<ApiKeysConfig>(&text)?;
    Ok(Some(cfg))
}
`;

const NAMES = {
  ApiKeysConfig: {
    // Its OWN def file. Sharing one URI with ApiKeysError meant the later entry
    // overwrote the earlier one's def-file text, so the attributes above this
    // declaration were never in the fixture's file at all.
    defUri: "file:///work/proj/src/keys_config.rs",
    // Serialize and Debug but NOT Deserialize, which is what the E0277 in the
    // goal's worked example is about. Seeing what IS derived is what tells the
    // model what to add.
    derives: "#[derive(Serialize, Debug)]",
    hover: "pub struct ApiKeysConfig { pub primary_rw: [u8; 32], pub secondary_ro: [u8; 32] }",
    members: [
      { name: "primary_rw", kind: "field", signature: "primary_rw: [u8; 32]" },
      { name: "secondary_ro", kind: "field", signature: "secondary_ro: [u8; 32]" },
    ],
  },
  ApiKeysError: {
    defUri: "file:///work/proj/src/keys.rs",
    hover: "pub enum ApiKeysError { Io, Parse }",
    members: [
      { name: "Io", kind: "field", signature: "Io" },
      { name: "Parse", kind: "field", signature: "Parse" },
    ],
  },
};

// ATTACK 3's over-the-cap fixture, in its own file so row 1 stays minimal.
//
// WIDENED session-v48 loop-back (defect 5): the repair round's surface cap is a
// derivation of the context stop's aggregate budget now, and the repair path
// reads the LIVE stop, so at the default it is `CAP_FILLERS.length` rather than
// the 4 this fixture's four filler types were cut against. Four no longer fill
// it, `Epsilon` was never dropped, and the row asserted about a cap that never
// bit. The filler count comes from the seam so the fixture stays exactly
// cap-full wherever the default stop moves.
const CAP_SURFACE_CAP = B.surfaceCapFor
  ? B.surfaceCapFor(B.contextBoundsFor(B.DEFAULT_CONTEXT_STOP).surfaceBudgetTok)
  : 4;
const CAP_FILLERS = Array.from({ length: CAP_SURFACE_CAP }, (_, i) => `Slot${String(i).padStart(2, "0")}`);
const CAP_URI = "file:///work/proj/src/cap.rs";
const CAP_SRC = `${CAP_FILLERS.map((n) => `use crate::t::${n};`).join("\n")}
use crate::t::Epsilon;

pub fn f() {
    let a = 0u64;
}
`;
const CAP_NAMES = {};
for (const n of [...CAP_FILLERS, "Epsilon"]) {
  CAP_NAMES[n] = {
    defUri: `file:///work/proj/src/t/${n.toLowerCase()}.rs`,
    hover: `pub struct ${n} { pub ${n.toLowerCase()}_slot: u32 }`,
    members: [{ name: `${n.toLowerCase()}_slot`, kind: "field", signature: `${n.toLowerCase()}_slot: u32` }],
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

// CURSOR-FAITHFUL, and strictly so: a type resolves ONLY when the cursor sits on
// that type's own token. No "one known name on the line" slack - every row below
// puts the cursor exactly on a token rust-analyzer really does resolve there
// (a `use` path segment, or the type argument of a turbofish), so the strict
// fake can never manufacture the failures this file reports.
function makeExtractor(srcByUri, names) {
  const asked = { hover: [], definition: [] };
  const nameAt = (cursor) => {
    const text = srcByUri[cursor && cursor.uri];
    const w = wordAt(text, cursor);
    return w && names[w] ? w : undefined;
  };
  // FIXTURE FIDELITY, added during triage. A real def file has the type's
  // ATTRIBUTES on the lines above its declaration, and the derives leg reads them
  // there. A fixture whose def file is the hover line alone cannot express a
  // derive list at all, so a row asserting that derives reach the prompt could
  // only ever fail for want of a fixture. When `derives` is present the def file
  // carries it on line 0 and the declaration moves to line 1.
  const defLoc = (name) => {
    const startLine = names[name].derives ? 1 : 0;
    return {
      uri: names[name].defUri,
      range: { startLine, startCharacter: 11, endLine: startLine, endCharacter: 11 + name.length },
      line: startLine,
      character: 11,
    };
  };
  return {
    asked,
    hoverSurface: async (cursor) => {
      const n = nameAt(cursor);
      asked.hover.push(`${n || wordAt(srcByUri[cursor && cursor.uri], cursor) || "(nothing)"}`);
      return n ? { signature: names[n].hover } : undefined;
    },
    definition: async (cursor) => {
      const n = nameAt(cursor);
      asked.definition.push(n || "(nothing)");
      return n ? defLoc(n) : undefined;
    },
    membersOfType: async (cursor) => {
      const byDef = Object.entries(names).find(([, rec]) => rec.defUri === (cursor && cursor.uri));
      if (byDef) return byDef[1].members;
      const n = nameAt(cursor);
      return n ? names[n].members : [];
    },
    completeMembers: async () => [],
    example: async () => undefined,
    qualifyImport: async () => undefined,
  };
}

function spanAt(src, lineNeedle, token, label, isPrimary = true) {
  const at = src.indexOf(lineNeedle);
  assert.ok(at >= 0, `fixture bug: ${JSON.stringify(lineNeedle)} not in source`);
  const lineIdx = src.slice(0, at).split("\n").length - 1;
  const lineText = src.split("\n")[lineIdx];
  const col = lineText.indexOf(token);
  assert.ok(col >= 0, `fixture bug: ${JSON.stringify(token)} not on ${JSON.stringify(lineText)}`);
  const lineStartOffset = src.split("\n").slice(0, lineIdx).reduce((a, l) => a + l.length + 1, 0);
  return {
    fileName: "src/api_keys.rs",
    byteStart: lineStartOffset + col,
    byteEnd: lineStartOffset + col + token.length,
    lineStart: lineIdx + 1,
    lineEnd: lineIdx + 1,
    columnStart: col + 1,
    columnEnd: col + 1 + token.length,
    isPrimary,
    ...(label === undefined ? {} : { label }),
  };
}

const diag = (code, message, spans) => ({
  kind: "compile-error",
  level: "error",
  code,
  message,
  spans: Array.isArray(spans) ? spans : [spans],
  suggestions: [],
  rendered: `error[${code}]: ${message}`,
});

async function run(diagnostics, opt = {}) {
  const { uri = MAIN_URI, src = MAIN_SRC, languageId = "rust", names = NAMES, catalog, resolution, localDefs, opts } = opt;
  const defFiles = {};
  for (const rec of Object.values(names)) {
    defFiles[rec.defUri] = rec.derives ? `${rec.derives}\n${rec.hover}\n` : `${rec.hover}\n`;
  }
  const files = { ...defFiles, [uri]: src };
  const ext = makeExtractor(files, names);
  const logs = [];
  globalThis.__RV34_FILES__ = files;
  let out;
  try {
    out = await B.resolveSurfaceInjection(ext, makeDoc(src, uri, languageId), diagnostics, (l) => logs.push(String(l)), catalog, resolution, localDefs, opts);
  } finally {
    delete globalThis.__RV34_FILES__;
  }
  const text = (typeof out === "string" ? out : out && out.surface) || "";
  const r = { out, text, logs, asked: ext.asked };
  if (process.env.RV34_DEBUG) console.log(dump(r));
  return r;
}

const dump = (r) =>
  `\n  HOVER-ASKED=${JSON.stringify(r.asked.hover)}\n  DEF-ASKED=${JSON.stringify(r.asked.definition)}` +
  `\n  LOGS=${JSON.stringify(r.logs, null, 1)}\n  PAYLOAD:\n${r.text || "(none)"}`;

// Every block, as (the type its HEADER claims, the type its FENCED BODY
// declares). Nothing about block wording is pinned: a header is a line carrying
// a backticked identifier with a fence opening within two lines, and the body's
// declared name is whatever `struct|enum|union NAME` it contains.
function blockClaims(payload) {
  const lines = (payload || "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(lines[i]);
    if (!m) continue;
    let fenceAt = -1;
    if ((lines[i + 1] || "").startsWith("```")) fenceAt = i + 1;
    else if ((lines[i + 2] || "").startsWith("```")) fenceAt = i + 2;
    if (fenceAt < 0) continue;
    const body = [];
    for (let j = fenceAt + 1; j < lines.length && !lines[j].startsWith("```"); j++) body.push(lines[j]);
    const decl = /\b(?:struct|enum|union)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(body.join("\n"));
    out.push({ header: m[1], declared: decl ? decl[1] : undefined, body: body.join("\n") });
  }
  return out;
}

// ===========================================================================
// ATTACK 1. THE WRONG-TYPE INJECT.
//
// The goal's own E0277 row: `the trait bound `ApiKeysConfig:
// serde::Deserialize<'de>` is not satisfied`. rustc puts the primary span on the
// TYPE ARGUMENT of the turbofish (`from_str::<ApiKeysConfig>`), which is a real
// type token. The harvest yields TWO names, `ApiKeysConfig` and `Deserialize`.
// `ApiKeysConfig` anchors at its own `use` line. `Deserialize` is not named
// anywhere in this file - the derive lives on the struct's own file - so it
// falls back to the diagnostic's primary span cursor, which sits on
// `ApiKeysConfig`'s token. The hover there resolves ApiKeysConfig's struct
// declaration, and nothing checks that the declaration it got is the type it
// asked for.
//
// A block may not claim to describe one type and render another's declaration.
// That is not a wording preference: the shared instruction under these blocks
// reads "use these exact names, do not invent".
// ===========================================================================

const E0277_TURBOFISH = () =>
  diag(
    "E0277",
    "the trait bound `ApiKeysConfig: serde::Deserialize<'de>` is not satisfied",
    spanAt(
      MAIN_SRC,
      "serde_json::from_str",
      "ApiKeysConfig",
      "the trait `serde::Deserialize<'de>` is not implemented for `ApiKeysConfig`",
    ),
  );

rtest("ATTACK 1a: no injected block may render one type's declaration under another type's name", async () => {
  const r = await run([E0277_TURBOFISH()]);
  const claims = blockClaims(r.text);
  const wrong = claims.filter((c) => c.declared !== undefined && c.declared !== c.header);
  assert.deepStrictEqual(
    wrong.map((c) => `header=${c.header} declares=${c.declared}`),
    [],
    `a harvested name that is NOT referenced in the document anchors at the diagnostic's ` +
      `primary span, and the hover there resolves whatever type the span sits on. The ` +
      `payload now tells the model that one type IS another type's struct.${dump(r)}`,
  );
});

// ===========================================================================
// ATTACK 1b. THE FLAGSHIP E0277 ROW BUYS NOTHING IN THE REAL FLOW.
//
// In the product, `resolvePrefill` (the span surface) runs FIRST and its
// disclosed types arrive here as `skipTypes`. The span surface mines the
// signature, the doc, the span's types-in-play AND every `use` import of the
// file - which is the same source `findReceiverTypeReference` needs the harvest's
// name to appear in. So on the goal's own worked example the struct is already
// disclosed and skipped, the trait has no cursor, and the round goes out with no
// surface at all: `[repair] surface EMPTY`.
// ===========================================================================

rtest("ATTACK 1b: the goal's E0277 worked example injects nothing once the span surface has run", async () => {
  const r = await run([E0277_TURBOFISH()], { opts: { skipTypes: new Set(["ApiKeysConfig"]) } });
  assert.notStrictEqual(
    r.text,
    "",
    `item 2 exists so a diagnostic outside the classifier stops going out with no surface. On ` +
      `the goal's own E0277 row it still does: the only name the harvest can anchor is the one ` +
      `the span surface already disclosed, and what the trait bound actually needs (the DERIVE ` +
      `list, Amendment A) is never rendered by any leg.${dump(r)}`,
  );
});

rtest("ATTACK 1c: a name SKIPPED as already disclosed must not be reported as a name that did not resolve", async () => {
  const r = await run([E0277_TURBOFISH()], { opts: { skipTypes: new Set(["ApiKeysConfig"]) } });
  const verdict = r.logs.find((l) => /NONE of the harvested name/.test(l));
  assert.ok(
    !verdict,
    `the diagnostic-level verdict names ApiKeysConfig among the names that did not resolve. It ` +
      `resolved fine on the previous leg and was skipped BECAUSE it resolved, which is the ` +
      `opposite diagnosis for whoever reads this line looking for the next rule to write. ` +
      `LINE=${JSON.stringify(verdict)}${dump(r)}`,
  );
});

// ===========================================================================
// ATTACK 2. ITEM 3'S SILENCE ON THE TERMINAL-STEER RETURN.
//
// The `noSurface` reasons are logged in a loop that runs AFTER the diagnostic
// loop, and the unresolved-crate branch RETURNS the catalog from inside that
// loop. So a diagnostic that bought nothing goes out silent whenever a later
// diagnostic short-circuits - and the harvest pass, which is also after the
// loop, never runs at all. Item 3 says EVERY error that reaches repair and
// produces no surface logs its code and a reason.
// ===========================================================================

rtest("ATTACK 2: an unclassified diagnostic is silent when a later diagnostic returns the catalog", async () => {
  const e0063 = diag(
    "E0063",
    "missing field `secondary_ro` in initializer of `ApiKeysConfig`",
    spanAt(MAIN_SRC, "Ok(Some(cfg))", "cfg"),
  );
  const e0433 = diag(
    "E0433",
    "failed to resolve: use of undeclared crate or module `chrono`",
    spanAt(MAIN_SRC, "read_to_string", "read_to_string"),
  );
  const r = await run([e0063, e0433], { catalog: "Installed crates: serde, serde_json." });
  assert.strictEqual(r.text, "Installed crates: serde, serde_json.", `precondition: the catalog is the payload${dump(r)}`);
  const named = r.logs.filter((l) => l.includes("E0063"));
  assert.ok(
    named.length > 0,
    `item 3: the E0063 reached this resolver, produced no surface, and left no line on the ` +
      `channel naming it. Every reason collected before a terminal steer is discarded with ` +
      `the collection.${dump(r)}`,
  );
});

// ===========================================================================
// ATTACK 3. THE CAP DROP REPORTS THE WRONG REASON.
//
// A harvested name dropped over SURFACE_CAP leaves `misses` empty, so the
// diagnostic's no-surface line says every harvested name "was already covered".
// It was not covered - it was dropped for want of a slot, which is the opposite
// diagnosis and sends the reader to the wrong subsystem.
// ===========================================================================

rtest("ATTACK 3: a name dropped over the cap must not be reported as already covered", async () => {
  const capSpan = (token, label) => {
    const s = spanAt(CAP_SRC, "let a = 0u64;", "a", label);
    return { ...s, fileName: "src/cap.rs" };
  };
  const fillers = CAP_FILLERS.map((n) =>
    diag("E0308", "mismatched types", capSpan("a", `expected \`${n}\`, found \`u64\``)),
  );
  const overflow = diag("E0063", "missing field `epsilon_slot` in initializer of `Epsilon`", capSpan("a"));
  const r = await run([...fillers, overflow], { uri: CAP_URI, src: CAP_SRC, names: CAP_NAMES });
  const line = r.logs.find((l) => l.includes("E0063") && l.includes("none"));
  assert.ok(line, `precondition: the fifth diagnostic bought nothing and said so${dump(r)}`);
  assert.ok(
    !/already covered/.test(line),
    `the reason is wrong: \`Epsilon\` was never covered, it was dropped over the surface cap. ` +
      `LINE=${JSON.stringify(line)}${dump(r)}`,
  );
});

// ===========================================================================
// ATTACK 4. `isRustSysrootDef` THROWS ON A URI IT CANNOT PERCENT-DECODE.
//
// `decodeURIComponent` raises URIError on a lone `%`, and the call sites do not
// guard it: in `resolvePrefill` the call is bare in the render loop, and in
// `harvestedTypeBlock` it sits OUTSIDE the try that wraps the definition round
// trip. A file whose name contains a bare `%` therefore takes down the whole
// prefill or the whole repair surface, not just its own block.
// ===========================================================================

rtest("ATTACK 4: isRustSysrootDef is total over the URIs a resolver can report", () => {
  assert.doesNotThrow(
    () => B.isRustSysrootDef("file:///work/proj/src/50%_done.rs"),
    `a provenance predicate must answer, not throw: every caller treats it as a pure test and ` +
      `one of them calls it outside any try`,
  );
});

// ===========================================================================
// ATTACK 6. THE DECLARED-NAME GUARD CANNOT SEE THE SYNTHESIZED SHAPE.
//
// `harvestedTypeBlock`'s second guard reads the RENDERED text for a
// `struct|enum|union NAME` and refuses a mismatch. That works for the hover leg,
// whose text is another type's real declaration. It cannot work for the
// membersOfType leg: `renderDerivedDef` SYNTHESIZES `struct <the name we asked
// for> { ...whatever fields came back... }`, so the declared name always equals
// the harvested name however wrong the fields are.
//
// The trigger is `findReceiverTypeReference` taking the first non-comment
// occurrence of the name: only `//` lines are skipped, so a `/* ... */` comment
// or a string literal inside ANOTHER struct's body anchors there. Hover resolves
// nothing at that position (rust-analyzer's own behaviour), and
// `membersOfType` is documentSymbol descent to the struct ENCLOSING the cursor -
// which is the other struct.
// ===========================================================================

const CMT_URI = "file:///work/proj/src/snap.rs";
const CMT_SRC = `pub struct Snapshot {
    /* the Ledger this snapshot was taken from */
    pub source_id: u64,
    pub epoch: u64,
}

pub fn take() -> Snapshot {
    Snapshot { source_id: 0, epoch: 0 }
}
`;

rtest("ATTACK 6: a synthesized shape can carry another struct's fields under the harvested name", async () => {
  // The fake models the two extractor legs exactly as raExtractor documents them:
  // hover answers only ON a type's own token, and membersOfType is the
  // documentSymbol descent to the struct enclosing the cursor.
  const ext = {
    asked: { hover: [], definition: [] },
    hoverSurface: async (c) => {
      ext.asked.hover.push(`${c.line}:${c.character}`);
      return undefined; // inside a comment: rust-analyzer resolves nothing
    },
    definition: async () => undefined, // and so no provenance can be proven either
    membersOfType: async (c) => {
      // The enclosing struct of the cursor is `Snapshot` (lines 0..4).
      if (c.line >= 0 && c.line <= 4) {
        return [
          { name: "source_id", kind: "field", signature: "source_id: u64" },
          { name: "epoch", kind: "field", signature: "epoch: u64" },
        ];
      }
      return [];
    },
    completeMembers: async () => [],
    example: async () => undefined,
    qualifyImport: async () => undefined,
  };
  const d = diag("E0308", "mismatched types", {
    fileName: "src/snap.rs",
    byteStart: 0,
    byteEnd: 1,
    lineStart: 8,
    lineEnd: 8,
    columnStart: 5,
    columnEnd: 6,
    isPrimary: true,
    label: "expected `Ledger`, found `Snapshot`",
  });
  const logs = [];
  globalThis.__RV34_FILES__ = { [CMT_URI]: CMT_SRC };
  let out;
  try {
    out = await B.resolveSurfaceInjection(ext, makeDoc(CMT_SRC, CMT_URI, "rust"), [d], (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__RV34_FILES__;
  }
  const text = (typeof out === "string" ? out : out && out.surface) || "";
  const r = { text, logs, asked: ext.asked };
  const ledger = blockClaims(text).find((c) => c.header === "Ledger");
  assert.ok(
    !ledger || !/source_id|epoch/.test(ledger.body),
    `the payload tells the model \`Ledger\` has Snapshot's fields, and the declared-name guard ` +
      `passed because the renderer wrote the name it was asked for.${dump(r)}`,
  );
});

// ===========================================================================
// ATTACK 5. WHAT THE HARVEST ACTUALLY RETURNS FOR REAL RUSTC MESSAGES.
//
// Evidence for attack 1: the names that enter the pipeline. Printed in full so
// the reader can see which are types worth a round trip, which are traits that
// can never render a data shape, and which are neither.
// ===========================================================================

rtest("ATTACK 5: real rustc message shapes, and every name the harvest hands to the resolver", () => {
  const rows = [
    ["E0277 serde", "the trait bound `ApiKeysConfig: serde::Deserialize<'de>` is not satisfied", []],
    ["E0277 Send", "`Rc<Inner>` cannot be sent between threads safely", ["within `Outer`, the trait `Send` is not implemented for `Rc<Inner>`"]],
    ["E0277 collect", "a value of type `HashMap<String, Order>` cannot be built from an iterator over elements of type `Order`", ["value of type `HashMap<String, Order>` cannot be built from `std::iter::Iterator<Item=Order>`"]],
    ["E0277 ?", "`?` couldn't convert the error to `DomainError`", ["the trait `From<serde_json::Error>` is not implemented for `DomainError`"]],
    ["E0308 literal", "mismatched types", ["expected `Summary`, found `Draft`"]],
    ["E0308 variant", "mismatched types", ["expected `Ordering`, found `Ordering::Less`"]],
    ["E0308 assoc", "mismatched types", ["expected associated type `<Rows as Iterator>::Item`, found `Order`"]],
    ["E0063", "missing field `acked_versions` in initializer of `SampledAggregate`", ["missing `acked_versions`"]],
    ["E0282", "type annotations needed", ["cannot infer type of the type parameter `T` declared on the enum `Option`"]],
    ["E0369", "binary operation `==` cannot be applied to type `Sample`", []],
    ["E0433 crate", "failed to resolve: use of undeclared crate or module `chrono`", []],
    ["E0599 bound", "the method `sort_by_key` exists for struct `Vec<Order>`, but its trait bounds were not satisfied", ["`Order: Ord` is not satisfied"]],
  ];
  const table = rows.map(([name, message, labels]) => {
    const d = diag("Ennnn", message, labels.map((l, i) => ({ ...spanAt(MAIN_SRC, "let text", "text", l), isPrimary: i === 0 })));
    if (labels.length === 0) d.spans = [spanAt(MAIN_SRC, "let text", "text")];
    return `${name.padEnd(16)} -> ${JSON.stringify(B.harvestDiagnosticTypes(d))}`;
  });
  console.log(`\nharvested names per real rustc message:\n${table.join("\n")}\n`);
  // The claim asserted: a TRAIT name reaches the resolver, which is the input
  // attack 1 turns into a mis-named struct block.
  const t = B.harvestDiagnosticTypes(E0277_TURBOFISH());
  assert.ok(t.includes("Deserialize"), `expected the trait name to be harvested; got ${JSON.stringify(t)}`);
});
