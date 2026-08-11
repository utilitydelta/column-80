// ADVERSARIAL REVIEW - session-v51 phase 0. THE SHARED COLLABORATOR.
//
// WHY THIS FILE EXISTS. Phase 0 prices the whole prompt's C# member blocks
// before the render loop, parks the total on `SharedWalkState.memberFloor`, and
// lets each candidate's data-shape walk spend only the surplus plus what its own
// shed will repay. The pricing pass and the render pass are two different walks
// over the same graph, and this file drives the one graph shape where they
// disagree: ONE COLLABORATOR REACHABLE FROM TWO ROOTS, whose members are all
// fields.
//
// THE INSTRUMENT is the one `test/review-v50-p4-starvation.test.cjs` uses, with
// one addition. N candidate types, each with K scalar fields, one method, and
// one field pointing at a single shared class `Share`. `Share` is never named in
// the target's signature, so it is a COLLABORATOR and not a candidate. The one
// variable between the before and the after side is the `kind` the transport
// puts on a data member (`other` = the pre-leg input, `field` = the post-leg
// one); `renderMemberSignatures` ignores kind, so the member LINES are
// byte-identical across the flip. Product render on both sides, through
// `resolvePrefill`, with the bound read off the product's own `budgetProfileFor`.
//
// WHAT IT FINDS, in one sentence: a collaborator whose member block SHEDS TO
// NOTHING renders under no root at all, so it is never marked as given, and a
// LATER root then renders it in full - after the reserve that paid for it was
// released. The prompt pays for that block twice, and a type at the tail loses
// the member list it had.
//
// EVERY ROW IS GREEN AS OF 2026-08-11, AND EVERY ROW WAS RED AGAINST SOME BUILD.
// V1, V2, V3, V4 and V6 were each red against a real build of this phase and are
// the pins that would catch a revert; V7, V8 and V9 were added afterwards to pin
// the individual pieces the first mutation matrix showed were covered only in
// combination. What each row catches, from a one-line-revert matrix run in a
// scratch copy of the tree (canary-validated - renaming the `Members of` header
// turns V1 and V3 red, so the mutations do reach the bundle):
//
//   revert                                                      turns red
//   csShapeGraphBlock marking a method-less type as given        V7
//   the member render's ceiling (remaining - what others are owed) V6
//   the pricing pass's roots-before-collaborators order          V6
//   the refusal recording every carried name, not just the root  V9
//   the aggregate line partitioning by what RENDERED, not cause  V9
//   the refusal line naming the carried types                    V4
//   the refusal restoring droppedBy   (only with the above)      V8, V9
//   both halves of the shed-to-nothing fix together              V1, V2, V6, V7
//
//
// Run: SKIP_LIVE=1 npx node --test test/review-v51-p0-shared.test.cjs

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const STUB = path.join(__dirname, ".review-v51-p0-vscode-stub.cjs");
const ENTRY = path.join(__dirname, ".review-v51-p0.entry.ts");
const OUTFILE = path.join(__dirname, ".review-v51-p0.bundle.cjs");

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
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
const keyOf = (a) => (typeof a === "string" ? a : (a && a.toString ? a.toString() : String(a)));
module.exports = {
  Position, Range, Selection: class extends Range {}, WorkspaceEdit: class {},
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
      const files = globalThis.__V51P0_SHARED_FILES__ || {};
      const key = keyOf(arg);
      return Promise.resolve({ uri: mkUri(key), getText: () => files[key] });
    },
  },
};
`,
);

let FN;
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { resolvePrefill } from "../src/vscode/fnGen";\n` +
      `export { budgetProfileFor, DEFAULT_CONTEXT_STOP } from "../src/core/budgetProfile";\n`,
  );
  esbuild.buildSync({ entryPoints: [ENTRY], bundle: true, outfile: OUTFILE, format: "cjs", platform: "node", alias: { vscode: STUB } });
  FN = require(OUTFILE);
} catch (e) {
  bundleErr = e;
}
const V = (() => {
  try {
    return require(STUB);
  } catch {
    return undefined;
  }
})();
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip(`bundle broken: ${bundleErr.message}`);
    return fn(ctx);
  });

const B = (s) => Buffer.byteLength(String(s), "utf8");

const wordAt = (text, cursor) => {
  const line = (text || "").split("\n")[cursor.line] ?? "";
  const isWord = (ch) => /[A-Za-z0-9_]/.test(ch);
  let s = Math.min(cursor.character, line.length);
  let e = s;
  while (s > 0 && isWord(line[s - 1])) s--;
  while (e < line.length && isWord(line[e])) e++;
  return e > s ? line.slice(s, e) : undefined;
};

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
    return new V.Position(Math.max(lines.length - 1, 0), 0);
  };
  return {
    uri: { toString: () => uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
  };
}

const fld = (i) => `Fa${String(i).padStart(2, "0")}`;

// ===========================================================================
// THE FIXTURE.
// ===========================================================================

let seq = 0;
function csFixture({ roots, fields, shareFields, kind, shareMethod = false }) {
  const NAMES = ["Alpha", "Bravo", "Chart", "Delta", "Echos", "Foxes", "Golfs", "Hotel"].slice(0, roots);
  const uri = `file:///w/v51p0/cs-${roots}-${fields}-${shareFields}-${kind}-${shareMethod}-${seq++}/App.cs`;
  const lines = [];
  const members = {};
  const hovers = {};
  for (const n of NAMES) {
    hovers[n] = `class App.${n}`;
    members[n] = [];
    lines.push(`public class ${n}`);
    lines.push("{");
    for (let i = 0; i < fields; i++) {
      const t = i % 2 ? "int" : "string";
      members[n].push({ name: fld(i), kind, signature: `${fld(i)} : ${t}`, declLine: lines.length });
      lines.push(`    public ${t} ${fld(i)};`);
    }
    members[n].push({ name: "Shr", kind, signature: "Shr : Share", declLine: lines.length });
    lines.push("    public Share Shr;");
    members[n].push({ name: "Settle", kind: "method", signature: "Settle(int) : bool", declLine: lines.length });
    lines.push("    public bool Settle(int amount) { return true; }");
    lines.push("}", "");
  }
  // The shared collaborator. `shareMethod` is the ONE knob the causal row flips:
  // with it, this type's member block can no longer shed to nothing.
  hovers["Share"] = "class App.Share";
  members["Share"] = [];
  lines.push("public class Share");
  lines.push("{");
  for (let i = 0; i < shareFields; i++) {
    const t = i % 2 ? "int" : "string";
    members["Share"].push({ name: fld(i), kind, signature: `${fld(i)} : ${t}`, declLine: lines.length });
    lines.push(`    public ${t} ${fld(i)};`);
  }
  if (shareMethod) {
    members["Share"].push({ name: "Tally", kind: "method", signature: "Tally() : int", declLine: lines.length });
    lines.push("    public int Tally() { return 0; }");
  }
  lines.push("}", "");

  const signature = `public uint Build(${NAMES.map((n, i) => `${n} p${i}`).join(", ")})`;
  const src = lines
    .concat(["/// <summary>Rebuild the registry.</summary>", signature, "{", "    throw new NotImplementedException();", "}", ""])
    .join("\n");
  return {
    NAMES,
    uri,
    src,
    members,
    hovers,
    declRe: (t) => new RegExp(`^public class ${t}\\b`),
    record: {
      span: { start: src.indexOf(signature), end: src.length - 1 },
      signature,
      docComment: "Rebuild the registry.",
      symbolName: "Build",
      languageId: "csharp",
      kind: "method",
      bodyOnly: false,
      headerIndent: "",
      bodyIndent: "    ",
    },
  };
}

function extractorFor(fix) {
  const lines = fix.src.split("\n");
  const known = new Set(Object.keys(fix.members));
  const typeAt = (c) => {
    const w = wordAt(fix.src, c);
    return w && known.has(w) ? w : undefined;
  };
  return {
    definition: async (c) => {
      const t = typeAt(c);
      if (!t) return undefined;
      const ln = lines.findIndex((l) => fix.declRe(t).test(l));
      if (ln < 0) return undefined;
      const ch = lines[ln].indexOf(t);
      return { uri: fix.uri, range: { startLine: ln, startCharacter: ch, endLine: ln, endCharacter: ch + t.length } };
    },
    hoverSurface: async (c) => {
      const t = typeAt(c);
      return t ? { signature: fix.hovers[t] } : undefined;
    },
    membersOfType: async (c) => {
      const t = typeAt(c);
      return t ? fix.members[t].map((m) => ({ ...m })) : [];
    },
    example: async () => undefined,
    completeMembers: async () => [],
    qualifyImport: async () => undefined,
  };
}

const sectionOf = (text, lead, name) => {
  const i = String(text).indexOf(`${lead} \`${name}\``);
  if (i < 0) return undefined;
  const open = String(text).indexOf("```", i);
  const close = String(text).indexOf("```", open + 3);
  return open < 0 || close < 0 ? undefined : String(text).slice(i, close + 3);
};

async function measure(opts) {
  const fix = csFixture(opts);
  const all = [...fix.NAMES, "Share"];
  const logs = [];
  globalThis.__V51P0_SHARED_FILES__ = { ...(globalThis.__V51P0_SHARED_FILES__ || {}), [fix.uri]: fix.src };
  const text =
    (await FN.resolvePrefill(extractorFor(fix), makeDoc(fix.src, fix.uri), fix.record, (l) => logs.push(String(l)), {})) || "";
  const shaped = all.filter((n) => text.includes(`Data shape of \`${n}\``));
  const membered = all.filter((n) => text.includes(`Members of \`${n}\``));
  return { fix, all, text, logs, bytes: B(text), shaped, membered };
}

const dump = (m) =>
  `\nSHAPED: ${m.shaped.join(",") || "-"}\nMEMBERS: ${m.membered.join(",") || "-"}\nLOGS:\n${m.logs.join("\n")}\nPROMPT:\n${m.text}`;

const aggLine = (m) => m.logs.find((l) => /injected context dropped/.test(l)) || "";
const namedOnAgg = (m) => m.all.filter((n) => aggLine(m).includes(`${n} (`));

// ===========================================================================
// G0. THE GUARD. The bound under measurement is the product's own.
// ===========================================================================

btest("G0 guard [csharp]: the bundle builds and the budget is read off budgetProfileFor", () => {
  assert.equal(typeof FN.resolvePrefill, "function");
  const p = FN.budgetProfileFor("local-mid", "csharp", FN.DEFAULT_CONTEXT_STOP);
  assert.equal(p.stop, "small");
  assert.equal(p.surfaceBudgetTok, 600, "the aggregate the shape blocks and the member blocks compete for");
  assert.equal(p.rootCap, 8);
  assert.equal(p.memberCap, 48);
});

// ===========================================================================
// V1. RED ON PURPOSE. THE FLOOR DOES NOT HOLD WHEN A COLLABORATOR SHEDS TO
// NOTHING.
//
// 8 roots x 12 fields, one shared 4-field collaborator, `small` stop:
//
//   before (kind=other)  2508B  members: all 8 roots
//   after  (kind=field)  2597B  members: 7 roots + Share; `Hotel` has NEITHER
//
// THE MECHANISM, and the render order in the after prompt shows it:
//
//   S:Alpha M:Alpha M:Bravo M:Share M:Chart M:Delta M:Echos M:Foxes M:Golfs
//
//   - `csPriceMemberBlocks` walks the candidates in render order with a scratch
//     dedup set and prices `Share`'s member block UNDER ALPHA, un-shed.
//   - `csShapeBlock` lets Alpha's walk borrow that price, because Alpha's shape
//     block prints every one of Share's fields and the post-walk check prices the
//     shed member render at ZERO for Share.
//   - `csShapeGraphBlock` SKIPS a type whose method list is empty
//     (src/core/csExtraction.ts:1113) and does NOT add it to `visited`, so Share
//     is never marked as given a member block.
//   - `resolvePrefill` releases Alpha's whole share of the reserve anyway
//     (src/vscode/fnGen.ts:2708-2711).
//   - the next root reaches Share, sheds nothing from it (Alpha's walk already
//     put Share in `sharedWalk.visited`, so this walk emits no def for it), and
//     renders its member block IN FULL - 135 bytes nobody is holding budget for.
//
//   The prompt therefore pays Share's member price twice: once as Alpha's borrow,
//   once as Share's real block. `Hotel`, at the tail, loses the member list it
//   had, and ends up in the prompt with nothing at all.
//
// A shared DTO reachable from two parameters of one method is the ordinary shape
// of a C# service call, not a corner.
// ===========================================================================

btest("V1 [csharp] DEFECT: a shed-to-nothing collaborator makes a root pay for a shape block with a LATER root's member list", async () => {
  const cfg = { roots: 8, fields: 12, shareFields: 4 };
  const before = await measure({ ...cfg, kind: "other" });
  const after = await measure({ ...cfg, kind: "field" });

  assert.deepEqual(before.membered, before.fix.NAMES, `precondition: before the field leg every root has a member block.${dump(before)}`);

  const lostMembers = before.membered.filter((n) => !after.membered.includes(n));
  const withNothing = lostMembers.filter((n) => !after.shaped.includes(n));

  assert.deepEqual(
    lostMembers,
    [],
    `THE DEFECT, contract-phase0.md invariant spelling 1 ("every type that renders a member block on the BEFORE side renders ` +
      `one on the AFTER side") and spelling 3 ("no type ends up with nothing"). 8 roots x 12 fields with ONE shared 4-field ` +
      `collaborator: the pre-leg render gave all 8 roots their member block (${before.bytes} bytes); with the field leg lit, ` +
      `${lostMembers.join(" and ")} lose theirs and \`${withNothing.join(", ")}\` is in the prompt with NEITHER block. The ` +
      `collaborator \`Share\` sheds to an EMPTY member list under the first root, so csShapeGraphBlock skips it without marking ` +
      `it given, and a later root renders it in full - after resolvePrefill released the reserve that had been priced for it. ` +
      `The aggregate pays for that block twice.${dump(after)}`,
  );
});

// ===========================================================================
// V2. THE SAME QUESTION, RE-CUT ONTO THE INVARIANT. RE-MEASURED 2026-08-11.
//
// The first cut of this row asserted the SYMPTOM of the double payment - "adding
// a method to the collaborator makes the prompt BIGGER" - and the symptom is
// gone, so the assertion was inverted by the fix rather than satisfied by it:
//
//   BEFORE THE FIX  no method 2597B (Hotel lost, Hotel has nothing) | one method 2838B
//   AFTER THE FIX   no method 2861B (nothing lost)                  | one method 2838B
//
// The question it was asked to answer is unchanged: does giving the shared
// collaborator a method change WHAT IS LOST? The answer must now be "nothing is
// lost either way", and that is contract-phase0.md's invariant, not a byte count.
//
// Both arms are checked against all three spellings, which is what makes the row
// survive the fix and still fail a revert of it:
//   1. a type with a member block BEFORE has one AFTER;
//   2. every member LINE the before side printed is somewhere in the after prompt
//      - the collaborator's lines legitimately MOVE into a data-shape block when
//      that block renders, and this is the spelling that tells the move from a
//      loss;
//   3. a type given a block before has at least one block after.
// ===========================================================================

const memberLinesOf = (m, name) =>
  (sectionOf(m.text, "Members of", name) || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\w+ ?[:(]/.test(l));

btest("V2 [csharp]: a method on the shared collaborator changes what RENDERS, never what is LOST", async (t) => {
  const cfg = { roots: 8, fields: 12, shareFields: 4 };
  const arms = [];
  for (const shareMethod of [false, true]) {
    const before = await measure({ ...cfg, shareMethod, kind: "other" });
    const after = await measure({ ...cfg, shareMethod, kind: "field" });
    arms.push({ shareMethod, before, after });

    // Spelling 1.
    assert.deepEqual(
      before.membered.filter((n) => !after.membered.includes(n)),
      [],
      `shareMethod=${shareMethod}: a type with a member block before the field leg has one after it.${dump(after)}`,
    );
    // Spelling 2, the one that matters: a line may MOVE into the shape block, it
    // may not vanish. Checked for the collaborator too, which is where the whole
    // defect lived.
    for (const n of [...before.fix.NAMES, "Share"]) {
      const lines = memberLinesOf(before, n);
      const missing = lines.filter((l) => !after.text.split("\n").some((a) => a.trim() === l));
      assert.deepEqual(
        missing,
        [],
        `shareMethod=${shareMethod}: member line(s) of \`${n}\` printed before the leg and nowhere after it: ` +
          `${missing.join(", ")}.${dump(after)}`,
      );
    }
    // Spelling 3.
    assert.deepEqual(
      before.membered.filter((n) => !after.membered.includes(n) && !after.shaped.includes(n)),
      [],
      `shareMethod=${shareMethod}: no type ends up with nothing.${dump(after)}`,
    );
  }
  t.diagnostic(
    arms
      .map(
        (a) =>
          `shareMethod=${a.shareMethod}: before=${a.before.bytes}B after=${a.after.bytes}B ` +
          `afterMembers=[${a.after.membered}] afterShapes=[${a.after.shaped}]`,
      )
      .join("\n"),
  );
});

// ===========================================================================
// V3. RED ON PURPOSE. THE `ENTIRELY` COUNT IS STILL WRONG, FOR THE V4 REASON.
//
// The line splits its two classes as of this build: "dropped N type(s) entirely
// and M data shape(s) whose member lists stay". `N` counts every ledger entry
// whose cause is NOT `member-floor`, and a refunded walk leaves cap-caused
// entries behind (V4), so a collaborator that has a member block in the prompt
// is counted in the `entirely` clause.
//
// MEASURED, 8 roots x 12 fields, one 12-field collaborator:
//
//   injected context dropped 1 type(s) entirely and 8 data shape(s) whose member
//   lists stay at the `small` stop: Alpha (member lists hold the rest of the
//   budget), Share (render budget 50 tok left of the prompt's shared aggregate,
//   not this walk's 400), ...
//
// Nine types are named; all nine have a `Members of` block in that prompt; zero
// were dropped entirely. The one counted as entirely is `Share`, which is the
// leftover V4 describes.
// ===========================================================================

btest("V3 [csharp] DEFECT: the aggregate line's `entirely` count includes a type that has a member block in the same prompt", async () => {
  const m = await measure({ roots: 8, fields: 12, shareFields: 12, kind: "field" });
  const named = namedOnAgg(m);
  assert.ok(named.length > 0, `precondition: the aggregate line fires.${dump(m)}`);
  const entirely = Number((/dropped (\d+) type\(s\) entirely/.exec(aggLine(m)) || [0, 0])[1]);
  const reallyGone = named.filter((n) => !m.membered.includes(n) && !m.shaped.includes(n));
  assert.equal(
    entirely,
    reallyGone.length,
    `THE DEFECT. The line reads "${aggLine(m)}" - it counts ${entirely} type(s) dropped ENTIRELY while ` +
      `${reallyGone.length} of the ${named.length} names on it have no block of any kind in the prompt. Every name on that ` +
      `line has a \`Members of\` block. The miscount is a leftover from a WITHDRAWN walk (see V4): the refusal restores ` +
      `remainingChars and visited but not \`sharedWalk.droppedBy\`, so the entry keeps its \`budget\` cause and is counted ` +
      `against the "entirely" clause rather than the floor's.${dump(m)}`,
  );
});

// ===========================================================================
// V4. RED ON PURPOSE. THE WITHDRAWN WALK'S LEFTOVERS.
//
// The refusal restores `remainingChars` and swaps `visited` back to a snapshot,
// and it replaces `walk` with an empty result - which SUPPRESSES the per-walk
// drop line. What it does NOT restore is `sharedWalk.droppedBy`: the walk wrote
// its own drops into that ledger (src/core/dataShape.ts:686-694) before the
// refusal, and those entries stand.
//
// So a collaborator dropped inside a walk that was then WITHDRAWN:
//   - appears on the once-per-gesture aggregate line, and
//   - appears NOWHERE else on the channel, and
//   - carries the walk's private allowance as if it were the shared aggregate, and
//   - keeps its `budget` cause, so it is counted in that line's `entirely` clause
//     even though its member block is in the prompt (V3).
//
// MEASURED, 8 roots x 12 fields, one 12-field collaborator:
//
//   ... Share (render budget 50 tok left of the prompt's shared aggregate, not this walk's 400) ...
//
// 50 tok is 200 chars - the allowance `walkWithinAllowance` handed that walk,
// not the aggregate. 1608 further chars of member blocks rendered after that
// walk, so at least 402 tok of the aggregate were in fact left. This is the D3
// failure class dataShape.ts:78-85 says the recorded bound exists to end: "a
// confident figure that was never in force".
// ===========================================================================

btest("V4 [csharp] DEFECT: a withdrawn walk leaves a drop on the aggregate ledger, named nowhere else, with a budget that was never in force", async () => {
  const m = await measure({ roots: 8, fields: 12, shareFields: 12, kind: "field" });
  const named = namedOnAgg(m);
  const perWalk = m.logs.filter((l) => !/injected context dropped/.test(l));
  const silent = named.filter((n) => !perWalk.some((l) => l.includes(n)));
  assert.deepEqual(
    silent,
    [],
    `THE DEFECT. \`${silent.join(", ")}\` is named on the once-per-gesture line and on NO other line in the channel: the walk ` +
      `that dropped it was refused and refunded, which wiped \`walk.dropped\` (so the per-walk drop line never printed) but ` +
      `left the entry it had already written into \`sharedWalk.droppedBy\`. The entry also carries that walk's private ` +
      `allowance as "left of the prompt's shared aggregate".\nAGG: ${aggLine(m)}${dump(m)}`,
  );
});

// ===========================================================================
// V5. RECORDED, NOT ASSERTED. THE DIRECTION IS RIGHT.
//
// 192 configs (roots x fields x collaborator width x collaborator-has-a-method),
// this build against HEAD 968ae62: ZERO configs deliver fewer member blocks than
// the pre-floor build, and 52 deliver more. The floor is a strict improvement on
// that grid; V1 says it is not yet the guarantee the contract claims.
//
// Cost, same instrument, 8 roots x 30 fields x a 20-field collaborator, 60 runs
// after 10 warm: median 50.64ms against HEAD's 49.31ms, +1.3ms. The transport is
// fake, so the absolute is not the product's latency; the DELTA is the floor's.
// ===========================================================================

btest("V5 [csharp]: the grid, printed", async (t) => {
  const rows = [];
  for (const roots of [4, 8]) {
    for (const fields of [8, 12, 20]) {
      for (const shareFields of [0, 4, 12]) {
        const m = await measure({ roots, fields, shareFields, kind: "field" });
        const b = await measure({ roots, fields, shareFields, kind: "other" });
        rows.push(
          `${roots} roots / ${fields} fields / ${shareFields}-field collaborator: before mem=${b.membered.length} ` +
            `after mem=${m.membered.length} shapes=${m.shaped.length} lost=[${b.membered.filter((n) => !m.membered.includes(n))}]`,
        );
      }
    }
  }
  t.diagnostic(rows.join("\n"));
  assert.ok(true);
});

// ===========================================================================
// V6. WAS RED, IS FIXED, AND IS NOW THE ROW THAT CARRIES THREE PIECES AT ONCE.
//
// WHAT WAS WRONG. `csPriceMemberBlocks` priced candidate by candidate, so the
// first candidate's COLLABORATORS were charged against the aggregate before the
// last candidate's own root type was reached. The aggregate ran out inside the
// pricing pass, a tail root that had a member block before the field leg was
// priced ZERO, the floor owed it nothing, and an earlier candidate's shape block
// spent exactly what that root's member list needed. Measured here at 6 roots x
// 20 fields with one shared 12-field collaborator: `Foxes` ended with neither
// block.
//
// THE FIX IS THE PASS ORDER: pass 1 charges every candidate's own root type,
// pass 2 charges the collaborators with what is left. It matches what the floor
// is for - every candidate root had a member block before the leg, and a
// collaborator reached through a field edge did not exist in the prompt until
// the leg derived it, so a root outranks a collaborator for the reserve.
//
// THE FOUR-WAY SWEEP that settled it. 1120 configs (roots x fields x
// collaborator width x collaborator-has-a-method x 0..3 shared collaborators),
// measured 2026-08-11 through this file's own fixture:
//
//   arm                                  a type left with NOTHING  loses a member block  shape blocks  bytes
//   HEAD 968ae62 (pre-floor)                    272 / 1120              433 / 1120           4792    2,685,144
//   first floor build (single-pass pricing)     175 / 1120              175 / 1120           3540    2,554,285
//   single-pass, pricing ceiling removed         51 / 1120               51 / 1120           3461    2,539,216
//   ROOTS FIRST (this build)                      0 / 1120                0 / 1120           3434    2,531,646
//
// Roots-first is a SUPERSET rescue and not a trade: worse in zero configs against
// every other arm, better in 272, 175 and 51 respectively. Removing the pricing
// ceiling was the trade - its 51 losses were a DISJOINT set that starved the
// first candidate instead of the last, which is why it was reported and not
// proposed. The price of roots-first is shape blocks: 3434 against HEAD's 4792,
// and prompts 5.7% smaller. That is the direction contract-phase0.md chose.
//
// THIS ROW CATCHES THREE REVERTS: the pass order, the member render's ceiling
// (which was inert against the single-pass build and binds against this one -
// 172 of 1120 configs lose a member block without it), and, with the
// shed-to-nothing marking, both halves of the F1 fix.
btest("V6 [csharp]: a root the pricing pass charges LAST still keeps the member list it had", async () => {
  const cfg = { roots: 6, fields: 20, shareFields: 12 };
  const before = await measure({ ...cfg, kind: "other" });
  const after = await measure({ ...cfg, kind: "field" });

  assert.deepEqual(before.membered, before.fix.NAMES, `precondition: all six roots have a member block before the leg.${dump(before)}`);
  const withNothing = before.membered.filter((n) => !after.membered.includes(n) && !after.shaped.includes(n));
  assert.deepEqual(
    withNothing,
    [],
    `THE DEFECT, contract-phase0.md spelling 3. 6 roots x 20 fields with one shared 12-field collaborator: ` +
      `\`${withNothing.join(", ")}\` had a member block before the field leg and has NEITHER block after it. The collaborator's ` +
      `member block is new surface the leg created, the pricing pass charges it against the same aggregate and in front of the ` +
      `tail roots, so the tail is priced zero, owed nothing, and its member list is what pays for an earlier root's shape ` +
      `block. Removing the pricing pass's ceiling puts it back.${dump(after)}`,
  );
});

// ===========================================================================
// V7 / V8 / V9. THE INDIVIDUAL PINS.
//
// The first mutation matrix over this file found that V1-V4 pin the fix as
// CONJUNCTIONS: no single-line revert of the empty-type marking, the ledger
// restore or the entirely-count partition turned any row red on its own. These
// three rows close that. Each is written at a width where exactly one piece of
// the fix decides the answer.
//
// V7 pins `csShapeGraphBlock` marking a method-less type as given.
// V8 pins the refusal restoring `sharedWalk.droppedBy`.
// V9 pins the aggregate line partitioning by WHAT RENDERED rather than by cause.
//
// TWO PIECES ARE PINNED BY NO ROW, AND BOTH ARE DELIBERATE.
//
// Restoring `visited` by CONTENT rather than by swapping the Set object is
// INERT: across all 1120 sweep configs, swapping the object back changes zero
// prompts and zero channel lines. `memberSeed` is read at each use and
// `memberBlocks` is always present, so nothing in the product holds a reference
// to the old object. It is a latent-safety change and is recorded here as
// unexercised rather than left looking tested.
//
// Restoring `sharedWalk.droppedBy` on a refusal is REDUNDANT with the write that
// follows it: `carried` re-records every name the walk could have touched - the
// root, its kept defs and its own drops - which is exactly the set `walkDataShape`
// wrote or deleted. Measured over the same 1120 configs: the raw channel text
// differs in 196, and the aggregate line's CONTENT - its two counts and its
// sorted name+cause pairs - differs in ZERO. The whole observable footprint of
// the restore is the ORDER names appear in on one line, and a row asserting name
// order would pin an implementation detail rather than a promise. V8 pins the
// PAIR instead: drop the restore AND the carried write and the stale figure
// returns.
// ===========================================================================

btest("V7 [csharp]: a collaborator the shape block emptied is not ALSO given a member block", async () => {
  // 2 roots x 1 field, one shared 4-field collaborator - narrow on purpose, so
  // the aggregate is nowhere near binding and the ONLY thing that can keep the
  // collaborator's member block out of the prompt is the renderer marking a
  // method-less type as given. At a wider width the member ceiling hides this by
  // refusing the block on budget instead, which is why the first cut of this row
  // could not be turned red.
  const m = await measure({ roots: 2, fields: 1, shareFields: 4, kind: "field" });
  assert.ok(m.shaped.includes("Alpha"), `precondition: the aggregate is not binding, so shape blocks render.${dump(m)}`);
  assert.ok(
    m.text.includes("class App.Share {"),
    `precondition: the shape block carries the collaborator's def, so every one of its member lines is already in the prompt.${dump(m)}`,
  );
  assert.equal(
    m.membered.includes("Share"),
    false,
    `THE PIN. \`Share\`'s every member line is printed inside the data-shape block above, and it renders a \`Members of\` ` +
      `block as well - the same lines twice, out of one aggregate (${m.bytes} bytes here against 839 when the type is marked ` +
      `given). A method-less type must be marked as given when the member renderer skips it, or a later root renders it in ` +
      `full out of a budget the first root was released from.${dump(m)}`,
  );
});

btest("V8 [csharp]: no cap figure from a WITHDRAWN walk survives onto the aggregate line", async () => {
  const m = await measure({ roots: 8, fields: 12, shareFields: 12, kind: "field" });
  const refused = m.logs.filter((l) => /walk `\w+` refused/.test(l));
  assert.ok(refused.length > 0, `precondition: this width refuses walks.${dump(m)}`);
  assert.equal(
    m.logs.some((l) => /data-shape walk .* dropped /.test(l)),
    false,
    `precondition: no walk in this prompt survived to report a cap of its own.${dump(m)}`,
  );
  assert.equal(
    /render budget \d+ tok/.test(aggLine(m)),
    false,
    `THE PIN. Every walk in this prompt was REFUSED and refunded, so no cap was ever in force - and the aggregate line ` +
      `carries a \`render budget N tok left of the prompt's shared aggregate\` figure anyway. It is the allowance the ` +
      `withdrawn walk was handed, left behind in \`sharedWalk.droppedBy\` because the refusal restored remainingChars and ` +
      `visited and not the ledger. A confident figure that was never in force is the failure class the recorded budget ` +
      `bound exists to end (src/core/dataShape.ts:78-85).\nAGG: ${aggLine(m)}${dump(m)}`,
  );
});

btest("V9 [csharp]: the aggregate line's two clauses match the prompt, at a width where cause and payload disagree", async () => {
  const m = await measure({ roots: 6, fields: 20, shareFields: 12, kind: "field" });
  const named = namedOnAgg(m);
  assert.ok(named.length > 1, `precondition: the line names several types.${dump(m)}`);
  const gone = named.filter((n) => !m.membered.includes(n) && !m.shaped.includes(n));
  const kept = named.filter((n) => m.membered.includes(n) || m.shaped.includes(n));
  assert.ok(gone.length > 0 && kept.length > 0, `precondition: both clauses are non-empty here.${dump(m)}`);
  const entirely = Number((/dropped (\d+) type\(s\) entirely/.exec(aggLine(m)) || [0, 0])[1]);
  const heldBack = Number((/(\d+) data shape\(s\) whose member lists stay/.exec(aggLine(m)) || [0, 0])[1]);
  assert.deepEqual(
    { entirely, heldBack },
    { entirely: gone.length, heldBack: kept.length },
    `THE PIN. Every drop on this line carries the \`member-floor\` cause, and one of the named types (${gone.join(", ")}) ` +
      `has NO block of any kind in the prompt. A partition read off the CAUSE puts all of them in the "member lists stay" ` +
      `clause and tells the developer a list survived that did not; the partition has to be read off what actually ` +
      `rendered.\nAGG: ${aggLine(m)}${dump(m)}`,
  );
});
