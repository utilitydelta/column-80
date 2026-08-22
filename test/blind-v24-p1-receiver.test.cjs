// Blind oracle for session-v24 phase 1, REWORKED against the rewritten
// contract. Entry point: `resolvePrefill` (src/vscode/fnGen.ts).
//
// This file replaces the version written against the old contract. That design
// found the enclosing type by counting braces over file text; this one does not
// read file text at all. The SIGNATURE decides whether a receiver applies and
// which job the target is doing; the DOCUMENT-SYMBOL TREE, arriving on the
// resolution record, answers only which type encloses it.
//
// Written blind: nothing here has read fnGen.ts, enclosingType.ts, extraction.ts
// or anything else under src/. Block-header shapes, log-line formats and the
// frozen free-function bytes were all CAPTURED by running the code through this
// harness.
//
// THREE OBSERVABLE CASES, and the file is organised around them:
//   A  receiver in the signature      -> the enclosing type's FIELDS and METHODS
//   B  no receiver, return type names
//      the enclosing type or Self     -> its FIELDS plus only PRODUCING members
//   C  neither                        -> NOTHING, and no evidence line claiming one
// plus item 4a: a target that is NOT A FUNCTION is case C always, whatever its
// signature looks like. The generation kind is a dimension of every fixture
// here (`genKind` on the scenario, defaulting to "function"), not a constant.
//
// STATE: 121 rows, all green. The rework, every triaged fix, the strict
// name-vs-anchor agreement check and phase 2 are all in. The six `item 13`
// byte freezes were re-baselined once when phase 2 rescoped the instruction;
// the terms and the verification are recorded at that family.
//
// One known degrade is RECORDED rather than left red: a path-qualified Rust impl
// header (`impl crate::store::Owner`) does not resolve, because the anchor sits
// on the path's first segment and the strict agreement check correctly refuses
// it. Its row pins how it fails - detected, placed first, no block, accounted
// honestly, and critically NO foreign members under the container's header - and
// names the widening that would resolve it. A permanently red row would have
// asserted none of that. See the row for the full reasoning.
//
// FIXTURE FIDELITY, and why it mattered. An earlier version of this file set
// every node's `selectionRange` to the whole header-line range, so anchors
// landed at column 0 on `impl` / `public` / `class` / `export`. No measured
// server does that: the selection covers the NAME TOKEN in all five. The
// infidelity had a real cost - a literal name-vs-anchor agreement check
// reddens ~25 rows on that artifact alone, so the product shipped a weaker
// line-granularity check instead. The fidelity is fixed here and the guard row
// below pins it.
//
// GREEN NOW AND AFTER, on purpose:
//   * "item 13" - the free-function SURFACE is byte-frozen. Note the contract
//     now excepts EVIDENCE lines from that freeze (a drop line changes no
//     injected byte), so these rows pin the surface string and deliberately do
//     NOT pin the log array any more.
//   * "item 14" - the injection gate. Sharper than before: with the extractor
//     absent nothing may resolve, which is what catches an implementation that
//     reads a container out of the document instead of using the resolution the
//     product already did.
//   * "case A" surface rows, "rule 5" and the "impl header" forms - the contract
//     says case A's surface is UNCHANGED from the old design, and today's
//     scanner already produces it for all of these. They are pins, not red rows.
//     What makes them cheat-proof is the paired tree-degrade family: same
//     fixture, tree removed, nothing may be injected.
//
// THE RESOLUTION-RECORD SEAM. Contract item 8 names the property: the tree
// arrives on the resolution record as `symbols`, and resolvePrefill's parameter
// list does not change. Earlier drafts of this file hedged across several
// plausible names; the contract settled it, so there is one name here.
//
// GO IS EXEMPT FROM THE TREE (item 9). Its signature carries the receiver and
// the receiver's TYPE in one clause, so detection and resolution both come from
// the record and a Go receiver resolves with no tree at all. That is not a hole
// in item 6 - what item 6 forbids is reading a container out of raw file text,
// and a resolved signature is neither. Go therefore has no case B either: case B
// needs an enclosing type, and a Go constructor is a package-level function with
// nothing enclosing it.
//
// MID-EDIT (item 10) is now covered, from the live measurement - never
// guessed. Every measured failure is a silent MISS and not one returned a
// wrong container, so those rows pin the DIRECTION of failure rather than the
// brokenness shapes: resolve the right type or nothing. Python's single
// accepted regression has its own row so it cannot later be read as a defect.
//
// Run: SKIP_LIVE=1 node --test test/blind-v24-p1-receiver.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness. resolvePrefill bundled headless against a STRUCTURAL vscode stub -
// real Position/Range with contains/compareTo, so a tree walk that does span
// math runs honestly (the blind-v10-gestures / blind-v12-admit-csts stub).
// workspace.openTextDocument serves a uri->text map through a process global.
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v24-p1-vscode-stub.cjs");
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
class WorkspaceEdit {}
class EventEmitter { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} }
class ThemeColor {}
class MarkdownString {}
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection, WorkspaceEdit, EventEmitter, ThemeColor, MarkdownString,
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
      const files = globalThis.__V24P1_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

let ROOT_CAP_AT_DEFAULT;
const ENTRY = path.join(__dirname, ".blind-v24-p1.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v24-p1.bundle.cjs");
let resolvePrefill;
// The root cap in force under the INSTALL DEFAULT context stop, read from the
// product's own seam. Written as a read rather than a literal because
// session-v48 phase 1 made it a setting: a row that hard-coded the number would
// pin the dial's default instead of the mechanism it is about.
let contextBoundsFor;
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolvePrefill } from "../src/vscode/fnGen";\n` +
      `export { contextBoundsFor, DEFAULT_CONTEXT_STOP } from "../src/core/budgetProfile";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  const built = require(OUTFILE);
  ({ resolvePrefill, contextBoundsFor } = built);
  ROOT_CAP_AT_DEFAULT = contextBoundsFor(built.DEFAULT_CONTEXT_STOP).rootCap;
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// --- Fake vscode.TextDocument over a source string. -------------------------
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

function wordAt(text, cursor) {
  const line = text.split("\n")[cursor.line] ?? "";
  const isWord = (c) => /[A-Za-z0-9_]/.test(c);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return line.slice(s, e) || undefined;
}

const DECL = (n) => new RegExp(`\\b(?:struct|class|record|interface|enum|type)\\s+${n}\\b`);

// --- Fake SurfaceExtractor. Answers by the type at the cursor: the exact word
// when it is a known type, else the first known type on the cursor's LINE.
// `darkTypes` are named-but-unresolvable and never win the fallback.
//
// The line fallback used to be load-bearing, because the fixtures put every
// anchor at column 0. With faithful selection ranges it is not: disabling it
// entirely leaves 115 of 116 rows green, the one exception being the
// path-qualified `impl crate::store::Owner`, whose selection shape no
// measurement recorded and which this file therefore declines to guess at. So
// the fallback is kept as a last resort rather than as a crutch, and any row
// that needs the anchor to be exact says so with `exactAnchor`.
function makeExtractor(cfg) {
  const files = cfg.files;
  const defTypes = cfg.defTypes || {};
  const examples = cfg.examples || {};
  const dark = new Set(cfg.darkTypes || []);
  const known = new Set(Object.keys(defTypes));
  const calls = { definition: [], hoverSurface: [], membersOfType: [], example: [] };

  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && dark.has(w)) return undefined;
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    if ([...dark].some((d) => new RegExp(`\\b${d}\\b`).test(line))) return undefined;
    // `exactAnchor` turns the fake into a pure function of the CURSOR: whatever
    // identifier is under it, and nothing else. The agreement rows need that,
    // because their whole subject is an anchor that points somewhere other than
    // the container's name, and a line fallback would paper over exactly that.
    if (cfg.exactAnchor) return undefined;
    for (const t of known) if (new RegExp(`\\b${t}\\b`).test(line)) return t;
    return undefined;
  };

  const defLocFor = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => DECL(t).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };

  const ext = {
    definition: async (c) => { calls.definition.push(c); const t = typeAtCursor(c.uri, c); return t ? defLocFor(t) : undefined; },
    hoverSurface: async (c) => { calls.hoverSurface.push(c); const t = typeAtCursor(c.uri, c); const h = t ? defTypes[t].hover : undefined; return h ? { signature: h } : undefined; },
    membersOfType: async (c) => { calls.membersOfType.push(c); const t = typeAtCursor(c.uri, c); return (t && defTypes[t].members) || []; },
    example: async (c, prefer) => { calls.example.push(prefer); return examples[prefer]; },
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
  return { ext, calls };
}

const M = (name, signature) => ({ name, signature, kind: "method" });
const F = (name, signature) => ({ name, signature, kind: "field" });

// --- Document-symbol fixtures. Shapes are the recorded product ones: the
// hierarchical vscode.DocumentSymbol ({name, detail, kind, range,
// selectionRange, children}) that blind-v6-item2a-adapter records for
// rust-analyzer - where an `impl` block is an untyped Object symbol and the
// struct is its SIBLING - and the class-with-member-children shape
// blind-v15-product-argtypes records for Roslyn, tsserver and Pylance. Go's
// methods arrive as TOP-LEVEL symbols named `(*Owner).Absorb`, per the Go
// extractor's recorded shape.
const SK = { Module: 1, Namespace: 2, Class: 4, Method: 5, Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Constant: 13, Object: 18, Struct: 22 };
const lineOf = (src, needle) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `fixture bug: ${JSON.stringify(needle)} not in source`);
  return src.slice(0, i).split("\n").length - 1;
};
// A range from the line of `from` to the line of `to` (or end of file), full
// width. It carries its own first line so `dsym` can place the selection range
// on the NAME TOKEN without every call site re-passing the source.
function rng(src, from, to) {
  const lines = src.split("\n");
  const sl = lineOf(src, from);
  const el = to === undefined ? lines.length - 1 : lineOf(src, to);
  const r = new V.Range(sl, 0, el, lines[el].length);
  Object.defineProperty(r, "__line", { value: lines[sl], enumerable: false });
  return r;
}

// The identifier a server's `selectionRange` covers, given the symbol's name.
// Measured, not assumed:
//   rust-analyzer  `impl Owner`             sel 4:5-4:10   -> `Owner`
//                  `impl Persist for Owner` sel 8:17-8:22  -> `Owner`, the SELF
//                                                             TYPE, never the trait
//                  `impl Cache<T>`          sel 4:15-4:23  -> `Cache<T>`, argument
//                                                             list INCLUDED
//   Roslyn         `Owner` [Class]          sel 2:13-2:18  -> the class name in
//                                                             `public class Owner`
//   tsserver       `Owner` [Class]          sel 0:13-0:18  -> same
//   pyright        `Owner` [Class]          sel 0:6-0:11   -> same
//   gopls          `(*Owner).Absorb`        sel 6:16-6:22  -> the METHOD name,
//                                                             not the receiver
function selectionTokenFor(name) {
  if (name.startsWith("impl")) {
    const forIdx = name.lastIndexOf(" for ");
    if (forIdx >= 0) return name.slice(forIdx + 5).trim();
    let rest = name.slice(4);
    if (rest.startsWith("<")) {
      let depth = 0;
      let i = 0;
      for (; i < rest.length; i++) {
        if (rest[i] === "<") depth++;
        else if (rest[i] === ">") {
          depth--;
          if (depth === 0) {
            i++;
            break;
          }
        }
      }
      rest = rest.slice(i);
    }
    return rest.trim();
  }
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1) : name;
}

// FIDELITY: `selectionRange` covers the name token on the node's first line,
// which is what every measured server reports. It is NOT the whole header line.
// An earlier version of this file set it to the full range, so every anchor
// landed at column 0 on `impl` / `public` / `class` / `export` - a shape no
// measured server produces, and one that forces any name-vs-anchor agreement
// check to be weakened to line granularity before it can pass.
function nameSelection(name, range) {
  const line = range.__line;
  const startLine = range.start.line;
  if (typeof line !== "string") return range;
  const token = selectionTokenFor(name);
  const ch = line.indexOf(token);
  if (ch < 0) return range;
  return new V.Range(startLine, ch, startLine, ch + token.length);
}

const dsym = (name, kind, range, children = [], detail = "", selectionRange = undefined) => ({
  name,
  detail,
  kind,
  range,
  selectionRange: selectionRange || nameSelection(name, range),
  children,
});

// ===========================================================================
// Reading the surface back, without knowing its block vocabulary. A block
// header is any line carrying a backticked identifier followed by a fenced code
// block within two lines - true of every header shape today and of any the
// receiver block may introduce, so no wording is pinned.
// ===========================================================================
function headerTypes(out) {
  const lines = (out || "").split("\n");
  const names = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(lines[i]);
    if (!m) continue;
    if (!((lines[i + 1] || "").startsWith("```") || (lines[i + 2] || "").startsWith("```"))) continue;
    if (!names.includes(m[1])) names.push(m[1]);
  }
  return names;
}
function headerCount(out, name) {
  const lines = (out || "").split("\n");
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(lines[i]);
    if (!m || m[1] !== name) continue;
    if ((lines[i + 1] || "").startsWith("```") || (lines[i + 2] || "").startsWith("```")) n++;
  }
  return n;
}
const injectedCount = (logs) => {
  const l = logs.find((x) => /injected types=/.test(x));
  return l ? Number(/injected types=(\d+)/.exec(l)[1]) : 0;
};

// The accounting evidence line (contract item 15). Conditional by design: it
// fires only when a kept candidate went dark, so its absence is a claim too and
// has its own rows.
const isCapDrop = (l) => /lower-priority/.test(l);
function accounting(logs) {
  const l = logs.find((x) => /accounting/.test(x));
  if (!l) return undefined;
  const m = /kept=(\d+)\D+injected=(\d+)\D+no-block=(\d+)/.exec(l);
  assert.ok(m, `the accounting line must report kept, injected and no-block counts; got ${JSON.stringify(l)}`);
  return { line: l, kept: Number(m[1]), injected: Number(m[2]), noBlock: Number(m[3]) };
}
function noBlockNames(logs, names) {
  const found = new Set();
  for (const l of logs) {
    if (isCapDrop(l) || /accounting/.test(l)) continue;
    const m = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(l);
    if (m && !names.includes(m[1])) found.add(m[1]);
  }
  return [...found];
}

// --- Drive resolvePrefill over a scenario. ----------------------------------
// `tree` present on the scenario (even as null) writes it to the record under
// every plausible property name; `tree` absent writes none at all, which is the
// "the resolution handed over no tree" state of contract item 9.
function applyTree(record, tree) {
  record.symbols = tree;
  return record;
}
async function runPrefill(scn) {
  const src = scn.files[scn.mainUri];
  const start = src.indexOf(scn.spanStart);
  assert.ok(start >= 0, `fixture bug: spanStart ${JSON.stringify(scn.spanStart)} not in ${scn.mainUri}`);
  const endIdx = src.indexOf(scn.spanEnd, start);
  assert.ok(endIdx >= 0, `fixture bug: spanEnd ${JSON.stringify(scn.spanEnd)} not after spanStart in ${scn.mainUri}`);
  const record = {
    span: { start, end: endIdx + scn.spanEnd.length },
    signature: scn.signature,
    docComment: scn.docComment,
    symbolName: scn.symbolName,
    languageId: scn.languageId,
    // The GENERATION KIND is a dimension, not a constant. Every row that does
    // not set it gets "function", which is what all the function-target rows
    // below rely on; the type-generation family varies it.
    kind: scn.genKind || "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  if ("tree" in scn) applyTree(record, scn.tree);
  const { ext, calls } = makeExtractor(scn);
  const logs = [];
  globalThis.__V24P1_FILES__ = scn.files;
  let out;
  try {
    out = await resolvePrefill(scn.noExtractor ? undefined : ext, makeDoc(src, scn.mainUri), record, (l) => logs.push(l));
  } finally {
    delete globalThis.__V24P1_FILES__;
  }
  return { out, text: out || "", logs, calls, names: headerTypes(out), injected: injectedCount(logs) };
}
const dump = (r) => `\n  NAMES=${JSON.stringify(r.names)}\n  LOGS=${JSON.stringify(r.logs)}\n  OUT:\n${r.text}`;

// ===========================================================================
// THE FIVE LANGUAGE FIXTURES. One source per language, one tree per language,
// carrying every target shape the contract distinguishes:
//   absorb / Absorb        case A - a receiver in the signature
//   new / create / Create  case B - no receiver, returns the enclosing type
//   from_widget / parse    case B - no receiver, returns it inside a wrapper
//   tally / Tally          case C - no receiver, returns something else
//   clone_owner / Clone    rule 5 - a receiver AND returns the type -> case A
// The enclosing type `Owner` is named nowhere the candidate miner looks; only
// the tree says the target sits inside it.
// ===========================================================================

// Members of `Owner`. A field, the members that can PRODUCE an Owner, and
// ordinary instance methods that cannot. Case A keeps them all; case B keeps the
// field plus the producers and must drop the instance methods.
const OWNER_MEMBERS = {
  rust: [
    F("slots", "slots: u32"),
    M("new", "new(w: Widget) -> Owner"),
    M("from_widget", "from_widget(w: Widget) -> Result<Self, ParseError>"),
    M("with_slots", "with_slots(self, n: u32) -> Self"),
    M("roll_active", "roll_active(&self) -> u64"),
    M("slots_of", "slots_of(&self) -> u32"),
  ],
  csharp: [
    F("Slots", "Slots: int"),
    M("Create", "Create(Widget): Owner"),
    M("Parse", "Parse(Widget): Task<Owner>"),
    M("RollActive", "RollActive(): long"),
    M("SlotsOf", "SlotsOf(): int"),
  ],
  typescript: [
    F("slots", "slots: number"),
    M("create", "create(w: Widget): Owner"),
    M("parse", "parse(w: Widget): Promise<Owner>"),
    M("rollActive", "rollActive(): number"),
    M("slotsOf", "slotsOf(): number"),
  ],
  python: [
    F("slots", "slots: int"),
    M("create", "create(w: Widget) -> Owner"),
    M("parse", "parse(w: Widget) -> Optional[Owner]"),
    M("roll_active", "roll_active(self) -> int"),
    M("slots_of", "slots_of(self) -> int"),
  ],
  go: [
    F("Slots", "Slots: uint32"),
    M("RollActive", "RollActive() uint64"),
    M("SlotsOf", "SlotsOf() uint32"),
  ],
};
const OWNER_FIELD = { rust: "slots: u32", csharp: "Slots: int", typescript: "slots: number", python: "slots: int", go: "Slots: uint32" };

// EVERY RENDERING `Owner`'s ONE FIELD IS ALLOWED TO TAKE, per language.
//
// RE-CUT 2026-08-10, session-v49 phase 1, by the blind non-implementer role.
//
// WHAT THE GO ROWS USED TO ASSERT: that the literal member line `Slots: uint32`
// appeared in the surface. That string is the MEMBER-LIST rendering of the
// field, and until phase 1 it was the only place a Go field could appear at all.
//
// WHY THE MOVE IS A SUPERSESSION AND NOT A DEFECT. Phase 1 lit Go's data-shape
// field leg. A Go type now renders a `Data shape of `Owner`` block carrying its
// declaration verbatim, and the member list sheds EXACTLY the fields that block
// rendered - methods are never touched. So `Slots` did not disappear from the
// prompt: it moved from the member list to the shape block, and changed
// rendering with it, from the member form `Slots: uint32` to Go's own
// declaration form `Slots uint32` inside `type Owner struct { Slots uint32 }`.
// Verified on the captured surface: the shape block carries the field, the
// member list still carries BOTH methods (`RollActive`, `SlotsOf`), and nothing
// is on the drop channel. Information moved; none was lost.
//
// The table exists rather than a rewritten literal because these strings are
// used in NEGATIVE assertions too ("no field of the unresolved type may appear").
// Swapping one literal for the other would have left every negative row checking
// a rendering the product no longer emits - a silent weakening, which is the one
// thing a re-baseline may never do. Checking the whole set makes the positives
// honest about where the field lives and the negatives STRICTER than they were.
const OWNER_FIELD_RENDERS = {
  rust: [OWNER_FIELD.rust],
  csharp: [OWNER_FIELD.csharp],
  typescript: [OWNER_FIELD.typescript],
  python: [OWNER_FIELD.python],
  // member-list form (pre-v49, still the form when no shape block renders for
  // the type) and data-shape form (session-v49 phase 1).
  go: [OWNER_FIELD.go, "Slots uint32"],
};
const hasOwnerField = (text, lang) => OWNER_FIELD_RENDERS[lang].some((s) => text.includes(s));
const noOwnerField = (text, lang) => OWNER_FIELD_RENDERS[lang].every((s) => !text.includes(s));
const PRODUCERS = {
  rust: ["new(", "from_widget(", "with_slots("],
  csharp: ["Create(", "Parse("],
  typescript: ["create(", "parse("],
  python: ["create(", "parse("],
  go: [],
};
const INSTANCE_ONLY = {
  rust: ["roll_active(", "slots_of("],
  csharp: ["RollActive(", "SlotsOf("],
  typescript: ["rollActive(", "slotsOf("],
  python: ["roll_active(", "slots_of("],
  go: ["RollActive(", "SlotsOf("],
};

const RS_URI = "file:///w/v24/cache.rs";
const RS_SRC = `struct Widget {
    mass: u32,
}

struct Owner {
    slots: u32,
}

impl Owner {
    /// Absorb the widget.
    fn absorb(&self, w: Widget) -> u32 {
        todo!()
    }

    /// Build an owner.
    fn new(w: Widget) -> Owner {
        todo!()
    }

    /// Parse an owner.
    fn from_widget(w: Widget) -> Result<Self, ParseError> {
        todo!()
    }

    /// Tally the widget.
    fn tally(w: Widget) -> u32 {
        todo!()
    }

    /// Clone this owner.
    fn clone_owner(&self) -> Owner {
        todo!()
    }
}
`;
const RS_TREE = () => [
  dsym("Widget", SK.Struct, rng(RS_SRC, "struct Widget", "    mass: u32,"), []),
  dsym("Owner", SK.Struct, rng(RS_SRC, "struct Owner", "    slots: u32,"), []),
  dsym("impl Owner", SK.Object, rng(RS_SRC, "impl Owner {"), [
    dsym("absorb", SK.Method, rng(RS_SRC, "fn absorb", "    /// Build an owner."), [], "fn(&self, w: Widget) -> u32"),
    dsym("new", SK.Function, rng(RS_SRC, "fn new", "    /// Parse an owner."), [], "fn(w: Widget) -> Owner"),
    dsym("from_widget", SK.Function, rng(RS_SRC, "fn from_widget", "    /// Tally the widget."), [], "fn(w: Widget) -> Result<Self, ParseError>"),
    dsym("tally", SK.Function, rng(RS_SRC, "fn tally", "    /// Clone this owner."), [], "fn(w: Widget) -> u32"),
    dsym("clone_owner", SK.Method, rng(RS_SRC, "fn clone_owner"), [], "fn(&self) -> Owner"),
  ]),
];

const CS_URI = "file:///w/v24/Owner.cs";
const CS_SRC = `namespace P;

public class Widget
{
    public int Mass;
}

public class Owner
{
    public int Slots;

    /// <summary>Absorb the widget.</summary>
    public int Absorb(Widget w)
    {
        throw new NotImplementedException();
    }

    public static Owner Create(Widget w)
    {
        throw new NotImplementedException();
    }

    public static Task<Owner> Parse(Widget w)
    {
        throw new NotImplementedException();
    }

    public static int Tally(Widget w)
    {
        throw new NotImplementedException();
    }

    public Owner Clone()
    {
        throw new NotImplementedException();
    }
}
`;
const CS_TREE = () => [
  dsym("Widget", SK.Class, rng(CS_SRC, "public class Widget", "    public int Mass;"), []),
  dsym("Owner", SK.Class, rng(CS_SRC, "public class Owner"), [
    dsym("Slots", SK.Field, rng(CS_SRC, "    public int Slots;", "    public int Slots;"), []),
    dsym("Absorb", SK.Method, rng(CS_SRC, "public int Absorb", "    public static Owner Create"), []),
    dsym("Create", SK.Method, rng(CS_SRC, "public static Owner Create", "    public static Task<Owner> Parse"), []),
    dsym("Parse", SK.Method, rng(CS_SRC, "public static Task<Owner> Parse", "    public static int Tally"), []),
    dsym("Tally", SK.Method, rng(CS_SRC, "public static int Tally", "    public Owner Clone"), []),
    dsym("Clone", SK.Method, rng(CS_SRC, "public Owner Clone"), []),
  ]),
];

const TS_URI = "file:///w/v24/owner.ts";
const TS_SRC = `export class Widget {
  mass: number = 0;
}

export class Owner {
  slots: number = 0;

  /** Absorb the widget. */
  absorb(w: Widget): number {
    throw new Error("todo");
  }

  static create(w: Widget): Owner {
    throw new Error("todo");
  }

  static parse(w: Widget): Promise<Owner> {
    throw new Error("todo");
  }

  static tally(w: Widget): number {
    throw new Error("todo");
  }

  clone(): Owner {
    throw new Error("todo");
  }
}
`;
const TS_TREE = () => [
  dsym("Widget", SK.Class, rng(TS_SRC, "export class Widget", "  mass: number = 0;"), []),
  dsym("Owner", SK.Class, rng(TS_SRC, "export class Owner"), [
    dsym("slots", SK.Field, rng(TS_SRC, "  slots: number = 0;", "  slots: number = 0;"), []),
    dsym("absorb", SK.Method, rng(TS_SRC, "absorb(w: Widget)", "  static create"), []),
    dsym("create", SK.Method, rng(TS_SRC, "static create", "  static parse"), []),
    dsym("parse", SK.Method, rng(TS_SRC, "static parse", "  static tally"), []),
    dsym("tally", SK.Method, rng(TS_SRC, "static tally", "  clone()"), []),
    dsym("clone", SK.Method, rng(TS_SRC, "clone()"), []),
  ]),
];

const PY_URI = "file:///w/v24/owner.py";
const PY_SRC = `class Widget:
    mass: int = 0


class Owner:
    slots: int = 0

    def absorb(self, w: Widget) -> int:
        raise NotImplementedError

    @staticmethod
    def create(w: Widget) -> Owner:
        raise NotImplementedError

    @classmethod
    def parse(cls, w: Widget) -> Optional[Owner]:
        raise NotImplementedError

    @staticmethod
    def tally(w: Widget) -> int:
        raise NotImplementedError

    @classmethod
    def build(cls, w: Widget) -> int:
        raise NotImplementedError

    def clone(self) -> Owner:
        raise NotImplementedError
`;
const PY_TREE = () => [
  dsym("Widget", SK.Class, rng(PY_SRC, "class Widget:", "    mass: int = 0"), []),
  dsym("Owner", SK.Class, rng(PY_SRC, "class Owner:"), [
    dsym("slots", SK.Field, rng(PY_SRC, "    slots: int = 0", "    slots: int = 0"), []),
    dsym("absorb", SK.Method, rng(PY_SRC, "def absorb", "    @staticmethod"), []),
    dsym("create", SK.Method, rng(PY_SRC, "def create", "    @classmethod"), []),
    dsym("parse", SK.Method, rng(PY_SRC, "def parse", "    def tally"), []),
    dsym("tally", SK.Method, rng(PY_SRC, "def tally", "    def build"), []),
    dsym("build", SK.Method, rng(PY_SRC, "def build", "    def clone"), []),
    dsym("clone", SK.Method, rng(PY_SRC, "def clone"), []),
  ]),
];

const GO_URI = "file:///w/v24/owner.go";
const GO_SRC = `package store

type Widget struct {
\tMass uint32
}

type Owner struct {
\tSlots uint32
}

// Absorb the widget.
func (o *Owner) Absorb(w Widget) uint32 {
\tpanic("todo")
}

// Tally the widget.
func Tally(w Widget) uint32 {
\tpanic("todo")
}

// NewOwner builds an Owner.
func NewOwner(w Widget) *Owner {
\tpanic("todo")
}
`;
// Go methods are TOP-LEVEL symbols named after their receiver; there is no
// container node to walk into.
const GO_TREE = () => [
  dsym("Widget", SK.Struct, rng(GO_SRC, "type Widget struct", "\tMass uint32"), []),
  dsym("Owner", SK.Struct, rng(GO_SRC, "type Owner struct", "\tSlots uint32"), []),
  dsym("(*Owner).Absorb", SK.Method, rng(GO_SRC, "func (o *Owner) Absorb", "// Tally the widget."), []),
  dsym("Tally", SK.Function, rng(GO_SRC, "func Tally", "// NewOwner builds an Owner."), []),
  dsym("NewOwner", SK.Function, rng(GO_SRC, "func NewOwner"), []),
];

const LANG = {
  rust: {
    uri: RS_URI, src: RS_SRC, tree: RS_TREE,
    defTypes: () => ({
      Owner: { uri: RS_URI, hover: "pub struct Owner { slots: u32 }", members: OWNER_MEMBERS.rust },
      Widget: { uri: RS_URI, hover: "pub struct Widget { mass: u32 }", members: [M("mass_of", "mass_of(&self) -> u32")] },
    }),
    caseA: { spanStart: "fn absorb", spanEnd: "todo!()\n    }", signature: "fn absorb(&self, w: Widget) -> u32", docComment: "/// Absorb the widget.", symbolName: "absorb" },
    caseB: { spanStart: "fn new", spanEnd: "todo!()\n    }", signature: "fn new(w: Widget) -> Owner", docComment: "/// Build an owner.", symbolName: "new" },
    caseBWrapped: { spanStart: "fn from_widget", spanEnd: "todo!()\n    }", signature: "fn from_widget(w: Widget) -> Result<Self, ParseError>", docComment: "/// Parse an owner.", symbolName: "from_widget" },
    caseC: { spanStart: "fn tally", spanEnd: "todo!()\n    }", signature: "fn tally(w: Widget) -> u32", docComment: "/// Tally the widget.", symbolName: "tally" },
    rule5: { spanStart: "fn clone_owner", spanEnd: "todo!()\n    }", signature: "fn clone_owner(&self) -> Owner", docComment: "/// Clone this owner.", symbolName: "clone_owner" },
  },
  csharp: {
    uri: CS_URI, src: CS_SRC, tree: CS_TREE,
    defTypes: () => ({
      Owner: { uri: CS_URI, hover: "class Owner", members: OWNER_MEMBERS.csharp },
      Widget: { uri: CS_URI, hover: "class Widget", members: [M("MassOf", "MassOf(): int")] },
    }),
    caseA: { spanStart: "public int Absorb", spanEnd: "throw new NotImplementedException();", signature: "public int Absorb(Widget w)", docComment: "/// <summary>Absorb the widget.</summary>", symbolName: "Absorb" },
    caseB: { spanStart: "public static Owner Create", spanEnd: "throw new NotImplementedException();", signature: "public static Owner Create(Widget w)", docComment: undefined, symbolName: "Create" },
    caseBWrapped: { spanStart: "public static Task<Owner> Parse", spanEnd: "throw new NotImplementedException();", signature: "public static Task<Owner> Parse(Widget w)", docComment: undefined, symbolName: "Parse" },
    caseC: { spanStart: "public static int Tally", spanEnd: "throw new NotImplementedException();", signature: "public static int Tally(Widget w)", docComment: undefined, symbolName: "Tally" },
    rule5: { spanStart: "public Owner Clone", spanEnd: "throw new NotImplementedException();", signature: "public Owner Clone()", docComment: undefined, symbolName: "Clone" },
  },
  typescript: {
    uri: TS_URI, src: TS_SRC, tree: TS_TREE,
    defTypes: () => ({
      Owner: { uri: TS_URI, hover: "class Owner", members: OWNER_MEMBERS.typescript },
      Widget: { uri: TS_URI, hover: "class Widget", members: [M("massOf", "massOf(): number")] },
    }),
    caseA: { spanStart: "absorb(w: Widget)", spanEnd: `throw new Error("todo");`, signature: "absorb(w: Widget): number", docComment: "/** Absorb the widget. */", symbolName: "absorb" },
    caseB: { spanStart: "static create", spanEnd: `throw new Error("todo");`, signature: "static create(w: Widget): Owner", docComment: undefined, symbolName: "create" },
    caseBWrapped: { spanStart: "static parse", spanEnd: `throw new Error("todo");`, signature: "static parse(w: Widget): Promise<Owner>", docComment: undefined, symbolName: "parse" },
    caseC: { spanStart: "static tally", spanEnd: `throw new Error("todo");`, signature: "static tally(w: Widget): number", docComment: undefined, symbolName: "tally" },
    rule5: { spanStart: "clone(): Owner", spanEnd: `throw new Error("todo");`, signature: "clone(): Owner", docComment: undefined, symbolName: "clone" },
  },
  python: {
    uri: PY_URI, src: PY_SRC, tree: PY_TREE,
    defTypes: () => ({
      Owner: { uri: PY_URI, hover: "class Owner", members: OWNER_MEMBERS.python },
      Widget: { uri: PY_URI, hover: "class Widget", members: [M("mass_of", "mass_of(self) -> int")] },
    }),
    caseA: { spanStart: "def absorb", spanEnd: "raise NotImplementedError", signature: "def absorb(self, w: Widget) -> int", docComment: undefined, symbolName: "absorb" },
    caseB: { spanStart: "def create", spanEnd: "raise NotImplementedError", signature: "def create(w: Widget) -> Owner", docComment: undefined, symbolName: "create" },
    caseBWrapped: { spanStart: "def parse", spanEnd: "raise NotImplementedError", signature: "def parse(cls, w: Widget) -> Optional[Owner]", docComment: undefined, symbolName: "parse" },
    caseC: { spanStart: "def tally", spanEnd: "raise NotImplementedError", signature: "def tally(w: Widget) -> int", docComment: undefined, symbolName: "tally" },
    caseC2: { spanStart: "def build", spanEnd: "raise NotImplementedError", signature: "def build(cls, w: Widget) -> int", docComment: undefined, symbolName: "build" },
    rule5: { spanStart: "def clone", spanEnd: "raise NotImplementedError", signature: "def clone(self) -> Owner", docComment: undefined, symbolName: "clone" },
  },
  go: {
    uri: GO_URI, src: GO_SRC, tree: GO_TREE,
    defTypes: () => ({
      Owner: { uri: GO_URI, hover: "type Owner struct { Slots uint32 }", members: OWNER_MEMBERS.go },
      Widget: { uri: GO_URI, hover: "type Widget struct { Mass uint32 }", members: [M("MassOf", "MassOf() uint32")] },
    }),
    caseA: { spanStart: "func (o *Owner) Absorb", spanEnd: `panic("todo")`, signature: "func (o *Owner) Absorb(w Widget) uint32", docComment: "// Absorb the widget.", symbolName: "Absorb" },
    caseC: { spanStart: "func Tally", spanEnd: `panic("todo")`, signature: "func Tally(w Widget) uint32", docComment: "// Tally the widget.", symbolName: "Tally" },
    caseCNew: { spanStart: "func NewOwner", spanEnd: `panic("todo")`, signature: "func NewOwner(w Widget) *Owner", docComment: "// NewOwner builds an Owner.", symbolName: "NewOwner" },
  },
};

// Build a runnable scenario from the language table.
function scenario(lang, target, opts = {}) {
  const L = LANG[lang];
  const s = {
    languageId: lang,
    mainUri: L.uri,
    files: { [L.uri]: L.src },
    defTypes: L.defTypes(),
    ...L[target],
    ...opts,
  };
  if (!("tree" in opts)) s.tree = L.tree();
  return s;
}

const LANGS = ["rust", "csharp", "typescript", "python", "go"];
// Case B needs a member that can produce the type. Go has none: its only route
// to an enclosing type is a receiver clause, which is case A by definition.
const CASE_B_LANGS = ["rust", "csharp", "typescript", "python"];

// ===========================================================================
// CASE A - a receiver in the signature means the target CALLS INTO a value, so
// the enclosing type's FIELDS and METHODS are injected, first.
//
// These rows are PINS, not red rows: the contract says case A's surface is
// unchanged from the old design, and today's text scanner produces it. What
// makes them cheat-proof is the tree-degrade family immediately below, which
// runs the identical fixture with the tree removed.
// ===========================================================================

for (const lang of LANGS) {
  btest(`case A [${lang}]: a receiver in the signature injects the enclosing type's fields AND methods, first`, async () => {
    const r = await runPrefill(scenario(lang, "caseA"));
    assert.strictEqual(r.names[0], "Owner", `the enclosing type leads at a receiver target.${dump(r)}`);
    // RE-CUT 2026-08-10, session-v49 phase 1: "the field is in the surface"
    // rather than "the field is in the member list". See OWNER_FIELD_RENDERS.
    assert.ok(hasOwnerField(r.text, lang), `case A carries the type's FIELDS, wherever the language renders them.${dump(r)}`);
    for (const m of INSTANCE_ONLY[lang]) {
      assert.ok(r.text.includes(m), `case A carries every method, including the instance method ${m}.${dump(r)}`);
    }
    // GO, SESSION-V49 PHASE 1: the render decision, pinned rather than tolerated.
    // The shape block ships the field and the member list SHEDS it, so the same
    // bytes are never printed twice. If the field ever came back as a member
    // line while the shape block also rendered it, that is the duplication the
    // decision exists to prevent and this row is where it shows up.
    if (lang === "go") {
      assert.ok(r.text.includes("Data shape of `Owner`"), `go renders a data-shape block for the receiver.${dump(r)}`);
      assert.ok(r.text.includes("Slots uint32"), `and the block carries the field in go's own declaration form.${dump(r)}`);
      assert.ok(
        !r.text.includes(OWNER_FIELD.go),
        `and the member list sheds the field the shape block rendered - one field, one place.${dump(r)}`,
      );
    }
    for (const m of PRODUCERS[lang]) {
      assert.ok(r.text.includes(m), `case A carries the producing members too - it is the fuller surface.${dump(r)}`);
    }
    assert.ok(r.names.includes("Widget"), `the signature-named candidate survives alongside the receiver.${dump(r)}`);
  });
}

// ===========================================================================
// THE TREE IS THE ONLY ROUTE (contract items 6, 7, 9). The identical case-A
// fixture - same text, same signature, same extractor - with a tree that is
// absent, null, empty, flat, or garbage. Every one must inject NOTHING for the
// enclosing type. An implementation that reads the container out of file text
// passes the rows above and fails all of these.
//
// The flat shape is SymbolInformation[] (a `location`, no `range`, no
// `children`), the non-hierarchical form the resolver already rejects.
//
// GO IS EXEMPT, and has its own family below. Item 9 now says so explicitly: Go's
// signature carries the receiver AND its type in one clause, so a Go receiver
// resolves with no tree present at all. What item 6 forbids is reading a
// container out of raw FILE TEXT, and the resolved signature is neither raw nor
// file text - it is what resolution already returned. So this family covers the
// four languages whose resolution genuinely needs the tree.
// ===========================================================================

const FLAT_TREE = [{ name: "impl Owner", kind: SK.Object, location: { uri: RS_URI, range: new V.Range(0, 0, 99, 0) } }];
const TREE_DEGRADES = [
  { why: "the resolution handed over NO tree at all", omit: true },
  { why: "the tree is null", tree: null },
  { why: "the tree is empty", tree: [] },
  { why: "the tree is the flat non-hierarchical shape", tree: FLAT_TREE },
  { why: "the tree is not a symbol shape at all", tree: { not: "symbols" } },
];

for (const lang of ["rust", "csharp", "typescript", "python"]) {
  for (const d of TREE_DEGRADES) {
    btest(`tree is the only route [${lang}]: when ${d.why}, NO enclosing type is injected (honest degrade, never a guess from file text)`, async () => {
      const scn = scenario(lang, "caseA", d.omit ? {} : { tree: d.tree });
      if (d.omit) delete scn.tree;
      const r = await runPrefill(scn);
      assert.ok(
        !r.names.includes("Owner"),
        `with no usable tree the enclosing type is unknowable; injecting it means it was read out of file text, ` +
          `which this contract forbids outright.${dump(r)}`,
      );
      assert.ok(noOwnerField(r.text, lang), `no field of the unresolved enclosing type may appear, in ANY rendering.${dump(r)}`);
      assert.deepStrictEqual(
        r.logs.filter((l) => /\bOwner\b/.test(l) && !/accounting/.test(l)),
        [],
        `no evidence line may claim a receiver that was never resolved.${dump(r)}`,
      );
      assert.ok(r.names.includes("Widget"), `the ordinary signature-named candidate is unaffected.${dump(r)}`);
    });
  }
}

// GO IS THE EXCEPTION, and it is the whole reason item 9 had to say so. Its
// signature carries the receiver AND the receiver's type in one clause, so
// detection and resolution both come from the record, and no tree is needed for
// either. The measurement records the payoff: gopls drops the method symbol
// entirely when a struct declaration above it is mid-edit, and Go is
// regression-free anyway because it never reads the tree.
for (const d of TREE_DEGRADES) {
  btest(`go is exempt from the tree: when ${d.why}, the receiver STILL resolves from the signature's own receiver clause`, async () => {
    const scn = scenario("go", "caseA", d.omit ? {} : { tree: d.tree });
    if (d.omit) delete scn.tree;
    const r = await runPrefill(scn);
    assert.strictEqual(
      r.names[0],
      "Owner",
      `\`func (o *Owner) Absorb(...)\` names its own receiver type; the tree is not consulted and its state is irrelevant.${dump(r)}`,
    );
    // RE-CUT 2026-08-10, session-v49 phase 1. It used to read the member line
    // `Slots: uint32`; the field now ships inside the type's data-shape block as
    // `Slots uint32`. Nothing about the TREE-EXEMPTION claim moved - the
    // receiver still resolves from the signature's own clause with no tree at
    // all - so this is a rendering supersession, not a defect. See
    // OWNER_FIELD_RENDERS. The methods are asserted separately below and they
    // stay in the member list, which is what proves the shed is field-only.
    assert.ok(hasOwnerField(r.text, "go"), `the resolved receiver carries its fields, wherever they render.${dump(r)}`);
    for (const m of INSTANCE_ONLY.go) assert.ok(r.text.includes(m), `and its methods - this is an ordinary case A.${dump(r)}`);
  });
}

// ===========================================================================
// CASE B - no receiver, but the return type NAMES the enclosing type or Self.
// The target BUILDS one, so the surface is the type's FIELDS plus only the
// members that can produce it. Ordinary instance methods are noise here and
// cost contended budget.
// ===========================================================================

for (const lang of CASE_B_LANGS) {
  btest(`case B [${lang}]: a return type naming the enclosing type injects its fields plus ONLY the producing members`, async () => {
    const r = await runPrefill(scenario(lang, "caseB"));
    assert.strictEqual(r.names[0], "Owner", `a construction target still leads with the type it builds.${dump(r)}`);
    assert.ok(r.text.includes(OWNER_FIELD[lang]), `case B carries the type's FIELDS - that is what a constructor must fill.${dump(r)}`);
    for (const m of PRODUCERS[lang]) {
      assert.ok(r.text.includes(m), `the producing member ${m} must be offered at a construction target.${dump(r)}`);
    }
    for (const m of INSTANCE_ONLY[lang]) {
      assert.ok(
        !r.text.includes(m),
        `the ordinary instance method ${m} is noise at a construction target and must NOT be injected - ` +
          `today the full method surface goes in regardless.${dump(r)}`,
      );
    }
  });

  btest(`case B [${lang}]: a return type naming the type INSIDE A WRAPPER is still a construction target`, async () => {
    const r = await runPrefill(scenario(lang, "caseBWrapped"));
    assert.strictEqual(
      r.names[0],
      "Owner",
      `the rule is that the return type NAMES the type or Self, not that it equals it - ` +
        `\`Result<Self, E>\`, \`Task<Owner>\`, \`Promise<Owner>\`, \`Optional[Owner]\` are the common constructor shape.${dump(r)}`,
    );
    assert.ok(r.text.includes(OWNER_FIELD[lang]), `the wrapped-return construction target still gets the fields.${dump(r)}`);
    for (const m of INSTANCE_ONLY[lang]) {
      assert.ok(!r.text.includes(m), `still the narrow surface: ${m} is an instance method.${dump(r)}`);
    }
  });
}

// Python's `cls` is explicitly NOT a receiver, so a classmethod reaches case B
// through its RETURN TYPE alone. Pinned separately because it is the one place a
// receiver-shaped first parameter must not be read as one.
btest("case B [python]: a `@classmethod` reaches case B through its return type, never through `cls`", async () => {
  const r = await runPrefill(scenario("python", "caseBWrapped"));
  assert.strictEqual(r.names[0], "Owner", `\`def parse(cls, w: Widget) -> Optional[Owner]\` is a construction target.${dump(r)}`);
  for (const m of INSTANCE_ONLY.python) {
    assert.ok(!r.text.includes(m), `case B is the narrow surface even when the first parameter is \`cls\`.${dump(r)}`);
  }
});

// ===========================================================================
// CASE C - neither a receiver nor a return type naming the type. Nothing is
// injected for the enclosing type, and no evidence line claims one.
//
// This is a straight INVERSION of what the old contract pinned. The previous
// version of this file carried eight rows labelled "OPEN HUMAN DECISION" that
// pinned a static utility function getting its class's siblings in the first
// prompt slot. The human has decided: it does not. The framing is settled and
// gone; these rows assert the opposite of what those did.
// ===========================================================================

// The precise statement of case C is "the enclosing-type path contributed
// NOTHING", not "the type never appears". A type can still be an ordinary
// ranked candidate when the signature names it - `func NewOwner(w Widget)
// *Owner` names Owner in its return type, and mining it from there is the
// candidate path doing its ordinary job. So every row asserts:
//   * no evidence line claims a receiver, and
//   * the surface is byte-identical to the same run with NO tree at all, which
//     is the only state where the enclosing-type path is provably inert.
// `ownerNotMinable` marks the rows whose signature does not name the type, where
// the stronger "Owner must not appear at all" is also true.
const CASE_C_ROWS = [
  { lang: "rust", target: "caseC", what: "an associated function returning `u32`", ownerNotMinable: true },
  { lang: "csharp", target: "caseC", what: "a `static` method returning `int`", ownerNotMinable: true },
  { lang: "typescript", target: "caseC", what: "a `static` method returning `number`", ownerNotMinable: true },
  { lang: "python", target: "caseC", what: "a `@staticmethod` returning `int`", ownerNotMinable: true },
  { lang: "python", target: "caseC2", what: "a `@classmethod` returning `int` (`cls` is not a receiver)", ownerNotMinable: true },
  { lang: "go", target: "caseC", what: "a `func` with no receiver clause", ownerNotMinable: true },
  // Go's `func NewOwner(w Widget) *Owner` reads like a constructor and its
  // return type names Owner, but Go has no container node: the only route from
  // the tree to an enclosing type is a receiver clause, and this function has
  // none. So it is case C, not case B - case B is structurally unreachable in
  // Go. Owner still shows up here, as an ordinary return-type candidate.
  { lang: "go", target: "caseCNew", what: "`func NewOwner(w Widget) *Owner` - a package-level constructor with no container node", ownerNotMinable: false },
];

for (const c of CASE_C_ROWS) {
  btest(`case C [${c.lang}]: ${c.what} gets NO enclosing-type block and no evidence line claiming one`, async () => {
    const r = await runPrefill(scenario(c.lang, c.target));
    assert.deepStrictEqual(
      r.logs.filter((l) => /\bOwner\b/.test(l) && !/accounting/.test(l)),
      [],
      `a utility function neither calls into the type nor builds one, so nothing may claim a receiver.${dump(r)}`,
    );
    // Byte-identical to the run where the enclosing-type path has nothing to
    // work with at all: that is what "contributed nothing" means from outside.
    const bare = scenario(c.lang, c.target);
    delete bare.tree;
    const b = await runPrefill(bare);
    assert.strictEqual(
      r.out,
      b.out,
      `the enclosing-type path must contribute nothing at a case-C target - its surface must equal the no-tree surface.` +
        `\n  WITH TREE:\n${r.text}\n  WITHOUT TREE:\n${b.text}`,
    );
    if (c.ownerNotMinable) {
      assert.ok(!r.names.includes("Owner"), `the signature does not name the type, so it must not appear at all.${dump(r)}`);
      assert.ok(noOwnerField(r.text, c.lang), `no field of the enclosing type may leak into a case-C surface, in ANY rendering.${dump(r)}`);
    }
    assert.ok(r.names.includes("Widget"), `the ordinary signature-named candidate is unaffected.${dump(r)}`);
  });
}

// ===========================================================================
// RULE 5 - a target with a receiver AND a return type naming the enclosing type
// takes CASE A. The fuller surface wins; the two are never merged.
// ===========================================================================

for (const lang of CASE_B_LANGS) {
  btest(`rule 5 [${lang}]: a receiver AND a return naming the type takes case A - the fuller surface, not the narrow one`, async () => {
    const r = await runPrefill(scenario(lang, "rule5"));
    assert.strictEqual(r.names[0], "Owner", `the enclosing type leads.${dump(r)}`);
    for (const m of INSTANCE_ONLY[lang]) {
      assert.ok(r.text.includes(m), `case A wins outright: the instance method ${m} must be present, which case B would have dropped.${dump(r)}`);
    }
    for (const m of PRODUCERS[lang]) {
      assert.ok(r.text.includes(m), `and the producing members stay - no merge, no subtraction.${dump(r)}`);
    }
  });
}

// ===========================================================================
// THE RUST IMPL-HEADER FORMS. The tree reports an `impl` block as an untyped
// object symbol whose NAME carries the header; the self type is the receiver.
// Trait impls, generics and path-qualified headers all resolve from that name,
// and none of it involves reading file text.
// ===========================================================================

const IMPL_HEADERS = [
  { header: "impl Persist for Owner", why: "a trait impl resolves to the self type, never the trait" },
  { header: "impl<T> Owner<T>", why: "generic parameters are stripped" },
  { header: "impl<T: Into<String>> Owner<T>", why: "an arrow-free bound with nested generics is still just a header" },
  // `impl crate::store::Owner` is NOT here. It does not resolve today, on
  // purpose, and it has its own row below pinning how it degrades.
];

// Text and tree agree, as they do in a real editor; only the tree is consulted.
const implHeaderScn = (header) => {
  const uri = `file:///w/v24/impl-${header.replace(/[^A-Za-z]+/g, "-")}.rs`;
  const src = `struct Widget {
    mass: u32,
}

struct Owner {
    slots: u32,
}

${header} {
    /// Absorb the widget.
    fn absorb(&self, w: Widget) -> u32 {
        todo!()
    }
}
`;
  return {
    languageId: "rust", mainUri: uri, files: { [uri]: src },
    defTypes: {
      Owner: { uri, hover: "pub struct Owner { slots: u32 }", members: [F("slots", "slots: u32"), M("roll_active", "roll_active(&self) -> u64")] },
      Widget: { uri, hover: "pub struct Widget { mass: u32 }", members: [M("mass_of", "mass_of(&self) -> u32")] },
    },
    tree: [
      dsym("Widget", SK.Struct, rng(src, "struct Widget", "    mass: u32,"), []),
      dsym("Owner", SK.Struct, rng(src, "struct Owner", "    slots: u32,"), []),
      dsym(header, SK.Object, rng(src, header), [dsym("absorb", SK.Method, rng(src, "fn absorb"), [])]),
    ],
    spanStart: "fn absorb", spanEnd: "todo!()\n    }",
    signature: "fn absorb(&self, w: Widget) -> u32", docComment: "/// Absorb the widget.", symbolName: "absorb",
  };
};

for (const h of IMPL_HEADERS) {
  btest(`impl header [rust]: \`${h.header}\` resolves the receiver to \`Owner\` - ${h.why}`, async () => {
    const r = await runPrefill(implHeaderScn(h.header));
    assert.strictEqual(r.names[0], "Owner", `${h.why}.${dump(r)}`);
    assert.ok(!r.names.includes("Persist"), `a trait is never the receiver.${dump(r)}`);
    assert.ok(r.text.includes("roll_active("), `the resolved receiver carries its member surface.${dump(r)}`);
  });
}

// ---------------------------------------------------------------------------
// RECORDED DEGRADE, NOT ENDORSED: a PATH-QUALIFIED impl header does not resolve.
//
// `impl crate::store::Owner` reduces to the name `Owner`, but the anchor sits on
// `crate` - the first segment of the path, which is where the selection range
// starts. The strict name-vs-anchor agreement check therefore refuses it, and
// refusing is the check WORKING: the identifier under the anchor genuinely is
// not the resolved name, and shipping whatever sits at that anchor under an
// `Owner` header is precisely the confidently-wrong surface the check exists to
// prevent. The trade was accepted in writing by the triage that ordered the
// strict check, before it was seen to fire.
//
// This row is here rather than left red because a permanently failing row in a
// frozen contract file asserts NOTHING. It cannot tell today's cheap miss apart
// from a future regression that ships `crate`'s or `store`'s members under
// `Owner`'s header - both leave it red. Pinned, it becomes a real test of the
// property that makes the degrade acceptable: when this fails, it fails CHEAP.
// Same treatment, same reasoning, as the accepted Python mid-edit regression
// above.
//
// WHAT WOULD MAKE IT RESOLVE AGAIN, named by the reviewer and deliberately not
// implemented: widen the agreement test to accept an identifier that is a
// SEGMENT of the same path expression the resolved name came from, rather than
// requiring token equality. That is a real option for a later session, not a
// mystery. If you implement it, this row goes red - update it deliberately, and
// do not weaken the agreement check to make it pass.
// ---------------------------------------------------------------------------

btest("impl header [rust] RECORDED DEGRADE: `impl crate::store::Owner` does not resolve, and fails in the CHEAP direction", async () => {
  const r = await runPrefill(implHeaderScn("impl crate::store::Owner"));

  // 1. The receiver IS detected, and 2. it IS claimed as first. Detection and
  // resolution are separate steps; only the second one degrades.
  const detection = r.logs.filter((l) => /\bOwner\b/.test(l) && RECEIVER_WORDS.test(l) && !/accounting/.test(l));
  assert.ok(detection.length >= 1, `the receiver must still be DETECTED - the signature and the tree both say so.${dump(r)}`);
  assert.ok(detection.some((l) => FIRST_WORDS.test(l)), `and still claimed first; it is resolution that degrades, not detection.${dump(r)}`);

  // 3. It injects no block.
  assert.ok(!r.names.includes("Owner"), `the anchor disagrees with the name, so the shape is refused rather than guessed.${dump(r)}`);

  // 4. The drop is accounted honestly: a named line with a reason, and the
  // candidate arithmetic balances. A silent miss would be a different defect.
  const drops = r.logs.filter((l) => /\bOwner\b/.test(l) && !isCapDrop(l) && !/accounting/.test(l) && REASON_WORDS.test(l));
  assert.ok(drops.length >= 1, `a kept candidate that produced no block owes a line naming it and a reason.${dump(r)}`);
  assertAccountingAddsUp(r);

  // 5. THE LOAD-BEARING ONE. No foreign members reach the prompt, and nothing
  // ships under a header that does not own it. This is what a red row could
  // never have protected, and it is the whole point of the check.
  assert.deepStrictEqual(r.names, ["Widget"], `only the legitimate signature-named candidate is injected.${dump(r)}`);
  assert.ok(!r.text.includes("roll_active("), `Owner's members must not appear without an Owner block to own them.${dump(r)}`);
  for (const foreign of ["crate", "store"]) {
    assert.ok(!new RegExp(`\\b${foreign}\\b`).test(r.text), `no path segment may be mistaken for a type and injected.${dump(r)}`);
  }
});

// ===========================================================================
// ORDERING, BUDGET AND DEDUP (contract items 11, 12, 17). Carried forward.
// ===========================================================================

const CAP_URI = "file:///w/v24/cap.rs";
// NINE candidate types, not five (session-v48 phase 1). The root cap is the
// context dial's now: the install default (`small`) admits 8, so a five-type
// fixture cannot make the cap bind and both rows below would pass while
// measuring nothing. The SUBJECT is unchanged - one more candidate than the cap
// admits, so eviction is observable.
const CAP_TYPES = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9"];
const CAP_PARAMS = CAP_TYPES.map((t, i) => `${"abcdefghi"[i]}: ${t}`).join(", ");
const CAP_SRC = `struct Owner {
    slots: u32,
}

${CAP_TYPES.map((t, i) => `struct ${t} { ${"abcdefghi"[i]}: u32 }`).join("\n")}

impl Owner {
    /// Fold everything.
    fn fold(&self, ${CAP_PARAMS}) -> u32 {
        todo!()
    }
}

/// Fold everything.
fn free_fold(${CAP_PARAMS}) -> u32 {
    todo!()
}
`;
const CAP_DEFS = () => {
  const d = { Owner: { uri: CAP_URI, hover: "pub struct Owner { slots: u32 }", members: [F("slots", "slots: u32"), M("roll_active", "roll_active(&self) -> u64")] } };
  for (const n of CAP_TYPES) d[n] = { uri: CAP_URI, hover: `pub struct ${n} { x: u32 }`, members: [M(`m_${n}`, `m_${n}(&self) -> u32`)] };
  return d;
};
const CAP_TREE = () => [
  dsym("Owner", SK.Struct, rng(CAP_SRC, "struct Owner", "    slots: u32,"), []),
  dsym("impl Owner", SK.Object, rng(CAP_SRC, "impl Owner {", "/// Fold everything.\nfn free_fold"), [
    dsym("fold", SK.Method, rng(CAP_SRC, "fn fold", "/// Fold everything.\nfn free_fold"), []),
  ]),
  dsym("free_fold", SK.Function, rng(CAP_SRC, "fn free_fold"), []),
];
const capScn = (target) => {
  const base = { languageId: "rust", mainUri: CAP_URI, files: { [CAP_URI]: CAP_SRC }, defTypes: CAP_DEFS(), tree: CAP_TREE(), docComment: "/// Fold everything." };
  return target === "method"
    ? { ...base, spanStart: "fn fold", spanEnd: "todo!()\n    }", signature: `fn fold(&self, ${CAP_PARAMS}) -> u32`, symbolName: "fold" }
    : { ...base, spanStart: "fn free_fold", spanEnd: "todo!()\n}", signature: `fn free_fold(${CAP_PARAMS}) -> u32`, symbolName: "free_fold" };
};

btest("item 12 [rust]: the receiver takes the first slot of the EXISTING cap - the block count does not grow", async () => {
  const free = await runPrefill(capScn("free"));
  const meth = await runPrefill(capScn("method"));
  assert.ok(free.names.length >= 2 && free.names.length < CAP_TYPES.length, `fixture precondition: the cap must BIND on the free run; got ${free.names.length}.${dump(free)}`);
  assert.strictEqual(meth.names[0], "Owner", `the receiver leads at the method target.${dump(meth)}`);
  assert.ok(meth.names.length <= free.names.length, `the receiver must not raise the cap: free=${free.names.length} method=${meth.names.length}.\n  FREE=${JSON.stringify(free.names)}\n  METHOD=${JSON.stringify(meth.names)}`);
  const displaced = free.names.filter((n) => !meth.names.includes(n));
  assert.ok(displaced.length >= 1, `cap eviction removes a whole block - one of the two displacement costs the measurement must carry.\n  FREE=${JSON.stringify(free.names)}\n  METHOD=${JSON.stringify(meth.names)}`);
});

// RE-CUT by session-v48 phase 1 (docs/supersessions.md). The row used to read
// "no cap constant moves ... exactly four": the cap WAS a constant and 4 was its
// value. It is now the context dial's `rootCap`, and the install default
// (`small`) admits 8. What the row is FOR is unchanged - the cap binds, the
// count is exactly the cap, and the evicted candidate is named on the channel -
// so the number is read from the seam rather than written down as a literal.
btest("item 17 [rust]: the free-function run admits exactly the stop's root cap and names the evicted one", async () => {
  const free = await runPrefill(capScn("free"));
  assert.strictEqual(free.names.length, ROOT_CAP_AT_DEFAULT, `the type cap admits the stop's root count; a changed count means the dial moved.${dump(free)}`);
  const evicted = CAP_TYPES[CAP_TYPES.length - 1];
  assert.ok(free.logs.some((l) => isCapDrop(l) && new RegExp(`\\b${evicted}\\b`).test(l)), `the lowest-ranked candidate is evicted and named.${dump(free)}`);
});

btest("item 12 [rust]: a receiver also named in the signature appears exactly once, in first position", async () => {
  const uri = "file:///w/v24/dedup.rs";
  const src = `struct Widget {
    mass: u32,
}

struct Owner {
    slots: u32,
}

impl Owner {
    /// Merge the other owner in.
    fn merge(&self, w: Widget, other: &Owner) -> u32 {
        todo!()
    }
}
`;
  const r = await runPrefill({
    languageId: "rust", mainUri: uri, files: { [uri]: src },
    defTypes: {
      Owner: { uri, hover: "pub struct Owner { slots: u32 }", members: [F("slots", "slots: u32"), M("roll_active", "roll_active(&self) -> u64")] },
      Widget: { uri, hover: "pub struct Widget { mass: u32 }", members: [M("mass_of", "mass_of(&self) -> u32")] },
    },
    tree: [
      dsym("Widget", SK.Struct, rng(src, "struct Widget", "    mass: u32,"), []),
      dsym("Owner", SK.Struct, rng(src, "struct Owner", "    slots: u32,"), []),
      dsym("impl Owner", SK.Object, rng(src, "impl Owner {"), [dsym("merge", SK.Method, rng(src, "fn merge"), [])]),
    ],
    spanStart: "fn merge", spanEnd: "todo!()\n    }",
    signature: "fn merge(&self, w: Widget, other: &Owner) -> u32", docComment: "/// Merge the other owner in.", symbolName: "merge",
  });
  assert.strictEqual(r.names[0], "Owner", `the receiver leads even when it is ALSO a lower-ranked signature candidate.${dump(r)}`);
  assert.strictEqual(headerCount(r.text, "Owner"), headerCount(r.text, "Widget"), `one candidate, one set of blocks: Owner=${headerCount(r.text, "Owner")} Widget=${headerCount(r.text, "Widget")}.${dump(r)}`);
  assert.strictEqual(r.injected, r.names.length, `the injected-type count must equal the distinct injected types.${dump(r)}`);
  assert.strictEqual(r.names.length, 2, `exactly two distinct types are injectable here.${dump(r)}`);
});

btest("item 12 [rust]: a bulky sibling consuming the shared data-shape budget cannot starve the receiver's field list", async () => {
  const uri = "file:///w/v24/bulky.rs";
  const src = `struct Bulky {
    x: u32,
}

struct Owner {
    slots: u32,
}

impl Owner {
    /// Absorb the bulk.
    fn absorb(&self, b: Bulky) -> u32 {
        todo!()
    }
}
`;
  const bulkyHover = "pub struct Bulky { " + Array.from({ length: 120 }, (_, i) => `f${i}: u64`).join(", ") + " }";
  const r = await runPrefill({
    languageId: "rust", mainUri: uri, files: { [uri]: src },
    defTypes: {
      Bulky: { uri, hover: bulkyHover, members: [M("bulk_of", "bulk_of(&self) -> u32")] },
      Owner: { uri, hover: "pub struct Owner { slots: u32 }", members: [F("slots", "slots: u32"), M("roll_active", "roll_active(&self) -> u64")] },
    },
    tree: [
      dsym("Bulky", SK.Struct, rng(src, "struct Bulky", "    x: u32,"), []),
      dsym("Owner", SK.Struct, rng(src, "struct Owner", "    slots: u32,"), []),
      dsym("impl Owner", SK.Object, rng(src, "impl Owner {"), [dsym("absorb", SK.Method, rng(src, "fn absorb"), [])]),
    ],
    spanStart: "fn absorb", spanEnd: "todo!()\n    }",
    signature: "fn absorb(&self, b: Bulky) -> u32", docComment: "/// Absorb the bulk.", symbolName: "absorb",
  });
  assert.strictEqual(r.names[0], "Owner", `the receiver leads, so it is served from the shared budget first.${dump(r)}`);
  assert.ok(r.text.includes("slots"), `shared-budget starvation removes a field list - the receiver's must survive.${dump(r)}`);
  assert.ok(r.text.includes("roll_active("), `and its member surface survives too.${dump(r)}`);
});

btest("item 12 [rust]: a sibling whose nested walk reaches the receiver cannot consume it via the shared visited set", async () => {
  const uri = "file:///w/v24/nested.rs";
  const src = `struct Owner {
    slots: u32,
}

struct Widget {
    owner: Owner,
}

impl Owner {
    /// Absorb the widget.
    fn absorb(&self, w: Widget) -> u32 {
        todo!()
    }
}
`;
  const r = await runPrefill({
    languageId: "rust", mainUri: uri, files: { [uri]: src },
    defTypes: {
      Owner: { uri, hover: "pub struct Owner { slots: u32 }", members: [F("slots", "slots: u32"), M("roll_active", "roll_active(&self) -> u64")] },
      Widget: { uri, hover: "pub struct Widget { owner: Owner }", members: [M("mass_of", "mass_of(&self) -> u32")] },
    },
    tree: [
      dsym("Owner", SK.Struct, rng(src, "struct Owner", "    slots: u32,"), []),
      dsym("Widget", SK.Struct, rng(src, "struct Widget", "    owner: Owner,"), []),
      dsym("impl Owner", SK.Object, rng(src, "impl Owner {"), [dsym("absorb", SK.Method, rng(src, "fn absorb"), [])]),
    ],
    spanStart: "fn absorb", spanEnd: "todo!()\n    }",
    signature: "fn absorb(&self, w: Widget) -> u32", docComment: "/// Absorb the widget.", symbolName: "absorb",
  });
  assert.strictEqual(r.names[0], "Owner", `the receiver needs its own leading block, not a nested mention inside the sibling's shape.${dump(r)}`);
  assert.ok(r.text.includes("roll_active("), `nesting carries a shape but never a member surface.${dump(r)}`);
});

// ===========================================================================
// RESOLUTION CROSSES FILES. The tree gives the enclosing type's NAME; resolving
// its shape and members is the ordinary cross-file walk, so a receiver whose
// declaration lives in another file still resolves.
// ===========================================================================

btest("resolution [rust]: a receiver whose struct is declared in ANOTHER file resolves from the tree's impl name", async () => {
  const consumer = "file:///w/v24/consumer.rs";
  const store = "file:///w/v24/store.rs";
  const consumerSrc = `impl Remote {
    /// Absorb the widget.
    fn absorb(&self, w: Widget) -> u32 {
        todo!()
    }
}
`;
  const storeSrc = `pub struct Remote {
    pub slots: u32,
}

pub struct Widget {
    pub mass: u32,
}
`;
  assert.ok(!/use .*Remote/.test(consumerSrc), "fixture: Remote is not on an import line");
  assert.ok(!/(struct|type|class)\s+Remote/.test(consumerSrc), "fixture: Remote is not declared in this file");
  const r = await runPrefill({
    languageId: "rust", mainUri: consumer, files: { [consumer]: consumerSrc, [store]: storeSrc },
    defTypes: {
      Remote: { uri: store, hover: "pub struct Remote { pub slots: u32 }", members: [F("slots", "slots: u32"), M("roll_active", "roll_active(&self) -> u64")] },
      Widget: { uri: store, hover: "pub struct Widget { pub mass: u32 }", members: [M("mass_of", "mass_of(&self) -> u32")] },
    },
    tree: [dsym("impl Remote", SK.Object, rng(consumerSrc, "impl Remote {"), [dsym("absorb", SK.Method, rng(consumerSrc, "fn absorb"), [])])],
    spanStart: "fn absorb", spanEnd: "todo!()\n    }",
    signature: "fn absorb(&self, w: Widget) -> u32", docComment: "/// Absorb the widget.", symbolName: "absorb",
  });
  assert.strictEqual(r.names[0], "Remote", `the tree names the type; the resolver crosses to store.rs for its shape.${dump(r)}`);
  assert.ok(r.text.includes("slots"), `the cross-file receiver's fields resolve.${dump(r)}`);
  assert.ok(r.text.includes("roll_active("), `and its members.${dump(r)}`);
  assert.ok(r.calls.definition.length >= 1, `crossing to the declaration requires definition(); got ${r.calls.definition.length}.${dump(r)}`);
});

btest("resolution [csharp]: a partial class whose members are declared in another file resolves from the tree", async () => {
  const handlers = "file:///w/v24/Owner.Handlers.cs";
  const decl = "file:///w/v24/Owner.cs";
  const handlersSrc = `namespace P;

public partial class Owner
{
    /// <summary>Absorb the widget.</summary>
    public int Absorb(Widget w)
    {
        throw new NotImplementedException();
    }
}
`;
  const declSrc = `namespace P;

public class Widget
{
    public int Mass;
}

public partial class Owner
{
    public int Slots;
}
`;
  const r = await runPrefill({
    languageId: "csharp", mainUri: handlers, files: { [handlers]: handlersSrc, [decl]: declSrc },
    defTypes: {
      Owner: { uri: decl, hover: "class Owner", members: [F("Slots", "Slots: int"), M("RollActive", "RollActive(): long")] },
      Widget: { uri: decl, hover: "class Widget", members: [M("MassOf", "MassOf(): int")] },
    },
    tree: [dsym("Owner", SK.Class, rng(handlersSrc, "public partial class Owner"), [dsym("Absorb", SK.Method, rng(handlersSrc, "public int Absorb"), [])])],
    spanStart: "public int Absorb", spanEnd: "throw new NotImplementedException();",
    signature: "public int Absorb(Widget w)", docComment: "/// <summary>Absorb the widget.</summary>", symbolName: "Absorb",
  });
  assert.strictEqual(r.names[0], "Owner", `the tree's class node names the receiver even though its members live in Owner.cs.${dump(r)}`);
  assert.ok(r.text.includes("RollActive("), `the receiver's member surface resolves cross-file.${dump(r)}`);
});

// ===========================================================================
// ITEM 13 - THE REGRESSION BAR. GREEN NOW AND AFTER. A free function with no
// enclosing container produces exactly the SURFACE it produces today, byte for
// byte, in all five languages.
//
// The contract EXCEPTS evidence lines from this freeze, because a drop line
// changes no injected byte. So these rows pin the surface string and not the log
// array. What they still assert about the logs is the only thing that matters
// here - that nothing claimed an enclosing type.
//
// RE-BASELINED ONCE, 2026-07-25, when phase 2 rescoped the instruction. The
// terms, which are item 15's and are not negotiable by whoever made the change:
//
//   * A re-baseline is performed by the BLIND role, never by an implementer. An
//     implementer re-freezing bytes to go green is grading its own work.
//   * It is DIFFERENTIAL. The new string may differ from the old ONLY inside the
//     instruction region. A diff reaching into a data block is a defect in the
//     change, not a new baseline: report it and re-baseline nothing.
//   * The whole log array must be unchanged.
//   * It happens AFTER the change, so it records what the change did rather than
//     what it was expected to do.
//
// What that verification found, all six rows: every data block byte-identical,
// the diff exactly one line, confined to the trailing instruction, which gained
// the type name and an explicit statement of what the ban does NOT cover. Log
// arrays identical, `["[fngen] pre-fill injected types=1"]` in all six.
//
// The row was split into two assertions afterwards, because this episode showed
// the single equality could not say WHERE a diff landed. The data-region
// assertion is never re-baselineable; the instruction one is, under the terms
// above. If a future change reddens only the second, that is the designed path.
// If it reddens the first, stop.
//
// RE-BASELINED A SECOND TIME, 2026-08-10, GO ROW ONLY, under HUMAN RULING R1.
//
// This is the first time the DATA region has been allowed to move, and it took
// an explicit human ruling taken BEFORE any code was written, not after the row
// went red. The ruling names three rows (python, csharp, go), holds the freeze
// for rust, typescript and everything else in this file, and requires the re-cut
// to be done last, by the blind non-implementer role, with the full before/after
// diff recorded. Only the GO string actually moved; python and csharp were
// captured byte-identical and were left alone. The diff and the reasoning sit on
// the go entry in FREE_CASES below.
//
// The terms above are NOT relaxed by this. A data-region diff is still a defect
// by default and still stops the session; what happened here is that the human
// ruled a specific, named, pre-identified diff to be a supersession in advance.
// Absent such a ruling, the answer is still: report it and re-baseline nothing.
// ===========================================================================

const FREE_RS_URI = "file:///w/v24/free.rs";
const FREE_RS_SRC = `struct Widget {
    mass: u32,
}

/// Absorb the widget.
fn absorb(w: Widget) -> u32 {
    todo!()
}
`;
const FREE_TS_URI = "file:///w/v24/free.ts";
const FREE_TS_SRC = `export class Widget {
  mass: number = 0;
}

/** Absorb the widget. */
export function absorb(w: Widget): number {
  throw new Error("todo");
}
`;
const FREE_PY_URI = "file:///w/v24/free.py";
const FREE_PY_SRC = `class Widget:
    mass: int = 0


def absorb(w: Widget) -> int:
    raise NotImplementedError
`;
const TRAP_URI = "file:///w/v24/trap.rs";
const TRAP_SRC = `struct Widget {
    mass: u32,
}

struct Owner {
    slots: u32,
}

impl Owner {
    fn roll(&self) -> u64 {
        0
    }
}

/// Absorb the widget.
fn absorb(w: Widget) -> u32 {
    todo!()
}
`;
const FREE_CS_URI = "file:///w/v24/Free.cs";
const FREE_CS_SRC = `using System;

int Absorb(Widget w)
{
    throw new NotImplementedException();
}

public class Widget
{
    public int Mass;
}

public class Owner
{
    public int Slots;
}
`;
const FREE_GO_URI = "file:///w/v24/free.go";
const FREE_GO_SRC = `package store

type Widget struct {
\tMass uint32
}

type Owner struct {
\tSlots uint32
}

// Absorb the widget.
func Absorb(w Widget) uint32 {
\tpanic("todo")
}
`;

const RS_FREE_OUT =
  "Data shape of `Widget` (fields and types, nested):\n```rust\npub struct Widget { mass: u32 }\n```\n\n" +
  "API surface for `Widget` (real signatures, use these exact names, do not invent):\n```\nmass_of(&self) -> u32\n```\n\n" +
  "Call ONLY methods and constructors of `Widget` that appear in the API surface above. Do not invent methods beyond that surface. " +
  "Everything else in the file is unaffected by this: calls on other values in scope, on the receiver's own fields, on sibling functions, " +
  "and on standard-library types stay allowed. " +
  "If a builder chain ends at a method returning the target type, that value IS the target; do not append any further call.";

const FREE_CASES = [
  {
    lang: "rust",
    scn: {
      languageId: "rust", mainUri: FREE_RS_URI, files: { [FREE_RS_URI]: FREE_RS_SRC },
      defTypes: { Widget: { uri: FREE_RS_URI, hover: "pub struct Widget { mass: u32 }", members: [M("mass_of", "mass_of(&self) -> u32")] } },
      tree: [
        dsym("Widget", SK.Struct, rng(FREE_RS_SRC, "struct Widget", "    mass: u32,"), []),
        dsym("absorb", SK.Function, rng(FREE_RS_SRC, "fn absorb"), []),
      ],
      spanStart: "fn absorb", spanEnd: "todo!()\n}",
      signature: "fn absorb(w: Widget) -> u32", docComment: "/// Absorb the widget.", symbolName: "absorb",
    },
    out: RS_FREE_OUT,
  },
  {
    lang: "rust, module scope AFTER an impl block",
    scn: {
      languageId: "rust", mainUri: TRAP_URI, files: { [TRAP_URI]: TRAP_SRC },
      defTypes: {
        Widget: { uri: TRAP_URI, hover: "pub struct Widget { mass: u32 }", members: [M("mass_of", "mass_of(&self) -> u32")] },
        Owner: { uri: TRAP_URI, hover: "pub struct Owner { slots: u32 }", members: [M("roll_active", "roll_active(&self) -> u64")] },
      },
      tree: [
        dsym("Widget", SK.Struct, rng(TRAP_SRC, "struct Widget", "    mass: u32,"), []),
        dsym("Owner", SK.Struct, rng(TRAP_SRC, "struct Owner", "    slots: u32,"), []),
        dsym("impl Owner", SK.Object, rng(TRAP_SRC, "impl Owner {", "/// Absorb the widget."), [dsym("roll", SK.Method, rng(TRAP_SRC, "fn roll", "/// Absorb the widget."), [])]),
        dsym("absorb", SK.Function, rng(TRAP_SRC, "fn absorb"), []),
      ],
      spanStart: "fn absorb", spanEnd: "todo!()\n}",
      signature: "fn absorb(w: Widget) -> u32", docComment: "/// Absorb the widget.", symbolName: "absorb",
    },
    out: RS_FREE_OUT,
  },
  {
    lang: "typescript",
    scn: {
      languageId: "typescript", mainUri: FREE_TS_URI, files: { [FREE_TS_URI]: FREE_TS_SRC },
      defTypes: { Widget: { uri: FREE_TS_URI, hover: "class Widget", members: [M("massOf", "massOf(): number")] } },
      tree: [
        dsym("Widget", SK.Class, rng(FREE_TS_SRC, "export class Widget", "  mass: number = 0;"), []),
        dsym("absorb", SK.Function, rng(FREE_TS_SRC, "export function absorb"), []),
      ],
      spanStart: "export function absorb", spanEnd: `throw new Error("todo");`,
      signature: "export function absorb(w: Widget): number", docComment: "/** Absorb the widget. */", symbolName: "absorb",
    },
    out:
      "Data shape of `Widget` (fields and types, nested):\n```ts\nclass Widget\n```\n\n" +
      "Members of `Widget` (real signatures, use these exact names, do not invent):\n```ts\nmassOf(): number\n```\n\n" +
      "Use ONLY the members and types of `Widget` that appear in the surface above. Do not invent members, fields, or types beyond that surface. " +
      "Everything else in the file is unaffected by this: other values in scope, this function's own locals, sibling functions, " +
      "and standard-library types stay allowed.",
  },
  {
    lang: "python",
    scn: {
      languageId: "python", mainUri: FREE_PY_URI, files: { [FREE_PY_URI]: FREE_PY_SRC },
      defTypes: { Widget: { uri: FREE_PY_URI, hover: "class Widget", members: [M("mass_of", "mass_of(self) -> int")] } },
      tree: [
        dsym("Widget", SK.Class, rng(FREE_PY_SRC, "class Widget:", "    mass: int = 0"), []),
        dsym("absorb", SK.Function, rng(FREE_PY_SRC, "def absorb"), []),
      ],
      spanStart: "def absorb", spanEnd: "raise NotImplementedError",
      signature: "def absorb(w: Widget) -> int", docComment: undefined, symbolName: "absorb",
    },
    out:
      "Members of `Widget` (real signatures, use these exact names, do not invent):\n```python\nmass_of(self) -> int\n```\n\n" +
      "Use ONLY the members and types of `Widget` that appear in the surface above. Do not invent members, attributes, or types beyond that surface. " +
      "Everything else in the file is unaffected by this: other values in scope, this function's own locals, sibling functions, " +
      "and standard-library types stay allowed.",
  },
  {
    lang: "csharp, top-level local function",
    scn: {
      languageId: "csharp", mainUri: FREE_CS_URI, files: { [FREE_CS_URI]: FREE_CS_SRC },
      defTypes: {
        Widget: { uri: FREE_CS_URI, hover: "class Widget", members: [M("MassOf", "MassOf(): int")] },
        Owner: { uri: FREE_CS_URI, hover: "class Owner", members: [M("RollActive", "RollActive(): long")] },
      },
      tree: [
        dsym("Absorb", SK.Function, rng(FREE_CS_SRC, "int Absorb", "}\n\npublic class Widget"), []),
        dsym("Widget", SK.Class, rng(FREE_CS_SRC, "public class Widget", "    public int Mass;"), []),
        dsym("Owner", SK.Class, rng(FREE_CS_SRC, "public class Owner"), []),
      ],
      spanStart: "int Absorb", spanEnd: "throw new NotImplementedException();",
      signature: "int Absorb(Widget w)", docComment: "/// <summary>Absorb the widget.</summary>", symbolName: "Absorb",
    },
    out:
      "Members of `Widget` (real signatures, use these exact names, do not invent):\n```cs\nMassOf(): int\n```\n\n" +
      "Use ONLY the members and types of `Widget` that appear in the surface above. Do not invent members, fields, or types beyond that surface. " +
      "Everything else in the file is unaffected by this: other values in scope, this function's own locals, sibling functions, " +
      "and standard-library types stay allowed.",
  },
  {
    lang: "go, plain package-level func",
    scn: {
      languageId: "go", mainUri: FREE_GO_URI, files: { [FREE_GO_URI]: FREE_GO_SRC },
      defTypes: {
        Widget: { uri: FREE_GO_URI, hover: "type Widget struct { Mass uint32 }", members: [M("MassOf", "MassOf() uint32")] },
        Owner: { uri: FREE_GO_URI, hover: "type Owner struct { Slots uint32 }", members: [M("RollActive", "RollActive() uint64")] },
      },
      tree: [
        dsym("Widget", SK.Struct, rng(FREE_GO_SRC, "type Widget struct", "\tMass uint32"), []),
        dsym("Owner", SK.Struct, rng(FREE_GO_SRC, "type Owner struct", "\tSlots uint32"), []),
        dsym("Absorb", SK.Function, rng(FREE_GO_SRC, "func Absorb"), []),
      ],
      spanStart: "func Absorb", spanEnd: `panic("todo")`,
      signature: "func Absorb(w Widget) uint32", docComment: "// Absorb the widget.", symbolName: "Absorb",
    },
    // RE-BASELINED 2026-08-10, session-v49 phase 1, under HUMAN RULING R1, by
    // the blind non-implementer role. This is the ONE row in this family whose
    // data region was allowed to move, and it is a named exception to the
    // "NEVER RE-BASELINE THIS ONE" line below, not a relaxation of it.
    //
    // THE RULING. The freeze holds for rust and typescript and for everything
    // else in this file. The human explicitly lifted it for the three
    // python/csharp/go rows, on the grounds that their expected strings are a
    // recording of the hole session-v49 closes, and required the re-cut to be
    // done last, blind, with the full before/after diff written down.
    //
    // WHAT MOVED, EXACTLY. Python and C# turned out to need NO re-cut at all:
    // both were captured byte-identical to their frozen strings, because their
    // field legs are phases 2 and 3 and had not landed. Go's is the only string
    // that changed, and it gained one leading block and changed nothing else:
    //
    //   BEFORE (frozen v1):
    //     "Members of `Widget` (real signatures, use these exact names, do not invent):\n```go\nMassOf() uint32\n```\n\n
    //      Use ONLY the members and types of `Widget` that appear in the surface above. ..."
    //
    //   AFTER (captured 2026-08-10):
    //     "Data shape of `Widget` (fields and types, nested):\n```go\ntype Widget struct { Mass uint32 }\n```\n\n
    //      Members of `Widget` (real signatures, use these exact names, do not invent):\n```go\nMassOf() uint32\n```\n\n
    //      Use ONLY the members and types of `Widget` that appear in the surface above. ..."
    //
    // The member block is byte-identical. The instruction block is
    // byte-identical (checked separately, and it is still the row's own second
    // assertion). The whole diff is the added data-shape block.
    //
    // WHY THAT IS A SUPERSESSION AND NOT A DEFECT. Go had no field leg at all
    // before phase 1: it emitted one type, always, member signatures only, and
    // this string is the recording of that. The block is ADDITIVE here - the
    // member list sheds a field only when the shape block rendered that same
    // field, and this fixture's member list carries no fields, only `MassOf`.
    // So nothing left the prompt; a shape the developer never had arrived.
    //
    // THE ONE THING THAT DID NOT SATISFY THE ROW'S OWN TERMS, DISCLOSED. Those
    // terms say "the whole log array must be unchanged". Go's first log line
    // changed, from the line declaring that breadth, total types and depth buy
    // Go nothing because it has no data-shape walk, to the ordinary five-field
    // dial line every walking language emits. That is contract-phase1 P5 - the
    // channel was lying about Go and had to stop in the same change that lit the
    // leg - and this family pins the SURFACE string, not the log array, by its
    // own header. The injected-count line is unchanged at types=1.
    out:
      "Data shape of `Widget` (fields and types, nested):\n```go\ntype Widget struct { Mass uint32 }\n```\n\n" +
      "Members of `Widget` (real signatures, use these exact names, do not invent):\n```go\nMassOf() uint32\n```\n\n" +
      "Use ONLY the members and types of `Widget` that appear in the surface above. Do not invent members, fields, or types beyond that surface. " +
      "Everything else in the file is unaffected by this: other values in scope, this function's own locals, sibling functions, " +
      "and standard-library types stay allowed.",
  },
];

// The surface splits into blocks separated by a blank line, the LAST of which is
// the instruction. Asserting the two regions separately is what keeps this row
// from being decoration: a diff outside the instruction and a diff inside it are
// different events with different remedies, and the failure message has to say
// which one you are looking at. See the re-baseline terms above.
const blocksOf = (surface) => surface.split("\n\n");
const dataRegion = (surface) => blocksOf(surface).slice(0, -1);
const instructionOf = (surface) => blocksOf(surface)[blocksOf(surface).length - 1];

for (const c of FREE_CASES) {
  btest(`item 13 [${c.lang}]: a free function's SURFACE is byte-identical to today`, async () => {
    const r = await runPrefill(c.scn);

    // NEVER RE-BASELINE THIS ONE. Everything before the instruction - block
    // order, headers, fences, rendered member lines - is the frozen v1 surface.
    // A diff here is a defect, whatever else changed at the same time.
    assert.deepStrictEqual(
      dataRegion(r.text),
      dataRegion(c.out),
      `the free-function surface moved OUTSIDE the instruction region. This is not a re-baseline: block order, ` +
        `headers, fences and rendered member lines are the frozen v1 contract. CAPTURED NOW:\n${JSON.stringify(r.out)}`,
    );

    // Re-baselineable, but only by a non-implementer and only after confirming
    // the diff is confined to this region.
    assert.strictEqual(
      instructionOf(r.text),
      instructionOf(c.out),
      `the free-function INSTRUCTION moved. If that was deliberate, it is a re-baseline under the terms above and ` +
        `belongs to the blind role, not to whoever made the change. CAPTURED NOW:\n${JSON.stringify(r.out)}`,
    );

    // Belt and braces: the two regions reassemble to the whole string, so a
    // change in the blank-line separators cannot slip between them.
    assert.strictEqual(r.out, c.out, `the free-function pre-fill bytes moved. CAPTURED NOW:\n${JSON.stringify(r.out)}`);

    assert.deepStrictEqual(
      r.logs.filter((l) => /\bOwner\b/.test(l)),
      [],
      `a free function has no enclosing type; nothing may claim one.${dump(r)}`,
    );
  });
}

// ===========================================================================
// ITEM 14 - INJECTION OFF IS STILL V1. GREEN NOW AND AFTER. With the gate off
// the extractor is never constructed, so resolvePrefill runs with `extractor:
// undefined`. Nothing may resolve - and this is now the sharpest anti-cheat in
// the file: an implementation that reads a container out of the document and
// renders it without going through the resolution the product already did shows
// up here as a non-undefined surface.
// ===========================================================================

for (const lang of ["rust", "python", "go"]) {
  btest(`item 14 [${lang}]: with no extractor (injection off) a receiver target resolves nothing at all`, async () => {
    const r = await runPrefill(scenario(lang, "caseA", { noExtractor: true }));
    assert.strictEqual(r.out, undefined, `injection off must stay byte-for-byte v1 - no surface, receiver or otherwise.${dump(r)}`);
    assert.deepStrictEqual(r.logs.filter((l) => /\bOwner\b/.test(l)), [], `and nothing may claim a receiver it never resolved.${dump(r)}`);
  });
}

// ===========================================================================
// ITEM 16 - DETECTION IS LOGGED, AND THE LINE DISTINGUISHES THE TWO CASES. A
// reader of the channel must be able to tell whether the receiver was injected
// to be CALLED INTO or to be BUILT. The wording is not pinned - it has already
// moved once - only that the two are distinguishable and that the line claims no
// more than is known when it fires.
// ===========================================================================

const RECEIVER_WORDS = /receiver|enclosing|container|impl\b|self\b/i;
const FIRST_WORDS = /first|lead|ahead|front|head|top|position 1|slot 1/i;
const BUILD_WORDS = /build|constru|creat|produc|factory|instantiat|return/i;

for (const lang of CASE_B_LANGS) {
  btest(`item 16 [${lang}]: the evidence line names the receiver and distinguishes "call into" from "build"`, async () => {
    const a = await runPrefill(scenario(lang, "caseA"));
    const b = await runPrefill(scenario(lang, "caseB"));
    const detectionLine = (r) => {
      const named = r.logs.filter((l) => /\bOwner\b/.test(l) && RECEIVER_WORDS.test(l) && !/accounting/.test(l));
      assert.ok(named.length >= 1, `an evidence line must name the detected receiver and say what it is.${dump(r)}`);
      return named[0];
    };
    const aLine = detectionLine(a);
    const bLine = detectionLine(b);
    assert.ok(FIRST_WORDS.test(aLine), `the case-A line still states first placement; got ${JSON.stringify(aLine)}`);
    assert.ok(FIRST_WORDS.test(bLine), `the case-B line still states first placement; got ${JSON.stringify(bLine)}`);
    assert.notStrictEqual(aLine, bLine, `a channel reader must be able to tell the two cases apart; both runs logged the same line: ${JSON.stringify(aLine)}`);
    assert.ok(BUILD_WORDS.test(bLine), `the case-B line must say the receiver is there to be BUILT (build / construct / create / produce / return); got ${JSON.stringify(bLine)}`);
    assert.ok(!BUILD_WORDS.test(aLine), `the case-A line must NOT read as construction - the target calls into a value; got ${JSON.stringify(aLine)}`);
  });
}

// ===========================================================================
// ITEM 15 - NO CANDIDATE LEAVES THE PRE-FILL WITHOUT A LINE, and the arithmetic
// is asserted against the ACCOUNTING line, never against the injected-types line
// (absent when nothing was injected) and never against a number copied out of a
// fixture.
//
// Narrowed by the rewrite: a type the candidate miner never yields is out of
// scope. Doc prose is not code, so a name mentioned only in a comment is not a
// kept candidate and owes no line.
// ===========================================================================

const REASON_WORDS = /anchor|render|resolve|surface|shape|member|empty|dark|nothing|no def|not found|unresolved/i;

function assertAccountingAddsUp(r) {
  const acct = accounting(r.logs);
  assert.ok(acct, `an accounting line is owed whenever a kept candidate produced no block.${dump(r)}`);
  assert.strictEqual(acct.kept - acct.injected, acct.noBlock, `the reported counts must add up: kept(${acct.kept}) - injected(${acct.injected}) must equal no-block(${acct.noBlock}).${dump(r)}`);
  assert.strictEqual(acct.injected, r.names.length, `the reported injected count must equal the blocks actually returned.${dump(r)}`);
  const silent = noBlockNames(r.logs, r.names);
  assert.strictEqual(silent.length, acct.noBlock, `every candidate counted in no-block(${acct.noBlock}) needs its own named line; the logs name ${JSON.stringify(silent)}.${dump(r)}`);
  assert.strictEqual(acct.kept, r.names.length + silent.length, `kept(${acct.kept}) must be the blocks returned(${r.names.length}) plus the candidates that produced none(${silent.length}).${dump(r)}`);
  if (acct.injected > 0) assert.strictEqual(acct.injected, r.injected, `the accounting line and the \`injected types=\` line must agree.${dump(r)}`);
  return acct;
}

btest("item 15 [rust]: a kept-but-unresolvable signature candidate emits a drop line naming the type and a reason", async () => {
  const uri = "file:///w/v24/drop.rs";
  const src = `struct Owner {
    slots: u32,
}

impl Owner {
    /// Absorb the ghost.
    fn absorb(&self, g: Ghost) -> u32 {
        todo!()
    }
}
`;
  const r = await runPrefill({
    languageId: "rust", mainUri: uri, files: { [uri]: src }, darkTypes: ["Ghost"],
    defTypes: { Owner: { uri, hover: "pub struct Owner { slots: u32 }", members: [F("slots", "slots: u32"), M("roll_active", "roll_active(&self) -> u64")] } },
    tree: [
      dsym("Owner", SK.Struct, rng(src, "struct Owner", "    slots: u32,"), []),
      dsym("impl Owner", SK.Object, rng(src, "impl Owner {"), [dsym("absorb", SK.Method, rng(src, "fn absorb"), [])]),
    ],
    spanStart: "fn absorb", spanEnd: "todo!()\n    }",
    signature: "fn absorb(&self, g: Ghost) -> u32", docComment: "/// Absorb the ghost.", symbolName: "absorb",
  });
  assert.ok(!r.names.includes("Ghost"), `fixture precondition: Ghost resolves to no block.${dump(r)}`);
  const drops = r.logs.filter((l) => /\bGhost\b/.test(l) && !isCapDrop(l) && !/accounting/.test(l));
  assert.ok(drops.length >= 1, `a kept candidate that produced no block must emit its own evidence line.${dump(r)}`);
  assert.ok(drops.some((l) => REASON_WORDS.test(l)), `the drop line must name a reason class.${dump(r)}`);
  assertAccountingAddsUp(r);
  assert.deepStrictEqual(r.names, ["Owner"], `the receiver is the one candidate that resolves here.${dump(r)}`);
});

btest("item 15 [python]: the reported kept/injected/no-block counts add up, with the receiver counted in", async () => {
  const uri = "file:///w/v24/drop.py";
  const src = `class Widget:
    mass: int = 0


class Owner:
    slots: int = 0

    def absorb(self, w: Widget, g: Ghost) -> int:
        raise NotImplementedError
`;
  const r = await runPrefill({
    languageId: "python", mainUri: uri, files: { [uri]: src }, darkTypes: ["Ghost"],
    defTypes: {
      Owner: { uri, hover: "class Owner", members: [F("slots", "slots: int"), M("roll_active", "roll_active(self) -> int")] },
      Widget: { uri, hover: "class Widget", members: [M("mass_of", "mass_of(self) -> int")] },
    },
    tree: [
      dsym("Widget", SK.Class, rng(src, "class Widget:", "    mass: int = 0"), []),
      dsym("Owner", SK.Class, rng(src, "class Owner:"), [dsym("absorb", SK.Method, rng(src, "def absorb"), [])]),
    ],
    spanStart: "def absorb", spanEnd: "raise NotImplementedError",
    signature: "def absorb(self, w: Widget, g: Ghost) -> int", docComment: undefined, symbolName: "absorb",
  });
  assert.ok(r.names.includes("Owner") && r.names.includes("Widget"), `both resolvable candidates are injected, receiver first.${dump(r)}`);
  assert.strictEqual(r.names[0], "Owner", `the receiver leads.${dump(r)}`);
  const drops = r.logs.filter((l) => /\bGhost\b/.test(l) && !isCapDrop(l) && !/accounting/.test(l));
  assert.strictEqual(drops.length, 1, `exactly one kept candidate went dark, so exactly one drop line is owed.${dump(r)}`);
  assert.ok(REASON_WORDS.test(drops[0]), `the drop line must name a reason class.${dump(r)}`);
  const acct = assertAccountingAddsUp(r);
  assert.ok(acct.kept > r.names.length, `the receiver must be counted as a kept candidate, not injected off the books.${dump(r)}`);
});

for (const lang of ["rust", "python"]) {
  btest(`item 15 [${lang}]: no accounting line when every kept candidate produced a block`, async () => {
    const r = await runPrefill(scenario(lang, "caseA"));
    assert.deepStrictEqual(r.names, ["Owner", "Widget"], `fixture precondition: every candidate here resolves.${dump(r)}`);
    assert.strictEqual(accounting(r.logs), undefined, `with nothing dropped there is nothing to account for.${dump(r)}`);
    assert.deepStrictEqual(noBlockNames(r.logs, r.names), [], `no candidate may be named as producing no block.${dump(r)}`);
    assert.strictEqual(r.injected, r.names.length, `\`injected types=\` still equals the blocks returned.${dump(r)}`);
  });
}

// ===========================================================================
// ITEM 10 - MID-EDIT FILES. Measured, all five languages, live servers.
// Nothing here is guessed; each row models a tree shape the measurement
// actually recorded.
//
// THE HEADLINE, and the thing worth pinning hardest: every failure is a silent
// MISS. Not one measured case returned a WRONG container. That is the direction
// of failure this contract buys, and it is strictly better than the text scanner
// it replaces, whose three documented residuals hand back a real but wrong type
// with a confident evidence line behind it. So these rows care much less about
// which brokenness shape produced the degraded tree than about what the pre-fill
// does with it: resolve the right type, or nothing.
// ===========================================================================

// The container node, per language, and the header line its range starts on.
const CONTAINER = {
  rust: { node: "impl Owner", header: "impl Owner {" },
  csharp: { node: "Owner", header: "public class Owner" },
  typescript: { node: "Owner", header: "export class Owner {" },
  python: { node: "Owner", header: "class Owner:" },
};
// The symbol is simply not in the tree (Python case 4, Go case 3).
const withoutContainer = (tree, name) => tree.filter((n) => n.name !== name);
// The symbol is present but its range stops at its own header line, so a cursor
// further down falls outside it (the AST-extent truncation Python and Go show).
function withTruncatedContainer(tree, name, src, headerNeedle) {
  const ln = lineOf(src, headerNeedle);
  const width = src.split("\n")[ln].length;
  return tree.map((n) => (n.name === name ? { ...n, range: new V.Range(ln, 0, ln, width) } : n));
}

const MIDEDIT_SHAPES = [
  { why: "the container symbol is ABSENT from the tree", make: (lang) => withoutContainer(LANG[lang].tree(), CONTAINER[lang].node) },
  { why: "the container symbol is present but its RANGE EXCLUDES the declaration head", make: (lang) => withTruncatedContainer(LANG[lang].tree(), CONTAINER[lang].node, LANG[lang].src, CONTAINER[lang].header) },
];

for (const lang of ["rust", "typescript", "python"]) {
  for (const s of MIDEDIT_SHAPES) {
    btest(`mid-edit [${lang}]: when ${s.why}, the result is a silent MISS - never a different type in the first slot`, async () => {
      const r = await runPrefill(scenario(lang, "caseA", { tree: s.make(lang) }));
      // The direction-of-failure bar. Anything injected first that is not the
      // real receiver is the expensive failure this rework exists to remove.
      assert.ok(!r.names.includes("Owner"), `a degraded tree yields nothing, not a fallback to file text.${dump(r)}`);
      assert.ok(!r.text.includes(OWNER_FIELD[lang]), `no field of the unresolved type may appear.${dump(r)}`);
      assert.deepStrictEqual(
        r.logs.filter((l) => RECEIVER_WORDS.test(l) && !/accounting/.test(l)),
        [],
        `a miss is silent: no evidence line may claim a receiver of ANY name.${dump(r)}`,
      );
      // And the ordinary candidate path is untouched, so the miss costs nothing else.
      assert.ok(r.names.includes("Widget"), `the signature-named candidate is unaffected by the degraded tree.${dump(r)}`);
    });
  }
}

// PYTHON'S ONE ACCEPTED REGRESSION, pinned so nobody later reads it as a defect.
// An unclosed `(` above the class swallows everything below it into a single
// expression and DELETES the class symbol from the tree; the measurement
// recorded the whole tree collapsing to one Constant. Python's signature cannot
// name its own class, so unlike Go there is no fallback. The receiver is not
// injected. This is accepted and disclosed, not an oversight: it is a silent
// miss in a file that does not parse, and the alternative is keeping a text
// scanner as a second leg, which is exactly what this rework removes.
btest("mid-edit [python] ACCEPTED REGRESSION: an unclosed `(` above the class deletes the class symbol, so no receiver is injected", async () => {
  const collapsed = [dsym("VALUES", SK.Constant, new V.Range(0, 0, 0, 6), [])];
  const r = await runPrefill(scenario("python", "caseA", { tree: collapsed }));
  assert.ok(
    !r.names.includes("Owner"),
    `the class symbol is gone from the tree and a Python signature cannot name its own class, so there is nothing ` +
      `to resolve. Accepted and disclosed in session-v24/measure-midedit.md - do not "fix" this by reintroducing a ` +
      `text scan.${dump(r)}`,
  );
  assert.deepStrictEqual(r.logs.filter((l) => RECEIVER_WORDS.test(l) && !/accounting/.test(l)), [], `and the miss is silent.${dump(r)}`);
  assert.ok(r.names.includes("Widget"), `the ordinary candidate path still works in a file that does not parse.${dump(r)}`);
});

// THE QUERY OFFSET IS THE DECLARATION HEAD, not a body cursor. Pyright's class
// range ends at the last STATEMENT in the block - Python has no closing token to
// extend to - so a caret on a fresh indented line sits outside the class even in
// a well-formed file. The product already passes `span.start`, which is the
// declaration head line, and that alone erases every body-cursor failure. This
// row models exactly that tree: the head is inside the container's range and the
// span's END is not.
btest("mid-edit [python]: the container range ends at the last statement, so the DECLARATION HEAD must be the query offset", async () => {
  const tree = PY_TREE();
  const headLine = lineOf(PY_SRC, "def absorb");
  const owner = tree.find((n) => n.name === "Owner");
  owner.range = new V.Range(lineOf(PY_SRC, "class Owner:"), 0, headLine, PY_SRC.split("\n")[headLine].length);
  const r = await runPrefill(scenario("python", "caseA", { tree }));
  assert.strictEqual(
    r.names[0],
    "Owner",
    `the declaration head is inside the container's range; a body cursor would not be. Querying anywhere but the ` +
      `head loses the receiver on well-formed Python.${dump(r)}`,
  );
  assert.ok(r.text.includes(OWNER_FIELD.python), `and the resolved receiver carries its fields.${dump(r)}`);
});

// The same fact from the Rust side, and the reason the head query is safe there
// too: a half-typed member's own symbol shrinks to its header line, but the impl
// range still covers it, so the receiver survives mid-edit.
btest("mid-edit [rust]: a half-typed member shrinks to its header line but the impl range still covers it", async () => {
  const tree = RS_TREE();
  const implNode = tree.find((n) => n.name === "impl Owner");
  const headLine = lineOf(RS_SRC, "fn absorb");
  implNode.children = implNode.children.map((c) =>
    c.name === "absorb" ? { ...c, range: new V.Range(headLine, 0, headLine, RS_SRC.split("\n")[headLine].length), detail: "fn(&self" } : c,
  );
  const r = await runPrefill(scenario("rust", "caseA", { tree }));
  assert.strictEqual(r.names[0], "Owner", `the cursor is outside the half-typed member but still inside the impl, which is all the lookup needs.${dump(r)}`);
});

// GO'S MEASURED LOSS COSTS NOTHING. Break the struct declaration above and gopls
// drops `(*Owner).Absorb` from the tree completely - the receiver is
// unrecoverable from the tree at any cursor. Go does not read the tree, so this
// is a non-event.
btest("mid-edit [go]: gopls dropping the method symbol entirely costs nothing - the receiver rides the signature", async () => {
  const tree = GO_TREE().filter((n) => n.name !== "(*Owner).Absorb");
  const r = await runPrefill(scenario("go", "caseA", { tree }));
  assert.strictEqual(r.names[0], "Owner", `the one Go case the measurement found is invisible to a signature-first resolution.${dump(r)}`);
  // RE-CUT 2026-08-10, session-v49 phase 1, same rendering move as case A: the
  // field left the member list for the type's data-shape block. The claim this
  // row defends - that gopls losing the method symbol costs Go nothing, because
  // Go never reads the tree - is untouched by that. See OWNER_FIELD_RENDERS.
  assert.ok(hasOwnerField(r.text, "go"), `and it is an ordinary case A, fields and all.${dump(r)}`);
});

// ===========================================================================
// CANDIDATE CONTAINERS ARE FILTERED BY KIND. Roslyn's enclosing NAMESPACE also
// contains the cursor, so an unfiltered innermost-container walk lands on it.
// This is the one measured route to a confidently WRONG receiver, and it is
// closed by kind rather than by name - a name list cannot tell a namespace from
// a class.
// ===========================================================================

const CS_NS_RANGE = () => rng(CS_SRC, "namespace P;");
const csNamespaceTree = (children) => [dsym("P", SK.Namespace, CS_NS_RANGE(), children)];

btest("kind filter [csharp]: an enclosing NAMESPACE that contains the cursor is never mistaken for the container", async () => {
  // The class is gone from the tree (mid-edit); only the namespace contains the
  // cursor. The honest answer is a miss, never `P`.
  const tree = csNamespaceTree(CS_TREE().filter((n) => n.name !== "Owner"));
  const r = await runPrefill(scenario("csharp", "caseA", { tree }));
  assert.ok(!r.names.includes("P"), `a namespace is not a type and can never be the receiver.${dump(r)}`);
  assert.ok(!r.names.includes("Owner"), `and with the class absent from the tree the answer is a miss.${dump(r)}`);
  assert.deepStrictEqual(
    r.logs.filter((l) => RECEIVER_WORDS.test(l) && !/accounting/.test(l)),
    [],
    `no evidence line may claim a receiver here, least of all a namespace.${dump(r)}`,
  );
});

btest("kind filter [csharp]: a namespace WRAPPING the class resolves the class, never the namespace", async () => {
  const r = await runPrefill(scenario("csharp", "caseA", { tree: csNamespaceTree(CS_TREE()) }));
  assert.strictEqual(r.names[0], "Owner", `the innermost container of a TYPE kind is the receiver.${dump(r)}`);
  assert.ok(!r.names.includes("P"), `the namespace that also contains the cursor is filtered out by kind.${dump(r)}`);
  assert.ok(r.text.includes(OWNER_FIELD.csharp), `and the class resolves normally through the namespace.${dump(r)}`);
});

// ===========================================================================
// ITEM 4a - A TARGET THAT IS NOT A FUNCTION IS CASE C, ALWAYS.
//
// The pre-fill also serves TYPE generation, where the target IS the type: a
// class, struct, interface or enum declaration head. Such a head carries no
// receiver parameter and no `static`, so a receiver test that reads only the
// signature passes on it and injects the type INTO ITS OWN generation prompt.
// The generation kind is on the resolution record and must be consulted.
//
// Every row here varies `genKind`. The precise bar is the same one the case-C
// family uses, because the type may still be a legitimate signature-mined
// candidate: no evidence line may claim a receiver, and the surface must equal
// the surface with no tree at all - the enclosing-type path contributed nothing.
// ===========================================================================

const TG_RS_URI = "file:///w/v24/tg.rs";
const TG_RS_SRC = `struct Widget {
    mass: u32,
}

struct Owner {
    part: Widget,
}
`;
const TG_CS_URI = "file:///w/v24/Tg.cs";
const TG_CS_SRC = `namespace P;

public class Widget
{
    public int Mass;
}

public class Owner
{
    public Widget Part;
}
`;
const TG_TS_URI = "file:///w/v24/tg.ts";
const TG_TS_SRC = `export class Widget {
  mass: number = 0;
}

export interface Owner {
  part: Widget;
}
`;
const TG_PY_URI = "file:///w/v24/tg.py";
const TG_PY_SRC = `class Widget:
    mass: int = 0


class Owner:
    part: Widget
`;
// A NESTED type target, where the enclosing type has a DIFFERENT name from the
// target, so "no enclosing type was injected" is unambiguous.
const TG_NEST_URI = "file:///w/v24/TgNest.cs";
const TG_NEST_SRC = `namespace P;

public class Widget
{
    public int Mass;
}

public class Holder
{
    public int Depth;

    public class Owner
    {
        public Widget Part;
    }
}
`;

const TYPE_TARGETS = {
  rust: {
    languageId: "rust", mainUri: TG_RS_URI, files: { [TG_RS_URI]: TG_RS_SRC },
    defTypes: {
      Owner: { uri: TG_RS_URI, hover: "pub struct Owner { part: Widget }", members: [F("part", "part: Widget"), M("roll_active", "roll_active(&self) -> u64")] },
      Widget: { uri: TG_RS_URI, hover: "pub struct Widget { mass: u32 }", members: [M("mass_of", "mass_of(&self) -> u32")] },
    },
    tree: [
      dsym("Widget", SK.Struct, rng(TG_RS_SRC, "struct Widget", "    mass: u32,"), []),
      dsym("Owner", SK.Struct, rng(TG_RS_SRC, "struct Owner"), [dsym("part", SK.Field, rng(TG_RS_SRC, "    part: Widget,", "    part: Widget,"), [])]),
    ],
    spanStart: "struct Owner", spanEnd: "part: Widget,",
    signature: "pub struct Owner", docComment: undefined, symbolName: "Owner",
    kinds: ["struct", "enum"],
  },
  csharp: {
    languageId: "csharp", mainUri: TG_CS_URI, files: { [TG_CS_URI]: TG_CS_SRC },
    defTypes: {
      Owner: { uri: TG_CS_URI, hover: "class Owner", members: [F("Part", "Part: Widget"), M("RollActive", "RollActive(): long")] },
      Widget: { uri: TG_CS_URI, hover: "class Widget", members: [M("MassOf", "MassOf(): int")] },
    },
    tree: [
      dsym("Widget", SK.Class, rng(TG_CS_SRC, "public class Widget", "    public int Mass;"), []),
      dsym("Owner", SK.Class, rng(TG_CS_SRC, "public class Owner"), [dsym("Part", SK.Field, rng(TG_CS_SRC, "    public Widget Part;", "    public Widget Part;"), [])]),
    ],
    spanStart: "public class Owner", spanEnd: "public Widget Part;",
    signature: "public class Owner", docComment: undefined, symbolName: "Owner",
    kinds: ["class", "struct"],
  },
  typescript: {
    languageId: "typescript", mainUri: TG_TS_URI, files: { [TG_TS_URI]: TG_TS_SRC },
    defTypes: {
      Owner: { uri: TG_TS_URI, hover: "interface Owner", members: [F("part", "part: Widget"), M("rollActive", "rollActive(): number")] },
      Widget: { uri: TG_TS_URI, hover: "class Widget", members: [M("massOf", "massOf(): number")] },
    },
    tree: [
      dsym("Widget", SK.Class, rng(TG_TS_SRC, "export class Widget", "  mass: number = 0;"), []),
      dsym("Owner", SK.Interface, rng(TG_TS_SRC, "export interface Owner"), [dsym("part", SK.Field, rng(TG_TS_SRC, "  part: Widget;", "  part: Widget;"), [])]),
    ],
    spanStart: "export interface Owner", spanEnd: "part: Widget;",
    signature: "export interface Owner", docComment: undefined, symbolName: "Owner",
    kinds: ["interface", "class"],
  },
  python: {
    languageId: "python", mainUri: TG_PY_URI, files: { [TG_PY_URI]: TG_PY_SRC },
    defTypes: {
      Owner: { uri: TG_PY_URI, hover: "class Owner", members: [F("part", "part: Widget"), M("roll_active", "roll_active(self) -> int")] },
      Widget: { uri: TG_PY_URI, hover: "class Widget", members: [M("mass_of", "mass_of(self) -> int")] },
    },
    tree: [
      dsym("Widget", SK.Class, rng(TG_PY_SRC, "class Widget:", "    mass: int = 0"), []),
      dsym("Owner", SK.Class, rng(TG_PY_SRC, "class Owner:"), [dsym("part", SK.Field, rng(TG_PY_SRC, "    part: Widget", "    part: Widget"), [])]),
    ],
    spanStart: "class Owner:", spanEnd: "part: Widget",
    signature: "class Owner:", docComment: undefined, symbolName: "Owner",
    kinds: ["class", "enum"],
  },
};

async function assertTypeTargetInjectsNoEnclosingType(scn) {
  const r = await runPrefill(scn);
  assert.deepStrictEqual(
    r.logs.filter((l) => RECEIVER_WORDS.test(l) && !/accounting/.test(l)),
    [],
    `a type-generation target has no receiver of any kind - the target IS the type, and claiming one injects it ` +
      `into its own generation prompt.${dump(r)}`,
  );
  const bare = { ...scn };
  delete bare.tree;
  const b = await runPrefill(bare);
  assert.strictEqual(
    r.out,
    b.out,
    `the enclosing-type path must contribute nothing at a non-function target - its surface must equal the no-tree surface.` +
      `\n  WITH TREE:\n${r.text}\n  WITHOUT TREE:\n${b.text}`,
  );
  return r;
}

for (const [lang, t] of Object.entries(TYPE_TARGETS)) {
  for (const genKind of t.kinds) {
    btest(`item 4a [${lang}]: a \`${genKind}\` generation target is case C - the type is never injected into its own prompt`, async () => {
      await assertTypeTargetInjectsNoEnclosingType({ ...t, genKind });
    });
  }
}

// The nested shape, where the enclosing type is a DIFFERENT type. Nothing about
// it may reach the prompt: at a type target there is no "calls into" and no
// "builds one", so `Holder` is neither.
btest("item 4a [csharp]: a NESTED class target injects neither itself nor its enclosing `Holder`", async () => {
  const scn = {
    languageId: "csharp", mainUri: TG_NEST_URI, files: { [TG_NEST_URI]: TG_NEST_SRC }, genKind: "class",
    defTypes: {
      Owner: { uri: TG_NEST_URI, hover: "class Owner", members: [F("Part", "Part: Widget"), M("RollActive", "RollActive(): long")] },
      Holder: { uri: TG_NEST_URI, hover: "class Holder", members: [F("Depth", "Depth: int"), M("HoldIt", "HoldIt(): void")] },
      Widget: { uri: TG_NEST_URI, hover: "class Widget", members: [M("MassOf", "MassOf(): int")] },
    },
    tree: [
      dsym("Widget", SK.Class, rng(TG_NEST_SRC, "public class Widget", "    public int Mass;"), []),
      dsym("Holder", SK.Class, rng(TG_NEST_SRC, "public class Holder"), [
        dsym("Depth", SK.Field, rng(TG_NEST_SRC, "    public int Depth;", "    public int Depth;"), []),
        dsym("Owner", SK.Class, rng(TG_NEST_SRC, "    public class Owner"), [dsym("Part", SK.Field, rng(TG_NEST_SRC, "        public Widget Part;", "        public Widget Part;"), [])]),
      ]),
    ],
    spanStart: "public class Owner", spanEnd: "public Widget Part;",
    signature: "public class Owner", docComment: undefined, symbolName: "Owner",
  };
  const r = await assertTypeTargetInjectsNoEnclosingType(scn);
  assert.ok(!r.names.includes("Holder"), `the enclosing type of a nested type target is not a receiver either.${dump(r)}`);
  assert.ok(!r.text.includes("HoldIt("), `and none of its members may reach the prompt.${dump(r)}`);
});

// ===========================================================================
// CASE B, THE MEMBER SHAPES THAT MATTER (contract item 3). The existing case-B
// rows prove instance methods are dropped. These prove the other half - which
// members must SURVIVE - because the expensive direction at a construction
// target is dropping a real producer the model then cannot see.
//
// Three shapes, each a different way a producer test goes wrong:
//   1. THE LANGUAGE'S OWN CONSTRUCTION MEMBER. Named in item 3 explicitly. It
//      does not look like "a static method whose return type names the type":
//      a C# constructor has no return type at all, `constructor` is a keyword,
//      and `__init__` returns None.
//   2. A CALLABLE-SHAPED FIELD. A member whose TYPE is a function is data, not
//      a method - `on_tick: fn(u64) -> bool` is called as `(x.on_tick)(..)`.
//      Case B injects the type's FIELDS unconditionally, so it must survive
//      even though its type produces something other than the enclosing type.
//      A producer filter that classifies by signature shape rather than by
//      member kind drops it.
//   3. A FACTORY WITH NO RETURN ANNOTATION. The producer test cannot see a
//      return type at all. Dropping it is the expensive direction.
// ===========================================================================

const B_MEMBERS = {
  rust: [
    F("slots", "slots: u32"),
    F("on_tick", "on_tick: fn(u64) -> bool"),
    M("new", "new(w: Widget) -> Owner"),
    M("roll_active", "roll_active(&self) -> u64"),
  ],
  csharp: [
    F("Slots", "Slots: int"),
    F("OnTick", "OnTick: Func<long, bool>"),
    M("Owner", "Owner(int slots)"),
    M("Create", "Create(Widget): Owner"),
    M("RollActive", "RollActive(): long"),
  ],
  typescript: [
    F("slots", "slots: number"),
    F("onTick", "onTick: (n: number) => boolean"),
    M("constructor", "constructor(slots: number)"),
    M("create", "create(w: Widget): Owner"),
    M("make", "make(w: Widget)"),
    M("rollActive", "rollActive(): number"),
  ],
  python: [
    F("slots", "slots: int"),
    F("on_tick", "on_tick: Callable[[int], bool]"),
    M("__init__", "__init__(self, slots: int) -> None"),
    M("create", "create(w: Widget) -> Owner"),
    M("make", "make(w)"),
    M("roll_active", "roll_active(self) -> int"),
  ],
};
// A case-B scenario whose Owner carries the shapes above.
const bMemberScn = (lang) => {
  const L = LANG[lang];
  const defTypes = L.defTypes();
  defTypes.Owner = { ...defTypes.Owner, members: B_MEMBERS[lang] };
  return scenario(lang, "caseB", { defTypes });
};

// 1. The construction member. C#, TypeScript and Python each have one; Rust
// does not - `new` is a convention, not a language construct, and it is already
// covered as an ordinary producer by the existing case-B rows.
const CONSTRUCTION_MEMBER = {
  csharp: { needle: "Owner(int slots)", what: "a constructor, which has no return type at all" },
  typescript: { needle: "constructor(slots: number)", what: "`constructor`, which is a keyword rather than a return type" },
  python: { needle: "__init__(self, slots: int) -> None", what: "`__init__`, whose annotated return type is None" },
};
for (const [lang, c] of Object.entries(CONSTRUCTION_MEMBER)) {
  btest(`case B [${lang}]: the language's own construction member survives the narrowing - ${c.what}`, async () => {
    const r = await runPrefill(bMemberScn(lang));
    assert.strictEqual(r.names[0], "Owner", `fixture precondition: this is a construction target.${dump(r)}`);
    assert.ok(
      r.text.includes(c.needle),
      `item 3 names the language's own construction member as a producer. It is the single most useful member at a ` +
        `construction target, and it is the one a "return type names the type" test cannot see.${dump(r)}`,
    );
    // The narrowing still does its job.
    for (const m of INSTANCE_ONLY[lang]) assert.ok(!r.text.includes(m), `ordinary instance methods still go.${dump(r)}`);
  });
}

// 2. The callable-shaped FIELD. Case B injects the type's fields, full stop.
const CALLABLE_FIELD = {
  rust: "on_tick: fn(u64) -> bool",
  csharp: "OnTick: Func<long, bool>",
  typescript: "onTick: (n: number) => boolean",
  python: "on_tick: Callable[[int], bool]",
};
for (const [lang, needle] of Object.entries(CALLABLE_FIELD)) {
  btest(`case B [${lang}]: a callable-shaped FIELD survives, because case B injects fields regardless of what they produce`, async () => {
    const r = await runPrefill(bMemberScn(lang));
    assert.strictEqual(r.names[0], "Owner", `fixture precondition: this is a construction target.${dump(r)}`);
    assert.ok(r.text.includes(OWNER_FIELD[lang]), `the plain field is there.${dump(r)}`);
    assert.ok(
      r.text.includes(needle),
      `a member whose TYPE is a function is DATA, not a method - a constructor must fill it like any other field. ` +
        `A producer filter keyed on signature shape rather than member kind drops it.${dump(r)}`,
    );
  });
}

// 3. The factory with no return annotation. The producer test has nothing to
// read, and the cheap-vs-expensive rule that governs receivers governs members
// too: a missing receiver costs a round, a missing producer costs the model the
// one call that would have worked.
const UNANNOTATED_FACTORY = {
  typescript: "make(w: Widget)",
  python: "make(w)",
};
for (const [lang, needle] of Object.entries(UNANNOTATED_FACTORY)) {
  btest(`case B [${lang}]: a factory with NO return annotation is not silently dropped`, async () => {
    const r = await runPrefill(bMemberScn(lang));
    assert.strictEqual(r.names[0], "Owner", `fixture precondition: this is a construction target.${dump(r)}`);
    assert.ok(
      r.text.includes(needle),
      `the producer test cannot see a return type here, and an unannotated factory is common in both languages. ` +
        `Dropping it is the expensive direction: the model cannot call what it cannot see.${dump(r)}`,
    );
  });
}

// ===========================================================================
// ITEM 3d - NARROWING IS LOGGED. A member removed by the producer test leaves an
// evidence line naming HOW MANY were removed and WHY.
//
// This row exists because item 15's arithmetic cannot see member-level drops and
// is not wrong to be silent about them: a narrowed-away member was never a
// candidate, so the candidate-level accounting is silent there BY DESIGN. Item
// 3d is the separate clause that closes the hole. Without it a construction
// target ships a shorter surface than the human expects with nothing in the
// channel saying so, which is the class of invisibility this session exists to
// end.
//
// The count is derived from the run itself - the members supplied to the fake
// extractor that did not reach the surface - so the assertion stays correct
// across the 3a/3b/3c rulings, which change WHICH members survive but not that
// the removals must be counted. Wording is not pinned, only that some line
// carries the number and a reason.
// ===========================================================================

const NARROW_WORDS = /narrow|producer|produce|construct|build|instance|method/i;

for (const lang of CASE_B_LANGS) {
  btest(`item 3d [${lang}]: members removed by the producer test are counted in an evidence line, with a reason`, async () => {
    const scn = bMemberScn(lang);
    const r = await runPrefill(scn);
    assert.strictEqual(r.names[0], "Owner", `fixture precondition: this is a construction target.${dump(r)}`);

    const supplied = scn.defTypes.Owner.members;
    const removed = supplied.filter((m) => !r.text.includes(m.signature));
    assert.ok(removed.length > 0, `fixture precondition: the narrowing must remove something here.${dump(r)}`);

    // Any line that is neither the candidate-level accounting nor the
    // injected-types nor the cap-eviction line, carrying the removal count and
    // a reason. Item 15's line is candidate-level and cannot serve here.
    const owed = r.logs.filter(
      (l) => !/accounting/.test(l) && !/injected types=/.test(l) && !isCapDrop(l) && new RegExp(`\\b${removed.length}\\b`).test(l) && NARROW_WORDS.test(l),
    );
    assert.ok(
      owed.length >= 1,
      `${removed.length} member(s) left the surface at a construction target and nothing in the channel says so. ` +
        `Removed: ${JSON.stringify(removed.map((m) => m.name))}. The candidate-level accounting line cannot carry ` +
        `this - a narrowed member was never a candidate - so item 3d owes its own line naming the count and the reason.${dump(r)}`,
    );
  });
}

// The counterpart: when the producer test removes nothing, no narrowing line is
// owed. Case A never narrows, so it is the clean control - and it keeps item 3d
// from being satisfied by an unconditional line, which would chatter on every
// prompt and break item 13's spirit the way an always-on accounting line would.
for (const lang of ["rust", "python"]) {
  btest(`item 3d [${lang}]: case A narrows nothing, so no narrowing line is emitted`, async () => {
    const r = await runPrefill(scenario(lang, "caseA"));
    for (const m of INSTANCE_ONLY[lang]) assert.ok(r.text.includes(m), `fixture precondition: case A keeps every method.${dump(r)}`);
    const chatter = r.logs.filter((l) => !/accounting/.test(l) && !/injected types=/.test(l) && !isCapDrop(l) && !RECEIVER_WORDS.test(l) && NARROW_WORDS.test(l));
    assert.deepStrictEqual(chatter, [], `nothing was narrowed away, so nothing is owed.${dump(r)}`);
  });
}

// ===========================================================================
// ITEM 4a, THE RULE ITSELF. The test is "the generation kind is not a function",
// NOT a list of type kinds: an enumeration rots the moment a per-language admit
// set changes, and it has changed before. The rows above use struct / enum /
// class / interface because those are what the admit sets carry today; this one
// uses a kind none of them carries, so it passes only for an implementation that
// asks the general question.
// ===========================================================================

btest("item 4a: a generation kind outside every current admit set is still case C - the test is `not a function`, not a list", async () => {
  const scn = { ...TYPE_TARGETS.csharp, genKind: "record" };
  await assertTypeTargetInjectsNoEnclosingType(scn);
});

// ===========================================================================
// FIXTURE FIDELITY GUARD. These fixtures must model what the measured servers
// actually report, or every row built on them tests something no product ever
// sees. This row pins the one shape that was wrong: `selectionRange` covers the
// NAME TOKEN, never the whole header line. The expected columns are read
// straight off the measured tables.
// ===========================================================================

btest("fixture fidelity: `selectionRange` covers the NAME TOKEN, at the columns the measured servers report", async () => {
  const at = (tree, name) => {
    const find = (nodes) => {
      for (const n of nodes) {
        if (n.name === name) return n;
        const hit = find(n.children || []);
        if (hit) return hit;
      }
      return undefined;
    };
    const n = find(tree);
    assert.ok(n, `fixture bug: no node named ${name}`);
    return n;
  };
  const textOf = (src, node) => src.split("\n")[node.selectionRange.start.line].slice(node.selectionRange.start.character, node.selectionRange.end.character);

  // rust-analyzer: `impl Owner` sel -> `Owner`, never `impl`.
  assert.strictEqual(textOf(RS_SRC, at(RS_TREE(), "impl Owner")), "Owner", "an impl node selects its SELF TYPE");
  // Roslyn / tsserver / pyright: the class name, never `public` / `export` / `class`.
  assert.strictEqual(textOf(CS_SRC, at(CS_TREE(), "Owner")), "Owner", "a C# class node selects the class name");
  assert.strictEqual(textOf(TS_SRC, at(TS_TREE(), "Owner")), "Owner", "a TS class node selects the class name");
  assert.strictEqual(textOf(PY_SRC, at(PY_TREE(), "Owner")), "Owner", "a Python class node selects the class name");
  // gopls: the METHOD name, not the receiver.
  assert.strictEqual(textOf(GO_SRC, at(GO_TREE(), "(*Owner).Absorb")), "Absorb", "a Go method node selects the method name");
  // A trait impl selects the self type; the server has already disambiguated.
  const traitTree = [dsym("impl Persist for Owner", SK.Object, rng(RS_SRC, "impl Owner {"), [])];
  assert.strictEqual(
    RS_SRC.split("\n")[traitTree[0].selectionRange.start.line].slice(traitTree[0].selectionRange.start.character),
    "Owner {",
    "`impl Persist for Owner` selects `Owner`, never `Persist`",
  );
  // And a member node selects its own name, not the line's leading keyword.
  assert.strictEqual(textOf(CS_SRC, at(CS_TREE(), "Absorb")), "Absorb", "a member node selects the member name");
});

// ===========================================================================
// NAME-VS-ANCHOR AGREEMENT. The resolved container's NAME and the surface's
// CONTENT come from independent sources: the name from the tree node, the
// content from a hover/member query at an anchor cursor. With no agreement test
// between them, an anchor that drifts one identifier turns into a block headed
// `Owner` carrying somebody else's members - a confidently wrong surface, which
// is the single failure mode this whole rework exists to prevent. A miss is
// cheap; this is the expensive direction.
//
// Each fixture is a header line carrying TWO type identifiers, which is where a
// drifting anchor actually lands in real code: a Rust trait impl (`impl Persist
// for Owner` - drift left, get the trait) and a C#/TypeScript base clause
// (`class Owner : Widget` - drift right, get the base type). The tree node is
// named for the real container and its selectionRange deliberately points at
// the OTHER identifier.
//
// `exactAnchor` makes the fake extractor a pure function of the cursor, so the
// surface's content is determined by the anchor and by nothing else. The
// target's signature names NO user type, so the wrong type has no other route
// into the prompt: if its members appear at all, they arrived through the
// receiver path under the wrong header.
// ===========================================================================

// A selection range over an arbitrary token on the node's header line.
function selOver(src, headerNeedle, token) {
  const ln = lineOf(src, headerNeedle);
  const line = src.split("\n")[ln];
  const ch = line.indexOf(token);
  assert.ok(ch >= 0, `fixture bug: ${token} not on the header line ${JSON.stringify(line)}`);
  return new V.Range(ln, ch, ln, ch + token.length);
}

const AGREEMENT = [
  {
    lang: "rust",
    uri: "file:///w/v24/agree.rs",
    src: `trait Persist {
    fn persist_now(&self);
}

struct Owner {
    slots: u32,
}

impl Persist for Owner {
    /// Absorb a count.
    fn absorb(&self, n: u32) -> u32 {
        todo!()
    }
}
`,
    container: "impl Persist for Owner",
    header: "impl Persist for Owner",
    driftToken: "Persist",
    wrongType: "Persist",
    wrongMember: "persist_now(",
    rightMember: "roll_active(",
    defTypes: (uri) => ({
      Owner: { uri, hover: "pub struct Owner { slots: u32 }", members: [F("slots", "slots: u32"), M("roll_active", "roll_active(&self) -> u64")] },
      Persist: { uri, hover: "pub trait Persist", members: [M("persist_now", "persist_now(&self)")] },
    }),
    spanStart: "fn absorb", spanEnd: "todo!()\n    }",
    signature: "fn absorb(&self, n: u32) -> u32", docComment: "/// Absorb a count.", symbolName: "absorb",
    why: "an anchor drifting LEFT on a trait impl lands on the trait",
  },
  {
    lang: "csharp",
    uri: "file:///w/v24/Agree.cs",
    src: `namespace P;

public class Widget
{
    public int Mass;
}

public class Owner : Widget
{
    /// <summary>Absorb a count.</summary>
    public int Absorb(int n)
    {
        throw new NotImplementedException();
    }
}
`,
    container: "Owner",
    header: "public class Owner : Widget",
    driftToken: "Widget",
    wrongType: "Widget",
    wrongMember: "MassOf(",
    rightMember: "RollActive(",
    defTypes: (uri) => ({
      Owner: { uri, hover: "class Owner", members: [F("Slots", "Slots: int"), M("RollActive", "RollActive(): long")] },
      Widget: { uri, hover: "class Widget", members: [M("MassOf", "MassOf(): int")] },
    }),
    spanStart: "public int Absorb", spanEnd: "throw new NotImplementedException();",
    signature: "public int Absorb(int n)", docComment: "/// <summary>Absorb a count.</summary>", symbolName: "Absorb",
    why: "an anchor drifting RIGHT on a base clause lands on the base type",
  },
  {
    lang: "typescript",
    uri: "file:///w/v24/agree.ts",
    src: `export class Widget {
  mass: number = 0;
}

export class Owner extends Widget {
  /** Absorb a count. */
  absorb(n: number): number {
    throw new Error("todo");
  }
}
`,
    container: "Owner",
    header: "export class Owner extends Widget",
    driftToken: "Widget",
    wrongType: "Widget",
    wrongMember: "massOf(",
    rightMember: "rollActive(",
    defTypes: (uri) => ({
      Owner: { uri, hover: "class Owner", members: [F("slots", "slots: number"), M("rollActive", "rollActive(): number")] },
      Widget: { uri, hover: "class Widget", members: [M("massOf", "massOf(): number")] },
    }),
    spanStart: "absorb(n: number)", spanEnd: `throw new Error("todo");`,
    signature: "absorb(n: number): number", docComment: "/** Absorb a count. */", symbolName: "absorb",
    why: "an anchor drifting RIGHT on an extends clause lands on the base type",
  },
  {
    lang: "python",
    uri: "file:///w/v24/agree.py",
    src: `class Widget:
    mass: int = 0


class Owner(Widget):
    slots: int = 0

    def absorb(self, n: int) -> int:
        raise NotImplementedError
`,
    container: "Owner",
    header: "class Owner(Widget):",
    driftToken: "Widget",
    wrongType: "Widget",
    wrongMember: "mass_of(",
    rightMember: "roll_active(",
    defTypes: (uri) => ({
      Owner: { uri, hover: "class Owner", members: [F("slots", "slots: int"), M("roll_active", "roll_active(self) -> int")] },
      Widget: { uri, hover: "class Widget", members: [M("mass_of", "mass_of(self) -> int")] },
    }),
    spanStart: "def absorb", spanEnd: "raise NotImplementedError",
    signature: "def absorb(self, n: int) -> int", docComment: undefined, symbolName: "absorb",
    why: "an anchor drifting RIGHT on a base list lands on the base class",
  },
];

for (const a of AGREEMENT) {
  btest(`agreement [${a.lang}]: an anchor pointing at a different identifier never ships that type's members under the container's header - ${a.why}`, async () => {
    const files = { [a.uri]: a.src };
    // The control: with a faithful anchor the receiver resolves normally, so the
    // fixture proves the agreement row and not merely a broken fake.
    const faithful = await runPrefill({
      languageId: a.lang, mainUri: a.uri, files, defTypes: a.defTypes(a.uri), exactAnchor: true,
      tree: [dsym(a.container, a.lang === "rust" ? SK.Object : SK.Class, rng(a.src, a.header), [])],
      spanStart: a.spanStart, spanEnd: a.spanEnd, signature: a.signature, docComment: a.docComment, symbolName: a.symbolName,
    });
    assert.strictEqual(faithful.names[0], "Owner", `control: a faithful anchor resolves the container normally.${dump(faithful)}`);
    assert.ok(faithful.text.includes(a.rightMember), `control: and carries the container's own members.${dump(faithful)}`);

    // The subject: same node, same name, anchor moved to the other identifier.
    const drifted = await runPrefill({
      languageId: a.lang, mainUri: a.uri, files, defTypes: a.defTypes(a.uri), exactAnchor: true,
      tree: [dsym(a.container, a.lang === "rust" ? SK.Object : SK.Class, rng(a.src, a.header), [], "", selOver(a.src, a.header, a.driftToken))],
      spanStart: a.spanStart, spanEnd: a.spanEnd, signature: a.signature, docComment: a.docComment, symbolName: a.symbolName,
    });

    assert.ok(
      !drifted.text.includes(a.wrongMember),
      `\`${a.wrongMember}\` belongs to ${a.wrongType}, not to the container the tree named. The signature names no user ` +
        `type, so it can only have arrived through the receiver path - which means a block headed \`Owner\` is carrying ` +
        `somebody else's surface under a header promising real names. Name and content must be cross-checked, and a ` +
        `mismatch must degrade to a miss.${dump(drifted)}`,
    );
    assert.ok(
      !drifted.names.includes(a.wrongType),
      `${a.wrongType} is not the enclosing type and must not be injected as one.${dump(drifted)}`,
    );
    // A miss is fine. Injecting the container is fine IF the content is really
    // the container's. What is forbidden is a header and a body that disagree.
    if (drifted.names.includes("Owner")) {
      assert.ok(
        drifted.text.includes(a.rightMember),
        `a block headed \`Owner\` must carry Owner's own members; anything else is the confidently-wrong surface.${dump(drifted)}`,
      );
    }
  });
}
