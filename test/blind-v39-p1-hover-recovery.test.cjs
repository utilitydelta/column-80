// BLIND CONTRACT ORACLE - session-v39, items 1 and 2.
//
// Written from this session's goal and its predecessor's, from the real
// corpus at ~/sandbox/complexity-study-acme, and from the harness mechanics
// of test/blind-v38-p1-enum-render.test.cjs, test/adversarial-v38-p1.test.cjs and
// test/blind-v37-p5-tuple-payload.test.cjs, which are tests.
//
// WHAT THIS FILE NEVER READ. Nothing here opened, grepped or otherwise inspected
// `src/core/rustHoverRecovery.ts`, `src/core/crossFileShape.ts`, `src/vscode/fnGen.ts`
// or `src/core/compilerDirected.ts`. The only symbol this file names from `src` is
// `resolvePrefill`, which two committed test files already import by that name.
// Every row drives the whole pre-fill end to end and reads the payload text, so no
// row can go red because a recovery helper was given a name this file did not guess.
// That is deliberate: the contract describes a behaviour, not a symbol.
//
// ---------------------------------------------------------------------------
// THE CONTRACT
// ---------------------------------------------------------------------------
//
// rust-analyzer elides parts of a type's hover, the product injects the elided text
// verbatim, and then closes the prompt with "Call ONLY methods and constructors of
// `X` that appear in the API surface above". The prompt shows a list it has itself
// marked incomplete and forbids everything off it.
//
// One marker, `/* … */`, three losses, told apart by POSITION:
//
//   1. LIST CUT        the marker on its own line in the body; members past
//                      rust-analyzer's display cap are simply gone.
//   2. PAYLOAD ELIDED  the marker inside a variant's own delimiters.
//                        Leader { /* … */ }   struct variant, NOT recovered today
//                        Leader( /* … */ )    tuple variant, recovered since v37
//   3. COLLABORATOR PRUNED  a hidden member names a type, so the walk never
//                      resolves it. Out of scope here; that is the goal's item 3.
//
// ITEM 1, RECOVERY. Restore what the hover elided from the definition file's source
// text, which the resolver has already read. Struct-variant payloads, and members
// the list cut dropped, for both `enum` and `struct`.
//
// THE BAR, and it is the whole point. A WRONG member is worse than an absent one,
// because it reaches the model in the compiler's voice. Recovery must REFUSE to the
// unmodified hover whenever it cannot prove the answer: no declaration in the
// source, two declarations of the name that disagree, a hover and a source that
// disagree about a member the hover DID show, an unreadable file. Refusal is TOTAL
// for that type, never partial, and never throws.
//
// ITEM 2, HONESTY FALLBACK. When recovery cannot prove it and the marker survives
// into the injected text, that type must NOT appear in the firm instruction's ONLY
// list. An incomplete surface may still be SHOWN; it may not be declared
// exhaustive. Independent of item 1, and must hold on its own.
//
// ---------------------------------------------------------------------------
// EXPECTED RED, and MEASURED RED, against the working tree at commit 0482bf3
// (v37: the injected surface, re-decided on measurement). Each must pass after the
// build. Ten rows, eight for item 1 and two for item 2:
//
//   A1  list-cut ENUM recovers the variants the cut dropped        (NodeStatus)
//   A2  struct-variant payloads recover                            (NodeStatus)
//   A3  both losses in ONE type: nothing elided is left behind     (NodeStatus)
//   A4  list-cut STRUCT recovers the fields the cut dropped        (ServerMeta)
//   A5  struct-variant payload with no list cut at all             (SignatureAlgorithmParams)
//   A6  a HIDDEN member whose own text carries braces and commas   (S3CatchupError)
//   A7  doc comments, `//` comments, blank lines, nested generics  (LogSegmentFile)
//   A8  brace-bearing attributes on every variant                  (StoreError)
//   D1  a still-truncated type is dropped from the ONLY list       (item 2, alone)
//   D3  mixed payload: the recovered type is named, the truncated one is not
//
// MEASURED 2026-08-03: 10 fail, 14 pass, and every failure is on the contract
// assertion rather than on a precondition or a missing block.
//
// EXPECTED GREEN, and MEASURED GREEN on that same baseline. Each must STAY green:
//
//   guard  the bundle builds
//   B1  the v37 tuple recovery still fires                         (BasicConstraints)
//   B2  a multi-payload tuple enum still recovers both types       (base64 DecodeError)
//   B3  a hover with nothing elided is byte-identical              (base64 Alphabet)
//   C1  REFUSE: no declaration of the name in the source read
//   C2  REFUSE: two declarations of the name that disagree
//   C3  REFUSE: hover and source disagree about a member the hover DID show
//   C4  REFUSE: the def file read came back empty
//   C5  REFUSE: the source declares the name with a different KIND
//   D2  a fully recovered type IS allowed in the ONLY list
//   E1..E4  typescript, go, csharp, python are untouched
//
// WHY THE REFUSAL ROWS ARE GREEN TODAY, AND WHY THEY STILL MATTER. Nothing recovers
// anything for these shapes today, so "the hover came back unchanged" is free. It
// stops being free the moment item 1 lands, and section A is their non-vacuity
// control: A1..A3 recover NodeStatus from a sound source, and C1, C2, C4 and C5
// mutilate that same source one way each. If A is green and C is green the refusal
// is real. If A is red and C is green, C proved nothing yet - which is exactly the
// state this file was written in, and is said out loud here so nobody reads a green
// C section as evidence.
//
// ---------------------------------------------------------------------------
// CONTRACT AMBIGUITIES HIT WHILE WRITING THIS. Each is called out at its row.
//
//   Q1  Must the `/* … */` LINE disappear once the cut members are restored? The
//       goal never says. This file reads it as yes, on two grounds: the v37 tuple
//       recovery already deletes the marker when every payload is recovered
//       (test/blind-v37-p5, the `ellipsisLeft: false` rows), and item 2 keys off
//       "the marker survives into the injected text", so a proven-complete list
//       still carrying a marker would lose its ONLY scope for no reason. REASONED,
//       not stated. Rows A1, A3, A4, A6, A7, A8.
//
//   Q2  Two declarations of the name that AGREE. The bar names disagreement. A
//       `#[cfg(test)] mod` copy that happens to be identical is neither proven
//       ambiguous nor proven unique. NOT PINNED here, on purpose - pinning it
//       either way would invent contract.
//
//   Q3  Does "unchanged" for the other four languages include item 2? Item 2 is
//       arguably a correctness fix in any language, but session-v39's goal puts
//       "the other four languages" under "Explicitly out" and v38 set the same
//       precedent. E1..E4 pin UNCHANGED. If the build decides item 2 should be
//       language-blind that is a contract change and belongs in writing.
//
//   Q4  A member whose TYPE contains braces. No Rust field type in the acme
//       corpus contains a brace: const-generic expressions like `Foo<{ N }>` do not
//       occur in it. The brace hazard is therefore exercised where it IS real -
//       struct-variant members (`WalSeqGap { expected: u64, got: u64 }`, A6) and
//       attributes whose string carries braces (`#[error("Object not found:
//       {path}")]`, A8). No synthetic const-generic field is invented for it.
//
//   Q5  Whether the restored members should carry their doc comments across is not
//       stated and is not pinned. The rows assert names and types only.
//
// ---------------------------------------------------------------------------
// TWO COMMITTED ROWS THIS CONTRACT SUPERSEDES. Both live in
// test/blind-v37-p5-tuple-payload.test.cjs and both were correct for v37:
//
//   * "item 5 [rust]: a struct variant is NOT a tuple variant - the brace form
//     survives byte-identical" asserts `RsaPss { /* … */ }` comes back untouched.
//     Session-v39 item 1 is precisely the decision to recover it. A5 is the same
//     fixture with the opposite expectation.
//   * "item 5 [rust]: a payload is never taken from a sibling enum..." asserts the
//     three variants RA cut from `PkiError` STAY hidden ("Item 5 restores payloads,
//     it does not un-truncate the list"). Session-v39 item 1 un-truncates the list.
//
// The builder owes both rows an edit and a written reason, not a quiet deletion.
//
// ---------------------------------------------------------------------------
// PROVENANCE. Every Rust source block below is VERBATIM from a real file, quoted
// with its path and line range. Hovers are labelled MEASURED where this repo holds
// a capture of them, and SYNTHESIZED where they are written in the elision form
// test/blind-v37-p5 byte-verified against a live rust-analyzer capture
// (four-space indent, U+2026 inside `/* … */`, list cut at five members). The
// NodeStatus hover is the one this session's goal printed itself.
//
// Run: SKIP_LIVE=1 node --test test/blind-v39-p1-hover-recovery.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// HARNESS. `resolvePrefill` bundled headless against a STRUCTURAL vscode stub.
// Copied from test/blind-v38-p1-enum-render.test.cjs, with ONE addition: a type
// may serve DIFFERENT text to the definition locator and to the file read
// (`defText`). That models the only failure the contract names that this harness
// could not otherwise reach - the resolver got a definition location and then the
// file read came back empty.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v39-p1-vscode-stub.cjs");
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
      const files = globalThis.__V39P1_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v39-p1.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v39-p1.bundle.cjs");
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

// A broken bundle must be ONE loud failure, never a wall of TypeErrors a reader
// could mistake for contract failures.
test("bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof resolvePrefill, "function", "resolvePrefill must be exported from src/vscode/fnGen");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

const ELLIPSIS = "/* … */";
const show = (v) => JSON.stringify(v);

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

function makeExtractor(files, defTypes) {
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
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

const FIXTURES = {
  rust: {
    ext: "rs",
    symbol: "decide",
    docLine: "/// Decide the outcome.",
    signature: (n) => `pub fn decide(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> u32`,
    body: "    todo!()\n}",
    bodyIndent: "    ",
  },
  typescript: {
    ext: "ts",
    symbol: "decide",
    docLine: "/** Decide the outcome. */",
    signature: (n) => `export function decide(${n.map((t, i) => `p${i}: ${t}`).join(", ")}): number`,
    body: "  throw new Error();\n}",
    bodyIndent: "  ",
  },
  csharp: {
    // PascalCase on purpose: the C# candidate rule reads the leading token of
    // `public uint Decide(...)` as a type. Same reasoning as blind-v38-p1.
    ext: "cs",
    symbol: "Decide",
    docLine: "/// <summary>Decide the outcome.</summary>",
    signature: (n) => `public uint Decide(${n.map((t, i) => `${t} p${i}`).join(", ")})`,
    body: "    throw new NotImplementedException();\n}",
    bodyIndent: "    ",
  },
  python: {
    ext: "py",
    symbol: "decide",
    docLine: '"""Decide the outcome."""',
    signature: (n) => `def decide(${n.map((t, i) => `p${i}: ${t}`).join(", ")}) -> int:`,
    body: "    raise NotImplementedError",
    bodyIndent: "    ",
  },
  go: {
    ext: "go",
    symbol: "Decide",
    docLine: "// Decide the outcome.",
    signature: (n) => `func Decide(${n.map((t, i) => `p${i} ${t}`).join(", ")}) uint32`,
    body: '\tpanic("todo")\n}',
    bodyIndent: "\t",
  },
};

const WS = "file:///work/v39p1";

// `types`: [{ name, hover, src, defText?, members? }] in signature order.
// `src` is what the definition LOCATOR sees; `defText`, when given, is what the
// file READ returns instead.
async function runPrefill(languageId, types) {
  const F = FIXTURES[languageId];
  const mainUri = `${WS}/main.${F.ext}`;
  const names = types.map((t) => t.name);
  const signature = F.signature(names);
  const src =
    languageId === "python"
      ? `${signature}\n    ${F.docLine}\n${F.body}\n`
      : `${F.docLine}\n${signature} {\n${F.body}\n`;
  const locatorFiles = { [mainUri]: src };
  const readFiles = { [mainUri]: src };
  const defTypes = {};
  for (const t of types) {
    const uri = `${WS}/${t.name.toLowerCase()}.${F.ext}`;
    locatorFiles[uri] = t.src;
    readFiles[uri] = t.defText !== undefined ? t.defText : t.src;
    defTypes[t.name] = { uri, hover: t.hover, members: t.members || [] };
  }
  const logs = [];
  const ext = makeExtractor(locatorFiles, defTypes);
  globalThis.__V39P1_FILES__ = readFiles;
  let out;
  try {
    out = await resolvePrefill(ext, makeDoc(src, mainUri), { ...RECORD(F, signature, src, languageId) }, (l) => logs.push(String(l)));
  } finally {
    delete globalThis.__V39P1_FILES__;
  }
  return { text: out || "", logs };
}

const RECORD = (F, signature, src, languageId) => ({
  span: { start: src.indexOf(signature), end: src.length - 1 },
  signature,
  docComment: "Decide the outcome.",
  symbolName: F.symbol,
  languageId,
  kind: "function",
  bodyOnly: false,
  headerIndent: "",
  bodyIndent: F.bodyIndent,
  docstringRefusal: undefined,
});

// The fenced block the payload rendered for `name`, read the way a reader would:
// a backticked name on a header line, then a fence, then the body. Header-agnostic
// so a row does not go red because a block header was reworded.
function blockFor(text, name) {
  const lines = (text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp("`" + name + "`").test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (!(lines[j] || "").startsWith("```")) continue;
    const body = [];
    for (let k = j + 1; k < lines.length && !lines[k].startsWith("```"); k++) body.push(lines[k]);
    return body.join("\n");
  }
  return undefined;
}

// The ONLY list: the type names the firm instruction scopes itself to. Both the
// Rust wording ("Call ONLY methods and constructors of `A` and `B` that appear in
// the API surface above") and the other four languages' wording ("Use ONLY the
// members and types of `A` that appear in the surface above") are matched, so a
// row cannot go green because the sentence was reworded out from under it.
function onlyListNames(text) {
  const m = /(?:Call|Use) ONLY [^\n`]*?\bof ((?:`[^`\n]+`(?:,\s*|\s+and\s+)?)+?) that appear in the/.exec(text || "");
  if (!m) return [];
  return [...m[1].matchAll(/`([^`\n]+)`/g)].map((x) => x[1]);
}

// The instruction must still be present even when it names nothing, or "the type
// is not in the ONLY list" is satisfied by deleting the instruction, which is a
// different and much worse change.
const hasFirmInstruction = (text) => /\bONLY\b[^\n]*that appear in the/.test(text || "");

const dump = (r, name) =>
  `\n  BLOCK for ${name}:\n${blockFor(r.text, name)}\n  ONLY LIST=${show(onlyListNames(r.text))}` +
  `\n  LOGS=${show(r.logs)}\n  FULL PAYLOAD:\n${r.text}`;

// ===========================================================================
// FIXTURES. Real source, quoted verbatim with path and line range.
// ===========================================================================

// ~/sandbox/complexity-study-acme/acme_distributed/src/node_status.rs:1-18,
// verbatim. THE corpus shape: four struct-variant payloads AND a list cut at five of
// seven, injected into 63 of 237 rows. `Leader { lease_epoch }` beside
// `Follower { leader_lease_epoch }` is also the discriminator for a recovery that
// copies the first payload it finds onto every variant.
const SRC_NODE_STATUS = [
  "#[derive(Debug, Clone, Copy, PartialEq, Eq)]",
  "pub enum NodeStatus {",
  "    Leader { lease_epoch: u64 },",
  "    Follower { leader_lease_epoch: u64 },",
  "    /// Runtime kick: follower is catching up from S3, rejects TCP replication.",
  "    /// Transitions directly back to Follower when catchup completes.",
  "    FollowerCatchingUp { leader_lease_epoch: u64 },",
  "    /// Won the lease CAS, running the promotion pipeline (reconcile, catchup,",
  "    /// upload) before the Leader flip. Rejects all TCP replication (not a",
  "    /// follower state) and refuses heartbeat adoption at epoch <= its own, so a",
  "    /// deposed leader cannot re-open the replication gate mid-window. Carries",
  "    /// the won lease's TTL: an overrunning promotion decays to Fenced.",
  "    Promoting { lease_epoch: u64 },",
  "    /// Boot-time S3 catchup, before election. TTL-exempt.",
  "    BootCatchup,",
  "    Fenced,",
  "    Standalone,",
  "}",
  "",
].join("\n");

// The hover printed in this session's own worked example, in the
// byte-verified elision form.
const HOVER_NODE_STATUS = [
  "pub enum NodeStatus {",
  "    Leader { /* … */ },",
  "    Follower { /* … */ },",
  "    FollowerCatchingUp { /* … */ },",
  "    Promoting { /* … */ },",
  "    BootCatchup,",
  "    /* … */",
  "}",
].join("\n");

// ~/sandbox/complexity-study-acme/acme/src/server_meta.rs:10-31, verbatim.
// A list-cut STRUCT: six fields, hover shows five. The hidden one is
// `compression: CompressionMeta`, which is the goal's named pruned collaborator.
// TWO declarations in the file, so it is also a sibling-fabrication trap: nothing
// from `CompressionMeta` may leak into `ServerMeta`. Two fields carry
// `#[serde(default)]` and three carry a `#[serde(skip_serializing_if = "...")]`
// whose argument holds a `::` path inside a string.
const SRC_SERVER_META = [
  "#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]",
  "pub struct CompressionMeta {",
  '    #[serde(skip_serializing_if = "Option::is_none")]',
  "    pub level: Option<u8>,",
  '    #[serde(skip_serializing_if = "Option::is_none")]',
  "    pub dictionary_name: Option<String>,",
  '    #[serde(skip_serializing_if = "Option::is_none")]',
  "    pub dictionary_sha256: Option<String>,",
  "}",
  "",
  "#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]",
  "pub struct ServerMeta {",
  "    pub num_shards: u32,",
  "    pub timestamp_precision: String,",
  "    pub timestamp_epoch_offset_secs: i64,",
  "    pub routing_rule: String,",
  "    #[serde(default)]",
  "    pub reserve_coordinator_shard: bool,",
  "    #[serde(default)]",
  "    pub compression: CompressionMeta,",
  "}",
  "",
].join("\n");

const HOVER_SERVER_META = [
  "pub struct ServerMeta {",
  "    pub num_shards: u32,",
  "    pub timestamp_precision: String,",
  "    pub timestamp_epoch_offset_secs: i64,",
  "    pub routing_rule: String,",
  "    pub reserve_coordinator_shard: bool,",
  "    /* … */",
  "}",
].join("\n");

// ~/.cargo/registry/.../rcgen-0.14.7/src/sign_algo.rs:25-37, verbatim, quoted from
// test/blind-v37-p5-tuple-payload.test.cjs which quoted it from the crate. TAB
// indented: the source and the hover do not agree on whitespace, so nothing here
// can work by column alignment. The struct variant spans three source lines.
const SRC_SIGN_ALGO = [
  "#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]",
  "pub(crate) enum SignatureAlgorithmParams {",
  "\t/// Omit the parameters",
  "\tNone,",
  "\t/// Write null parameters",
  "\tNull,",
  "\t/// RSASSA-PSS-params as per RFC 4055",
  "\tRsaPss {",
  "\t\thash_algorithm: &'static [u64],",
  "\t\tsalt_length: u64,",
  "\t},",
  "}",
  "",
].join("\n");

// MEASURED, quoted in test/blind-v37-p5. The only
// captured evidence in this repo of how rust-analyzer renders a struct variant.
// No list cut here: three variants, all three shown.
const HOVER_SIGN_ALGO = [
  "pub(crate) enum SignatureAlgorithmParams {",
  "    None,",
  "    Null,",
  "    RsaPss { /* … */ },",
  "}",
].join("\n");

// ~/sandbox/complexity-study-acme/acme_shard/src/error/s3_catchup_error.rs:1-15,
// verbatim. Nine variants, hover shows five. Every hidden member is a hazard:
// `WalSeqGap { expected: u64, got: u64 }` carries BRACES and a comma inside them,
// and the three after it are tuple variants. The one variant the hover DOES show
// last, `DeserializationFailed`, carries a fully-qualified path inside its braces.
const SRC_S3_CATCHUP = [
  "use crate::error::apply_batch_error::ApplyBatchError;",
  "use crate::error::shard_fsync_error::ShardFsyncError;",
  "",
  "#[derive(Debug, Clone)]",
  "pub enum S3CatchupError {",
  "    SidecarUnavailable,",
  "    S3ListFailed { prefix: String, message: String },",
  "    S3GetFailed { path: String, message: String },",
  "    S3DeleteFailed { path: String, message: String },",
  "    DeserializationFailed { path: String, source: acme_wire::disk::disk_format_error::DiskFormatError },",
  "    WalSeqGap { expected: u64, got: u64 },",
  "    ApplyFailed(ApplyBatchError),",
  "    FsyncFailed(ShardFsyncError),",
  "    TruncationFailed(ShardFsyncError),",
  "}",
  "",
].join("\n");

const HOVER_S3_CATCHUP = [
  "pub enum S3CatchupError {",
  "    SidecarUnavailable,",
  "    S3ListFailed { /* … */ },",
  "    S3GetFailed { /* … */ },",
  "    S3DeleteFailed { /* … */ },",
  "    DeserializationFailed { /* … */ },",
  "    /* … */",
  "}",
].join("\n");

// ~/sandbox/complexity-study-acme/acme_rotating_log/src/log_segment_file/
// log_segment_file.rs:31-57, verbatim. Six fields, hover shows five. The parse
// hazards are all real and all in one declaration: multi-line `///` doc comments,
// ONE `//` non-doc comment, blank lines between every field, mixed private and
// `pub`, three levels of nested generics, and a hidden field whose type
// `RefCell<HashMap<AggregateKey, u64>>` carries a comma inside angle brackets.
const SRC_LOG_SEGMENT_FILE = [
  "/// Represents a physical log file on disk, with its associated metadata.",
  "/// Here we are flexible in terms of locking, allowing read/write of metadata during concurrent writes & reads",
  "pub struct LogSegmentFile {",
  "    /// Active, open fd to the log file. Optional type allows to take",
  "    /// ownership when closing the file or rotating the active log file.",
  "    writer: RwLock<Option<Rc<DmaFile>>>,",
  "",
  "    /// Duplicate DmaFile for a reader, so we can do reads while writing without blocking",
  "    reader: RwLock<Option<Rc<DmaFile>>>,",
  "",
  "    // Metadata directly associated with the log segment file structure",
  "    pub metadata: RefCell<LogSegmentFileMetadata>,",
  "",
  "    /// Highest `last_self_acked_wal_seq` known durable in this file's headers.",
  "    /// Conservative (only bumped after a successful header fdatasync); lets the",
  "    /// replication barrier skip its own fsync when a data fsync already covered it.",
  "    pub last_self_acked_synced: Cell<u64>,",
  "",
  "    /// Highest read-cursor `wal_seq` known durable in this file's headers. Same",
  "    /// contract as `last_self_acked_synced`; lets the follower's deferred-commit",
  "    /// drain skip a header-only fsync when a data fsync already persisted the",
  "    /// advanced read cursor.",
  "    pub read_wal_synced: Cell<u64>,",
  "",
  "    /// Last metablock file-offset written for each aggregate in THIS segment.",
  "    /// Feeds the per-aggregate backlink at append time; node-local, never persisted,",
  "    /// dropped with the segment. Updated only after a sync commits (transactional).",
  "    pub aggregate_chain_tips: RefCell<HashMap<AggregateKey, u64>>,",
  "}",
  "",
].join("\n");

const HOVER_LOG_SEGMENT_FILE = [
  "pub struct LogSegmentFile {",
  "    writer: RwLock<Option<Rc<DmaFile>>>,",
  "    reader: RwLock<Option<Rc<DmaFile>>>,",
  "    pub metadata: RefCell<LogSegmentFileMetadata>,",
  "    pub last_self_acked_synced: Cell<u64>,",
  "    pub read_wal_synced: Cell<u64>,",
  "    /* … */",
  "}",
].join("\n");

// ~/sandbox/complexity-study-acme/acme_sidecar/src/error.rs:1-35, verbatim.
// Seven variants, hover shows five. Every variant carries an attribute whose STRING
// contains braces - `#[error("Object not found: {path}")]` - which is a brace a
// brace-counting scan must not count. The `impl` below is a fabrication trap in the
// same file: `Self::NotFound { .. }` is a match arm, not a declaration, and
// recovering `{ .. }` as a payload would inject a pattern where a type belongs.
const SRC_STORE_ERROR = [
  "#[derive(Debug, thiserror::Error)]",
  "pub enum StoreError {",
  '    #[error("S3 not configured")]',
  "    S3NotConfigured,",
  "",
  '    #[error("Object not found: {path}")]',
  "    NotFound { path: String },",
  "",
  '    #[error("Object already exists: {path}")]',
  "    AlreadyExists { path: String },",
  "",
  '    #[error("Precondition failed: {path}")]',
  "    PreconditionFailed { path: String },",
  "",
  '    #[error("S3 error: {message}")]',
  "    S3Error { message: String },",
  "",
  '    #[error("Invalid path: {path}")]',
  "    InvalidPath { path: String },",
  "",
  '    #[error("Unknown error: {message}")]',
  "    Unknown { message: String },",
  "}",
  "",
  "impl StoreError {",
  "    pub fn kind(&self) -> ErrorKind {",
  "        match self {",
  "            Self::NotFound { .. } => ErrorKind::NotFound,",
  "            Self::AlreadyExists { .. } => ErrorKind::AlreadyExists,",
  "            Self::PreconditionFailed { .. } => ErrorKind::PreconditionFailed,",
  "            Self::S3NotConfigured => ErrorKind::Configuration,",
  "            Self::S3Error { .. } => ErrorKind::S3,",
  "            Self::InvalidPath { .. } => ErrorKind::InvalidPath,",
  "            Self::Unknown { .. } => ErrorKind::Unknown,",
  "        }",
  "    }",
  "}",
  "",
].join("\n");

const HOVER_STORE_ERROR = [
  "pub enum StoreError {",
  "    S3NotConfigured,",
  "    NotFound { /* … */ },",
  "    AlreadyExists { /* … */ },",
  "    PreconditionFailed { /* … */ },",
  "    S3Error { /* … */ },",
  "    /* … */",
  "}",
].join("\n");

// MEASURED: the live `create_ca` capture. The v37 tuple
// case, present here only as the no-regression control.
const HOVER_BASIC_CONSTRAINTS = [
  "pub enum BasicConstraints {",
  "    Unconstrained,",
  "    Constrained( /* … */ ),",
  "}",
].join("\n");
// rcgen-0.14.7/src/certificate.rs:1098-1108, verbatim, quoted from blind-v37-p5.
const SRC_BASIC_CONSTRAINTS = [
  "/// The path length constraint (only relevant for CA certificates)",
  "#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]",
  "pub enum BasicConstraints {",
  "\t/// No constraint",
  "\tUnconstrained,",
  "\t/// Constrain to the contained number of intermediate certificates",
  "\tConstrained(u8),",
  "}",
  "",
].join("\n");

// MEASURED. base64::DecodeError.
const HOVER_DECODE_ERROR = [
  "pub enum DecodeError {",
  "    InvalidByte( /* … */ ),",
  "    InvalidLength( /* … */ ),",
  "    InvalidLastSymbol( /* … */ ),",
  "    InvalidPadding,",
  "}",
].join("\n");
// ~/sandbox/complexity-study-oss/base64/src/decode.rs:8-57, abridged to the two
// declarations and the impl between them, verbatim, quoted from blind-v37-p5.
const SRC_BASE64_DECODE = [
  "/// Errors that can occur while decoding.",
  "#[derive(Clone, Debug, PartialEq, Eq)]",
  "pub enum DecodeError {",
  "    /// An invalid byte was found in the input. The offset and offending byte are provided.",
  "    InvalidByte(usize, u8),",
  "    /// The length of the input, as measured in valid base64 symbols, is invalid.",
  "    InvalidLength(usize),",
  "    /// Unlike [DecodeError::InvalidByte], which reports symbols that aren't in the alphabet,",
  "    InvalidLastSymbol(usize, u8),",
  "    /// The nature of the padding was not as configured.",
  "    InvalidPadding,",
  "}",
  "",
  "impl fmt::Display for DecodeError {",
  "    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {",
  "        match *self {",
  "            Self::InvalidByte(index, byte) => {",
  '                write!(f, "Invalid symbol {}, offset {}.", byte, index)',
  "            }",
  '            Self::InvalidLength(len) => write!(f, "Invalid input length: {}", len),',
  "        }",
  "    }",
  "}",
  "",
  "/// Errors that can occur while decoding into a slice.",
  "pub enum DecodeSliceError {",
  "    /// A [DecodeError] occurred",
  "    DecodeError(DecodeError),",
  "    /// The provided slice is too small.",
  "    OutputSliceTooSmall,",
  "}",
  "",
].join("\n");

// MEASURED. Nothing elided at all.
const HOVER_ALPHABET = ["pub struct Alphabet {", "    pub(crate) symbols: [u8; ALPHABET_SIZE],", "}"].join("\n");
// ~/sandbox/complexity-study-oss/base64/src/alphabet.rs:54-57, verbatim.
const SRC_ALPHABET = [
  "#[derive(Clone, Debug, Eq, PartialEq)]",
  "pub struct Alphabet {",
  "    pub(crate) symbols: [u8; ALPHABET_SIZE],",
  "}",
  "",
].join("\n");

// ===========================================================================
// A. ITEM 1, RECOVERY. Every row EXPECTED RED.
// ===========================================================================

btest("A1 [rust]: a list-cut ENUM recovers the variants the cut dropped", async () => {
  const r = await runPrefill("rust", [{ name: "NodeStatus", hover: HOVER_NODE_STATUS, src: SRC_NODE_STATUS }]);
  const block = blockFor(r.text, "NodeStatus");
  assert.ok(block, `precondition: the enum must render at all.${dump(r, "NodeStatus")}`);
  assert.ok(/BootCatchup/.test(block), `precondition: the five variants RA DID show must survive.${dump(r, "NodeStatus")}`);
  for (const hidden of ["Fenced", "Standalone"]) {
    assert.ok(
      new RegExp(`\\b${hidden}\\b`).test(block),
      `acme_distributed/src/node_status.rs declares seven variants and rust-analyzer showed five. ` +
        `\`${hidden}\` is in the source the resolver has already read, and the prompt below this block ` +
        `forbids everything not shown.${dump(r, "NodeStatus")}`,
    );
  }
  // Q1, REASONED not stated: the marker's job is done once the list is complete,
  // and item 2 keys off its survival.
  assert.ok(
    !block.includes(ELLIPSIS),
    `the list is complete now, so rust-analyzer's own truncation marker must go with it. Leaving it ` +
      `would cost the type its ONLY scope under item 2 for a surface that IS proven.${dump(r, "NodeStatus")}`,
  );
});

btest("A2 [rust]: a struct-variant payload recovers, and each variant gets ITS OWN payload", async () => {
  const r = await runPrefill("rust", [{ name: "NodeStatus", hover: HOVER_NODE_STATUS, src: SRC_NODE_STATUS }]);
  const block = blockFor(r.text, "NodeStatus");
  assert.ok(block, `precondition: the enum must render at all.${dump(r, "NodeStatus")}`);
  const WANT = [
    ["Leader", "lease_epoch: u64"],
    ["Follower", "leader_lease_epoch: u64"],
    ["FollowerCatchingUp", "leader_lease_epoch: u64"],
    ["Promoting", "lease_epoch: u64"],
  ];
  for (const [variant, field] of WANT) {
    const m = new RegExp(`\\b${variant}\\s*\\{([^}]*)\\}`).exec(block);
    assert.ok(m, `\`${variant}\` must still be a struct variant with braces.${dump(r, "NodeStatus")}`);
    assert.ok(
      m[1].includes(field),
      `\`${variant}\` is declared \`${variant} { ${field} }\`. Got \`${variant} {${m[1]}}\`. ` +
        `Leader and Follower carry DIFFERENTLY NAMED fields on purpose: a recovery that copies the ` +
        `first payload onto every variant passes a looser check and lies here.${dump(r, "NodeStatus")}`,
    );
  }
});

btest("A3 [rust]: both losses in ONE type - nothing elided is left behind", async () => {
  // The real corpus shape, injected into 63 of 237 rows. A1 and A2 each pass for a
  // build that fixed one loss and not the other; this row does not.
  const r = await runPrefill("rust", [{ name: "NodeStatus", hover: HOVER_NODE_STATUS, src: SRC_NODE_STATUS }]);
  const block = blockFor(r.text, "NodeStatus");
  assert.ok(block, `precondition: the enum must render at all.${dump(r, "NodeStatus")}`);
  for (const v of ["Leader", "Follower", "FollowerCatchingUp", "Promoting", "BootCatchup", "Fenced", "Standalone"]) {
    assert.ok(new RegExp(`\\b${v}\\b`).test(block), `variant \`${v}\` missing.${dump(r, "NodeStatus")}`);
  }
  assert.ok(
    !block.includes(ELLIPSIS),
    `every loss in this type is recoverable from the source, so no marker may survive.${dump(r, "NodeStatus")}`,
  );
  assert.ok(
    !/\bStandalone\s*[({]/.test(block),
    `\`Standalone\` is a unit variant and must not be given a payload it does not have.${dump(r, "NodeStatus")}`,
  );
});

btest("A4 [rust]: a list-cut STRUCT recovers the fields the cut dropped, attributes and all", async () => {
  const r = await runPrefill("rust", [{ name: "ServerMeta", hover: HOVER_SERVER_META, src: SRC_SERVER_META }]);
  const block = blockFor(r.text, "ServerMeta");
  assert.ok(block, `precondition: the struct must render at all.${dump(r, "ServerMeta")}`);
  assert.ok(
    /compression:\s*CompressionMeta/.test(block),
    `acme/src/server_meta.rs:29 declares \`pub compression: CompressionMeta\`, the sixth of six ` +
      `fields and the one rust-analyzer cut. It is also the goal's named pruned collaborator: while it ` +
      `is missing the walk never resolves CompressionMeta at all.${dump(r, "ServerMeta")}`,
  );
  assert.ok(!block.includes(ELLIPSIS), `the field list is complete now.${dump(r, "ServerMeta")}`);
  assert.ok(
    !/#\[serde/.test(block),
    `the attribute lines are not members. Injecting \`#[serde(default)]\` as if it were a field spends ` +
      `budget on noise and invites the model to write it.${dump(r, "ServerMeta")}`,
  );
  // The sibling-fabrication trap: the same file declares CompressionMeta first.
  for (const alien of ["level", "dictionary_name", "dictionary_sha256"]) {
    assert.ok(
      !new RegExp(`\\b${alien}\\b`).test(block),
      `\`${alien}\` is a field of \`CompressionMeta\`, declared ABOVE \`ServerMeta\` in the same file. ` +
        `Pulling it in is a lie in the compiler's voice.${dump(r, "ServerMeta")}`,
    );
  }
});

btest("A5 [rust]: a struct-variant payload with no list cut - the form v37 never covered", async () => {
  // SUPERSEDES a committed row. test/blind-v37-p5-tuple-payload.test.cjs asserts
  // this exact fixture comes back byte-identical, which was correct for v37 and is
  // the thing session-v39 item 1 changes. The source is TAB indented and the hover
  // is space indented, so nothing here can work by column alignment.
  const r = await runPrefill("rust", [{ name: "SignatureAlgorithmParams", hover: HOVER_SIGN_ALGO, src: SRC_SIGN_ALGO }]);
  const block = blockFor(r.text, "SignatureAlgorithmParams");
  assert.ok(block, `precondition: the enum must render at all.${dump(r, "SignatureAlgorithmParams")}`);
  const m = /\bRsaPss\s*\{([^}]*)\}/.exec(block);
  assert.ok(m, `\`RsaPss\` must still be a struct variant.${dump(r, "SignatureAlgorithmParams")}`);
  assert.ok(
    /hash_algorithm:\s*&'static \[u64\]/.test(m[1]) && /salt_length:\s*u64/.test(m[1]),
    `rcgen sign_algo.rs:32-35 declares \`RsaPss { hash_algorithm: &'static [u64], salt_length: u64 }\`, ` +
      `spread over three tab-indented lines. Got \`RsaPss {${m[1]}}\`.${dump(r, "SignatureAlgorithmParams")}`,
  );
  assert.ok(!block.includes(ELLIPSIS), `nothing is left elided in this enum.${dump(r, "SignatureAlgorithmParams")}`);
  assert.ok(
    !/RsaPss\s*\(/.test(block),
    `a struct variant must never be rewritten into a tuple variant.${dump(r, "SignatureAlgorithmParams")}`,
  );
  for (const unit of ["None", "Null"]) {
    assert.ok(
      new RegExp(`\\b${unit}\\b`).test(block) && !new RegExp(`\\b${unit}\\s*[({]`).test(block),
      `the unit variant \`${unit}\` must survive and must not grow a payload.${dump(r, "SignatureAlgorithmParams")}`,
    );
  }
});

btest("A6 [rust]: a HIDDEN member whose own text carries braces and a comma inside them", async () => {
  // The sharp case for the list cut. Recovering nine variants means walking past
  // `WalSeqGap { expected: u64, got: u64 }`, whose braces close a member rather
  // than the declaration, and whose comma is not a member separator.
  const r = await runPrefill("rust", [{ name: "S3CatchupError", hover: HOVER_S3_CATCHUP, src: SRC_S3_CATCHUP }]);
  const block = blockFor(r.text, "S3CatchupError");
  assert.ok(block, `precondition: the enum must render at all.${dump(r, "S3CatchupError")}`);
  const gap = /\bWalSeqGap\s*\{([^}]*)\}/.exec(block);
  assert.ok(gap, `the hidden struct variant \`WalSeqGap\` must arrive with its braces.${dump(r, "S3CatchupError")}`);
  assert.ok(
    /expected:\s*u64/.test(gap[1]) && /got:\s*u64/.test(gap[1]),
    `s3_catchup_error.rs:11 declares \`WalSeqGap { expected: u64, got: u64 }\`; a member split on the ` +
      `first comma keeps only \`expected\`. Got \`WalSeqGap {${gap[1]}}\`.${dump(r, "S3CatchupError")}`,
  );
  for (const [v, payload] of [["ApplyFailed", "ApplyBatchError"], ["FsyncFailed", "ShardFsyncError"], ["TruncationFailed", "ShardFsyncError"]]) {
    assert.ok(
      new RegExp(`\\b${v}\\(${payload}\\)`).test(block),
      `the hidden tuple variant \`${v}(${payload})\` must arrive with its payload.${dump(r, "S3CatchupError")}`,
    );
  }
  assert.ok(
    /DeserializationFailed\s*\{[^}]*source:\s*acme_wire::disk::disk_format_error::DiskFormatError/.test(block),
    `the last SHOWN variant carries a fully-qualified path inside its braces and must recover intact.` +
      `${dump(r, "S3CatchupError")}`,
  );
  assert.ok(!block.includes(ELLIPSIS), `nine of nine recovered leaves no marker.${dump(r, "S3CatchupError")}`);
});

btest("A7 [rust]: doc comments, a `//` comment, blank lines and nested generics do not corrupt the parse", async () => {
  const r = await runPrefill("rust", [{ name: "LogSegmentFile", hover: HOVER_LOG_SEGMENT_FILE, src: SRC_LOG_SEGMENT_FILE }]);
  const block = blockFor(r.text, "LogSegmentFile");
  assert.ok(block, `precondition: the struct must render at all.${dump(r, "LogSegmentFile")}`);
  assert.ok(
    /aggregate_chain_tips:\s*RefCell<HashMap<AggregateKey,\s*u64>>/.test(block),
    `log_segment_file.rs:56 declares \`pub aggregate_chain_tips: RefCell<HashMap<AggregateKey, u64>>\`, ` +
      `the sixth of six fields. Its type carries a comma inside angle brackets and it sits under three ` +
      `lines of doc comment, after a blank line.${dump(r, "LogSegmentFile")}`,
  );
  assert.ok(!block.includes(ELLIPSIS), `the field list is complete now.${dump(r, "LogSegmentFile")}`);
  assert.ok(
    !/Last metablock file-offset|Metadata directly associated/.test(block),
    `neither the \`///\` prose nor the one \`//\` comment at log_segment_file.rs:40 is a member.` +
      `${dump(r, "LogSegmentFile")}`,
  );
  assert.ok(
    /\bwriter:\s*RwLock<Option<Rc<DmaFile>>>/.test(block),
    `the five fields rust-analyzer DID show must survive the recovery byte for byte.${dump(r, "LogSegmentFile")}`,
  );
});

btest("A8 [rust]: attributes whose own strings carry braces, and a match arm that is not a declaration", async () => {
  const r = await runPrefill("rust", [{ name: "StoreError", hover: HOVER_STORE_ERROR, src: SRC_STORE_ERROR }]);
  const block = blockFor(r.text, "StoreError");
  assert.ok(block, `precondition: the enum must render at all.${dump(r, "StoreError")}`);
  for (const [v, field] of [["InvalidPath", "path: String"], ["Unknown", "message: String"]]) {
    const m = new RegExp(`\\b${v}\\s*\\{([^}]*)\\}`).exec(block);
    assert.ok(m, `hidden variant \`${v}\` must arrive.${dump(r, "StoreError")}`);
    assert.ok(m[1].includes(field), `\`${v} { ${field} }\`; got \`${v} {${m[1]}}\`.${dump(r, "StoreError")}`);
  }
  const nf = /\bNotFound\s*\{([^}]*)\}/.exec(block);
  assert.ok(nf, `the shown struct variant \`NotFound\` must recover its payload too.${dump(r, "StoreError")}`);
  assert.ok(
    nf[1].includes("path: String") && !nf[1].includes(".."),
    `error.rs:7 declares \`NotFound { path: String }\`. error.rs:28 writes \`Self::NotFound { .. }\`, ` +
      `which is a MATCH ARM in the impl below and not a declaration. Got \`NotFound {${nf[1]}}\`.` +
      `${dump(r, "StoreError")}`,
  );
  assert.ok(
    !/#\[error|Object not found|S3 not configured/.test(block),
    `\`#[error("Object not found: {path}")]\` is an attribute, and the braces in its string are not ` +
      `member braces. None of it belongs in the surface.${dump(r, "StoreError")}`,
  );
  assert.ok(!block.includes(ELLIPSIS), `seven of seven recovered leaves no marker.${dump(r, "StoreError")}`);
});

// ===========================================================================
// B. NO REGRESSION. The v37 tuple recovery, and a hover with nothing elided.
// All EXPECTED GREEN.
// ===========================================================================

btest("B1 [rust]: the v37 tuple recovery still fires", async () => {
  const r = await runPrefill("rust", [{ name: "BasicConstraints", hover: HOVER_BASIC_CONSTRAINTS, src: SRC_BASIC_CONSTRAINTS }]);
  const block = blockFor(r.text, "BasicConstraints");
  assert.ok(block, `precondition: the enum must render.${dump(r, "BasicConstraints")}`);
  assert.ok(
    /Constrained\(u8\)/.test(block),
    `rcgen certificate.rs:1103. This is the live create_ca capture that filed the original item and it ` +
      `has been green since v37.${dump(r, "BasicConstraints")}`,
  );
  assert.ok(!block.includes(ELLIPSIS), `and no marker survives.${dump(r, "BasicConstraints")}`);
  assert.ok(
    /^\s*Unconstrained,$/m.test(block),
    `the unit variant line is untouched.${dump(r, "BasicConstraints")}`,
  );
});

btest("B2 [rust]: a multi-payload tuple enum still recovers every type, and never from a match arm", async () => {
  const r = await runPrefill("rust", [{ name: "DecodeError", hover: HOVER_DECODE_ERROR, src: SRC_BASE64_DECODE }]);
  const block = blockFor(r.text, "DecodeError");
  assert.ok(block, `precondition: the enum must render.${dump(r, "DecodeError")}`);
  assert.ok(/InvalidByte\(usize,\s*u8\)/.test(block), `base64 decode.rs:18.${dump(r, "DecodeError")}`);
  assert.ok(/InvalidLastSymbol\(usize,\s*u8\)/.test(block), `base64 decode.rs:26.${dump(r, "DecodeError")}`);
  assert.ok(/InvalidLength\(usize\)/.test(block), `base64 decode.rs:22.${dump(r, "DecodeError")}`);
  assert.ok(
    !/InvalidByte\(index,\s*byte\)/.test(block),
    `\`Self::InvalidByte(index, byte)\` in the impl below binds VALUES, not types.${dump(r, "DecodeError")}`,
  );
  assert.ok(
    !/OutputSliceTooSmall/.test(block),
    `\`DecodeSliceError\` is a sibling enum in the same file and must not leak in.${dump(r, "DecodeError")}`,
  );
});

btest("B3 [rust]: a hover with nothing elided is byte-identical", async () => {
  const r = await runPrefill("rust", [{ name: "Alphabet", hover: HOVER_ALPHABET, src: SRC_ALPHABET }]);
  const block = blockFor(r.text, "Alphabet");
  assert.ok(block, `precondition: the struct must render.${dump(r, "Alphabet")}`);
  assert.equal(
    block,
    HOVER_ALPHABET,
    `base64 alphabet.rs:55 has one field and rust-analyzer printed it with its type. There is nothing ` +
      `to recover, so a recovery pass over it must be a no-op down to the byte.${dump(r, "Alphabet")}`,
  );
});

// ===========================================================================
// C. REFUSAL. The bar, and it matters more than section A.
//
// EXPECTED GREEN today, because nothing recovers anything for these shapes yet.
// Their non-vacuity control is section A: C1, C2, C4 and C5 mutilate the SAME
// NodeStatus source that A1..A3 recover from, one way each, and C3 mutilates
// ServerMeta from A4.
//
// The claim in every row is BYTE-IDENTITY with the hover. "Refusal must be total,
// never partial" cannot be stated any weaker: a build that recovers the four
// struct-variant payloads and then declines to un-cut the list has told the model
// four things it could not prove.
// ===========================================================================

// SYNTHESIZED, and the only synthesized source in this file. It is the real
// node_status.rs with a `#[cfg(test)] mod` appended that declares a second, smaller
// `NodeStatus` carrying `u32` epochs. The goal names this shape explicitly.
const SRC_NODE_STATUS_TWO_DECLS =
  SRC_NODE_STATUS +
  [
    "#[cfg(test)]",
    "mod tests {",
    "    /// A cut-down stand-in used only by the state-machine tests.",
    "    pub enum NodeStatus {",
    "        Leader { lease_epoch: u32 },",
    "        Follower { leader_lease_epoch: u32 },",
    "        BootCatchup,",
    "    }",
    "}",
    "",
  ].join("\n");

// SYNTHESIZED from the real file: a re-export module. The name is present, the
// declaration is not.
const SRC_NODE_STATUS_REEXPORT = [
  "// The declaration lives in another module; this file only re-exports it.",
  "pub use crate::node_status::NodeStatus;",
  "",
].join("\n");

// SYNTHESIZED from the real file: the same declaration under the wrong keyword.
const SRC_NODE_STATUS_WRONG_KIND = [
  "#[derive(Debug, Clone, Copy, PartialEq, Eq)]",
  "pub struct NodeStatus {",
  "    pub lease_epoch: u64,",
  "    pub role: u8,",
  "}",
  "",
].join("\n");

// SYNTHESIZED from the real file: one field's type moved on. The hover was taken
// before the edit, the source after it, and they disagree about `routing_rule`,
// which the hover DID show.
const SRC_SERVER_META_DRIFTED = SRC_SERVER_META.replace(
  "    pub routing_rule: String,",
  "    pub routing_rule: RoutingRule,",
);

const REFUSAL_ROWS = [
  {
    row: "C1",
    why: "no declaration of the name anywhere in the source that was read",
    name: "NodeStatus",
    hover: HOVER_NODE_STATUS,
    src: SRC_NODE_STATUS_REEXPORT,
    absent: ["Fenced", "Standalone", "lease_epoch"],
  },
  {
    row: "C2",
    why: "two declarations of the name that disagree - a `#[cfg(test)] mod` declares the second",
    name: "NodeStatus",
    hover: HOVER_NODE_STATUS,
    src: SRC_NODE_STATUS_TWO_DECLS,
    // `Fenced` and `Standalone` exist only in the outer copy, `u32` only in the
    // inner one. Neither may be picked, and picking the outer copy "because it is
    // first" is a guess dressed as a rule.
    absent: ["Fenced", "Standalone", "u32", "lease_epoch"],
  },
  {
    row: "C4",
    why: "the def file read came back empty",
    name: "NodeStatus",
    hover: HOVER_NODE_STATUS,
    src: SRC_NODE_STATUS,
    defText: "",
    absent: ["Fenced", "Standalone", "lease_epoch"],
  },
  {
    row: "C5",
    why: "the source declares the name with a different KIND than the hover",
    name: "NodeStatus",
    hover: HOVER_NODE_STATUS,
    src: SRC_NODE_STATUS_WRONG_KIND,
    absent: ["role", "pub lease_epoch"],
  },
  {
    row: "C3",
    why: "hover and source disagree about a member the hover DID show",
    name: "ServerMeta",
    hover: HOVER_SERVER_META,
    src: SRC_SERVER_META_DRIFTED,
    // The disagreement is on `routing_rule`. The tempting partial answer is to
    // keep the hover's five and append the sixth; the bar forbids it, because the
    // disagreement is evidence the two texts are not describing the same type.
    absent: ["compression", "CompressionMeta", "RoutingRule"],
  },
];

for (const c of REFUSAL_ROWS) {
  btest(`${c.row} [rust] REFUSE: ${c.why}`, async () => {
    let r;
    await assert.doesNotReject(
      async () => {
        r = await runPrefill("rust", [{ name: c.name, hover: c.hover, src: c.src, defText: c.defText }]);
      },
      `${c.row}: the recovery reads a file that may be anything at all and must never throw`,
    );
    const block = blockFor(r.text, c.name);
    assert.ok(
      block !== undefined,
      `${c.row}: NON-VACUITY. Refusing means falling back to the UNMODIFIED HOVER, not deleting the ` +
        `surface. An absent block would make every assertion below green for the wrong reason.` +
        `${dump(r, c.name)}`,
    );
    assert.equal(
      block,
      c.hover,
      `${c.row}: ${c.why}. Refusal must be TOTAL for the type and byte-identical to the hover. A ` +
        `partial recovery here reaches the model in the compiler's voice, and a wrong member is worse ` +
        `than an absent one.${dump(r, c.name)}`,
    );
    for (const a of c.absent) {
      assert.ok(
        !block.includes(a),
        `${c.row}: \`${a}\` came from the source and is not proven. ${c.why}.${dump(r, c.name)}`,
      );
    }
  });
}

// ===========================================================================
// D. ITEM 2, THE HONESTY FALLBACK.
// ===========================================================================

btest("D1 [rust]: a type whose marker survives is DROPPED from the ONLY list, with item 1 absent", async () => {
  // EXPECTED RED, and this is the independence row. The source names the type and
  // never declares it, so NO item-1 implementation can recover anything: item 2
  // has to carry this row alone. That makes a partial build visible - if only
  // item 2 lands, this goes green while every A row stays red.
  const r = await runPrefill("rust", [{ name: "NodeStatus", hover: HOVER_NODE_STATUS, src: SRC_NODE_STATUS_REEXPORT }]);
  const block = blockFor(r.text, "NodeStatus");
  assert.ok(block && block.includes(ELLIPSIS), `precondition: the marker survived into the injection.${dump(r, "NodeStatus")}`);
  assert.ok(
    hasFirmInstruction(r.text),
    `the firm instruction must still be there. Dropping the whole sentence is a much larger change ` +
      `than dropping one name from its scope.${dump(r, "NodeStatus")}`,
  );
  assert.ok(
    !onlyListNames(r.text).includes("NodeStatus"),
    `the block above says, in rust-analyzer's own marker, that the list is incomplete, and the ` +
      `instruction then forbids everything off it. An incomplete surface may be SHOWN; it may not be ` +
      `declared exhaustive.${dump(r, "NodeStatus")}`,
  );
  assert.ok(
    /`NodeStatus`/.test(r.text),
    `and the surface itself must still be shown. Withdrawing the block is not the fallback; ` +
      `withdrawing the exhaustiveness claim is.${dump(r, "NodeStatus")}`,
  );
});

btest("D2 [rust]: a fully recovered type IS allowed in the ONLY list", async () => {
  // EXPECTED GREEN and must stay green. This is the row that stops item 2 being
  // implemented as "never name a Rust enum again".
  const r = await runPrefill("rust", [{ name: "BasicConstraints", hover: HOVER_BASIC_CONSTRAINTS, src: SRC_BASIC_CONSTRAINTS }]);
  const block = blockFor(r.text, "BasicConstraints");
  assert.ok(block && !block.includes(ELLIPSIS), `precondition: nothing elided survived.${dump(r, "BasicConstraints")}`);
  assert.ok(
    onlyListNames(r.text).includes("BasicConstraints"),
    `the surface is complete and proven, so the exhaustiveness claim is true and must be made. Item 2 ` +
      `withdraws it only when the marker survives.${dump(r, "BasicConstraints")}`,
  );
});

btest("D3 [rust]: in one payload the recovered type is named and the truncated one is not", async () => {
  // EXPECTED RED. The sharpest item-2 row: the fallback is per TYPE, not per
  // prompt. A build that drops the whole instruction the moment any block is
  // truncated passes D1 and fails here.
  const r = await runPrefill("rust", [
    { name: "BasicConstraints", hover: HOVER_BASIC_CONSTRAINTS, src: SRC_BASIC_CONSTRAINTS },
    { name: "NodeStatus", hover: HOVER_NODE_STATUS, src: SRC_NODE_STATUS_REEXPORT },
  ]);
  assert.ok(blockFor(r.text, "BasicConstraints"), `precondition: both types render.${dump(r, "BasicConstraints")}`);
  assert.ok(blockFor(r.text, "NodeStatus"), `precondition: both types render.${dump(r, "NodeStatus")}`);
  const only = onlyListNames(r.text);
  assert.ok(
    only.includes("BasicConstraints"),
    `the proven type keeps its scope even when a sibling in the same payload lost hers.${dump(r, "BasicConstraints")}`,
  );
  assert.ok(
    !only.includes("NodeStatus"),
    `and the truncated type loses hers. Got ONLY list ${show(only)}.${dump(r, "NodeStatus")}`,
  );
});

// ===========================================================================
// E. THE OTHER FOUR LANGUAGES ARE UNTOUCHED.
//
// Each row feeds its language the SAME marker-bearing Rust hover the Rust rows
// use, which is the only lever that can tell a Rust-gated fix from a
// language-blind one from outside. See Q3 in the header: item 2 is arguably a
// correctness fix in any language, and session-v39 still puts the other four
// under "Explicitly out".
//
// Each row carries a non-vacuity control, and it needs one: measured on this
// harness, go, csharp and python render no data-shape block for any hover, so
// without a method member the whole row would be green for free.
// ===========================================================================

for (const [row, languageId] of [
  ["E1", "typescript"],
  ["E2", "go"],
  ["E3", "csharp"],
  ["E4", "python"],
]) {
  btest(`${row} [${languageId}]: a marker-bearing hover is unchanged, and keeps its ONLY scope`, async () => {
    const r = await runPrefill(languageId, [
      {
        name: "NodeStatus",
        hover: HOVER_NODE_STATUS,
        src: SRC_NODE_STATUS,
        members: [{ name: "same_role", kind: "method", signature: "same_role(other) : boolean" }],
      },
    ]);
    assert.ok(
      /`NodeStatus`/.test(r.text),
      `${languageId}: NON-VACUITY CONTROL. The type must reach the payload at all, or this row says ` +
        `nothing.${dump(r, "NodeStatus")}`,
    );
    const block = blockFor(r.text, "NodeStatus");
    if (block && block.includes("NodeStatus {")) {
      assert.ok(
        block.includes(ELLIPSIS),
        `${languageId} is out of scope for session-v39 and its bytes must not move. This is the exact ` +
          `hover the Rust rows recover from, so a recovery here means the fix is language-blind.` +
          `${dump(r, "NodeStatus")}`,
      );
      for (const hidden of ["Fenced", "Standalone", "lease_epoch"]) {
        assert.ok(
          !block.includes(hidden),
          `${languageId}: \`${hidden}\` was read out of Rust source by a non-Rust path.${dump(r, "NodeStatus")}`,
        );
      }
    }
    assert.ok(
      onlyListNames(r.text).includes("NodeStatus"),
      `${languageId}: item 2 is scoped to Rust too. Narrowing the ONLY list here is a contract change ` +
        `and belongs in writing.${dump(r, "NodeStatus")}`,
    );
  });
}
