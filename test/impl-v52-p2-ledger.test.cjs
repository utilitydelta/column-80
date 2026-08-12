// IMPLEMENTER (white-box) - session-v52 phase 2, SHIP CONDITION 5:
// `resolvePrefill` is unchanged for every existing caller.
//
// `onLedger` is an ADDITIVE hook. No existing caller passes it, and the surface
// bytes every existing caller receives must be identical whether it is there or
// not. That is standing rule 6 ("no behaviour change to fn-gen, repair or FIM")
// reduced to something mechanical: resolve the same target twice, once with the
// hook and once without, and compare the bytes AND the channel lines.
//
// Byte comparison and nothing softer. A hook that logged one extra line, or
// that reordered a set into a list before rendering, would pass any assertion
// about "the same types" and would still have changed the prompt every user
// gets. The log array is compared too, because the channel is the product's
// diagnostic surface and a line added there is a line in the user's output.
//
// The second half of the file is the ledger's own truth: what it reports has to
// be what the run did, or `tightenClassify.ts` is classifying against fiction.
// `surface` must equal the returned string, `rendered` must be the types whose
// blocks are in it, and `typeCap`/`admitted` must be readable numbers.
//
// The last section WATCHES THE TYPE-LEVEL PIN FAIL. `PrefillLedgerViewIsPinned`
// in fnGen.ts claims a field added on either side of the ledger's two hand-kept
// declarations is a build failure. The first version of it could not fail at
// all: the mismatch branch evaluated to `never`, and `never` is assignable to
// `true`, so the constraint was satisfied and a drifted shape compiled clean in
// both directions (session-v52 adversarial defect 1). A guard nobody has
// watched fail is decoration, so this file drifts the shape in a copy of the
// tree, in BOTH directions, and runs the real `tsc --noEmit` over it.
//
// The harness is the one `test/blind-v24-p2-surface.test.cjs` uses: bundle
// `src/vscode/fnGen.ts` with esbuild against a vscode STUB and drive
// `resolvePrefill` headless over a fake TextDocument and a fake
// SurfaceExtractor.
//
// Run: SKIP_LIVE=1 node --test test/impl-v52-p2-ledger.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");
const esbuild = require("esbuild");
const { execFileSync } = require("child_process");

// ===========================================================================
// Harness
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v52-p2-ledger-vscode-stub.cjs");
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
      const files = globalThis.__V52P2_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".impl-v52-p2-ledger.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v52-p2-ledger.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(ENTRY, `export { resolvePrefill } from "../src/vscode/fnGen";\n`);
  esbuild.buildSync({
    entryPoints: [ENTRY],
    bundle: true,
    outfile: OUTFILE,
    format: "cjs",
    platform: "node",
    alias: { vscode: STUB },
  });
  B = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
const V = require(STUB);
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

// The pure gate, bundled separately: it takes no vscode, so it must not ride
// the stubbed bundle. Feeding a REAL ledger to the REAL gate is the only
// end-to-end evidence either side is right about the other.
const { mod: CLASSIFY, cleanup: cleanupClassify } = require("./.blind-util.cjs").bundleCore(
  "impl-v52-p2-ledger-classify",
  `export { classifyCandidate, deltaProposals } from "../src/core/tightenClassify";\n`,
);
test.after(cleanupClassify);

// A broken bundle must be ONE loud failure, never a wall of TypeErrors that
// could be mistaken for a contract failure.
test("bundle guard: resolvePrefill builds headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  assert.equal(typeof B.resolvePrefill, "function");
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

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

const SK = { Class: 4, Method: 5, Field: 7, Function: 11, Object: 18, Struct: 22 };
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
// FIDELITY: `selectionRange` covers the NAME TOKEN on the node's first line,
// which is what every server measured in `session-v24/measure-midedit.md`
// reports. A full-span selectionRange is a shape no server produces and it
// pushes every anchor to column 0.
function nameSelection(name, range) {
  const line = range.__line;
  if (typeof line !== "string") return range;
  const token = name.startsWith("impl") ? name.slice(4).trim() : name;
  const ch = line.indexOf(token);
  if (ch < 0) return range;
  return new V.Range(range.start.line, ch, range.start.line, ch + token.length);
}
const dsym = (name, kind, range, children = [], detail = "") => ({
  name,
  detail,
  kind,
  range,
  selectionRange: nameSelection(name, range),
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
  const known = new Set(Object.keys(defTypes));
  const typeAtCursor = (uri, cursor) => {
    const text = files[uri];
    if (text === undefined) return undefined;
    const w = wordAt(text, cursor);
    if (w && known.has(w)) return w;
    const line = text.split("\n")[cursor.line] ?? "";
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

/** One `resolvePrefill` run. `opts` rides straight through, so the only thing
 *  that differs between the two halves of a byte comparison is the hook. */
async function runPrefill(scn, opts) {
  const src = scn.files[scn.mainUri];
  const start = src.indexOf(scn.spanStart);
  assert.ok(start >= 0, `fixture bug: spanStart ${JSON.stringify(scn.spanStart)} not found`);
  const endIdx = src.indexOf(scn.spanEnd, start);
  assert.ok(endIdx >= 0, `fixture bug: spanEnd ${JSON.stringify(scn.spanEnd)} not after spanStart`);
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
  if ("tree" in scn) resolved.symbols = scn.tree;
  const logs = [];
  globalThis.__V52P2_FILES__ = scn.files;
  let out;
  try {
    out = await B.resolvePrefill(makeExtractor(scn), makeDoc(src, scn.mainUri), resolved, (l) => logs.push(l), opts);
  } finally {
    delete globalThis.__V52P2_FILES__;
  }
  return { out, logs };
}

// ===========================================================================
// Fixtures. Two languages, so the identity claim is not read off one code path:
// rust renders data-shape blocks and typescript renders member signatures.
// ===========================================================================

const RS_URI = "file:///w/v52p2/lib.rs";
const RS_SRC = `pub struct Widget {
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

/// Absorb the \`Widget\` into the owner.
fn absorb(o: &Owner, w: Widget) -> u32 {
    todo!()
}
`;
const RS_TREE = () => [
  dsym("Widget", SK.Struct, rng(RS_SRC, "pub struct Widget", "    mass: u32,")),
  dsym("Owner", SK.Struct, rng(RS_SRC, "pub struct Owner", "    slots: u32,")),
  dsym("impl Owner", SK.Object, rng(RS_SRC, "impl Owner {", "    }"), [
    dsym("roll_active", SK.Method, rng(RS_SRC, "pub fn roll_active", "    }"), [], "fn(&self) -> u64"),
  ]),
  dsym("absorb", SK.Function, rng(RS_SRC, "fn absorb(o: &Owner"), [], "fn(o: &Owner, w: Widget) -> u32"),
];
const RUST = {
  languageId: "rust",
  mainUri: RS_URI,
  files: { [RS_URI]: RS_SRC },
  tree: RS_TREE(),
  defTypes: {
    Widget: {
      uri: RS_URI,
      hover: "pub struct Widget { mass: u32 }",
      members: [{ name: "mass_of", signature: "mass_of(&self) -> u32", kind: "method" }],
    },
    Owner: {
      uri: RS_URI,
      hover: "pub struct Owner { slots: u32 }",
      members: [{ name: "roll_active", signature: "roll_active(&self) -> u64", kind: "method" }],
    },
  },
  spanStart: "fn absorb(o: &Owner",
  spanEnd: "todo!()\n}",
  signature: "fn absorb(o: &Owner, w: Widget) -> u32",
  docComment: "/// Absorb the `Widget` into the owner.",
  symbolName: "absorb",
};

const TS_URI = "file:///w/v52p2/lib.ts";
const TS_SRC = `export class Widget {
  mass: number = 0;
  massOf(): number { return this.mass; }
}

export class Owner {
  slots: number = 0;
}

/** Absorb the \`Widget\` into the owner. */
export function absorb(o: Owner, w: Widget): number {
  throw new Error("todo");
}
`;
const TS_TREE = () => [
  dsym("Widget", SK.Class, rng(TS_SRC, "export class Widget", "  massOf(): number"), [
    dsym("mass", SK.Field, rng(TS_SRC, "  mass: number = 0;", "  mass: number = 0;")),
    dsym("massOf", SK.Method, rng(TS_SRC, "  massOf(): number", "  massOf(): number")),
  ]),
  dsym("Owner", SK.Class, rng(TS_SRC, "export class Owner", "  slots: number = 0;"), [
    dsym("slots", SK.Field, rng(TS_SRC, "  slots: number = 0;", "  slots: number = 0;")),
  ]),
  dsym("absorb", SK.Function, rng(TS_SRC, "export function absorb")),
];
const TYPESCRIPT = {
  languageId: "typescript",
  mainUri: TS_URI,
  files: { [TS_URI]: TS_SRC },
  tree: TS_TREE(),
  defTypes: {
    Widget: {
      uri: TS_URI,
      hover: "class Widget",
      members: [{ name: "massOf", signature: "massOf(): number", kind: "method" }],
    },
    Owner: {
      uri: TS_URI,
      hover: "class Owner",
      members: [{ name: "rollActive", signature: "rollActive(): number", kind: "method" }],
    },
  },
  spanStart: "export function absorb",
  spanEnd: 'throw new Error("todo");',
  signature: "export function absorb(o: Owner, w: Widget): number",
  docComment: "/** Absorb the `Widget` into the owner. */",
  symbolName: "absorb",
};

const CASES = [
  ["rust", RUST],
  ["typescript", TYPESCRIPT],
];

// The fixtures have to actually PRODUCE a surface, or the identity claim is
// "undefined equals undefined" and proves nothing. An instrument that cannot
// make the case fire returns a fact about the instrument.
for (const [name, scn] of CASES) {
  btest(`fixture guard (${name}): the run injects a real surface`, async () => {
    const { out } = await runPrefill(scn, undefined);
    assert.equal(typeof out, "string", "the fixture must render a surface for the identity claim to mean anything");
    assert.ok(out.length > 0);
    assert.match(out, /Widget/);
  });
}

// ===========================================================================
// SHIP CONDITION 5. The bytes, and the channel.
// ===========================================================================

for (const [name, scn] of CASES) {
  btest(`SHIP 5 (${name}): the surface bytes are identical with and without onLedger`, async () => {
    const without = await runPrefill(scn, undefined);
    let seen;
    const with_ = await runPrefill(scn, { onLedger: (l) => (seen = l) });
    assert.equal(
      with_.out,
      without.out,
      "onLedger is additive: an existing caller's surface bytes must not move by one character",
    );
    assert.deepEqual(with_.logs, without.logs, "and not one channel line may be added, removed or reworded");
    assert.ok(seen !== undefined, "the hook must actually have fired, or this row proves nothing");
  });

  // The hook is passed INSIDE the same opts bag every other additive hook uses,
  // so the row also has to hold when a caller already passes one. The pairing
  // is what catches an implementation that renders a different branch when
  // `opts` is present at all.
  btest(`SHIP 5 (${name}): identical again beside an existing hook`, async () => {
    const disclosedA = [];
    const a = await runPrefill(scn, { onDisclosed: (t) => disclosedA.push(...t) });
    const disclosedB = [];
    const b = await runPrefill(scn, { onDisclosed: (t) => disclosedB.push(...t), onLedger: () => {} });
    assert.equal(b.out, a.out);
    assert.deepEqual(b.logs, a.logs);
    assert.deepEqual(
      disclosedB.map((d) => d.name),
      disclosedA.map((d) => d.name),
      "onDisclosed must report the same types beside onLedger as without it",
    );
  });

  btest(`SHIP 5 (${name}): a hook that throws is the caller's problem, not the surface's`, async () => {
    // Not a contract clause, a guard on the seam: the ledger is built and
    // handed over AFTER the surface is finished, so a broken consumer cannot
    // corrupt what fn-gen already resolved. If this ever starts failing, the
    // hook has been moved somewhere it can affect the render.
    const without = await runPrefill(scn, undefined);
    let out;
    let threw;
    try {
      out = (
        await runPrefill(scn, {
          onLedger: () => {
            throw new Error("consumer blew up");
          },
        })
      ).out;
    } catch (e) {
      threw = e;
    }
    if (threw === undefined) {
      assert.equal(out, without.out);
    } else {
      assert.match(String(threw.message), /consumer blew up/, "only the consumer's own error may escape");
    }
  });
}

// ===========================================================================
// The ledger reports what the run DID. `tightenClassify.ts` classifies against
// these fields, so a field that lies is a gate that lies.
// ===========================================================================

for (const [name, scn] of CASES) {
  btest(`ledger (${name}): every field is present and the right shape`, async () => {
    let led;
    await runPrefill(scn, { onLedger: (l) => (led = l) });
    assert.ok(led !== undefined, "the hook must fire exactly once on a rendering run");
    for (const field of ["rendered", "visited", "notLookedAt"]) {
      assert.ok(Array.isArray(led[field]), `${field} must be an array`);
      for (const v of led[field]) assert.equal(typeof v, "string", `${field} carries names`);
    }
    for (const row of led.noBlock) {
      assert.equal(typeof row.type, "string");
      assert.equal(typeof row.reason, "string");
    }
    for (const row of led.dropped) {
      assert.equal(typeof row.name, "string");
      assert.equal(typeof row.cause, "string");
    }
    assert.ok(Number.isFinite(led.typeCap) && led.typeCap > 0, `typeCap must be a real cap.  GOT ${led.typeCap}`);
    assert.ok(Number.isFinite(led.admitted) && led.admitted >= 0);
    assert.equal(typeof led.surface, "string");
  });

  btest(`ledger (${name}): surface is byte-identical to the returned surface`, async () => {
    let led;
    const { out } = await runPrefill(scn, { onLedger: (l) => (led = l) });
    assert.equal(led.surface, out, "the classifier scans this string for whole-word hits; a stale copy misclassifies");
  });

  btest(`ledger (${name}): every rendered name is actually named in the surface`, async () => {
    let led;
    await runPrefill(scn, { onLedger: (l) => (led = l) });
    assert.ok(led.rendered.length > 0, "the fixture renders at least one root");
    for (const n of led.rendered) {
      assert.ok(
        led.surface.includes(n),
        `rendered claims ${n} but the surface never names it.\n  SURFACE:\n${led.surface}`,
      );
    }
    // `rendered` is a subset of `visited`: a root the walk emitted is a name the
    // walk visited. Class 1 shadowing class 2 in `classifyCandidate` depends on
    // the order of the tests, not on these two being disjoint.
    for (const n of led.rendered) {
      assert.ok(led.visited.includes(n), `${n} rendered but is not in visited`);
    }
  });

  // The arrays must be COPIES. The interface promises read-only by
  // construction, and a consumer holding a live reference to the walk's own
  // bookkeeping could change what a later gesture injects.
  btest(`ledger (${name}): the arrays are copies, not the walk's own state`, async () => {
    let first;
    let second;
    await runPrefill(scn, { onLedger: (l) => (first = l) });
    first.rendered.push("Injected");
    first.visited.push("Injected");
    await runPrefill(scn, { onLedger: (l) => (second = l) });
    assert.ok(!second.rendered.includes("Injected"), "a mutation by one consumer must not reach the next run");
    assert.ok(!second.visited.includes("Injected"));
  });
}

// ===========================================================================
// THE PIN, WATCHED FAILING. Session-v52 adversarial defect 1.
//
// `PrefillLedger` (src/vscode/fnGen.ts) and `PrefillLedgerView`
// (src/core/tightenClassify.ts) are two hand-kept declarations of one record,
// redeclared because `src/core/` may not import a module that imports `vscode`.
// `PrefillLedgerViewIsPinned` claims drift between them is a build failure.
//
// The claim was false for one release of this file. `AssertTrue<T extends true>`
// applied to `never` is legal, because `never` is assignable to every type, so
// the mismatch branch satisfied its own constraint and both drift directions
// compiled clean. The fix is `false` instead of `never` on both branches, and
// the only evidence that a compile-time guard works is watching it reject.
//
// Both directions, because a one-directional check passes while the halves
// diverge the other way: a field added only to the VIEW is just as wrong, and it
// is the direction a future consumer edit takes.
// ===========================================================================

/** A copy of `src/` with a real tsconfig and the repo's node_modules, so `tsc`
 *  sees exactly the build the product ships. */
function inCopiedTree(mutate) {
  const repo = path.resolve(__dirname, "..");
  const tsc = path.join(repo, "node_modules", ".bin", "tsc");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "impl-v52-p2-pin-"));
  try {
    fs.cpSync(path.join(repo, "src"), path.join(tmp, "src"), { recursive: true });
    fs.copyFileSync(path.join(repo, "tsconfig.json"), path.join(tmp, "tsconfig.json"));
    fs.symlinkSync(path.join(repo, "node_modules"), path.join(tmp, "node_modules"), "dir");
    mutate(tmp);
    try {
      execFileSync(tsc, ["--noEmit"], { cwd: tmp, stdio: "pipe" });
      return { code: 0, out: "" };
    } catch (e) {
      return { code: e.status ?? 1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Replace `find` with `replaceWith` in a file of the copied tree, loudly when
 *  the anchor has moved. A fixture that silently patches nothing would report a
 *  clean build as proof the guard works. */
function patch(tmp, rel, find, replaceWith) {
  const p = path.join(tmp, rel);
  const s = fs.readFileSync(p, "utf8");
  assert.ok(s.includes(find), `fixture bug: anchor moved in ${rel}: ${JSON.stringify(find.slice(0, 60))}`);
  fs.writeFileSync(p, s.replace(find, replaceWith));
}

const PIN_TSC = path.join(path.resolve(__dirname, ".."), "node_modules", ".bin", "tsc");
const ptest = (name, fn) =>
  test(name, (ctx) => {
    if (!fs.existsSync(PIN_TSC)) return ctx.skip("SKIP LOUDLY: node_modules/.bin/tsc is absent; the pin cannot be exercised");
    return fn(ctx);
  });

// The control. Without it, a tree that fails to build for an unrelated reason
// would make every drift row below pass for the wrong reason.
ptest("pin control: the unmodified tree typechecks clean", () => {
  const r = inCopiedTree(() => {});
  assert.equal(r.code, 0, `the copy must build, or the drift rows prove nothing:\n${r.out}`);
});

const IFACE_ANCHOR = "  /** The rendered surface, byte-identical to the return value. */\n  surface: string;\n}";
const CALL_ANCHOR = "      typeCap,\n      admitted,\n      surface,\n    });";
const VIEW_ANCHOR = "  /** The rendered surface text, verbatim. */\n  surface: string;\n}";

ptest("PIN FAILS on producer-side drift: a field added to PrefillLedger", () => {
  const r = inCopiedTree((tmp) => {
    patch(tmp, "src/vscode/fnGen.ts", IFACE_ANCHOR, IFACE_ANCHOR.replace("}", "  driftedField: number;\n}"));
    // Supplied at the hand-over too, so the only thing left to complain about
    // is the pin itself and not a missing property at the call site.
    patch(tmp, "src/vscode/fnGen.ts", CALL_ANCHOR, "      typeCap,\n      admitted,\n      surface,\n      driftedField: 1,\n    });");
  });
  assert.notEqual(
    r.code,
    0,
    "a field on the producer that the view does not declare is exactly the drift the pin claims to catch, and tsc was clean",
  );
  assert.match(
    r.out,
    /PrefillLedgerViewIsPinned|TS2344/,
    `the failure must come from the PIN, not from some other error the drift happened to cause:\n${r.out}`,
  );
});

ptest("PIN FAILS on consumer-side drift: a field added to PrefillLedgerView", () => {
  const r = inCopiedTree((tmp) => {
    patch(tmp, "src/core/tightenClassify.ts", VIEW_ANCHOR, VIEW_ANCHOR.replace("}", "  driftedField: number;\n}"));
  });
  assert.notEqual(r.code, 0, "the view growing a field the producer never sets is the other direction, and it is just as wrong");
  assert.match(r.out, /PrefillLedgerViewIsPinned|TS2344/, `the failure must come from the PIN:\n${r.out}`);
});

// A RENAME is the case the pin's own comment names: the classifier reads
// `undefined` and every candidate silently becomes class 4, which is the
// eviction the whole phase exists to prevent.
ptest("PIN FAILS on a renamed field, which is the failure its comment describes", () => {
  const r = inCopiedTree((tmp) => {
    patch(tmp, "src/core/tightenClassify.ts", VIEW_ANCHOR, VIEW_ANCHOR.replace("surface: string;", "surfaceText: string;"));
  });
  assert.notEqual(r.code, 0, "a renamed field reads as undefined in the classifier and must not compile");
  assert.match(r.out, /PrefillLedgerViewIsPinned|TS2344|surfaceText/, `GOT:\n${r.out}`);
});

// ===========================================================================
// `dropped` VS `rendered`, ON A FIXTURE THAT ACTUALLY POPULATES `dropped`.
// Session-v52 adversarial defect 5, and its coverage gap.
//
// `sharedWalk.droppedBy` carries two classes and the channel prints them apart:
// types dropped ENTIRELY, and types whose data shape was withdrawn by the
// member floor while their member list still rendered. The second class names a
// type that is ALSO in `rendered`, so shipping the raw map made the field mean
// something other than its own comment. `classifyCandidate` tests `rendered`
// first, so nothing escaped the gate; the ledger was simply less honest than
// the channel beside it.
//
// The review could not fire this. The member floor is C#-only and structurally
// so - C# is the one language whose member blocks come out of the same
// aggregate - and every fixture it had was Rust or TypeScript. Across 42 runs
// `dropped` was populated ZERO times. A field no test has ever seen carry a
// value is a field with no evidence behind it, so the fixture below is built to
// make the member floor refuse a real walk.
//
// It needs three things at once: `contextStop: "shipped"` for the tightest
// budget the dial offers, a data shape deep and wide enough to cost most of it,
// and a member list large enough that the shape cannot repay its own cost by
// shedding. Any one of them alone leaves the floor with room and nothing fires.
// ===========================================================================

const CS_URI = "file:///w/v52p2/Ledger.cs";
const csFields = (n, type) =>
  Array.from({ length: n }, (_, i) => `    public ${type} Field${i} { get; set; }`).join("\n");
const csMethods = (n, name) =>
  Array.from({ length: n }, (_, i) => `    public string ${name}Method${i}(int a, string b, long c) { return null; }`).join("\n");
const CS_SRC = `namespace P;

public class Leaf
{
${csFields(10, "string")}
${csMethods(10, "Leaf")}
}

public class Order
{
${csFields(10, "Leaf")}
${csMethods(10, "Order")}
}

public class Manifest
{
${csFields(10, "Order")}
${csMethods(10, "Manifest")}
}

public class Runner
{
    /// <summary>Absorb the <c>Manifest</c> and the <c>Order</c>.</summary>
    public int Absorb(Manifest m, Order o, Leaf l)
    {
        throw new NotImplementedException();
    }
}
`;
const csMemberList = (owner, n, fieldType) => [
  ...Array.from({ length: 10 }, (_, i) => ({
    name: `Field${i}`,
    // Roslyn spells a property `Name : Type`, spaces included, and
    // `csFieldsFromMembers` splits on exactly that. A `Name: Type` fixture
    // derives no fields at all and the data-shape walk never runs.
    signature: `Field${i} : ${fieldType}`,
    kind: "field",
  })),
  ...Array.from({ length: n }, (_, i) => ({
    name: `${owner}Method${i}`,
    signature: `${owner}Method${i}(int a, string b, long c): string`,
    kind: "method",
  })),
];
const CS_TREE = () => [
  dsym("Leaf", SK.Class, rng(CS_SRC, "public class Leaf", "    public string LeafMethod9")),
  dsym("Order", SK.Class, rng(CS_SRC, "public class Order", "    public string OrderMethod9")),
  dsym("Manifest", SK.Class, rng(CS_SRC, "public class Manifest", "    public string ManifestMethod9")),
  dsym("Runner", SK.Class, rng(CS_SRC, "public class Runner"), [
    dsym("Absorb", SK.Method, rng(CS_SRC, "public int Absorb")),
  ]),
];
const CSHARP = {
  languageId: "csharp",
  mainUri: CS_URI,
  files: { [CS_URI]: CS_SRC },
  tree: CS_TREE(),
  defTypes: {
    Leaf: { uri: CS_URI, hover: "class Leaf", members: csMemberList("Leaf", 10, "string") },
    Order: { uri: CS_URI, hover: "class Order", members: csMemberList("Order", 10, "Leaf") },
    Manifest: { uri: CS_URI, hover: "class Manifest", members: csMemberList("Manifest", 10, "Order") },
  },
  spanStart: "public int Absorb",
  spanEnd: "throw new NotImplementedException();",
  signature: "public int Absorb(Manifest m, Order o, Leaf l)",
  docComment: "/// <summary>Absorb the <c>Manifest</c> and the <c>Order</c>.</summary>",
  symbolName: "Absorb",
};

btest("ledger (csharp): the fixture populates `dropped`, which no other fixture here does", async () => {
  let led;
  await runPrefill(CSHARP, { contextStop: "shipped", onLedger: (l) => (led = l) });
  assert.ok(led !== undefined, "the hook must fire");
  assert.ok(
    led.dropped.length > 0,
    "INSTRUMENT FAILURE, not a product failure: this fixture exists only to make `dropped` carry a value, " +
      "and every row below grades nothing if it does not. Across the adversarial review's 42 runs `dropped` " +
      "was populated zero times, which is how the defect below survived review.",
  );
  for (const row of led.dropped) {
    assert.equal(typeof row.name, "string");
    assert.ok(row.cause.length > 0, "a drop names the cap that did it, or the ledger is less use than the channel");
  }
  assert.ok(led.rendered.length > 0, "and something must still render, or the two partitions cannot be told apart");
});

// DEFECT 5. `droppedBy` is the raw map and it carries BOTH partitions. This
// fixture produces one of each: two types the budget took entirely, and one
// whose data shape was withdrawn while its member list rendered anyway.
btest("ledger (csharp): DEFECT 5 - `dropped` and `rendered` never name the same type", async () => {
  let led;
  await runPrefill(CSHARP, { contextStop: "shipped", onLedger: (l) => (led = l) });
  const both = led.dropped.filter((d) => led.rendered.includes(d.name)).map((d) => d.name);
  assert.deepEqual(
    both,
    [],
    "a name in both is a name the ledger calls dropped while its own block sits in the prompt. " +
      "`classifyCandidate` tests `rendered` first so nothing escapes the gate, but the field would not mean " +
      "what its comment says and a consumer reading it as class-3 evidence would be wrong.",
  );
});

// The ledger against the channel, on the one field the channel splits in two.
// The channel is the reference here because it has always partitioned them; the
// ledger is the thing that was wrong.
btest("ledger (csharp): `dropped` matches the channel's `N entirely` count exactly", async () => {
  let led;
  const { logs } = await runPrefill(CSHARP, { contextStop: "shipped", onLedger: (l) => (led = l) });
  const line = logs.find((l) => /injected context dropped \d+ type\(s\) entirely/.test(l));
  assert.ok(line !== undefined, `the fixture must produce the partitioned drop line.  LOGS ${JSON.stringify(logs)}`);
  const entirely = Number(/dropped (\d+) type\(s\) entirely/.exec(line)[1]);
  const heldBack = Number(/and (\d+) data shape\(s\) whose member lists stay/.exec(line)?.[1] ?? 0);
  assert.ok(heldBack > 0, `the held-back partition must be non-empty, or this row cannot see the defect.  LINE: ${line}`);
  assert.equal(
    led.dropped.length,
    entirely,
    `the channel says ${entirely} dropped entirely and ${heldBack} held back; the ledger must carry the first ` +
      `number only.  LEDGER ${JSON.stringify(led.dropped)}\n  LINE: ${line}`,
  );
});

// The gate, end to end, on the one language whose member floor exists. Every
// name the real C# surface carries must be refused by the real gate.
btest("ledger (csharp): the real gate drops every name the real surface carries", async () => {
  let led;
  await runPrefill(CSHARP, { contextStop: "shipped", onLedger: (l) => (led = l) });
  const inSurface = [...new Set([...led.rendered, ...led.visited])];
  assert.ok(inSurface.length > 0);
  const candidates = inSurface.map((n, i) => ({ identifier: n, phrase: n, start: i, end: i + n.length, match: "fold" }));
  const survivors = CLASSIFY.deltaProposals(candidates, led, "csharp");
  assert.deepEqual(survivors.map((s) => `${s.identifier}:${s.klass}`), [], "ship condition 1 on a real C# ledger");
  // And the held-back type, which is in `dropped` upstream and in `rendered`
  // here, is class 1 rather than class 3. That ordering is the reason the
  // filter is a correctness fix and not a tidy-up.
  for (const n of led.rendered) {
    assert.equal(CLASSIFY.classifyCandidate(n, led), 1, `${n} rendered, so a backtick on it only evicts`);
  }
});

// ===========================================================================
// THE NO-BLOCK EXIT. Session-v52 adversarial defect 2.
//
// `resolvePrefill` returns `undefined` when nothing rendered and there is no
// import hint, and that return used to sit BEFORE the hand-over. The walk has
// already run by then: `noBlock`, `notLookedAt` and `droppedBy` are full and
// every one of them has already been logged. So the channel described a run the
// ledger did not exist for.
//
// Why that is a correctness bug and not a gap. Amendment 14 says an absent
// ledger classifies everything as class 4, and class 4 ranks AHEAD of class 3.
// The targets with the MOST class-3 evidence are exactly the ones that render
// nothing, and those were the targets whose proposal list came back ordered
// worst. The fix is one hand-over shared by both exits, with `surface: ""`.
// ===========================================================================

const NOTHING = {
  ...RUST,
  // No type resolves, so no block renders and the early exit is taken. The
  // extra candidates are what the walk still has evidence ABOUT.
  defTypes: {},
};

btest("DEFECT 2: the hook fires on the exit that renders nothing", async () => {
  let led;
  const { out, logs } = await runPrefill(NOTHING, {
    extraCandidates: ["Ghost", "Phantom", "Spectre"],
    onLedger: (l) => (led = l),
  });
  assert.equal(out, undefined, "the fixture must actually take the no-block exit, or this row proves nothing");
  const evidence = logs.filter((l) => /injected nothing|accounting|lower-priority/.test(l));
  assert.ok(evidence.length > 0, `the channel must have said something.  LOGS ${JSON.stringify(logs)}`);
  assert.ok(
    led !== undefined,
    `the channel disclosed ${evidence.length} line(s) of evidence and the ledger never arrived.  ${JSON.stringify(evidence)}`,
  );
  assert.equal(led.surface, "", "nothing rendered, so the surface is the empty string and not a stale one");
  assert.deepEqual(led.rendered, [], "and nothing may claim to have rendered");
});

// The evidence has to SURVIVE the exit, not merely arrive with it. A hand-over
// that fired with empty arrays would pass the row above and still throw away
// every class-3 fact the walk paid for.
btest("DEFECT 2: the no-block ledger still carries the walk's class-3 evidence", async () => {
  let led;
  await runPrefill(NOTHING, {
    extraCandidates: ["Ghost", "Phantom", "Spectre"],
    onLedger: (l) => (led = l),
  });
  const known = [...led.noBlock.map((d) => d.type), ...led.notLookedAt, ...led.dropped.map((d) => d.name)];
  assert.ok(
    known.length > 0,
    `the walk produced cap and no-block evidence and the ledger must carry it.  LEDGER ${JSON.stringify(led)}`,
  );
  // And it must reach the gate as class 3, which is the whole point: without
  // the hand-over these were class 4 and ranked ABOVE the real class 4s.
  for (const n of known) {
    assert.equal(CLASSIFY.classifyCandidate(n, led), 3, `${n} has cap evidence against it and must classify 3`);
  }
  const out = CLASSIFY.deltaProposals(
    [
      { identifier: "OffTheWalk", phrase: "off the walk", start: 0, end: 12, match: "fold" },
      { identifier: known[0], phrase: known[0], start: 20, end: 20 + known[0].length, match: "fold" },
    ],
    led,
  );
  assert.deepEqual(
    out.map((p) => `${p.identifier}:${p.klass}`),
    ["OffTheWalk:4", `${known[0]}:3`],
    "a genuine class 4 ranks above a type a cap merely took; without the ledger both read as class 4",
  );
});
