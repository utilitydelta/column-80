// IMPLEMENTATION rows - session-v48 phase 1, the context dial.
//
// WHITE-BOX, and deliberately so: these rows know that the four numbers live in
// `budgetProfileFor`'s stop table, that `fnGenProfileFor` spends them, and that
// the `shipped` row is spelled against the module constants the measurement rig
// patches. The BLACK-BOX promise is test/blind-v48-p1-context-dial.test.cjs,
// written against contract-phase1.md by an oracle that never read this file.
//
// The property that matters most is P1, and it is the reason the phase exists:
// THREE OF THE FOUR NUMBERS MAKE THE FOURTH INERT. Measured before the build,
// against the shipped `walkDataShape` on a 40-wide synthetic type graph at
// depth 2 - raising breadth alone 4 -> 48 with the total at 6 and the budget at
// 200 gave a BYTE-IDENTICAL 791-char block at every rung, and so did breadth
// and total together with the budget pinned. Section D below re-proves that
// through the WHOLE product path (candidates -> gather -> walk -> render)
// rather than against the walk alone, because the product path adds a gather
// bound the walk-only proof never saw.
//
// Sections:
//   A - the stop table itself: the contract's numbers, and the invariants that
//       keep a stop from being inert (rootCap <= resolveCap, totalTypes >=
//       roughly 3x roots, every number monotone).
//   B - the derivation seam: budgetProfileFor resolves all six from the stop
//       and keeps every pre-existing derived field working off the budget.
//   C - the shipped stop is the pre-dial point, spelled against the constants
//       the rig patches, and the rig's patch sites still reach a prompt.
//   D - the dial is not inert, through the product path, on a wide graph.
//   E - the setting resolver: total, never throws, one line for the setting it
//       replaced.
//
// Run: SKIP_LIVE=1 node --test test/impl-v48-p1-context-dial.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness. `resolvePrefill` plus the derivation seam, bundled headless against
// a STRUCTURAL vscode stub whose `getConfiguration` is driven by a process
// global, so a row can put a real setting value in front of the resolver.
// Mechanics follow test/blind-v37-p2-prefill-bounds.test.cjs.
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v48-p1-vscode-stub.cjs");
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
    getConfiguration: (section) => {
      const cfg = globalThis.__V48P1_CFG__;
      if (cfg === "no-provider") { throw new Error("this host has no configuration provider"); }
      const c = cfg || {};
      return {
        // __throw_get__ names a KEY whose read blows up: a host that knows
        // nothing about a removed setting is entitled to throw on it, and the
        // stop the user DID choose must survive that.
        get: (k, f) => {
          if (c.__throw_get__ === k) { throw new Error("this host does not know that key"); }
          const v = c[k];
          return v !== undefined ? v : f;
        },
        has: () => false,
        inspect: (k) => {
          if (c.__throw_inspect__) { throw new Error("inspect is unavailable on this host"); }
          return c.__inspect__ && c.__inspect__[k] !== undefined ? c.__inspect__[k] : undefined;
        },
        update: async () => {},
      };
    },
    openTextDocument: (arg) => {
      const files = globalThis.__V48P1_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

const ENTRY = path.join(__dirname, ".impl-v48-p1.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v48-p1.bundle.cjs");
let mod;
let bundleErr;
let bundleSrc = "";
try {
  fs.writeFileSync(
    ENTRY,
    [
      `export { resolvePrefill, FNGEN_PROFILE } from "../src/vscode/fnGen";`,
      `export { injectedContextStop } from "../src/vscode/config";`,
      `export { budgetProfileFor, contextBoundsFor, INJECTED_CONTEXT_STOPS, DEFAULT_CONTEXT_STOP,`,
      `  PREFILL_TYPE_CAP, DATASHAPE_TOTAL_TOK, memberCapFor, surfaceCapFor, refineTotalCharsFor,`,
      `  walkTokMaxFor } from "../src/core/budgetProfile";`,
      "",
    ].join("\n"),
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  bundleSrc = fs.readFileSync(OUTFILE, "utf8");
  mod = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
const V = (() => { try { return require(STUB); } catch { return undefined; } })();
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("bundle guard: the dial seam and the prefill entry point build headless against the vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  for (const name of ["resolvePrefill", "injectedContextStop", "budgetProfileFor", "contextBoundsFor"]) {
    assert.equal(typeof mod[name], "function", `${name} must be exported`);
  }
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see the bundle guard");
    return fn(ctx);
  });

// The contract's table, written out here so a change to the product's table has
// to be a deliberate edit in two places rather than a silent drift in one.
const TABLE = {
  shipped: { depth: 2, breadth: 4, totalTypes: 6, rootCap: 4, resolveCap: 8, provenanceCap: 24, surfaceBudgetTok: 300 },
  small: { depth: 2, breadth: 6, totalTypes: 24, rootCap: 8, resolveCap: 16, provenanceCap: 24, surfaceBudgetTok: 600 },
  medium: { depth: 2, breadth: 12, totalTypes: 48, rootCap: 8, resolveCap: 16, provenanceCap: 24, surfaceBudgetTok: 1200 },
  large: { depth: 2, breadth: 24, totalTypes: 96, rootCap: 12, resolveCap: 24, provenanceCap: 36, surfaceBudgetTok: 2400 },
  frontier: { depth: 2, breadth: 48, totalTypes: 192, rootCap: 16, resolveCap: 32, provenanceCap: 48, surfaceBudgetTok: 4000 },
};
const ALL_STOPS = ["shipped", "small", "medium", "large", "frontier"];
const PUBLIC_STOPS = ["small", "medium", "large", "frontier"];

// ===========================================================================
// A. THE STOP TABLE.
// ===========================================================================

for (const stop of ALL_STOPS) {
  btest(`A [${stop}]: the stop resolves the contract's six numbers exactly`, () => {
    assert.deepEqual(mod.contextBoundsFor(stop), TABLE[stop], `${stop} must be contract-phase1.md's row, field for field`);
  });
}

btest("A6: no stop promises more roots than its resolve cap can fill", () => {
  // The clamp `column80.injectedSurface`'s "generous" value carried in code,
  // kept as a property of the table. A root beyond the resolve cap can never be
  // injected - a type that was never resolved has no surface - so a stop that
  // broke this would be inert above its resolve cap and would say otherwise on
  // the channel.
  for (const stop of ALL_STOPS) {
    const b = mod.contextBoundsFor(stop);
    assert.ok(b.rootCap <= b.resolveCap, `${stop}: rootCap ${b.rootCap} > resolveCap ${b.resolveCap}`);
  }
});

btest("A7: total types leads the root count, so breadth has somewhere to go", () => {
  // Roughly 3x, from the goal: eight roots against a total of twelve would
  // strangle breadth before it started.
  for (const stop of ALL_STOPS) {
    const b = mod.contextBoundsFor(stop);
    assert.ok(
      b.totalTypes >= b.rootCap,
      `${stop}: totalTypes ${b.totalTypes} < rootCap ${b.rootCap} - roots would evict each other before breadth ran`,
    );
  }
});

btest("A8: every number is monotone non-decreasing across the four public stops, and the four move together", () => {
  const four = ["rootCap", "breadth", "totalTypes", "surfaceBudgetTok"];
  for (let i = 1; i < PUBLIC_STOPS.length; i++) {
    const lo = mod.contextBoundsFor(PUBLIC_STOPS[i - 1]);
    const hi = mod.contextBoundsFor(PUBLIC_STOPS[i]);
    for (const k of [...four, "resolveCap", "provenanceCap"]) {
      assert.ok(hi[k] >= lo[k], `${PUBLIC_STOPS[i]}.${k} (${hi[k]}) went DOWN from ${PUBLIC_STOPS[i - 1]} (${lo[k]})`);
    }
    // Breadth, total types and budget must all MOVE at every rung. Roots are
    // allowed to hold (small and medium share 8 by the contract's table), but
    // the other three carry the prompt and a rung where they held would be the
    // inert-dial trap.
    for (const k of ["breadth", "totalTypes", "surfaceBudgetTok"]) {
      assert.ok(hi[k] > lo[k], `${PUBLIC_STOPS[i]}.${k} did not move from ${PUBLIC_STOPS[i - 1]} (${lo[k]})`);
    }
  }
});

btest("A9: depth is 2 at every stop and is not a dial", () => {
  for (const stop of ALL_STOPS) {
    assert.equal(mod.contextBoundsFor(stop).depth, 2, `${stop}: depth must stay 2 - deeper describes infrastructure the function never touches`);
  }
});

btest("A10: an unrecognised stop answers with the default rather than throwing", () => {
  assert.deepEqual(mod.contextBoundsFor("enormous"), TABLE.small);
  assert.deepEqual(mod.contextBoundsFor(undefined), TABLE.small);
});

btest("A11: the four public stops are exported in the contract's order, and `shipped` is not among them", () => {
  assert.deepEqual([...mod.INJECTED_CONTEXT_STOPS], PUBLIC_STOPS);
  assert.equal(mod.DEFAULT_CONTEXT_STOP, "small");
});

// ===========================================================================
// B. THE DERIVATION SEAM.
// ===========================================================================

for (const stop of ALL_STOPS) {
  btest(`B [${stop}]: budgetProfileFor carries the stop's six numbers and derives the rest off its budget`, () => {
    const p = mod.budgetProfileFor("local-mid", "rust", stop);
    const b = TABLE[stop];
    assert.equal(p.stop, stop);
    for (const k of ["depth", "breadth", "totalTypes", "rootCap", "resolveCap", "provenanceCap", "surfaceBudgetTok"]) {
      assert.equal(p[k], b[k], `${stop}.${k}`);
    }
    // The pre-existing deriveds must keep working off the RESOLVED budget, not
    // off the shipped constant they were written against.
    assert.equal(p.memberCap, mod.memberCapFor(b.surfaceBudgetTok), `${stop}: memberCap follows the resolved budget`);
    assert.equal(p.surfaceCap, mod.surfaceCapFor(b.surfaceBudgetTok), `${stop}: surfaceCap follows the resolved budget`);
    assert.equal(p.refineTotalChars, mod.refineTotalCharsFor(b.surfaceBudgetTok), `${stop}: refineTotalChars follows`);
    assert.equal(p.walkTokMax, mod.walkTokMaxFor(b.surfaceBudgetTok), `${stop}: walkTokMax follows`);
  });
}

btest("B6: every language resolves the same rootCap at a given stop - Go's 8-root exception is gone (P4)", () => {
  for (const stop of ALL_STOPS) {
    const caps = {};
    for (const lang of ["rust", "go", "typescript", "python", "csharp"]) {
      caps[lang] = mod.budgetProfileFor("local-mid", lang, stop).rootCap;
    }
    const distinct = new Set(Object.values(caps));
    assert.equal(
      distinct.size,
      1,
      `${stop}: five languages must resolve ONE rootCap, got ${JSON.stringify(caps)}`,
    );
    assert.equal(caps.go, TABLE[stop].rootCap, `${stop}: and it is the table's`);
  }
});

btest("B7: C# keeps its CS_BUDGET_FACTOR treatment, which is 1, so C# equals the others at every stop", () => {
  for (const stop of ALL_STOPS) {
    const cs = mod.budgetProfileFor("local-mid", "csharp", stop).surfaceBudgetTok;
    const rust = mod.budgetProfileFor("local-mid", "rust", stop).surfaceBudgetTok;
    assert.equal(cs, rust, `${stop}: CS_BUDGET_FACTOR is 1 today, so C# must equal every other language`);
    assert.equal(cs, TABLE[stop].surfaceBudgetTok, `${stop}: and it is the stop's own budget`);
  }
});

btest("B8: the transport ceilings are stop-independent - the dial is about prompt bytes, not the reply", () => {
  for (const stop of ALL_STOPS) {
    const local = mod.budgetProfileFor("local-mid", "rust", stop);
    const front = mod.budgetProfileFor("frontier", "rust", stop);
    assert.equal(local.maxTokens, 2048, `${stop}: GEN_MAX_TOKENS`);
    assert.equal(front.maxTokens, 64000, `${stop}: FRONTIER_MAX_TOKENS`);
    assert.equal(local.numCtx, 16384, `${stop}: GEN_NUM_CTX`);
    assert.equal(local.timeoutMs, 120000, `${stop}: GEN_TIMEOUT_MS`);
  }
});

// ===========================================================================
// C. THE SHIPPED STOP AND THE RIG'S PATCH SITES.
// ===========================================================================

btest("C1: the shipped row is spelled against the live constants the rig patches", () => {
  assert.equal(mod.PREFILL_TYPE_CAP, 4, "the rig patches `var PREFILL_TYPE_CAP = 4;`");
  assert.equal(mod.DATASHAPE_TOTAL_TOK, 300, "the rig patches `var DATASHAPE_TOTAL_TOK = 300;`");
  const shipped = mod.contextBoundsFor("shipped");
  assert.equal(shipped.rootCap, mod.PREFILL_TYPE_CAP, "the shipped rootCap IS the constant, not a copy of its value");
  assert.equal(shipped.surfaceBudgetTok, mod.DATASHAPE_TOTAL_TOK, "the shipped budget IS the constant");
});

btest("C2: the rig's two textual patch sites are still present in the bundle, and still unique", () => {
  for (const re of [/var PREFILL_TYPE_CAP = 4;/g, /var DATASHAPE_TOTAL_TOK = 300;/g]) {
    const hits = bundleSrc.match(re) ?? [];
    assert.equal(hits.length, 1, `${re} must match EXACTLY once in the bundle; found ${hits.length}`);
  }
});

btest("C3: fnGen's shipped DATASHAPE_BOUNDS / CROSS_FILE_BOUND literals survive, in the rig's exact shape", () => {
  // review-v46-p0's RIG rows pin these from the rig side; this row pins them
  // from the product side, so a refactor that dissolved the literal into the
  // stop table turns red HERE too rather than only where the rig is checked out.
  assert.match(
    bundleSrc,
    /var DATASHAPE_BOUNDS = \{ D_MAX: 2, B_MAX: 4, N_MAX: 6, TOK_MAX: walkTokMaxFor\(DATASHAPE_TOTAL_TOK\) \};/,
    "lib-core's WIDE_PATCHES and loadPrefillBudget both match this literal by exact text",
  );
  assert.match(bundleSrc, /N_MAX: 12 \}/, "lib-core's WIDE_PATCHES widens the gather through this literal");
});

btest("C4: the shipped stop's structural numbers ARE the module constants' - the two cannot drift", () => {
  const shipped = mod.contextBoundsFor("shipped");
  const dsBounds = mod.FNGEN_PROFILE.dataShape;
  assert.equal(shipped.depth, dsBounds.D_MAX, "depth vs DATASHAPE_BOUNDS.D_MAX");
  assert.equal(shipped.breadth, dsBounds.B_MAX, "breadth vs DATASHAPE_BOUNDS.B_MAX");
  assert.equal(shipped.totalTypes, dsBounds.N_MAX, "totalTypes vs DATASHAPE_BOUNDS.N_MAX");
  assert.equal(shipped.totalTypes * 2, mod.FNGEN_PROFILE.crossFile.N_MAX, "the gather runs 2x the walk at the shipped stop");
});

// ===========================================================================
// D. THE DIAL IS NOT INERT, THROUGH THE PRODUCT PATH.
//
// A WIDE graph, because a narrow one cannot tell a working dial from a broken
// one: with 3 roots of 2 fields each, every stop renders the same block and
// every stop is "equal" for a reason that has nothing to do with the dial.
// ===========================================================================

const WS = "file:///work/v48p1";
const MAIN = `${WS}/main.rs`;

// ROOTS roots, each with FIELDS distinct nested field-types, each nested type
// carrying three primitive fields and one method. 20 roots x 52 fields = 1040
// distinct types: wider than the frontier stop's 16 roots, 48 breadth and 192
// total, so NO stop is bounded by the fixture rather than by its own numbers.
//
// The method is not decoration. `membersWithSettle` re-polls a type whose
// member set renders no method, three times, 40ms apart - the cold-file race
// guard. A fixture of pure data structs pays 120ms per type and the run takes
// forty minutes.
const ROOTS = 20;
const FIELDS = 52;
const rootName = (i) => `Root${String(i).padStart(2, "0")}`;
const nestName = (i, k) => `Leaf${String(i).padStart(2, "0")}x${String(k).padStart(2, "0")}`;

function wideFixture() {
  const files = {};
  const defTypes = {};
  const roots = [];
  for (let i = 0; i < ROOTS; i++) {
    const r = rootName(i);
    roots.push(r);
    const fields = Array.from({ length: FIELDS }, (_, k) => `    pub f${k}: ${nestName(i, k)},`);
    const rootHover = `pub struct ${r} {\n${fields.join("\n")}\n}`;
    const uri = `${WS}/${r.toLowerCase()}.rs`;
    files[uri] = `${rootHover}\n`;
    defTypes[r] = { uri, hover: rootHover, members: [{ name: "id", kind: "method", signature: `fn id(&self) -> u32` }] };
    for (let k = 0; k < FIELDS; k++) {
      const n = nestName(i, k);
      const nHover = `pub struct ${n} {\n    pub a: i64,\n    pub b: String,\n    pub c: bool,\n}`;
      const nUri = `${WS}/${n.toLowerCase()}.rs`;
      files[nUri] = `${nHover}\n`;
      defTypes[n] = { uri: nUri, hover: nHover, members: [{ name: "id", kind: "method", signature: `fn id(&self) -> u32` }] };
    }
  }
  // Every root is a PARAMETER, so each one anchors at a real position in the
  // target file (the Rust reference finder searches the target's own text) and
  // the ROOT CAP is the only thing deciding how many are admitted.
  const docComment = "/// Assemble the report.";
  const signature = `pub fn assemble(${roots.map((r, i) => `p${i}: ${r}`).join(", ")}) -> u32`;
  const src = [docComment, `${signature} {`, "    todo!()", "}", ""].join("\n");
  files[MAIN] = src;
  const record = {
    span: { start: src.indexOf(signature), end: src.length - 1 },
    signature,
    docComment,
    symbolName: "assemble",
    languageId: "rust",
    kind: "function",
    bodyOnly: false,
    headerIndent: "",
    bodyIndent: "    ",
  };
  return { files, defTypes, record, src };
}

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
  return { uri: { toString: () => uriStr }, offsetAt, positionAt, getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text) };
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
  const typeAt = (c) => {
    const w = wordAt(files[c.uri], c);
    if (w && known.has(w)) return w;
    const line = (files[c.uri] || "").split("\n")[c.line] ?? "";
    const on = [...known].filter((t) => new RegExp(`\\b${t}\\b`).test(line));
    return on.length === 1 ? on[0] : undefined;
  };
  const defLoc = (t) => {
    const uri = defTypes[t].uri;
    const lines = (files[uri] || "").split("\n");
    const ln = lines.findIndex((l) => new RegExp(`\\b${t}\\b`).test(l));
    if (ln < 0) return undefined;
    const ch = lines[ln].indexOf(t);
    return { uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
  };
  return {
    definition: async (c) => {
      const t = typeAt(c);
      return t ? defLoc(t) : undefined;
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      return t ? { signature: defTypes[t].hover } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c);
      return (t && defTypes[t].members) || [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

const FX = wideFixture();

async function renderAt(stopOrCfg) {
  const logs = [];
  const opts = typeof stopOrCfg === "string" ? { contextStop: stopOrCfg } : {};
  globalThis.__V48P1_FILES__ = FX.files;
  if (typeof stopOrCfg !== "string") globalThis.__V48P1_CFG__ = stopOrCfg;
  let out;
  try {
    out = await mod.resolvePrefill(
      makeExtractor(FX.files, FX.defTypes),
      makeDoc(FX.src, MAIN),
      FX.record,
      (l) => logs.push(String(l)),
      opts,
    );
  } finally {
    delete globalThis.__V48P1_FILES__;
    delete globalThis.__V48P1_CFG__;
  }
  const text = out || "";
  const types = new Set([...text.matchAll(/\b(Root\d\d|Leaf\d\dx\d\d)\b/g)].map((m) => m[1]));
  return { text, logs, chars: text.length, types: types.size };
}

btest("D1: the rendered block DIFFERS between every adjacent pair of stops (P1)", async () => {
  const seen = [];
  for (const stop of ALL_STOPS) {
    seen.push({ stop, ...(await renderAt(stop)) });
  }
  const report = seen.map((s) => `  ${s.stop.padEnd(9)} chars=${String(s.chars).padStart(6)} types=${s.types}`).join("\n");
  for (const s of seen) {
    assert.ok(s.chars > 0, `${s.stop} rendered nothing at all, so the comparison below is vacuous\n${report}`);
  }
  for (let i = 1; i < seen.length; i++) {
    assert.notEqual(
      seen[i].text,
      seen[i - 1].text,
      `${seen[i - 1].stop} and ${seen[i].stop} rendered a BYTE-IDENTICAL block. That is the inert dial ` +
        `this phase exists to prevent: three of the four numbers make the fourth inert.\n${report}`,
    );
    assert.ok(
      seen[i].chars > seen[i - 1].chars,
      `${seen[i].stop} did not render MORE than ${seen[i - 1].stop}\n${report}`,
    );
  }
});

btest("D2: each of the four numbers reaches the walk on its own (P2)", async () => {
  // Not through the stop table - one number at a time against the profile the
  // walk is actually called with, which is what P2 asks. The stop table is the
  // only place the four are bundled; this row proves the bundle is not hiding
  // three dead wires.
  const base = mod.budgetProfileFor("local-mid", "rust", "small");
  for (const k of ["breadth", "totalTypes", "surfaceBudgetTok"]) {
    const moved = mod.budgetProfileFor("local-mid", "rust", "medium");
    assert.notEqual(moved[k], base[k], `${k} must differ between small and medium for this row to mean anything`);
  }
  // Roots: the admission loop's own cap, read off the channel rather than
  // inferred, at two stops whose rootCap differs.
  const small = await renderAt("small");
  const large = await renderAt("large");
  const rootsOf = (r) => {
    const line = r.logs.find((l) => l.includes("[fngen] injected context:"));
    return /roots=(\d+)/.exec(line || "")?.[1];
  };
  assert.equal(rootsOf(small), "8");
  assert.equal(rootsOf(large), "12");
});

btest("D3: the channel names the stop in force and its four numbers, once (P8)", async () => {
  const r = await renderAt("medium");
  const lines = r.logs.filter((l) => l.includes("[fngen] injected context:"));
  assert.equal(lines.length, 1, `exactly one line per gesture, got ${lines.length}:\n${lines.join("\n")}`);
  for (const frag of ["stop=medium", "roots=8", "breadth=12", "types=48", "budget=1200tok"]) {
    assert.ok(lines[0].includes(frag), `the line must carry ${frag}; got:\n${lines[0]}`);
  }
});

btest("D4: the setting drives the render - a stop set in settings.json reaches the block", async () => {
  // renderAt(string) pins the stop through the opts seam; this row goes the
  // other way, through the SETTING, so a resolver wired to nothing turns red.
  const viaSetting = await renderAt({ injectedContext: "large" });
  const viaOpts = await renderAt("large");
  assert.equal(viaSetting.text, viaOpts.text, "the setting and the pinned stop must render the same block");
  const dflt = await renderAt({});
  const small = await renderAt("small");
  assert.equal(dflt.text, small.text, "an unset setting is the `small` install default");
});

// ===========================================================================
// E. THE SETTING RESOLVER (P5, P6).
// ===========================================================================

const withCfg = (cfg, fn) => {
  if (cfg === undefined) delete globalThis.__V48P1_CFG__;
  else globalThis.__V48P1_CFG__ = cfg;
  try {
    return fn();
  } finally {
    delete globalThis.__V48P1_CFG__;
  }
};

btest("E1: the resolution is total and never throws (P5)", () => {
  const cases = [
    [undefined, "an absent setting"],
    [{}, "an absent key"],
    [{ injectedContext: "" }, "an emptied field"],
    [{ injectedContext: "   " }, "whitespace"],
    [{ injectedContext: "enormous" }, "an unrecognised value"],
    [{ injectedContext: 7 }, "a hand-edited non-string"],
    [{ injectedContext: null }, "a null"],
    [{ injectedContext: "shipped" }, "the internal stop, which no setting value may reach"],
    ["no-provider", "a host whose getConfiguration throws"],
  ];
  for (const [cfg, why] of cases) {
    const got = withCfg(cfg, () => mod.injectedContextStop());
    assert.equal(got, "small", `${why} must resolve to small, got ${JSON.stringify(got)}`);
  }
});

btest("E2: every public stop resolves to itself", () => {
  for (const stop of PUBLIC_STOPS) {
    assert.equal(withCfg({ injectedContext: stop }, () => mod.injectedContextStop()), stop);
  }
});

btest("E3: a user who still has the replaced setting gets ONE channel line naming what took its place", () => {
  const logs = [];
  const got = withCfg(
    { injectedContext: "medium", __inspect__: { injectedSurface: { globalValue: "generous" } } },
    () => mod.injectedContextStop((l) => logs.push(String(l))),
  );
  assert.equal(got, "medium");
  assert.equal(logs.length, 1, `one line, got ${logs.length}:\n${logs.join("\n")}`);
  assert.match(logs[0], /injectedSurface/, "it must name the setting the user still has set");
  assert.match(logs[0], /injectedContext/, "and the one that replaced it");
  // And silence when nobody has it set - a line every developer sees forever is
  // not a migration notice, it is noise.
  const quiet = [];
  withCfg({ injectedContext: "medium" }, () => mod.injectedContextStop((l) => quiet.push(String(l))));
  assert.deepEqual(quiet, []);
});

btest("E5: a failure in the DEPRECATION NOTICE must not discard the stop the user chose", () => {
  // session-v48 loop-back, defect 7. The `injectedSurface` reads sat inside the
  // same try as the resolution and AFTER the stop was computed, so a host that
  // throws on `inspect` - or on a `get` for a key it has never heard of, which
  // is exactly what a removed setting is - silently downgraded a developer who
  // had explicitly chosen `frontier` to the default. A courtesy message about a
  // setting the product no longer reads may not overrule the one it does.
  for (const [cfg, why] of [
    [{ injectedContext: "frontier", __throw_inspect__: true }, "inspect() throws"],
    [{ injectedContext: "frontier", __throw_get__: "injectedSurface" }, "get() throws on the removed key"],
  ]) {
    const logs = [];
    const got = withCfg(cfg, () => mod.injectedContextStop((l) => logs.push(String(l))));
    assert.equal(got, "frontier", `${why}: the chosen stop must survive, got ${JSON.stringify(got)}`);
  }
});

btest("E6: a non-string setting value lands on the default, whatever it coerces to", () => {
  // session-v48 loop-back, defect 7. `String(["frontier"])` is "frontier", so an
  // array in settings.json was accepted as a valid stop through a value the
  // setting cannot hold. A non-string is not an unrecognised stop, it is not a
  // stop at all.
  for (const v of [["frontier"], ["small"], { toString: () => "large" }, 4, true]) {
    assert.equal(
      withCfg({ injectedContext: v }, () => mod.injectedContextStop()),
      "small",
      `${JSON.stringify(v)} is not a string and must resolve to the install default`,
    );
  }
});

btest("E4: the stop is read ONCE per gesture, not once per candidate (P6)", async () => {
  let reads = 0;
  const cfg = {};
  Object.defineProperty(cfg, "injectedContext", {
    enumerable: true,
    get() {
      reads++;
      return "frontier";
    },
  });
  globalThis.__V48P1_FILES__ = FX.files;
  globalThis.__V48P1_CFG__ = cfg;
  try {
    await mod.resolvePrefill(
      makeExtractor(FX.files, FX.defTypes),
      makeDoc(FX.src, MAIN),
      FX.record,
      () => {},
    );
  } finally {
    delete globalThis.__V48P1_FILES__;
    delete globalThis.__V48P1_CFG__;
  }
  // The frontier stop admits 16 roots and looks at up to 48 candidates. One
  // read per candidate would be dozens; one per gesture is one.
  assert.equal(reads, 1, `the setting was read ${reads} times for one gesture`);
});
