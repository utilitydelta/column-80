// BLIND ORACLE - session-v24 phase 2: "the API-surface instruction stops
// over-claiming, and stops naming private members". Pins the external contract
// in `session-v24/surface-p2.md` (items 1-15) plus goal.md fix 2.
//
// STATE: 59 rows, 45 green, 14 RED. Phase 2 has landed, so the original 22 reds
// are pins now. The 14 reds are a THIRD red-before-green round, from two
// sources: an adversarial review that found three C# shapes this suite could
// not see (B15 an enum, B16 private field spellings, B17 a public member
// sharing a line with a private one), and the human's ruling in contract item
// 7a, which corrected WHICH SCOPE the filter applies to and re-aimed nine rows.
//
// ITEM 7a, and it changed this file more than any other ruling. The signal item
// 8 names - `pub`, an accessibility modifier - answers "is this visible outside
// its own scope". The question the contract asks is "can THIS TARGET call it".
// Those agree for an external crate, which is the capture, and disagree
// whenever the target sits inside the type's own scope - which after phase 1 is
// the NORMAL case, because the first block in every payload is the human's own
// enclosing type. The old B7 rows encoded the mechanical signal and could not
// see it: their private members lived on the receiver, in the target's own
// file. They are re-aimed onto a type in ANOTHER module, which is what the
// capture actually was, and the exempt scopes get rows of their own.
//
// Nothing here has read src/core/compilerDirected.ts,
// src/core/*Extraction.ts, src/core/crossFileShape.ts, src/core/tsLsExtractor.ts,
// src/core/receiver.ts or anything under src/vscode/. Every assertion is
// black-box: on the STRING a payload assembler / pre-fill resolver returns, on
// the LOG LINES the `log` callback receives, and on values CAPTURED by running
// today's code through this same harness (never copied out of source).
//
// WHAT IT PINS
//
//   Contract A - the instruction is scoped to the types it names.
//     A1  (item 1)  the instruction NAMES the type(s) the surface describes,
//                   at all three payload producers.              [RED]
//     A1b (item 1)  ...and its scope is WHATEVER RENDERED, never "the
//                   receiver": a payload with no receiver in it scopes to the
//                   signature-named candidate and names no receiver. Two
//                   shapes - a module-scope function below an `impl` block,
//                   and a static utility inside a class (case C, where the
//                   container resolves perfectly and is still not injected).
//                   Catches an instruction hard-coded to the receiver. [RED]
//     A2  (item 2)  the instruction carries an explicit permission clause, so
//                   it cannot be read as a global ban.           [RED]
//     A3  (item 3)  one instruction per payload, however many blocks; it names
//                   every block's type. The count half is green today; the
//                   naming half is not.                          [RED]
//     A4  (item 4)  `Call ONLY methods and constructors` survives verbatim and
//                   never appears twice in one payload. [GREEN both sides]
//     A5  (item 5)  no injected surface -> no instruction. [GREEN both sides]
//     A6  (item 6)  pre-fill and repair-time move TOGETHER.      [RED]
//
//   Contract B - injected members are public members THE TARGET CANNOT REACH.
//     B7  (items 7-8, 7a) RE-AIMED. A private member of a type in ANOTHER
//                   module/package/file is absent; its public one survives, and
//                   so does one whose declaration line is unreadable (item 9's
//                   degrade, which only has somewhere to live now that the
//                   target's own scope is exempt). This is the capture.[GREEN]
//     B18 (item 7a) a private member of the target's OWN enclosing type
//                   SURVIVES, in all four languages.                   [RED]
//     B19 (item 7a) a private member of a DIFFERENT type in the SAME FILE:
//                   KEPT for rust and go (module- and package-scoped), FILTERED
//                   for c# and typescript (`private` is TYPE-scoped). The two
//                   directions together are what stop an implementation taking
//                   the cheap same-file shortcut for all four.  [RED rust+go,
//                                                          GREEN c#+ts]
//     B7b (item 7a) RE-AIMED, and it used to assert the opposite: a
//                   CONSTRUCTION target KEEPS the private producer of the type
//                   it builds - it sits inside that type.               [RED]
//     B7c (item 7a) the private FIELD a constructor exists to FILL is in the
//                   MEMBER list, not only in the data-shape block that quotes
//                   the hover. Rust only; C# and TS cannot carry the claim.[RED]
//     B8  (item 8)  Python is UNCHANGED: `_sunder` members stay. [GREEN both]
//     B9  (item 9)  the degrade is ASYMMETRIC - when the signal cannot be read
//                   the member is KEPT. A macro-generated member, and a C#
//                   INTERFACE member (no modifier there means PUBLIC). The
//                   no-declaration-line shape moved INTO B7, on the filtered
//                   type, because item 7a exempts the type it used to ride.
//                   Go has no degrade at all: its signal is the first rune of
//                   the name, and a member always has a name.[GREEN both sides]
//     B9d (item 9a) the VISIBILITY pass and the ROLE pass are INDEPENDENT. At
//                   a construction target, a producer with no readable
//                   visibility signal survives WHILE the role pass is
//                   demonstrably still narrowing in the same run. The pairing
//                   is what makes it a merge detector and not a "nothing
//                   filters yet" tautology.               [GREEN both sides]
//     B10 (item 10) a member dropped for VISIBILITY is logged by name and
//                   names the visibility filter.                 [RED]
//     B10b (item 10) at a construction target BOTH filters fire, and the two
//                   drop reasons are told apart. A public instance method
//                   dropped for its role must not read as a visibility drop.
//                   Today the role drop is not logged at all.     [RED]
//     B11 (item 11) the FIM scope boundary, pinned from outside in the KEEP
//                   direction: the SHARED member renderer and the FIM candidate
//                   render must NOT filter. A filter placed there would close
//                   every site in one edit and change FIM bytes. [GREEN both]
//     B12 (item 12) injection off is still v1 at a method target, proved
//                   against a paired positive on the same fixture. [GREEN both]
//     B13 (item 13 + 7a) the C# `_`-prefix stand-in stops double-filtering.
//                   Both `_RollActive` (public) and `_scratch` (private, but on
//                   the target's OWN type, so item 7a exempts it) must survive:
//                   with the fact saying keep, nothing is left to drop them on
//                   but the convention item 13 retires.               [RED]
//     B14 (item 14) no cap/budget/bound constant moves.    [GREEN both sides]
//
//   Second round - C# shapes the walk reaches that no fixture carried.
//     A1d (item 1)  a collaborator that CARRIES members, so more than one block
//                   renders and item 1's scope becomes testable at all. [GREEN]
//     A1e (item 1)  the general form: the instruction's scope is derived FROM
//                   THE RUN - every rendered type named, no unrendered one -
//                   swept over five payload shapes.                    [GREEN]
//     B15 (items 7-9) a C# ENUM's members survive. They carry no accessibility
//                   modifier because the syntax FORBIDS one; the class-member
//                   default does not reach them. Applying it drops all three,
//                   the block renders nothing and vanishes, and the model is
//                   told not to invent beyond a surface that no longer names
//                   the enum it must return - the capture's own failure,
//                   manufactured by the fix.                            [RED]
//     B16 (items 7-8) private fields survive no spelling of their declaration:
//                   a dotted namespace-qualified type, the second declarator of
//                   a multi-declarator line, and a generic whose argument list
//                   carries a comma. The list is ILLUSTRATIVE - the third came
//                   from triage, not the review - so special-casing exactly
//                   these three memorises the test.                     [RED]
//     B17 (items 7 + 9) the expensive inverse: a PUBLIC member sharing a source
//                   line with a private one SURVIVES. A modifier check reading
//                   the LINE rather than the DECLARATOR drops it, and nothing
//                   downstream catches a surface that is merely absent. [RED]
//     FIXTURE FIDELITY  every node's `selectionRange` covers the NAME TOKEN at
//                   the columns `session-v24/measure-midedit.md` recorded from
//                   five live servers, never the whole node span; and no node
//                   has an inverted range or swallows a later sibling. Guards
//                   this file, not the product. Extended to all seventeen
//                   trees, including the enum, the multi-declarator line and
//                   the one-line class body.              [GREEN both sides]
//
// THE PHASE-1 BYTE FREEZE (item 15). Scoping the instruction moves the round-0
// pre-fill's bytes, and the six `item 13` rows in
// `test/blind-v24-p1-receiver.test.cjs` freeze exactly those bytes (the two rust
// rows freeze the `Call ONLY ...` sentence; the ts/python/csharp/go rows freeze
// the `Use ONLY ...` one). Item 15 settles it: those rows are phase 1's own
// regression bar from this same session, not the historical frozen set, and a
// guard protecting fix 1 cannot veto fix 2. The re-baseline belongs to THIS
// role, happens after the instruction change lands, and the new frozen string
// may differ from the old ONLY inside the instruction region - every other byte
// of the surface, and the whole log array, unchanged. NOT DONE YET: the
// instruction has not changed.
//
// THE PHASE-1 REWORK, AND WHAT PHASE 2 INHERITS. Phase 1 was rebuilt after this
// file was first written: the receiver is resolved from the document-symbol
// tree, which rides the resolution record as `symbols`, never from file text.
// Every fixture below carries one. Two consequences:
//   * The pre-fill surface is SHAPE-DEPENDENT. A receiver target (case A) gets
//     fields plus all methods; a construction target (case B) gets fields plus
//     only the PRODUCING members; a plain function (case C) gets nothing. So
//     there are now two reasons a member leaves a surface, arguing in opposite
//     directions - which is item 9a, and which the B9d / B7b / B10b families
//     exist to hold apart.
//   * A payload can carry no receiver at all, so item 1's scope is "the blocks
//     that actually rendered". That is A1b.
//
// SYMBOL-TREE FIDELITY, AND WHY IT IS NOT COSMETIC. An earlier version of this
// file set every node's `selectionRange` to its whole `range`, so an anchor
// derived from it landed at column 0 on `impl` / `public` / `class` / `export` /
// `func`. No measured server does that: all five point the selection at the NAME
// TOKEN (`session-v24/measure-midedit.md`). The cost was real and was paid by
// the product, not by the test - a name-vs-anchor agreement check in a SHARED
// resolver shipped weakened to line granularity because the strict version
// reddened rows that were only failing on this artifact. A fixture convention
// was setting safety semantics. `selectionTokenFor` now derives the token the
// way the measurement records it, including the three cases where it is not
// simply the node's name: a Rust trait impl selects the SELF type, a generic
// impl includes the argument list, a Go method selects the method name and not
// the receiver. `range` is untouched; only the selection moved. The guard row
// reads the selected text back out of the source so this cannot return quietly.
//
// FOUR MORE THINGS THE IMPLEMENTER SHOULD KNOW.
//
// 1. CORRECTED, and it changed a row. An earlier version of this note said the
//    ROLE drop was silent on HEAD. That was true when captured and went stale
//    when phase 1's item 3d landed: a narrowing line now fires in every
//    construction-target language, carrying the removal COUNT and a reason.
//    The note was not merely wrong prose - it justified B10b demanding that the
//    role-dropped member be NAMED. Item 3d deliberately pins only a count (a
//    narrowed member was never a candidate), so that demand exceeded any clause
//    and would red a conforming implementation reporting a count alone. B10b is
//    re-specified to the intersection of both contracts: role evidence must
//    exist, must read as a role drop, must not read as a visibility drop - and
//    the converse for the visibility line. Silence still fails it.
//
// 2. Item 8's own correction is load-bearing for this file. The member shape
//    crossing the `SurfaceExtractor` boundary is `{ name, kind, signature }` -
//    captured by calling the exported `membersFromDocumentSymbols`, not read
//    out of source - so the position the filter needs is discarded there and
//    threading it out is part of the work. Until it is, the fixtures hand each
//    member a SUPERSET of plausible position carriers (`line`, `character`,
//    `position`, `declLine`, `range`, `selectionRange`, `location`, `uri`) AND
//    keep every member name unique inside its def file, so an implementation
//    that reads a position and one that matches on the declaration line both
//    resolve. If a real implementation reads a field named none of those, a B7
//    row stays red for a harness reason - the one failure mode here that is not
//    a contract failure, and cheap to spot (the surface still carries the
//    private member completely unchanged).
//
// 3. One latent fixture defect fell out of the fidelity pass and is fixed here:
//    the rust no-receiver tree ended its `impl` node at the FIRST `}` in the
//    file (Widget's, above it), which built an inverted range. It happened not
//    to change A1b's result - the target is outside that impl either way - but
//    an inverted container range is not a shape any server produces either.
//    `rng`'s `to` needle must be unique to the line it means.
//
// 4. Item 8's TypeScript clause ("the editor-side transport ... that residual
//    closes") and item 11 ("this phase changes no FIM prompt bytes") pull
//    against each other: the editor-side TS transport's `completeMembers` is
//    what the FIM candidate block consumes, and its `membersOfType` is what the
//    FIM whole-block render consumes. Closing the residual inside the transport
//    changes FIM bytes either way. B7 [typescript] is therefore written at the
//    site item 11 permits - the injected pre-fill surface - and B11a/B11b pin
//    the transport-shared renderers in the KEEP direction.
//
// Run: SKIP_LIVE=1 node --test test/blind-v24-p2-surface.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness. Same mechanics as blind-v24-p1-receiver / blind-v7-prepare-xfile
// (resolvePrefill headless over a vscode stub whose workspace.openTextDocument
// serves a uri->text map through a process global) merged with blind-v6-item1 /
// blind7-payload (the payload assemblers and the repair-time resolver).
// ===========================================================================

const STUB = path.join(__dirname, ".blind-v24-p2-vscode-stub.cjs");
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
  languages: {}, window: {}, commands: { executeCommand: async () => undefined },
  workspace: {
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
    openTextDocument: (arg) => {
      const files = globalThis.__V24P2_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".blind-v24-p2.entry.ts");
const OUTFILE = path.join(__dirname, ".blind-v24-p2.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolvePrefill } from "../src/vscode/fnGen";
export { resolveSurfaceInjection } from "../src/vscode/oracleSurface";
export { assembleSurfacePayload, FIRM_INSTRUCTION, classifyHallucination } from "../src/core/compilerDirected";
export { renderMemberSignatures, MEMBER_CAP, HOVER_SIGNATURE_CAP, HOVER_FANOUT_BUDGET_MS } from "../src/core/extraction";
export { renderFimCandidates } from "../src/core/fimInject";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

// A broken bundle must be ONE loud failure, never a wall of TypeErrors that
// could be mistaken for contract failures.
test("bundle guard: the phase-2 surface entry points build headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  for (const n of ["resolvePrefill", "resolveSurfaceInjection", "assembleSurfacePayload", "FIRM_INSTRUCTION", "renderMemberSignatures", "renderFimCandidates"]) {
    assert.ok(B[n] !== undefined, `${n} must be exported`);
  }
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// ===========================================================================
// Reading an instruction back out of a payload, without pinning its wording.
// ===========================================================================

// The literal marker two FROZEN oracles (blind-v6-item1, blind-v6-item4) pin.
// Contract item 4: it survives verbatim, exactly once per payload.
const FROZEN_PHRASE = "Call ONLY methods and constructors";
// The other closing instruction the pre-fill renders today, for the languages
// whose block vocabulary is "Members of ...". Captured, not read out of source.
const ALT_PHRASE = "Use ONLY the members and types";

const countOf = (hay, needle) => (hay ? hay.split(needle).length - 1 : 0);

// The trailing instruction of a payload: everything from the first instruction
// marker to the end. Returns undefined when the payload carries no instruction,
// which is itself a contract claim (item 5).
function instructionOf(payload) {
  const text = payload || "";
  const idx = [FROZEN_PHRASE, ALT_PHRASE].map((p) => text.indexOf(p)).filter((i) => i >= 0);
  if (idx.length === 0) return undefined;
  return text.slice(Math.min(...idx));
}

// Item 2: a reader must be able to tell that calling something NOT in the
// surface is still permitted. Deliberately generous - any clause that grants
// permission elsewhere satisfies the contract; only the absence of all of them
// is the capture's failure.
const PERMISSION_CLAUSE =
  /other (?:type|value|object|expression|variable|member|method|function|call|thing)s?|another type|any other|anything else|outside (?:the|this|that)|elsewhere|not (?:listed|shown|named|described|covered)|do(?:es)? not appear|own field|its (?:own )?field|self\b|this\.|standard library|std\b|stdlib|built-?in|prelude|rest of (?:the )?file|unrestricted|unaffected|still (?:allowed|permitted|fine|ok)|free to (?:call|use)|remains? (?:allowed|permitted)|are (?:allowed|permitted|not restricted)|does not (?:ban|restrict|forbid|apply|constrain)|only (?:constrain|restrict|appl)/i;

// Item 1: the instruction says WHICH types it constrains. Asserted by the type
// name appearing inside the instruction span, in any wording.
function assertScopedTo(instruction, types, where) {
  assert.ok(instruction, `${where}: a rendered payload must carry an instruction`);
  for (const t of types) {
    assert.ok(
      new RegExp(`\\b${t}\\b`).test(instruction),
      `${where}: item 1 - the instruction must NAME the type it constrains (\`${t}\`); a surface for one type closed by an unscoped ban is the capture's exact failure.\n  INSTRUCTION: ${JSON.stringify(instruction)}`,
    );
  }
}

function assertNotAGlobalBan(instruction, where) {
  assert.ok(instruction, `${where}: a rendered payload must carry an instruction`);
  assert.match(
    instruction,
    PERMISSION_CLAUSE,
    `${where}: item 2 - the instruction must say, in some wording, that calls on OTHER values (the receiver's own fields, a sibling method, a std type) are still permitted. Without that clause the correct body cannot be written and obeyed at the same time.\n  INSTRUCTION: ${JSON.stringify(instruction)}`,
  );
}

// ===========================================================================
// Pre-fill harness. Fake vscode.TextDocument, a recording position-aware fake
// SurfaceExtractor, and a scenario runner - all copied from
// blind-v24-p1-receiver so both phases drive resolvePrefill the same way.
// ===========================================================================

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

// --- Document-symbol fixtures. Contract item 8 of the REWORKED phase-1 spec
// puts the hierarchical tree on the resolution record under `symbols`, and the
// receiver is resolved from that tree alone - never from file text. Shapes are
// the recorded product ones (blind-v24-p1-receiver): a rust `impl` block is an
// untyped Object symbol SIBLING to the struct, class-shaped languages carry
// their members as children, and Go's methods are TOP-LEVEL symbols named
// `(*Owner).Absorb`.
const SK = { Module: 1, Namespace: 2, Class: 4, Method: 5, Field: 7, Constructor: 8, Enum: 9, Interface: 10, Constant: 13, EnumMember: 21, Function: 11, Object: 18, Struct: 22 };
const lineOf = (src, needle) => {
  const i = src.indexOf(needle);
  assert.ok(i >= 0, `fixture bug: ${JSON.stringify(needle)} not in source`);
  return src.slice(0, i).split("\n").length - 1;
};
function rng(src, from, to) {
  const lines = src.split("\n");
  const sl = lineOf(src, from);
  const el = to === undefined ? lines.length - 1 : lineOf(src, to);
  const r = new V.Range(sl, 0, el, lines[el].length);
  Object.defineProperty(r, "__line", { value: lines[sl], enumerable: false });
  return r;
}

// The identifier a server's `selectionRange` covers, given the symbol's name.
// MEASURED, not assumed (`session-v24/measure-midedit.md`, five live servers):
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

// FIDELITY: `selectionRange` covers the name token on the node's first line -
// what every measured server reports - NOT the whole node span. An earlier
// version of this file set it to the full range, so every anchor landed at
// column 0 on `impl` / `public` / `class` / `export` / `func`, a shape no server
// produces. That artifact is not cosmetic: it forces any name-vs-anchor
// agreement check in the shared resolver to be weakened to line granularity
// before a fixture built this way can pass, which is a test convention setting
// product safety semantics.
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

function makeExtractor(cfg) {
  const files = cfg.files;
  const defTypes = cfg.defTypes || {};
  const examples = cfg.examples || {};
  const dark = new Set(cfg.darkTypes || []);
  const known = new Set(Object.keys(defTypes));
  const calls = { definition: [], hoverSurface: [], membersOfType: [], example: [], completeMembers: [], qualifyImport: [] };

  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && dark.has(w)) return undefined;
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
    if ([...dark].some((d) => new RegExp(`\\b${d}\\b`).test(line))) return undefined;
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
    definition: async (c) => {
      calls.definition.push(c);
      const t = typeAtCursor(c.uri, c);
      return t ? defLocFor(t) : undefined;
    },
    hoverSurface: async (c) => {
      calls.hoverSurface.push(c);
      const t = typeAtCursor(c.uri, c);
      const h = t ? defTypes[t].hover : undefined;
      return h ? { signature: h } : undefined;
    },
    membersOfType: async (c) => {
      calls.membersOfType.push(c);
      const t = typeAtCursor(c.uri, c);
      return (t && defTypes[t].members) || [];
    },
    example: async (c, prefer) => {
      calls.example.push(prefer);
      return examples[prefer];
    },
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
  return { ext, calls };
}

// A member as the SurfaceExtractor yields it. Contract item 8 says every member
// carries "the position of its own declaration"; the FIELD NAME that position
// travels under is not part of the external contract, so the fixture supplies a
// SUPERSET of the plausible carriers rather than guessing one. The member's
// declaration line is located in the def text by name, so a name-matching
// implementation resolves it too. Every fixture below keeps each member name
// unique within its def file so both routes land on the same line.
function memberIn(files, uri, name, signature, kind = "method") {
  const lines = (files[uri] || "").split("\n");
  const line = lines.findIndex((l) => new RegExp(`\\b${name.replace(/[#$]/g, "\\$&")}\\b`).test(l));
  const character = line >= 0 ? Math.max(lines[line].indexOf(name), 0) : 0;
  const r = {
    start: { line, character },
    end: { line, character: character + name.length },
    startLine: line,
    startCharacter: character,
    endLine: line,
    endCharacter: character + name.length,
  };
  return {
    name,
    signature,
    kind,
    uri,
    line,
    character,
    position: { line, character },
    declLine: line,
    range: r,
    selectionRange: r,
    location: { uri, range: r },
  };
}

// A member with NO declaration anywhere in the def text: the honest-degrade
// case. It carries no usable position either, so both routes come up empty.
const memberNowhere = (name, signature, kind = "method") => ({ name, signature, kind });

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

async function runPrefill(scn) {
  const src = scn.files[scn.mainUri];
  const start = src.indexOf(scn.spanStart);
  assert.ok(start >= 0, `fixture bug: spanStart ${JSON.stringify(scn.spanStart)} not in ${scn.mainUri}`);
  const endIdx = src.indexOf(scn.spanEnd, start);
  assert.ok(endIdx >= 0, `fixture bug: spanEnd ${JSON.stringify(scn.spanEnd)} not after spanStart in ${scn.mainUri}`);
  const resolved = {
    span: { start, end: endIdx + scn.spanEnd.length },
    signature: scn.signature,
    docComment: scn.docComment,
    symbolName: scn.symbolName,
    languageId: scn.languageId,
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
    docstringRefusal: undefined,
  };
  // The phase-1 seam: `tree` on the scenario rides the record as `symbols`.
  // A scenario with no `tree` key hands over no tree at all, which is the state
  // in which no enclosing type may resolve.
  if ("tree" in scn) resolved.symbols = scn.tree;
  const { ext, calls } = makeExtractor(scn);
  const logs = [];
  globalThis.__V24P2_FILES__ = scn.files;
  let out;
  try {
    out = await B.resolvePrefill(scn.noExtractor ? undefined : ext, makeDoc(src, scn.mainUri), resolved, (l) => logs.push(l));
  } finally {
    delete globalThis.__V24P2_FILES__;
  }
  return { out, text: out || "", logs, calls, names: headerTypes(out) };
}

// The fenced content under a type's MEMBER header ("API surface for `X`" /
// "Members of `X`"), as distinct from its data-shape block. A field can survive
// in the shape block while having been dropped from the member list, which is
// exactly the shape item 7a's construction case turns on.
function memberBlockOf(text, type) {
  const lines = (text || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!new RegExp("`" + type + "`").test(lines[i])) continue;
    if (!/API surface for|Members of/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].startsWith("```")) j++;
    const out = [];
    for (let k = j + 1; k < lines.length && !lines[k].startsWith("```"); k++) out.push(lines[k]);
    return out.join("\n");
  }
  return undefined;
}

const dump = (r) => `\n  NAMES=${JSON.stringify(r.names)}\n  LOGS=${JSON.stringify(r.logs)}\n  OUT:\n${r.text}`;

// ===========================================================================
// THE THREE SCOPES (contract item 7a). Every fixture below carries the SAME
// shape, and the shape is the ruling:
//
//   `Owner`   the target's OWN enclosing type, same file  -> exempt everywhere
//   `Sibling` a DIFFERENT type in the SAME file           -> exempt in rust and
//                                                            go (module- and
//                                                            package-scoped),
//                                                            FILTERED in c# and
//                                                            typescript (`private`
//                                                            is TYPE-scoped)
//   `Remote`  a type in ANOTHER module / package / file   -> filtered everywhere
//
// `Remote` is the capture: an external crate whose private methods the target
// genuinely cannot call. `Owner` and `Sibling` are what the ruling corrected -
// the mechanical `pub`/modifier signal answers "visible outside its own scope",
// and the question the contract asks is "can THIS TARGET call it".
//
// The `Sibling` row is the one that stops an implementation taking the cheap
// same-file shortcut for all four languages: rust and go must KEEP it, c# and
// typescript must DROP it, and only a rule that knows the difference does both.
// ===========================================================================

const RS_URI = "file:///w/v24p2/owner.rs";
const RS_REMOTE_URI = "file:///w/v24p2/vendor/lru.rs";
const RS_SRC = `pub struct Sibling {
    hidden: u32,
}

impl Sibling {
    pub fn shown(&self) -> u32 {
        0
    }

    fn peek(&self) -> u32 {
        0
    }
}

pub struct Owner {
    slots: u32,
}

impl Owner {
    pub fn roll_active(&self) -> u64 {
        0
    }

    fn unlink(&mut self) {
    }

    /// Absorb the sibling and the remote.
    pub fn absorb(&self, s: Sibling, r: Remote) -> u32 {
        todo!()
    }
}
`;
const RS_REMOTE_SRC = `pub struct Remote {
    pub mass: u32,
}

impl Remote {
    pub fn public_api(&self) -> u32 {
        0
    }

    fn detach_remote(&mut self) {
    }
}
`;

const GO_URI = "file:///w/v24p2/owner.go";
const GO_REMOTE_URI = "file:///w/v24p2/vendor/remote.go";
const GO_SRC = `package store

type Sibling struct {
\tHidden uint32
}

func (s *Sibling) Shown() uint32 {
\treturn 0
}

func (s *Sibling) peek() uint32 {
\treturn 0
}

type Owner struct {
\tSlots uint32
}

func (o *Owner) RollActive() uint64 {
\treturn 0
}

func (o *Owner) unlink() {
}

// Absorb the sibling and the remote.
func (o *Owner) Absorb(s Sibling, r Remote) uint32 {
\tpanic("todo")
}
`;
const GO_REMOTE_SRC = `package remote

type Remote struct {
\tMass uint32
}

func (r *Remote) PublicAPI() uint32 {
\treturn 0
}

func (r *Remote) detachRemote() {
}
`;

const TS_URI = "file:///w/v24p2/owner.ts";
const TS_REMOTE_URI = "file:///w/v24p2/vendor/remote.ts";
const TS_SRC = `export class Sibling {
  shown(): number {
    return 0;
  }

  private peek(): number {
    return 0;
  }
}

export class Owner {
  rollActive(): number {
    return 0;
  }

  private unlink(): void {
  }

  /** Absorb the sibling and the remote. */
  absorb(s: Sibling, r: Remote): number {
    throw new Error("todo");
  }
}
`;
const TS_REMOTE_SRC = `export class Remote {
  publicApi(): number {
    return 0;
  }

  private detachRemote(): void {
  }

  #hidden(): void {
  }
}
`;

const CS_URI = "file:///w/v24p2/Owner.cs";
const CS_REMOTE_URI = "file:///w/v24p2/vendor/Remote.cs";
const CS_SRC = `namespace P;

public class Sibling
{
    public int Shown()
    {
        return 0;
    }

    void Peek()
    {
    }
}

public class Owner
{
    public int Slots;

    public long RollActive()
    {
        return 0;
    }

    void Unlink()
    {
    }

    /// <summary>Absorb the sibling and the remote.</summary>
    public int Absorb(Sibling s, Remote r)
    {
        throw new NotImplementedException();
    }
}
`;
const CS_REMOTE_SRC = `namespace V;

public class Remote
{
    public int PublicApi()
    {
        return 0;
    }

    void DetachRemote()
    {
    }
}
`;

const PY_URI = "file:///w/v24p2/owner.py";
const PY_SRC = `class Widget:
    mass: int = 0


class Owner:
    slots: int = 0

    def roll_active(self) -> int:
        return 0

    def _hidden_state(self) -> int:
        return 0

    def absorb(self, w: Widget) -> int:
        raise NotImplementedError
`;

const RS_TREE = () => [
  dsym("Sibling", SK.Struct, rng(RS_SRC, "pub struct Sibling", "    hidden: u32,"), []),
  dsym("impl Sibling", SK.Object, rng(RS_SRC, "impl Sibling {", "pub struct Owner"), [
    dsym("shown", SK.Method, rng(RS_SRC, "pub fn shown", "    fn peek"), [], "fn(&self) -> u32"),
    dsym("peek", SK.Method, rng(RS_SRC, "fn peek", "}\n\npub struct Owner"), [], "fn(&self) -> u32"),
  ]),
  dsym("Owner", SK.Struct, rng(RS_SRC, "pub struct Owner", "    slots: u32,"), []),
  dsym("impl Owner", SK.Object, rng(RS_SRC, "impl Owner {"), [
    dsym("roll_active", SK.Method, rng(RS_SRC, "pub fn roll_active", "    fn unlink"), [], "fn(&self) -> u64"),
    dsym("unlink", SK.Method, rng(RS_SRC, "fn unlink", "    /// Absorb the sibling and the remote."), [], "fn(&mut self)"),
    dsym("absorb", SK.Method, rng(RS_SRC, "pub fn absorb"), [], "fn(&self, s: Sibling, r: Remote) -> u32"),
  ]),
];

const GO_TREE = () => [
  dsym("Sibling", SK.Struct, rng(GO_SRC, "type Sibling struct", "\tHidden uint32"), []),
  dsym("(*Sibling).Shown", SK.Method, rng(GO_SRC, "func (s *Sibling) Shown", "func (s *Sibling) peek"), []),
  dsym("(*Sibling).peek", SK.Method, rng(GO_SRC, "func (s *Sibling) peek", "type Owner struct"), []),
  dsym("Owner", SK.Struct, rng(GO_SRC, "type Owner struct", "\tSlots uint32"), []),
  dsym("(*Owner).RollActive", SK.Method, rng(GO_SRC, "func (o *Owner) RollActive", "func (o *Owner) unlink"), []),
  dsym("(*Owner).unlink", SK.Method, rng(GO_SRC, "func (o *Owner) unlink", "// Absorb the sibling and the remote."), []),
  dsym("(*Owner).Absorb", SK.Method, rng(GO_SRC, "func (o *Owner) Absorb"), []),
];

const TS_TREE = () => [
  dsym("Sibling", SK.Class, rng(TS_SRC, "export class Sibling", "}\n\nexport class Owner"), [
    dsym("shown", SK.Method, rng(TS_SRC, "shown(): number", "  private peek"), []),
    dsym("peek", SK.Method, rng(TS_SRC, "private peek", "  }\n}"), []),
  ]),
  dsym("Owner", SK.Class, rng(TS_SRC, "export class Owner"), [
    dsym("rollActive", SK.Method, rng(TS_SRC, "rollActive(): number", "  private unlink"), []),
    dsym("unlink", SK.Method, rng(TS_SRC, "private unlink", "  /** Absorb the sibling and the remote. */"), []),
    dsym("absorb", SK.Method, rng(TS_SRC, "absorb(s: Sibling"), []),
  ]),
];

const CS_TREE = () => [
  dsym("Sibling", SK.Class, rng(CS_SRC, "public class Sibling", "}\n\npublic class Owner"), [
    dsym("Shown", SK.Method, rng(CS_SRC, "public int Shown", "    void Peek()"), []),
    dsym("Peek", SK.Method, rng(CS_SRC, "void Peek()", "}\n\npublic class Owner"), []),
  ]),
  dsym("Owner", SK.Class, rng(CS_SRC, "public class Owner"), [
    dsym("Slots", SK.Field, rng(CS_SRC, "    public int Slots;", "    public int Slots;"), []),
    dsym("RollActive", SK.Method, rng(CS_SRC, "public long RollActive", "    void Unlink()"), []),
    dsym("Unlink", SK.Method, rng(CS_SRC, "void Unlink()", "    /// <summary>Absorb the sibling and the remote.</summary>"), []),
    dsym("Absorb", SK.Method, rng(CS_SRC, "public int Absorb"), []),
  ]),
];

const PY_TREE = () => [
  dsym("Widget", SK.Class, rng(PY_SRC, "class Widget:", "    mass: int = 0"), []),
  dsym("Owner", SK.Class, rng(PY_SRC, "class Owner:"), [
    dsym("slots", SK.Field, rng(PY_SRC, "    slots: int = 0", "    slots: int = 0"), []),
    dsym("roll_active", SK.Method, rng(PY_SRC, "def roll_active", "    def _hidden_state"), []),
    dsym("_hidden_state", SK.Method, rng(PY_SRC, "def _hidden_state", "    def absorb"), []),
    dsym("absorb", SK.Method, rng(PY_SRC, "def absorb"), []),
  ]),
];

// Per language: the three scopes, the member each carries, and whether the
// SIBLING scope is exempt. `siblingExempt` is the whole anti-shortcut axis.
const VISIBILITY_CASES = {
  rust: {
    signal: "the `pub` keyword on the member's own declaration line",
    siblingExempt: true,
    ownPrivate: "unlink",
    siblingPrivate: "peek",
    remotePrivate: "detach_remote",
    remotePublic: "public_api(",
    unreadable: "from_elsewhere(",
    scn: () => {
      const files = { [RS_URI]: RS_SRC, [RS_REMOTE_URI]: RS_REMOTE_SRC };
      return {
        languageId: "rust", mainUri: RS_URI, files, tree: RS_TREE(),
        defTypes: {
          Owner: {
            uri: RS_URI, hover: "pub struct Owner { slots: u32 }",
            members: [
              memberIn(files, RS_URI, "roll_active", "roll_active(&self) -> u64"),
              memberIn(files, RS_URI, "unlink", "unlink(&mut self)"),
            ],
          },
          Sibling: {
            uri: RS_URI, hover: "pub struct Sibling { hidden: u32 }",
            members: [
              memberIn(files, RS_URI, "shown", "shown(&self) -> u32"),
              memberIn(files, RS_URI, "peek", "peek(&self) -> u32"),
            ],
          },
          Remote: {
            uri: RS_REMOTE_URI, hover: "pub struct Remote { pub mass: u32 }",
            members: [
              memberIn(files, RS_REMOTE_URI, "public_api", "public_api(&self) -> u32"),
              memberIn(files, RS_REMOTE_URI, "detach_remote", "detach_remote(&mut self)"),
              memberNowhere("from_elsewhere", "from_elsewhere(&self) -> u32"),
            ],
          },
        },
        spanStart: "pub fn absorb", spanEnd: "todo!()\n    }",
        signature: "pub fn absorb(&self, s: Sibling, r: Remote) -> u32",
        docComment: "/// Absorb the sibling and the remote.", symbolName: "absorb",
      };
    },
  },
  go: {
    signal: "the first rune of the member name (exported iff upper-case)",
    siblingExempt: true,
    ownPrivate: "unlink",
    siblingPrivate: "peek",
    remotePrivate: "detachRemote",
    remotePublic: "PublicAPI(",
    // Go has NO unreadable case: the signal is the first rune of the name, and
    // a member always has a name. Item 9's degrade is unreachable here by
    // construction, so the row does not pretend to exercise it.
    unreadable: undefined,
    scn: () => {
      const files = { [GO_URI]: GO_SRC, [GO_REMOTE_URI]: GO_REMOTE_SRC };
      return {
        languageId: "go", mainUri: GO_URI, files, tree: GO_TREE(),
        defTypes: {
          Owner: {
            uri: GO_URI, hover: "type Owner struct { Slots uint32 }",
            members: [
              memberIn(files, GO_URI, "RollActive", "RollActive() uint64"),
              memberIn(files, GO_URI, "unlink", "unlink()"),
            ],
          },
          Sibling: {
            uri: GO_URI, hover: "type Sibling struct { Hidden uint32 }",
            members: [
              memberIn(files, GO_URI, "Shown", "Shown() uint32"),
              memberIn(files, GO_URI, "peek", "peek() uint32"),
            ],
          },
          Remote: {
            uri: GO_REMOTE_URI, hover: "type Remote struct { Mass uint32 }",
            members: [
              memberIn(files, GO_REMOTE_URI, "PublicAPI", "PublicAPI() uint32"),
              memberIn(files, GO_REMOTE_URI, "detachRemote", "detachRemote()"),
            ],
          },
        },
        spanStart: "func (o *Owner) Absorb", spanEnd: `panic("todo")`,
        signature: "func (o *Owner) Absorb(s Sibling, r Remote) uint32",
        docComment: "// Absorb the sibling and the remote.", symbolName: "Absorb",
      };
    },
  },
  typescript: {
    signal: "the `private` keyword at the member's declaration",
    siblingExempt: false,
    ownPrivate: "unlink",
    siblingPrivate: "peek",
    remotePrivate: "detachRemote",
    remotePrivateAlso: "#hidden",
    remotePublic: "publicApi(",
    unreadable: "fromElsewhere(",
    scn: () => {
      const files = { [TS_URI]: TS_SRC, [TS_REMOTE_URI]: TS_REMOTE_SRC };
      return {
        languageId: "typescript", mainUri: TS_URI, files, tree: TS_TREE(),
        defTypes: {
          Owner: {
            uri: TS_URI, hover: "class Owner",
            members: [
              memberIn(files, TS_URI, "rollActive", "rollActive(): number"),
              memberIn(files, TS_URI, "unlink", "unlink(): void"),
            ],
          },
          Sibling: {
            uri: TS_URI, hover: "class Sibling",
            members: [
              memberIn(files, TS_URI, "shown", "shown(): number"),
              memberIn(files, TS_URI, "peek", "peek(): number"),
            ],
          },
          Remote: {
            uri: TS_REMOTE_URI, hover: "class Remote",
            members: [
              memberIn(files, TS_REMOTE_URI, "publicApi", "publicApi(): number"),
              memberIn(files, TS_REMOTE_URI, "detachRemote", "detachRemote(): void"),
              memberIn(files, TS_REMOTE_URI, "#hidden", "#hidden(): void"),
              memberNowhere("fromElsewhere", "fromElsewhere(): number"),
            ],
          },
        },
        spanStart: "absorb(s: Sibling", spanEnd: `throw new Error("todo");`,
        signature: "absorb(s: Sibling, r: Remote): number",
        docComment: "/** Absorb the sibling and the remote. */", symbolName: "absorb",
      };
    },
  },
  csharp: {
    signal: "the accessibility modifier at the declaration (a class member with none is private)",
    siblingExempt: false,
    ownPrivate: "Unlink",
    siblingPrivate: "Peek",
    remotePrivate: "DetachRemote",
    remotePublic: "PublicApi(",
    unreadable: "FromElsewhere(",
    scn: () => {
      const files = { [CS_URI]: CS_SRC, [CS_REMOTE_URI]: CS_REMOTE_SRC };
      return {
        languageId: "csharp", mainUri: CS_URI, files, tree: CS_TREE(),
        defTypes: {
          Owner: {
            uri: CS_URI, hover: "class Owner",
            members: [
              memberIn(files, CS_URI, "RollActive", "RollActive(): long"),
              memberIn(files, CS_URI, "Unlink", "Unlink(): void"),
            ],
          },
          Sibling: {
            uri: CS_URI, hover: "class Sibling",
            members: [
              memberIn(files, CS_URI, "Shown", "Shown(): int"),
              memberIn(files, CS_URI, "Peek", "Peek(): void"),
            ],
          },
          Remote: {
            uri: CS_REMOTE_URI, hover: "class Remote",
            members: [
              memberIn(files, CS_REMOTE_URI, "PublicApi", "PublicApi(): int"),
              memberIn(files, CS_REMOTE_URI, "DetachRemote", "DetachRemote(): void"),
              memberNowhere("FromElsewhere", "FromElsewhere(): int"),
            ],
          },
        },
        spanStart: "public int Absorb", spanEnd: "throw new NotImplementedException();",
        signature: "public int Absorb(Sibling s, Remote r)",
        docComment: "/// <summary>Absorb the sibling and the remote.</summary>", symbolName: "Absorb",
      };
    },
  },
};

// ===========================================================================
// CONTRACT A - the instruction is scoped to the types it names.
// ===========================================================================

// The three payload producers the contract governs. `assembleSurfacePayload` is
// the pure assembler, `resolveSurfaceInjection` the repair-time entry point,
// `resolvePrefill` the round-0 one. Item 6 is the claim that all of them move.
const RS_PAYLOAD_TYPE = "LruCache";
const RS_SIGNATURES = "get(&self, k: &K) -> Option<&V>\nput(&mut self, k: K, v: V) -> Option<V>";

const diag = (code, message, span) => ({
  kind: "compile-error", level: "error", code, message,
  spans: [{ fileName: "src/main.rs", byteStart: 0, byteEnd: 0, lineStart: span.line + 1, lineEnd: span.line + 1, columnStart: span.character + 1, columnEnd: span.character + 3, isPrimary: true }],
  suggestions: [],
});
const methodMiss = (member, type) => `no method named \`${member}\` found for struct \`${type}\` in the current scope`;

// A fake SurfaceExtractor for the repair path: keyed on the cursor line so
// distinct receivers come back with distinct member lists (blind-v6-item4).
const repairExtractor = (members) => ({
  example: async () => undefined,
  completeMembers: async (cursor) => members(cursor.line),
});
const surfaceOf = (r) => (typeof r === "string" ? r : r && r.surface);

const PAYLOAD_PRODUCERS = [
  {
    name: "assembleSurfacePayload (the pure assembler)",
    types: [RS_PAYLOAD_TYPE],
    make: async () => B.assembleSurfacePayload({ typeOrCrate: RS_PAYLOAD_TYPE, signatures: RS_SIGNATURES }),
  },
  {
    name: "resolveSurfaceInjection (repair-time, item 6)",
    types: ["Ledger"],
    make: async () =>
      surfaceOf(
        await B.resolveSurfaceInjection(
          repairExtractor(() => [{ name: "total", signature: "total(&self) -> u64", kind: "method" }]),
          makeDoc("fn f() {}", "file:///x/main.rs"),
          [diag("E0599", methodMiss("grand_total", "Ledger"), { line: 2, character: 4 })],
          () => {},
        ),
      ),
  },
  {
    name: "resolvePrefill (round 0, item 6)",
    types: ["Owner"],
    make: async () => (await runPrefill(VISIBILITY_CASES.rust.scn())).text,
  },
];

for (const p of PAYLOAD_PRODUCERS) {
  btest(`A1 (item 1) ${p.name}: the instruction NAMES the type its surface describes`, async () => {
    const out = await p.make();
    assert.ok(out, `${p.name} must render a payload for this fixture`);
    assertScopedTo(instructionOf(out), p.types, p.name);
  });

  btest(`A2 (item 2) ${p.name}: the instruction is not readable as a global ban`, async () => {
    const out = await p.make();
    assert.ok(out, `${p.name} must render a payload for this fixture`);
    assertNotAGlobalBan(instructionOf(out), p.name);
  });

  // GREEN BOTH SIDES. The frozen marker two other blind oracles pin.
  btest(`A4 (item 4) ${p.name}: the frozen phrase appears at most once, and the payload carries exactly one instruction`, async () => {
    const out = await p.make();
    assert.ok(out, `${p.name} must render a payload for this fixture`);
    assert.ok(
      countOf(out, FROZEN_PHRASE) <= 1,
      `item 4: \`${FROZEN_PHRASE}\` must never appear twice in one payload; got ${countOf(out, FROZEN_PHRASE)}.\n  OUT:\n${out}`,
    );
    assert.strictEqual(
      countOf(out, FROZEN_PHRASE) + countOf(out, ALT_PHRASE),
      1,
      `item 3/4: exactly ONE closing instruction per payload.\n  OUT:\n${out}`,
    );
  });
}

// ===========================================================================
// ITEM 1, SECOND HALF - THE SCOPE IS WHATEVER RENDERED, NEVER "THE RECEIVER".
// After the phase-1 rework a round-0 payload may carry no receiver at all: a
// static utility target gets none by rule (case C), and a file whose symbol
// tree does not resolve gets none by honest degrade. An implementation that
// hard-codes the receiver as the instruction's scope then names a type that is
// not in the payload - which is the capture's failure inverted, an instruction
// about something the model cannot see.
// ===========================================================================

// A module-scope function declared AFTER an `impl Owner` block. `Owner` is in
// the file, is a resolvable type, and is NOT the target's container - so it
// renders no block and the instruction has no business naming it.
const RS_FREE_URI = "file:///w/v24p2/free.rs";
const RS_FREE_SRC = `struct Widget {
    mass: u32,
}

pub struct Owner {
    slots: u32,
}

impl Owner {
    pub fn roll_active(&self) -> u64 {
        0
    }
}

/// Absorb the widget.
fn absorb(w: Widget) -> u32 {
    todo!()
}
`;
const RS_FREE_TREE = () => [
  dsym("Widget", SK.Struct, rng(RS_FREE_SRC, "struct Widget", "    mass: u32,"), []),
  dsym("Owner", SK.Struct, rng(RS_FREE_SRC, "pub struct Owner", "    slots: u32,"), []),
  // `to` must be a needle unique to the intended line: a bare "}" would match
  // the FIRST closing brace in the file (Widget's, above) and build an inverted
  // range. The impl block ends at its method's closing brace here.
  dsym("impl Owner", SK.Object, rng(RS_FREE_SRC, "impl Owner {", "    }"), [
    dsym("roll_active", SK.Method, rng(RS_FREE_SRC, "pub fn roll_active", "    }"), [], "fn(&self) -> u64"),
  ]),
  dsym("absorb", SK.Function, rng(RS_FREE_SRC, "fn absorb(w: Widget)"), [], "fn(w: Widget) -> u32"),
];

// A static utility INSIDE a class. The container is unambiguous and the tree
// resolves it perfectly - phase 1 injects nothing for it anyway, because the
// target neither takes one nor builds one. The instruction must follow the
// payload, not the container.
const CS_STATIC_URI = "file:///w/v24p2/Tally.cs";
const CS_STATIC_SRC = `namespace P;

public class Widget
{
    public int Mass;
}

public class Owner
{
    public int Slots;

    /// <summary>Tally the widget.</summary>
    public static int Tally(Widget w)
    {
        throw new NotImplementedException();
    }
}
`;
const CS_STATIC_TREE = () => [
  dsym("Widget", SK.Class, rng(CS_STATIC_SRC, "public class Widget", "    public int Mass;"), []),
  dsym("Owner", SK.Class, rng(CS_STATIC_SRC, "public class Owner"), [
    dsym("Slots", SK.Field, rng(CS_STATIC_SRC, "    public int Slots;", "    public int Slots;"), []),
    dsym("Tally", SK.Method, rng(CS_STATIC_SRC, "public static int Tally"), []),
  ]),
];

const NO_RECEIVER_CASES = [
  {
    name: "rust, a module-scope function below an `impl` block",
    why: "there is no enclosing type at all",
    rendered: "Widget",
    absent: "Owner",
    scn: {
      languageId: "rust", mainUri: RS_FREE_URI, files: { [RS_FREE_URI]: RS_FREE_SRC }, tree: RS_FREE_TREE(),
      defTypes: {
        Widget: { uri: RS_FREE_URI, hover: "pub struct Widget { mass: u32 }", members: [{ name: "mass_of", signature: "mass_of(&self) -> u32", kind: "method" }] },
        Owner: { uri: RS_FREE_URI, hover: "pub struct Owner { slots: u32 }", members: [{ name: "roll_active", signature: "roll_active(&self) -> u64", kind: "method" }] },
      },
      spanStart: "fn absorb(w: Widget)", spanEnd: "todo!()\n}",
      signature: "fn absorb(w: Widget) -> u32", docComment: "/// Absorb the widget.", symbolName: "absorb",
    },
  },
  {
    name: "csharp, a static utility inside a class",
    why: "the target neither takes the enclosing type nor builds one, so phase 1 injects none",
    rendered: "Widget",
    absent: "Owner",
    scn: {
      languageId: "csharp", mainUri: CS_STATIC_URI, files: { [CS_STATIC_URI]: CS_STATIC_SRC }, tree: CS_STATIC_TREE(),
      defTypes: {
        Widget: { uri: CS_STATIC_URI, hover: "class Widget", members: [{ name: "MassOf", signature: "MassOf(): int", kind: "method" }] },
        Owner: { uri: CS_STATIC_URI, hover: "class Owner", members: [{ name: "RollActive", signature: "RollActive(): long", kind: "method" }] },
      },
      spanStart: "public static int Tally", spanEnd: "throw new NotImplementedException();",
      signature: "public static int Tally(Widget w)", docComment: "/// <summary>Tally the widget.</summary>", symbolName: "Tally",
    },
  },
];

for (const c of NO_RECEIVER_CASES) {
  btest(`A1b (item 1) [${c.name}]: with no receiver in the payload the instruction scopes to what RENDERED, and names no receiver`, async () => {
    const r = await runPrefill(c.scn);
    assert.deepStrictEqual(
      r.names,
      [c.rendered],
      `fixture precondition: exactly one block renders here (${c.why}), so the instruction's scope is unambiguous.${dump(r)}`,
    );
    const instruction = instructionOf(r.text);
    assertScopedTo(instruction, [c.rendered], `no-receiver payload [${c.name}]`);
    assert.ok(
      !new RegExp(`\\b${c.absent}\\b`).test(instruction),
      `item 1: \`${c.absent}\` rendered no block in this payload, so the instruction must not name it. An instruction hard-coded to the receiver points the model at a surface it cannot see.\n  INSTRUCTION: ${JSON.stringify(instruction)}${dump(r)}`,
    );
  });
}

// Item 6 as its own claim: fixing one entry point and not the other leaves the
// capture's failure reachable, so BOTH are asserted in one row.
btest("A6 (item 6): the pre-fill AND the repair-time surface both carry a scoped instruction", async () => {
  const prefill = (await runPrefill(VISIBILITY_CASES.rust.scn())).text;
  const repair = surfaceOf(
    await B.resolveSurfaceInjection(
      repairExtractor(() => [{ name: "total", signature: "total(&self) -> u64", kind: "method" }]),
      makeDoc("fn f() {}", "file:///x/main.rs"),
      [diag("E0599", methodMiss("grand_total", "Ledger"), { line: 2, character: 4 })],
      () => {},
    ),
  );
  assertScopedTo(instructionOf(prefill), ["Owner"], "round-0 pre-fill");
  assertNotAGlobalBan(instructionOf(prefill), "round-0 pre-fill");
  assertScopedTo(instructionOf(repair), ["Ledger"], "repair-time surface");
  assertNotAGlobalBan(instructionOf(repair), "repair-time surface");
});

// Item 3: a payload carrying SEVERAL surface blocks carries ONE instruction
// governing all of them - and, per item 1, that one instruction names them all.
btest("A3 (item 3): a two-block payload carries exactly one instruction, and it names BOTH types", async () => {
  const out = surfaceOf(
    await B.resolveSurfaceInjection(
      repairExtractor((line) => [{ name: `mem${line}`, signature: `mem${line}(&self) -> usize`, kind: "method" }]),
      makeDoc("fn f() {}", "file:///x/main.rs"),
      [
        diag("E0599", methodMiss("total", "Alpha"), { line: 2, character: 4 }),
        diag("E0599", methodMiss("size", "Beta"), { line: 3, character: 4 }),
      ],
      () => {},
    ),
  );
  assert.ok(out, "a payload is produced");
  assert.ok(out.includes("`Alpha`") && out.includes("`Beta`"), `fixture precondition: both blocks must be injected.\n  OUT:\n${out}`);
  assert.strictEqual(countOf(out, FROZEN_PHRASE), 1, `item 3: one instruction, not one per block.\n  OUT:\n${out}`);
  assertScopedTo(instructionOf(out), ["Alpha", "Beta"], "two-block repair payload");
});

// GREEN BOTH SIDES. Item 5: nothing injected, nothing instructed.
btest("A5 (item 5): a payload with no injected surface carries no instruction at all", async () => {
  assert.strictEqual(B.assembleSurfacePayload({ typeOrCrate: "Widget" }), "", "no example and no signatures renders nothing");
  assert.strictEqual(B.assembleSurfacePayload({ typeOrCrate: "Widget", example: "", signatures: "" }), "");
  assert.strictEqual(
    instructionOf(B.assembleSurfacePayload({ typeOrCrate: "Widget" })),
    undefined,
    "item 5: an empty payload must never carry a bare instruction",
  );
  // ...and the same at the pre-fill entry point: an unresolvable candidate set
  // resolves no surface, so there is nothing to instruct about.
  const uri = "file:///w/v24p2/dark.rs";
  const src = `fn absorb(g: Ghost) -> u32 {
    todo!()
}
`;
  const r = await runPrefill({
    languageId: "rust", mainUri: uri, files: { [uri]: src }, darkTypes: ["Ghost"], defTypes: {},
    spanStart: "fn absorb", spanEnd: "todo!()\n}",
    signature: "fn absorb(g: Ghost) -> u32", docComment: undefined, symbolName: "absorb",
  });
  assert.strictEqual(r.out, undefined, `fixture precondition: nothing here resolves, so there is no surface at all.${dump(r)}`);
  assert.strictEqual(instructionOf(r.text), undefined, `item 5: nothing resolved, so no instruction rides the pre-fill.${dump(r)}`);
  // The paired positive is the A1 pre-fill row: the same entry point, a
  // resolvable fixture, and an instruction present. So "no instruction here"
  // is the gate, not a dead code path.
});

// ===========================================================================
// CONTRACT B - injected members are public members.
// ===========================================================================

for (const [lang, c] of Object.entries(VISIBILITY_CASES)) {
  // THE CAPTURE. `Remote` lives in another module/package/file, so its private
  // members are exactly what the target cannot call. This is the row item 7a
  // leaves untouched, and the only one that ever modelled the real capture.
  btest(`B7 (items 7-8, 7a) [${lang}]: a private member of a type from ANOTHER module is absent; its public one survives. Signal: ${c.signal}`, async () => {
    const r = await runPrefill(c.scn());
    assert.ok(r.names.includes("Remote"), `fixture precondition: the out-of-module type's block must be injected.${dump(r)}`);
    assert.ok(
      r.text.includes(c.remotePublic),
      `the PUBLIC member ${JSON.stringify(c.remotePublic)} must survive - dropping a callable member costs the model the API it needed and no oracle catches that.${dump(r)}`,
    );
    assert.ok(
      !r.text.includes(c.remotePrivate),
      `item 7: the injected surface names ${JSON.stringify(c.remotePrivate)}, a private member of a type the target cannot reach into, under a header promising real signatures to use verbatim. This is the capture verbatim.${dump(r)}`,
    );
    if (c.remotePrivateAlso) {
      assert.ok(
        !r.text.includes(c.remotePrivateAlso),
        `item 8: the other TypeScript spelling of private - a \`#\` name - is just as unreachable from another module.${dump(r)}`,
      );
    }
    // Item 9's degrade, on a type that IS filtered - which is the only place it
    // can be exercised now that the target's own scope is exempt outright.
    if (c.unreadable === undefined) return;
    assert.ok(
      r.text.includes(c.unreadable),
      `item 9: this member of the filtered type has no readable declaration line, so its visibility is unknowable. The fallback is KEEP - injecting a private member costs one compile error the oracle catches in ~200ms, dropping a public one costs the model the API it needed and there is no oracle for that.${dump(r)}`,
    );
  });

  // ITEM 7a, the correction. The target's OWN enclosing type is exempt in every
  // language: `self.unlink()` / `this.Unlink()` compiles.
  btest(`B18 (item 7a) [${lang}]: a private member of the target's OWN enclosing type SURVIVES`, async () => {
    const r = await runPrefill(c.scn());
    assert.ok(r.names.includes("Owner"), `fixture precondition: the receiver's block must be injected.${dump(r)}`);
    assert.ok(
      r.text.includes(c.ownPrivate),
      `item 7a: the target is a method OF \`Owner\`, so \`${c.ownPrivate}\` is callable from it. The \`pub\`/modifier signal answers "visible outside its own scope"; the question this contract asks is "can THIS TARGET call it". Dropping it is the expensive direction on the feature's most common case - the receiver block phase 1 added is the human's own type.${dump(r)}`,
    );
  });

  // ITEM 7a, the part that is NOT uniform. Rust privacy is module-scoped and Go
  // exportedness is package-scoped, so a sibling type in the same file is
  // exempt; C# and TypeScript `private` is TYPE-scoped, so it is not. These two
  // directions together are what stop an implementation taking the cheap
  // same-file shortcut for all four languages.
  btest(
    `B19 (item 7a) [${lang}]: a private member of a DIFFERENT type in the SAME FILE is ${c.siblingExempt ? "KEPT (module/package-scoped)" : "FILTERED (type-scoped)"}`,
    async () => {
      const r = await runPrefill(c.scn());
      assert.ok(r.names.includes("Sibling"), `fixture precondition: the sibling type's block must be injected.${dump(r)}`);
      if (c.siblingExempt) {
        assert.ok(
          r.text.includes(c.siblingPrivate),
          `item 7a: ${lang} privacy is ${lang === "go" ? "PACKAGE" : "MODULE"}-scoped. \`Sibling\` is declared in the target's own ${lang === "go" ? "package" : "module"}, so a sibling function reads its private members legally. Filtering here is the same expensive mistake as B18, one scope out.${dump(r)}`,
        );
      } else {
        assert.ok(
          !r.text.includes(c.siblingPrivate),
          `item 7a: ${lang} \`private\` is TYPE-scoped, not file-scoped. \`Sibling\` is a DIFFERENT type, so the target genuinely cannot reach its privates - same file or not. An implementation that exempts everything in the file passes B18 and ships this.${dump(r)}`,
        );
      }
    },
  );
}

// GREEN BOTH SIDES. Item 8: Python is explicitly UNCHANGED this phase. The
// standing decision to keep single-underscore members is a human call routed to
// session-v24/scraps.md; a phase-2 implementation that "tidies" Python here is
// out of contract.
btest("B8 (item 8) [python]: single-underscore members are KEPT - Python's surface does not change this phase", async () => {
  const files = { [PY_URI]: PY_SRC };
  const r = await runPrefill({
    languageId: "python", mainUri: PY_URI, files, tree: PY_TREE(),
    defTypes: {
      Owner: {
        uri: PY_URI, hover: "class Owner",
        members: [
          memberIn(files, PY_URI, "roll_active", "roll_active(self) -> int"),
          memberIn(files, PY_URI, "_hidden_state", "_hidden_state(self) -> int"),
        ],
      },
      Widget: { uri: PY_URI, hover: "class Widget", members: [] },
    },
    spanStart: "def absorb", spanEnd: "raise NotImplementedError",
    signature: "def absorb(self, w: Widget) -> int", docComment: undefined, symbolName: "absorb",
  });
  assert.ok(r.text.includes("roll_active("), `the public member must be injected.${dump(r)}`);
  assert.ok(
    r.text.includes("_hidden_state"),
    `item 8: Python has no visibility signal, and the codebase carries a standing decision to keep sunder members. Reversing it is a human call, not a phase-2 edit.${dump(r)}`,
  );
});

// ===========================================================================
// ITEM 9 - THE DEGRADE IS ASYMMETRIC. GREEN TODAY, GREEN AFTER. These are the
// rows that separate a real visibility filter from "drop anything I cannot
// prove public", which passes every B7 row and silently strips real API.
// ===========================================================================

// (a) A member with no declaration line at all is covered INSIDE the B7 rows
// above, on the `Remote` type - the only scope where the visibility filter now
// runs at all. Keeping a separate row here would have exercised the degrade on
// `Owner`, which item 7a exempts outright, so it would pass without testing
// anything. Skipped deliberately, not overlooked.

// (b) The declaration line exists but is not a declaration - the name only
// appears inside a macro invocation, so there is no modifier to read.
const RS_MACRO_URI = "file:///w/v24p2/macro.rs";
const RS_MACRO_SRC = `struct Widget {
    mass: u32,
}

pub struct Owner {
    slots: u32,
}

column80_accessors!(Owner, tick_count, slot_count);

impl Owner {
    pub fn roll_active(&self) -> u64 {
        0
    }

    /// Absorb the widget into the owner.
    pub fn absorb(&self, w: Widget) -> u32 {
        todo!()
    }
}
`;
const RS_MACRO_TREE = () => [
  dsym("Widget", SK.Struct, rng(RS_MACRO_SRC, "struct Widget", "    mass: u32,"), []),
  dsym("Owner", SK.Struct, rng(RS_MACRO_SRC, "pub struct Owner", "    slots: u32,"), []),
  dsym("impl Owner", SK.Object, rng(RS_MACRO_SRC, "impl Owner {"), [
    dsym("roll_active", SK.Method, rng(RS_MACRO_SRC, "pub fn roll_active", "    /// Absorb the widget into the owner."), [], "fn(&self) -> u64"),
    dsym("absorb", SK.Method, rng(RS_MACRO_SRC, "pub fn absorb"), [], "fn(&self, w: Widget) -> u32"),
  ]),
];
btest("B9b (item 9) [rust]: a macro-generated member, whose only line is unparseable as a declaration, is KEPT", async () => {
  const files = { [RS_MACRO_URI]: RS_MACRO_SRC };
  const r = await runPrefill({
    languageId: "rust", mainUri: RS_MACRO_URI, files, tree: RS_MACRO_TREE(),
    defTypes: {
      Owner: {
        uri: RS_MACRO_URI, hover: "pub struct Owner { slots: u32 }",
        members: [
          memberIn(files, RS_MACRO_URI, "roll_active", "roll_active(&self) -> u64"),
          memberIn(files, RS_MACRO_URI, "tick_count", "tick_count(&self) -> u64"),
        ],
      },
      Widget: { uri: RS_MACRO_URI, hover: "pub struct Widget { mass: u32 }", members: [] },
    },
    spanStart: "pub fn absorb", spanEnd: "todo!()\n    }",
    signature: "pub fn absorb(&self, w: Widget) -> u32",
    docComment: "/// Absorb the widget into the owner.", symbolName: "absorb",
  });
  assert.ok(r.text.includes("roll_active("), `fixture precondition: the readable public member is injected.${dump(r)}`);
  assert.ok(
    r.text.includes("tick_count"),
    `item 9: \`column80_accessors!(...)\` is not a declaration line - it carries no \`pub\`, but it also carries no visibility answer. "No pub on the line" is not the same claim as "private", and treating them as one drops real API.${dump(r)}`,
  );
});

// (c) C# INTERFACE members. Item 8's C# rule is scoped to a CLASS member; an
// interface member with no modifier is PUBLIC. An implementation that applies
// "no modifier means private" uniformly drops every member of every interface
// receiver - the sharpest form of the drop-on-uncertainty failure.
const CS_IFACE_URI = "file:///w/v24p2/IOwner.cs";
const CS_IFACE_SRC = `namespace P;

public interface IOwner
{
    long RollActive();
}

public class Handler
{
    /// <summary>Absorb through the owner.</summary>
    public int Absorb(IOwner o)
    {
        throw new NotImplementedException();
    }
}
`;
const CS_IFACE_TREE = () => [
  dsym("IOwner", SK.Interface, rng(CS_IFACE_SRC, "public interface IOwner", "    long RollActive();"), [
    dsym("RollActive", SK.Method, rng(CS_IFACE_SRC, "    long RollActive();", "    long RollActive();"), []),
  ]),
  dsym("Handler", SK.Class, rng(CS_IFACE_SRC, "public class Handler"), [
    dsym("Absorb", SK.Method, rng(CS_IFACE_SRC, "public int Absorb"), []),
  ]),
];
btest("B9c (item 9) [csharp]: an INTERFACE member with no modifier is public and is KEPT - the C# default is a class rule", async () => {
  const files = { [CS_IFACE_URI]: CS_IFACE_SRC };
  const r = await runPrefill({
    languageId: "csharp", mainUri: CS_IFACE_URI, files, tree: CS_IFACE_TREE(),
    defTypes: {
      IOwner: {
        uri: CS_IFACE_URI, hover: "interface IOwner",
        members: [memberIn(files, CS_IFACE_URI, "RollActive", "RollActive(): long")],
      },
      Handler: { uri: CS_IFACE_URI, hover: "class Handler", members: [] },
    },
    spanStart: "public int Absorb", spanEnd: "throw new NotImplementedException();",
    signature: "public int Absorb(IOwner o)",
    docComment: "/// <summary>Absorb through the owner.</summary>", symbolName: "Absorb",
  });
  assert.ok(
    r.text.includes("RollActive"),
    `item 9 + item 8: \`long RollActive();\` inside an interface has no accessibility modifier because C# forbids one there - it is PUBLIC. Applying the class default uniformly strips every interface receiver's whole surface, and no oracle catches a surface that is merely absent.${dump(r)}`,
  );
});

// ===========================================================================
// ITEM 9a - THE VISIBILITY PASS AND THE ROLE PASS ARE INDEPENDENT.
//
// After the phase-1 rework there are two reasons a member can leave a surface,
// and they argue in OPPOSITE directions: visibility KEEPS on uncertainty (item
// 9), role DROPS public instance methods at a construction target (phase 1's
// case B). Both are right, and they stay right only while they are separate
// passes. Merged, a construction target loses a public PRODUCER whose
// declaration line happens to be unreadable - item 9's exact failure arriving
// through the other door, and there is no oracle downstream for a surface that
// is merely absent.
//
// These are case-B targets: no receiver in the signature, a return type naming
// the enclosing type. Only the three languages where BOTH passes can fire -
// Go has no case B (a receiver clause is case A by definition) and Python has
// no visibility signal at all (item 8).
// ===========================================================================

const RS_CTOR_URI = "file:///w/v24p2/ctor.rs";
const RS_CTOR_SRC = `struct Widget {
    mass: u32,
}

pub struct Owner {
    slots: u32,
}

impl Owner {
    pub fn with_slots(w: Widget, n: u32) -> Owner {
        todo!()
    }

    fn from_raw(w: Widget) -> Owner {
        todo!()
    }

    pub fn roll_active(&self) -> u64 {
        0
    }

    /// Build an owner.
    pub fn build(w: Widget) -> Owner {
        todo!()
    }
}
`;
const RS_CTOR_TREE = () => [
  dsym("Widget", SK.Struct, rng(RS_CTOR_SRC, "struct Widget", "    mass: u32,"), []),
  dsym("Owner", SK.Struct, rng(RS_CTOR_SRC, "pub struct Owner", "    slots: u32,"), []),
  dsym("impl Owner", SK.Object, rng(RS_CTOR_SRC, "impl Owner {"), [
    dsym("with_slots", SK.Function, rng(RS_CTOR_SRC, "pub fn with_slots", "    fn from_raw"), [], "fn(w: Widget, n: u32) -> Owner"),
    dsym("from_raw", SK.Function, rng(RS_CTOR_SRC, "fn from_raw", "    pub fn roll_active"), [], "fn(w: Widget) -> Owner"),
    dsym("roll_active", SK.Method, rng(RS_CTOR_SRC, "pub fn roll_active", "    /// Build an owner."), [], "fn(&self) -> u64"),
    dsym("build", SK.Function, rng(RS_CTOR_SRC, "pub fn build"), [], "fn(w: Widget) -> Owner"),
  ]),
];

const CS_CTOR_URI = "file:///w/v24p2/Ctor.cs";
const CS_CTOR_SRC = `namespace P;

public class Widget
{
    public int Mass;
}

public class Owner
{
    public int Slots;

    public static Owner Make(Widget w)
    {
        throw new NotImplementedException();
    }

    static Owner FromRaw(Widget w)
    {
        throw new NotImplementedException();
    }

    public long RollActive()
    {
        return 0;
    }

    /// <summary>Build an owner.</summary>
    public static Owner Build(Widget w)
    {
        throw new NotImplementedException();
    }
}
`;
const CS_CTOR_TREE = () => [
  dsym("Widget", SK.Class, rng(CS_CTOR_SRC, "public class Widget", "    public int Mass;"), []),
  dsym("Owner", SK.Class, rng(CS_CTOR_SRC, "public class Owner"), [
    dsym("Slots", SK.Field, rng(CS_CTOR_SRC, "    public int Slots;", "    public int Slots;"), []),
    dsym("Make", SK.Method, rng(CS_CTOR_SRC, "public static Owner Make", "    static Owner FromRaw"), []),
    dsym("FromRaw", SK.Method, rng(CS_CTOR_SRC, "static Owner FromRaw", "    public long RollActive"), []),
    dsym("RollActive", SK.Method, rng(CS_CTOR_SRC, "public long RollActive", "    /// <summary>Build an owner.</summary>"), []),
    dsym("Build", SK.Method, rng(CS_CTOR_SRC, "public static Owner Build"), []),
  ]),
];

const TS_CTOR_URI = "file:///w/v24p2/ctor.ts";
const TS_CTOR_SRC = `export class Widget {
  mass: number = 0;
}

export class Owner {
  slots: number = 0;

  static make(w: Widget): Owner {
    throw new Error("todo");
  }

  private static fromRaw(w: Widget): Owner {
    throw new Error("todo");
  }

  rollActive(): number {
    return 0;
  }

  /** Build an owner. */
  static build(w: Widget): Owner {
    throw new Error("todo");
  }
}
`;
const TS_CTOR_TREE = () => [
  dsym("Widget", SK.Class, rng(TS_CTOR_SRC, "export class Widget", "  mass: number = 0;"), []),
  dsym("Owner", SK.Class, rng(TS_CTOR_SRC, "export class Owner"), [
    dsym("slots", SK.Field, rng(TS_CTOR_SRC, "  slots: number = 0;", "  slots: number = 0;"), []),
    dsym("make", SK.Method, rng(TS_CTOR_SRC, "static make", "  private static fromRaw"), []),
    dsym("fromRaw", SK.Method, rng(TS_CTOR_SRC, "private static fromRaw", "  rollActive()"), []),
    dsym("rollActive", SK.Method, rng(TS_CTOR_SRC, "rollActive(): number", "  /** Build an owner. */"), []),
    dsym("build", SK.Method, rng(TS_CTOR_SRC, "static build"), []),
  ]),
];

// Each case: a construction target on `Owner` whose member surface carries one
// producer of each kind the two passes must treat differently, plus a public
// instance method the ROLE pass alone is entitled to drop.
const CTOR_CASES = {
  rust: {
    uri: RS_CTOR_URI, src: RS_CTOR_SRC, tree: RS_CTOR_TREE,
    field: "slots: u32",
    keepProducer: "with_slots(",          // public producer, signal readable
    keepUnreadable: "from_elsewhere(",    // producer, signal UNAVAILABLE -> keep
    ownPrivateProducer: "from_raw",              // producer, readably private -> drop
    dropRole: "roll_active",              // public instance method -> role drop
    members: (f) => [
      memberIn(f, RS_CTOR_URI, "slots", "slots: u32", "field"),
      memberIn(f, RS_CTOR_URI, "with_slots", "with_slots(w: Widget, n: u32) -> Owner"),
      memberNowhere("from_elsewhere", "from_elsewhere(w: Widget) -> Owner"),
      memberIn(f, RS_CTOR_URI, "from_raw", "from_raw(w: Widget) -> Owner"),
      memberIn(f, RS_CTOR_URI, "roll_active", "roll_active(&self) -> u64"),
    ],
    target: {
      spanStart: "pub fn build", spanEnd: "todo!()\n    }",
      signature: "pub fn build(w: Widget) -> Owner",
      docComment: "/// Build an owner.", symbolName: "build",
    },
  },
  csharp: {
    uri: CS_CTOR_URI, src: CS_CTOR_SRC, tree: CS_CTOR_TREE,
    field: "Slots: int",
    keepProducer: "Make(",
    keepUnreadable: "Adopted(",
    ownPrivateProducer: "FromRaw",
    dropRole: "RollActive",
    members: (f) => [
      memberIn(f, CS_CTOR_URI, "Slots", "Slots: int", "field"),
      memberIn(f, CS_CTOR_URI, "Make", "Make(Widget): Owner"),
      memberNowhere("Adopted", "Adopted(Widget): Owner"),
      memberIn(f, CS_CTOR_URI, "FromRaw", "FromRaw(Widget): Owner"),
      memberIn(f, CS_CTOR_URI, "RollActive", "RollActive(): long"),
    ],
    target: {
      spanStart: "public static Owner Build", spanEnd: "throw new NotImplementedException();",
      signature: "public static Owner Build(Widget w)",
      docComment: "/// <summary>Build an owner.</summary>", symbolName: "Build",
    },
  },
  typescript: {
    uri: TS_CTOR_URI, src: TS_CTOR_SRC, tree: TS_CTOR_TREE,
    field: "slots: number",
    keepProducer: "make(",
    keepUnreadable: "adopted(",
    ownPrivateProducer: "fromRaw",
    dropRole: "rollActive",
    members: (f) => [
      memberIn(f, TS_CTOR_URI, "slots", "slots: number", "field"),
      memberIn(f, TS_CTOR_URI, "make", "make(w: Widget): Owner"),
      memberNowhere("adopted", "adopted(w: Widget): Owner"),
      memberIn(f, TS_CTOR_URI, "fromRaw", "fromRaw(w: Widget): Owner"),
      memberIn(f, TS_CTOR_URI, "rollActive", "rollActive(): number"),
    ],
    target: {
      spanStart: "static build", spanEnd: `throw new Error("todo");`,
      signature: "static build(w: Widget): Owner",
      docComment: "/** Build an owner. */", symbolName: "build",
    },
  },
};

function ctorScenario(lang) {
  const c = CTOR_CASES[lang];
  const files = { [c.uri]: c.src };
  return {
    languageId: lang, mainUri: c.uri, files, tree: c.tree(),
    defTypes: {
      Owner: { uri: c.uri, hover: lang === "rust" ? "pub struct Owner { slots: u32 }" : "class Owner", members: c.members(files) },
      Widget: { uri: c.uri, hover: lang === "rust" ? "pub struct Widget { mass: u32 }" : "class Widget", members: [] },
    },
    ...c.target,
  };
}

// GREEN BOTH SIDES, and the whole point of item 9a. A producer whose visibility
// cannot be read must survive a construction target - WHILE the role pass is
// demonstrably still narrowing in the same run. That pairing is what makes this
// a merge detector rather than a "nothing filters yet" tautology: an
// implementation that runs one pass over both questions fails the keep half,
// and an implementation that quietly stops narrowing fails the drop half.
for (const lang of Object.keys(CTOR_CASES)) {
  btest(`B9d (item 9a) [${lang}]: at a CONSTRUCTION target, an unreadable producer is KEPT while the role pass still narrows`, async () => {
    const c = CTOR_CASES[lang];
    const r = await runPrefill(ctorScenario(lang));
    assert.ok(r.names.includes("Owner"), `fixture precondition: a construction target still injects the type it builds.${dump(r)}`);
    assert.ok(r.text.includes(c.field), `fixture precondition: case B carries the fields a constructor must fill.${dump(r)}`);
    assert.ok(r.text.includes(c.keepProducer), `fixture precondition: the readably-public producer is offered.${dump(r)}`);
    // The role pass is doing its job in this very run...
    assert.ok(
      !r.text.includes(c.dropRole),
      `fixture precondition (phase 1, case B): the public instance method ${JSON.stringify(c.dropRole)} is noise at a construction target and the ROLE pass drops it. If this fails, the role pass regressed and the rest of this row proves nothing.${dump(r)}`,
    );
    // ...and the visibility pass must not have ridden along with it.
    assert.ok(
      r.text.includes(c.keepUnreadable),
      `item 9a: ${JSON.stringify(c.keepUnreadable)} is a PRODUCER with no readable visibility signal. The role pass has no quarrel with it and the visibility pass keeps on uncertainty, so it must survive. Losing it here means the two passes were merged into one, which is item 9's failure arriving through the other door - and a surface that is merely absent has no oracle.${dump(r)}`,
    );
  });
}

// RE-AIMED by item 7a, and it used to assert the opposite. A construction target
// sits INSIDE the type it builds, so there is no case where a private producer
// of that type should be dropped: `Owner::build` can call `Owner::from_raw`.
// The old row encoded item 8's mechanical signal, which is the thing item 7a
// corrected. RED.
for (const lang of Object.keys(CTOR_CASES)) {
  btest(`B7b (item 7a) [${lang}]: a CONSTRUCTION target KEEPS the private producer of the type it builds`, async () => {
    const c = CTOR_CASES[lang];
    const r = await runPrefill(ctorScenario(lang));
    assert.ok(r.text.includes(c.keepProducer), `fixture precondition: the public producer is offered.${dump(r)}`);
    assert.ok(
      r.text.includes(c.ownPrivateProducer),
      `item 7a: the target is a member of \`Owner\`, so \`${c.ownPrivateProducer}\` is callable from it. A construction target is the LAST place to hide a constructor - it is the one member the body most likely needs.${dump(r)}`,
    );
  });
}

// The human's named case, and the sharpest form of it: the private field a
// constructor exists to FILL must be in the MEMBER list. Rust only - C# `Slots`
// is declared public and TypeScript has no modifier, so neither can carry the
// claim. Asserted against the member block specifically, because the field also
// appears inside the data-shape block's hover text, which would mask the drop.
btest("B7c (item 7a) [rust]: the private FIELD a constructor exists to fill is in the MEMBER list, not only the data-shape block", async () => {
  const r = await runPrefill(ctorScenario("rust"));
  const block = memberBlockOf(r.text, "Owner");
  assert.ok(block, `fixture precondition: \`Owner\` must render a member block.${dump(r)}`);
  assert.ok(
    /\bslots\b/.test(block),
    `item 7a: \`slots\` is a private field of \`Owner\` and the target is \`Owner::build\`, which exists to fill it. Rust privacy is module-scoped, so the field is writable here. It survives in the data-shape block only because that block quotes the hover verbatim - the MEMBER list, the one under a header promising real signatures, has lost it.\n  MEMBER BLOCK:\n${block}${dump(r)}`,
  );
});

// ===========================================================================
// ITEM 10 - A DROPPED MEMBER IS LOGGED, AND THE LINE SAYS WHICH FILTER DROPPED
// IT. Same discipline as phase 1: no silent truncation of a surface. With two
// independent drop reasons an undifferentiated line sends the reader hunting in
// the wrong subsystem.
// ===========================================================================

const VISIBILITY_REASON = /private|non-?public|not public|visibility|unexported|inaccessible|protected|internal|accessib/i;
const ROLE_REASON = /produc|construct|instance method|not a producer|\brole\b|builds?\b|case b|narrow/i;

for (const lang of ["rust", "csharp"]) {
  btest(`B10 (item 10) [${lang}]: a member dropped for VISIBILITY is logged by NAME, and names the visibility filter`, async () => {
    const c = VISIBILITY_CASES[lang];
    const r = await runPrefill(c.scn());
    const dropped = c.remotePrivate;
    const named = r.logs.filter((l) => new RegExp(`\\b${dropped}\\b`).test(l));
    assert.ok(
      named.length >= 1,
      `item 10: dropping ${JSON.stringify(dropped)} from the injected surface must emit a line NAMING it; today it would leave no trace at all.${dump(r)}`,
    );
    assert.ok(
      named.some((l) => VISIBILITY_REASON.test(l)),
      `item 10: the line must say WHY (private / non-public / visibility / unexported).${dump(r)}`,
    );
    assert.ok(
      !named.some((l) => ROLE_REASON.test(l) && !VISIBILITY_REASON.test(l)),
      `item 10: this is a case-A target, so the role pass never fired here. A line blaming the role filter sends the reader into the wrong subsystem.${dump(r)}`,
    );
  });
}

// The differentiation claim itself, at the one target shape where BOTH filters
// fire in a single run.
//
// RE-SPECIFIED. An earlier version of this row required the ROLE-dropped member
// to be named, on the premise (recorded in this file's header, and true when it
// was captured) that the role drop was silent. It is not, and has not been since
// phase 1's item 3d landed: a narrowing line fires naming the COUNT and a
// reason. Item 3d deliberately does not pin per-member naming - a narrowed
// member was never a candidate - so requiring it here demanded more than any
// clause guarantees, and would red on a conforming implementation that reported
// only a count. What both contracts agree on, and what this row now asserts, is
// the intersection: role evidence must EXIST, must read as a role drop, and must
// NOT read as a visibility drop. Silence still fails it.
for (const lang of ["rust", "csharp"]) {
  btest(`B10b (item 10) [${lang}]: at a construction target the two drop reasons are told apart, not merged into one line`, async () => {
    const c = CTOR_CASES[lang];
    const r = await runPrefill(ctorScenario(lang));
    const evidence = r.logs.filter((l) => !/accounting/.test(l) && !/injected types=/.test(l));
    const namesMember = (l, n) => new RegExp(`\\b${n}\\b`).test(l);

    // NARROWED by item 7a. The visibility half used to ride this run: the
    // private producer on `Owner` was dropped and its line checked here. Item
    // 7a exempts the target's own type outright, so at a construction target
    // only the ROLE filter fires now, and there is no cheap way to make both
    // fire in one run without a second remote candidate. The visibility line's
    // own claims (named member, visibility reason, not blaming the role pass)
    // are asserted in B10 instead - together the two rows still cover the
    // differentiation from both sides.
    const role = evidence.filter((l) => ROLE_REASON.test(l) && (namesMember(l, c.dropRole) || /\b1\b/.test(l)));
    assert.ok(
      role.length >= 1,
      `item 10: the role-dropped instance method ${JSON.stringify(c.dropRole)} left the surface and owes evidence - either naming it or (phase 1 item 3d) carrying the removal count with a reason.${dump(r)}`,
    );
    assert.ok(
      !role.some((l) => VISIBILITY_REASON.test(l)),
      `item 10: ${JSON.stringify(c.dropRole)} is PUBLIC and was dropped for its ROLE. Evidence that reads as a visibility drop sends the reader hunting in the wrong subsystem - the exact defect phase 1's review already found once.${dump(r)}`,
    );
  });
}

// ===========================================================================
// ITEM 11 - THE SCOPE BOUNDARY, PINNED FROM OUTSIDE. GREEN TODAY AND GREEN
// AFTER. The contract names the trap explicitly: "a filter placed at the shared
// member renderer would close every render site in one edit AND change FIM
// output." These rows assert the KEEP direction at exactly those shared sites,
// so the cheap wrong fix is caught by an oracle rather than by a user.
// ===========================================================================

const MIXED_MEMBERS = [
  { name: "roll_active", kind: "method", signature: "roll_active(&self) -> u64" },
  { name: "detach", kind: "method", signature: "detach(&mut self)" },
  { name: "_cache", kind: "field", signature: "_cache: u32" },
  { name: "attach", kind: "method", signature: "attach(&mut self, n: u32)" },
];

btest("B11a (item 11): the SHARED member renderer does not filter - it renders every member it is handed", () => {
  const out = B.renderMemberSignatures(MIXED_MEMBERS);
  for (const m of MIXED_MEMBERS) {
    assert.ok(
      out.includes(m.signature),
      `item 11: \`renderMemberSignatures\` is shared with the FIM paths, which this phase must not touch. A visibility filter placed here changes FIM prompt bytes. Missing: ${m.signature}\n  OUT:\n${out}`,
    );
  }
});

btest("B11b (item 11): the FIM candidate render does not filter - no FIM prompt byte moves this phase", () => {
  const out = B.renderFimCandidates(MIXED_MEMBERS, "");
  for (const m of MIXED_MEMBERS) {
    assert.ok(
      out.includes(m.signature),
      `item 11: the FIM candidate block is explicitly out of scope; a filter reaching it is the deferred site, not this phase's. Missing: ${m.signature}\n  OUT:\n${out}`,
    );
  }
});

// ===========================================================================
// ITEM 12 - THE REGRESSION BAR. GREEN TODAY AND GREEN AFTER. With injection off
// the extractor is never constructed, so resolvePrefill runs with
// `extractor: undefined` and must resolve nothing - at a method target whose
// receiver has private members as much as anywhere else.
// ===========================================================================

for (const lang of ["rust", "csharp"]) {
  btest(`B12 (item 12) [${lang}]: with injection off the pre-fill is byte-for-byte v1 - no surface, no instruction, no logs`, async () => {
    // Paired positive first, so this row cannot pass because the fixture stopped
    // resolving anything. The SAME scenario with the extractor present must
    // produce a real surface; only then does its absence mean the gate.
    const on = await runPrefill(VISIBILITY_CASES[lang].scn());
    assert.ok(on.names.includes("Owner"), `paired precondition: with injection ON this fixture resolves a surface.${dump(on)}`);
    const r = await runPrefill({ ...VISIBILITY_CASES[lang].scn(), noExtractor: true });
    assert.strictEqual(r.out, undefined, `injection off must stay byte-for-byte v1.${dump(r)}`);
    assert.deepStrictEqual(r.logs, [], `injection off must emit no pre-fill evidence at all.${dump(r)}`);
  });
}

// ===========================================================================
// ITEM 13 - THE C# `_`-PREFIX STAND-IN IS NARROWED OR RETIRED, NOT LEFT TO
// DOUBLE-FILTER. `_`-prefix is a NAMING CONVENTION, not a fact; once the real
// accessibility modifier is readable the convention must stop overruling it. A
// member C# says is public stays, whatever it is called.
// ===========================================================================

const CS_UNDERSCORE_URI = "file:///w/v24p2/Cache.cs";
const CS_UNDERSCORE_SRC = `namespace P;

public class Widget
{
    public int Mass;
}

public class Owner
{
    public void Tick()
    {
    }

    public long _RollActive()
    {
        return 0;
    }

    private int _scratch()
    {
        return 0;
    }

    /// <summary>Absorb the widget.</summary>
    public int Absorb(Widget w)
    {
        throw new NotImplementedException();
    }
}
`;
const CS_UNDERSCORE_TREE = () => [
  dsym("Widget", SK.Class, rng(CS_UNDERSCORE_SRC, "public class Widget", "    public int Mass;"), []),
  dsym("Owner", SK.Class, rng(CS_UNDERSCORE_SRC, "public class Owner"), [
    dsym("Tick", SK.Method, rng(CS_UNDERSCORE_SRC, "public void Tick()", "    public long _RollActive"), []),
    dsym("_RollActive", SK.Method, rng(CS_UNDERSCORE_SRC, "public long _RollActive", "    private int _scratch"), []),
    dsym("_scratch", SK.Method, rng(CS_UNDERSCORE_SRC, "private int _scratch", "    /// <summary>Absorb the widget.</summary>"), []),
    dsym("Absorb", SK.Method, rng(CS_UNDERSCORE_SRC, "public int Absorb"), []),
  ]),
];
btest("B13 (item 13) [csharp]: a member declared `public` survives whatever its name looks like; the `_` stand-in stops double-filtering", async () => {
  const files = { [CS_UNDERSCORE_URI]: CS_UNDERSCORE_SRC };
  const r = await runPrefill({
    languageId: "csharp", mainUri: CS_UNDERSCORE_URI, files, tree: CS_UNDERSCORE_TREE(),
    defTypes: {
      Owner: {
        uri: CS_UNDERSCORE_URI, hover: "class Owner",
        members: [
          memberIn(files, CS_UNDERSCORE_URI, "Tick", "Tick(): void"),
          memberIn(files, CS_UNDERSCORE_URI, "_RollActive", "_RollActive(): long"),
          memberIn(files, CS_UNDERSCORE_URI, "_scratch", "_scratch(): int"),
        ],
      },
      Widget: { uri: CS_UNDERSCORE_URI, hover: "class Widget", members: [] },
    },
    spanStart: "public int Absorb", spanEnd: "throw new NotImplementedException();",
    signature: "public int Absorb(Widget w)",
    docComment: "/// <summary>Absorb the widget.</summary>", symbolName: "Absorb",
  });
  assert.ok(r.text.includes("Tick("), `fixture precondition: the plainly-named public member renders, so the block exists at all.${dump(r)}`);
  assert.ok(
    r.text.includes("_RollActive"),
    `item 13: \`public long _RollActive()\` is public. The \`_\`-prefix heuristic was a stand-in for the accessibility fact that becomes available in this phase; leaving both in place double-filters and hides real API. Today the underscore alone decides, and the modifier is never read.${dump(r)}`,
  );
  assert.ok(
    r.text.includes("_scratch"),
    `item 13 + item 7a: \`private int _scratch()\` is a member of the target's OWN enclosing type, so the target can call it and the visibility filter does not reach it. That leaves nothing but the \`_\` convention to drop it on - which is exactly what item 13 says must stop. The underscore was a stand-in for a fact; the fact now says keep.${dump(r)}`,
  );
});

// ===========================================================================
// ITEM 14 - NO CAP, BUDGET, OR BOUND CONSTANT MOVES IN THIS PHASE. GREEN TODAY
// AND GREEN AFTER. Values CAPTURED by reading the exports through this harness,
// never copied out of source; a diff here is a phase-scope violation, not a
// contract failure. Filtering members is not a licence to re-budget the block.
// ===========================================================================

// ===========================================================================
// C# SHAPES THE WALK REACHES THAT NO FIXTURE ABOVE CARRIES.
//
// Three dimensions, all C#, all found by adversarial review after the phase
// landed green against the rows above. Two of them were STRUCTURALLY invisible
// here: an enum was in no fixture at all, and every collaborator carried an
// empty member list so a payload never rendered more than one type's block.
// A suite that cannot see a defect is not evidence that the defect is absent.
// ===========================================================================

// ---------------------------------------------------------------------------
// 1. AN ENUM. C# enum members carry no accessibility modifier and CANNOT - the
// syntax does not allow one. An implementation applying the class-member
// default (no modifier means private) drops every member, and the block then
// disappears entirely. The model is then told not to invent beyond a surface
// that no longer names the enum it has to return: the capture's own failure,
// manufactured by the fix meant to prevent it.
// ---------------------------------------------------------------------------

const CS_ENUM_URI = "file:///w/v24p2/Mode.cs";
const CS_ENUM_SRC = `namespace P;

public enum Mode
{
    Idle,
    Running,
    Stopped,
}

public class Owner
{
    public void Reset()
    {
    }

    /// <summary>Pick a mode for the tick count.</summary>
    public Mode Pick(int ticks)
    {
        throw new NotImplementedException();
    }
}
`;
const CS_ENUM_TREE = () => [
  dsym("Mode", SK.Enum, rng(CS_ENUM_SRC, "public enum Mode", "}"), [
    dsym("Idle", SK.EnumMember, rng(CS_ENUM_SRC, "    Idle,", "    Idle,"), []),
    dsym("Running", SK.EnumMember, rng(CS_ENUM_SRC, "    Running,", "    Running,"), []),
    dsym("Stopped", SK.EnumMember, rng(CS_ENUM_SRC, "    Stopped,", "    Stopped,"), []),
  ]),
  dsym("Owner", SK.Class, rng(CS_ENUM_SRC, "public class Owner"), [
    dsym("Reset", SK.Method, rng(CS_ENUM_SRC, "public void Reset", "    /// <summary>Pick a mode for the tick count.</summary>"), []),
    dsym("Pick", SK.Method, rng(CS_ENUM_SRC, "public Mode Pick"), []),
  ]),
];

const ENUM_MEMBERS = ["Idle", "Running", "Stopped"];

btest("B15 (items 7-9) [csharp]: an ENUM's members survive - they carry no modifier because the syntax forbids one, which is not the same claim as private", async () => {
  const files = { [CS_ENUM_URI]: CS_ENUM_SRC };
  const r = await runPrefill({
    languageId: "csharp", mainUri: CS_ENUM_URI, files, tree: CS_ENUM_TREE(),
    defTypes: {
      Mode: {
        uri: CS_ENUM_URI, hover: "enum Mode",
        members: ENUM_MEMBERS.map((n) => memberIn(files, CS_ENUM_URI, n, `${n}: Mode`, "field")),
      },
      Owner: { uri: CS_ENUM_URI, hover: "class Owner", members: [memberIn(files, CS_ENUM_URI, "Reset", "Reset(): void")] },
    },
    spanStart: "public Mode Pick", spanEnd: "throw new NotImplementedException();",
    signature: "public Mode Pick(int ticks)",
    docComment: "/// <summary>Pick a mode for the tick count.</summary>", symbolName: "Pick",
  });
  assert.ok(
    r.names.includes("Mode"),
    `items 7-9: the target RETURNS a \`Mode\`, so the enum is the one surface it cannot do without. Applying the C# class-member default to enum members drops all three, the block renders nothing and vanishes, and the instruction then forbids inventing beyond a surface that no longer names the enum. That is the capture's failure manufactured by the fix.${dump(r)}`,
  );
  for (const m of ENUM_MEMBERS) {
    assert.ok(
      r.text.includes(m),
      `item 9: \`${m}\` has no accessibility modifier because C# FORBIDS one on an enum member. "No modifier" is the class-member default, not a universal one, and absence of a signal is never evidence of privacy.${dump(r)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 2. A COLLABORATOR THAT CARRIES MEMBERS. Every C# collaborator above has an
// empty member list, so a C# payload has never rendered more than one type's
// block and item 1's scope has never been testable there - a one-type payload
// cannot distinguish "scopes to what rendered" from "scopes to the receiver".
// ---------------------------------------------------------------------------

const CS_COLLAB_URI = "file:///w/v24p2/Collab.cs";
const CS_COLLAB_SRC = `namespace P;

public class Widget
{
    public int Mass;

    public int MassOf()
    {
        return 0;
    }
}

public class Owner
{
    public long RollActive()
    {
        return 0;
    }

    /// <summary>Absorb the widget.</summary>
    public int Absorb(Widget w)
    {
        throw new NotImplementedException();
    }
}
`;
const CS_COLLAB_TREE = () => [
  dsym("Widget", SK.Class, rng(CS_COLLAB_SRC, "public class Widget", "}\n\npublic class Owner"), [
    dsym("Mass", SK.Field, rng(CS_COLLAB_SRC, "    public int Mass;", "    public int Mass;"), []),
    dsym("MassOf", SK.Method, rng(CS_COLLAB_SRC, "public int MassOf", "    }"), []),
  ]),
  dsym("Owner", SK.Class, rng(CS_COLLAB_SRC, "public class Owner"), [
    dsym("RollActive", SK.Method, rng(CS_COLLAB_SRC, "public long RollActive", "    /// <summary>Absorb the widget.</summary>"), []),
    dsym("Absorb", SK.Method, rng(CS_COLLAB_SRC, "public int Absorb"), []),
  ]),
];

const collabScenario = () => {
  const files = { [CS_COLLAB_URI]: CS_COLLAB_SRC };
  return {
    languageId: "csharp", mainUri: CS_COLLAB_URI, files, tree: CS_COLLAB_TREE(),
    defTypes: {
      Owner: { uri: CS_COLLAB_URI, hover: "class Owner", members: [memberIn(files, CS_COLLAB_URI, "RollActive", "RollActive(): long")] },
      Widget: {
        uri: CS_COLLAB_URI, hover: "class Widget",
        members: [
          memberIn(files, CS_COLLAB_URI, "Mass", "Mass: int", "field"),
          memberIn(files, CS_COLLAB_URI, "MassOf", "MassOf(): int"),
        ],
      },
    },
    spanStart: "public int Absorb", spanEnd: "throw new NotImplementedException();",
    signature: "public int Absorb(Widget w)",
    docComment: "/// <summary>Absorb the widget.</summary>", symbolName: "Absorb",
  };
};

btest("A1d (item 1) [csharp]: when a candidate AND its collaborator both render, the instruction names EVERY type that rendered", async () => {
  const r = await runPrefill(collabScenario());
  assert.ok(
    r.names.length >= 2,
    `fixture precondition: this row exists because a one-block payload cannot tell "scopes to what rendered" from "scopes to the receiver". Both blocks must render, which needs a collaborator that CARRIES members - every other C# fixture here hands it an empty list.${dump(r)}`,
  );
  const instruction = instructionOf(r.text);
  assertScopedTo(instruction, r.names, "csharp candidate + collaborator");
});

// ---------------------------------------------------------------------------
// ...and the general form, which is the one that actually holds item 1 down.
// A1/A1b/A1d each name their expected types by hand; this sweep derives the
// expected scope FROM THE RUN - every type that rendered a block is named, and
// every type that rendered none is not - across every payload shape in this
// file. A payload can only be checked against itself here, which is the point:
// the contract says "whatever rendered", so the oracle must read what rendered.
// ---------------------------------------------------------------------------

const SCOPE_SWEEP = [
  { name: "rust, receiver + signature candidate", scn: () => VISIBILITY_CASES.rust.scn(), absent: [] },
  { name: "typescript, receiver + signature candidate", scn: () => VISIBILITY_CASES.typescript.scn(), absent: [] },
  { name: "csharp, candidate + collaborator that carries members", scn: collabScenario, absent: [] },
  { name: "csharp, a collaborator renders and the receiver does not", scn: () => spellScenario(), absent: ["Owner"] },
  { name: "rust, a construction target", scn: () => ctorScenario("rust"), absent: [] },
];

for (const c of SCOPE_SWEEP) {
  btest(`A1e (item 1) [${c.name}]: the instruction's scope is exactly the set of types that RENDERED`, async () => {
    const r = await runPrefill(c.scn());
    assert.ok(r.names.length >= 1, `fixture precondition: something must render for a scope to exist.${dump(r)}`);
    const instruction = instructionOf(r.text);
    assertScopedTo(instruction, r.names, `scope sweep [${c.name}]`);
    for (const t of c.absent) {
      assert.ok(
        !r.names.includes(t),
        `fixture precondition: \`${t}\` is supposed to render nothing here, which is what makes it a scope test.${dump(r)}`,
      );
      assert.ok(
        !new RegExp(`\\b${t}\\b`).test(instruction),
        `item 1: \`${t}\` rendered no block, so the instruction must not name it - the model would be pointed at a surface it cannot see.\n  INSTRUCTION: ${JSON.stringify(instruction)}${dump(r)}`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 3. PRIVATE FIELD SPELLINGS A MODIFIER CHECK GETS WRONG, AND THE EXPENSIVE
// INVERSE. The three below are reproduced; the list is ILLUSTRATIVE, not
// exhaustive - the third was found by triage rather than by the review, so a
// modifier check that special-cases exactly these three has not solved the
// problem, it has memorised the test.
// ---------------------------------------------------------------------------

const CS_SPELL_URI = "file:///w/v24p2/Spellings.cs";
const CS_SPELL_SRC = `namespace P;

public class Cache
{
    private System.Timers.Timer _timer;

    private int _a, _b;

    private Dictionary<string, int> _map;

    public int Hits;

    public int Lookup(string k)
    {
        return 0;
    }
}

public class Owner
{
    /// <summary>Read the cache.</summary>
    public int Read(Cache c)
    {
        throw new NotImplementedException();
    }
}
`;
const CS_SPELL_TREE = () => [
  dsym("Cache", SK.Class, rng(CS_SPELL_SRC, "public class Cache", "}\n\npublic class Owner"), [
    dsym("_timer", SK.Field, rng(CS_SPELL_SRC, "    private System.Timers.Timer _timer;", "    private System.Timers.Timer _timer;"), []),
    dsym("_a", SK.Field, rng(CS_SPELL_SRC, "    private int _a, _b;", "    private int _a, _b;"), []),
    dsym("_b", SK.Field, rng(CS_SPELL_SRC, "    private int _a, _b;", "    private int _a, _b;"), []),
    dsym("_map", SK.Field, rng(CS_SPELL_SRC, "    private Dictionary<string, int> _map;", "    private Dictionary<string, int> _map;"), []),
    dsym("Hits", SK.Field, rng(CS_SPELL_SRC, "    public int Hits;", "    public int Hits;"), []),
    dsym("Lookup", SK.Method, rng(CS_SPELL_SRC, "public int Lookup", "    }\n}"), []),
  ]),
  dsym("Owner", SK.Class, rng(CS_SPELL_SRC, "public class Owner"), [
    dsym("Read", SK.Method, rng(CS_SPELL_SRC, "public int Read"), []),
  ]),
];

// `_b` needs its own selection: `memberIn`/`nameSelection` both take the FIRST
// match on the line, which for a multi-declarator line is `_a`'s column.
const SPELL_DROP = [
  { name: "_timer", signature: "_timer: System.Timers.Timer", why: "a dotted, namespace-qualified type name" },
  { name: "_a", signature: "_a: int", why: "the first declarator of a multi-declarator line" },
  { name: "_b", signature: "_b: int", why: "the SECOND declarator, whose name is nowhere near the modifier" },
  { name: "_map", signature: "_map: Dictionary<string, int>", why: "a generic type whose argument list carries a comma and angle brackets" },
];

function spellScenario() {
  const files = { [CS_SPELL_URI]: CS_SPELL_SRC };
  return {
    languageId: "csharp", mainUri: CS_SPELL_URI, files, tree: CS_SPELL_TREE(),
    defTypes: {
      Cache: {
        uri: CS_SPELL_URI, hover: "class Cache",
        members: [
          ...SPELL_DROP.map((f) => memberIn(files, CS_SPELL_URI, f.name, f.signature, "field")),
          memberIn(files, CS_SPELL_URI, "Hits", "Hits: int", "field"),
          memberIn(files, CS_SPELL_URI, "Lookup", "Lookup(string): int"),
        ],
      },
      Owner: { uri: CS_SPELL_URI, hover: "class Owner", members: [] },
    },
    spanStart: "public int Read", spanEnd: "throw new NotImplementedException();",
    signature: "public int Read(Cache c)",
    docComment: "/// <summary>Read the cache.</summary>", symbolName: "Read",
  };
}

btest("B16 (items 7-8) [csharp]: private fields survive no spelling of their declaration - dotted, multi-declarator, or generic", async () => {
  const r = await runPrefill(spellScenario());
  assert.ok(r.names.includes("Cache"), `fixture precondition: the collaborator's block must render.${dump(r)}`);
  // The KEEP direction first, so a row that goes green by emptying the block
  // cannot be mistaken for a fix.
  assert.ok(r.text.includes("Hits"), `fixture precondition: the plainly-spelled public field survives.${dump(r)}`);
  assert.ok(r.text.includes("Lookup("), `fixture precondition: the plainly-spelled public method survives.${dump(r)}`);
  for (const f of SPELL_DROP) {
    assert.ok(
      !r.text.includes(f.name),
      `items 7-8: \`private ... ${f.name}\` is private and the declaration says so plainly - ${f.why} is a parsing problem, not an unknowable signal. It ships under a header promising real signatures to use verbatim.${dump(r)}`,
    );
  }
});

// The expensive direction, and the one that matters more: a modifier check that
// reads the LINE rather than the DECLARATOR drops the public member sharing it.
// Injecting a private member costs one compile error the oracle catches; losing
// a public one costs the model an API and nothing catches it at all.
const CS_ONELINE_URI = "file:///w/v24p2/OneLine.cs";
const CS_ONELINE_SRC = `namespace P;

public class Cache { private int _a; public int B; }

public class Owner
{
    /// <summary>Read the cache.</summary>
    public int Read(Cache c)
    {
        throw new NotImplementedException();
    }
}
`;
const CS_ONELINE_TREE = () => [
  dsym("Cache", SK.Class, rng(CS_ONELINE_SRC, "public class Cache {", "public class Cache {"), [
    dsym("_a", SK.Field, rng(CS_ONELINE_SRC, "public class Cache {", "public class Cache {"), []),
    dsym("B", SK.Field, rng(CS_ONELINE_SRC, "public class Cache {", "public class Cache {"), []),
  ]),
  dsym("Owner", SK.Class, rng(CS_ONELINE_SRC, "public class Owner"), [
    dsym("Read", SK.Method, rng(CS_ONELINE_SRC, "public int Read"), []),
  ]),
];

btest("B17 (items 7 + 9) [csharp]: a PUBLIC member sharing a source line with a private one SURVIVES", async () => {
  const files = { [CS_ONELINE_URI]: CS_ONELINE_SRC };
  const r = await runPrefill({
    languageId: "csharp", mainUri: CS_ONELINE_URI, files, tree: CS_ONELINE_TREE(),
    defTypes: {
      Cache: {
        uri: CS_ONELINE_URI, hover: "class Cache",
        members: [
          memberIn(files, CS_ONELINE_URI, "_a", "_a: int", "field"),
          memberIn(files, CS_ONELINE_URI, "B", "B: int", "field"),
        ],
      },
      Owner: { uri: CS_ONELINE_URI, hover: "class Owner", members: [] },
    },
    spanStart: "public int Read", spanEnd: "throw new NotImplementedException();",
    signature: "public int Read(Cache c)",
    docComment: "/// <summary>Read the cache.</summary>", symbolName: "Read",
  });
  assert.ok(
    r.text.includes("B"),
    `items 7 + 9: \`public int B\` is public. A modifier check that reads the LINE instead of the DECLARATOR sees \`private\` on it and drops B with _a. That is the expensive direction: an injected private member costs one compile error the oracle catches in ~200ms, a lost public member costs the model an API and no oracle exists for it.${dump(r)}`,
  );
  assert.ok(
    !r.text.includes("_a"),
    `item 7: \`private int _a\` on the same line is still private.${dump(r)}`,
  );
});

// ===========================================================================
// FIXTURE FIDELITY GUARD. GREEN NOW AND AFTER, and it guards the file itself
// rather than the product. Every contract-B row here is built on a symbol tree;
// if that tree models a shape no server produces, the rows test something no
// product ever sees. This one shape was wrong: `selectionRange` was the whole
// node span, so every anchor landed at column 0 on a keyword. Expected columns
// are read straight off the tables in `session-v24/measure-midedit.md`.
//
// It reads the SELECTED TEXT back out of the source, so a regression to the
// full-span shape shows up as `impl` / `public` / `export` / `func` rather than
// as a silently weakened anchor.
// ===========================================================================

btest("FIXTURE FIDELITY: every node's `selectionRange` covers the NAME TOKEN, never the header keyword", () => {
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

  // One row per language, at the container shape each server reports.
  assert.strictEqual(textOf(RS_SRC, at(RS_TREE(), "impl Owner")), "Owner", "an impl node selects its SELF TYPE, never `impl`");
  assert.strictEqual(textOf(CS_SRC, at(CS_TREE(), "Owner")), "Owner", "a C# class node selects the class name, never `public`");
  assert.strictEqual(textOf(TS_SRC, at(TS_TREE(), "Owner")), "Owner", "a TS class node selects the class name, never `export`");
  assert.strictEqual(textOf(PY_SRC, at(PY_TREE(), "Owner")), "Owner", "a Python class node selects the class name, never `class`");
  assert.strictEqual(textOf(GO_SRC, at(GO_TREE(), "(*Owner).Absorb")), "Absorb", "a Go method node selects the METHOD name, not the receiver and not `func`");

  // Member nodes select their own name too - the private ones this phase is
  // about are exactly the nodes whose lines lead with a visibility keyword.
  assert.strictEqual(textOf(RS_SRC, at(RS_TREE(), "unlink")), "unlink", "a rust member selects its name, not the `fn`");
  assert.strictEqual(textOf(TS_SRC, at(TS_TREE(), "peek")), "peek", "a TS member selects its name, not the `private`");
  assert.strictEqual(textOf(CS_SRC, at(CS_TREE(), "Unlink")), "Unlink", "a C# member selects its name, not its leading keyword");
  assert.strictEqual(textOf(CS_UNDERSCORE_SRC, at(CS_UNDERSCORE_TREE(), "_RollActive")), "_RollActive", "an underscore-named public member selects its whole name");

  // The two impl shapes the measurement calls out by name, since neither is
  // simply "the node's name" and both are load-bearing for a Rust receiver.
  const traitTree = [dsym("impl Persist for Owner", SK.Object, rng(RS_SRC, "impl Owner {"), [])];
  assert.strictEqual(
    RS_SRC.split("\n")[traitTree[0].selectionRange.start.line].slice(traitTree[0].selectionRange.start.character, traitTree[0].selectionRange.end.character),
    "Owner",
    "`impl Persist for Owner` selects `Owner`, never `Persist`",
  );
  assert.strictEqual(selectionTokenFor("impl Cache<T>"), "Cache<T>", "a generic impl's selection INCLUDES the argument list");
  assert.strictEqual(selectionTokenFor("impl<T: Clone> Cache<T>"), "Cache<T>", "the impl's own generic parameters are not part of the selection");

  // Enum members select their own name too - the dimension no fixture carried
  // until the review found it.
  assert.strictEqual(textOf(CS_ENUM_SRC, at(CS_ENUM_TREE(), "Idle")), "Idle", "an enum member selects its name");
  // A multi-declarator line: each declarator selects ITS OWN name, and the
  // second one is nowhere near the modifier. If both selected the same columns
  // the B16 row would be testing one field twice.
  const spellTree = CS_SPELL_TREE();
  assert.strictEqual(textOf(CS_SPELL_SRC, at(spellTree, "_a")), "_a", "the first declarator selects `_a`");
  assert.strictEqual(textOf(CS_SPELL_SRC, at(spellTree, "_b")), "_b", "the second declarator selects `_b`, not `_a`");
  assert.notStrictEqual(
    at(spellTree, "_a").selectionRange.start.character,
    at(spellTree, "_b").selectionRange.start.character,
    "two declarators on one line must not share a selection",
  );
  // And the one-line class body, where a public and a private member share
  // every coordinate except their own columns.
  const oneTree = CS_ONELINE_TREE();
  assert.strictEqual(textOf(CS_ONELINE_SRC, at(oneTree, "_a")), "_a", "`_a` selects its own name on the shared line");
  assert.strictEqual(textOf(CS_ONELINE_SRC, at(oneTree, "B")), "B", "`B` selects its own name on the shared line");

  // The sweep: EVERY tree in this file, every node. Two shapes that must never
  // come back - a selection covering a keyword (the full-span artifact), and a
  // container whose range swallows a later sibling (which silently re-points
  // the receiver at the wrong type; it happened twice while writing this file).
  const ALL_TREES = [
    ["RS_SRC", RS_SRC, RS_TREE()], ["CS_SRC", CS_SRC, CS_TREE()], ["TS_SRC", TS_SRC, TS_TREE()],
    ["PY_SRC", PY_SRC, PY_TREE()], ["GO_SRC", GO_SRC, GO_TREE()],
    ["RS_MACRO", RS_MACRO_SRC, RS_MACRO_TREE()], ["CS_IFACE", CS_IFACE_SRC, CS_IFACE_TREE()],
    ["CS_UNDERSCORE", CS_UNDERSCORE_SRC, CS_UNDERSCORE_TREE()],
    ["RS_CTOR", RS_CTOR_SRC, RS_CTOR_TREE()], ["CS_CTOR", CS_CTOR_SRC, CS_CTOR_TREE()], ["TS_CTOR", TS_CTOR_SRC, TS_CTOR_TREE()],
    ["RS_FREE", RS_FREE_SRC, RS_FREE_TREE()], ["CS_STATIC", CS_STATIC_SRC, CS_STATIC_TREE()],
    ["CS_ENUM", CS_ENUM_SRC, CS_ENUM_TREE()], ["CS_COLLAB", CS_COLLAB_SRC, CS_COLLAB_TREE()],
    ["CS_SPELL", CS_SPELL_SRC, CS_SPELL_TREE()], ["CS_ONELINE", CS_ONELINE_SRC, CS_ONELINE_TREE()],
  ];
  for (const [tag, src, tree] of ALL_TREES) {
    const walk = (nodes) => {
      for (const n of nodes) {
        assert.ok(
          n.selectionRange.start.line === n.selectionRange.end.line,
          `${tag}: a selection is a single-line name token; ${n.name} spans lines`,
        );
        assert.ok(
          n.selectionRange.end.character > n.selectionRange.start.character,
          `${tag}: ${n.name} has an empty selection`,
        );
        assert.ok(
          n.range.start.line <= n.range.end.line,
          `${tag}: ${n.name} has an INVERTED range - an \`rng\` \`to\` needle matched an earlier line than its \`from\``,
        );
        assert.ok(
          n.range.contains(n.selectionRange.start),
          `${tag}: ${n.name}'s selection must lie inside its own range`,
        );
        const sel = src.split("\n")[n.selectionRange.start.line].slice(n.selectionRange.start.character, n.selectionRange.end.character);
        assert.ok(
          !/^(impl|pub|public|private|static|export|class|struct|interface|enum|func|fn|def|type)$/.test(sel),
          `${tag}: ${n.name}'s selection covers the keyword ${JSON.stringify(sel)} - that is the full-span artifact coming back`,
        );
        walk(n.children || []);
      }
    };
    walk(tree);
    // No top-level node may SWALLOW a later sibling. `rng`'s `to` needle names
    // a line, so adjacent nodes legitimately touch on one line; extending PAST
    // the next sibling's start is the bug. It happened twice while writing this
    // file (a `to` that matched the wrong line, and an omitted `to` running to
    // EOF), and both times the walk resolved a receiver the fixture never meant
    // while every row built on it went on proving something else.
    for (let i = 0; i + 1 < tree.length; i++) {
      assert.ok(
        tree[i].range.end.line <= tree[i + 1].range.start.line,
        `${tag}: \`${tree[i].name}\` (ends line ${tree[i].range.end.line}) swallows \`${tree[i + 1].name}\` (starts line ${tree[i + 1].range.start.line}) - the receiver would resolve to the wrong type`,
      );
    }
  }
});

const FROZEN_CONSTANTS = { MEMBER_CAP: 24, HOVER_SIGNATURE_CAP: 32, HOVER_FANOUT_BUDGET_MS: 50 };

for (const [name, value] of Object.entries(FROZEN_CONSTANTS)) {
  btest(`B14 (item 14): \`${name}\` does not move in this phase`, () => {
    assert.strictEqual(B[name], value, `item 14: no cap, budget or bound constant moves in phase 2; \`${name}\` is ${B[name]}, was ${value}`);
  });
}


