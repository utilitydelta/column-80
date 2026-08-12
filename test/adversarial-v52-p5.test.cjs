// ADVERSARIAL REVIEW - session-v52 phase 5, `src/vscode/tightenDocComment.ts`.
//
// THIS FILE IS RED BY DESIGN. Every `D<n>` row asserts what `contract-p5.md`,
// its five amendments, or the goal's ship conditions REQUIRE, and fails against
// the code as reviewed. The assertion message carries the observed value, so a
// failure reads as the defect report. Every `SOUND` row is green and is a
// suspicion that came back clean.
//
// Nothing here edits `src/**` or any other test file.
//
// Run: SKIP_LIVE=1 node --test test/adversarial-v52-p5.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const esbuild = require("esbuild");
const { performance } = require("node:perf_hooks");

// ===========================================================================
// Harness. Same shape as test/impl-v52-p5-command.test.cjs: the command's only
// runtime edge to fnGen.ts is the wiring record, so the whole pipeline drives
// headless against a vscode stub.
// ===========================================================================

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "adv-v52-p5-"));
const STUB = path.join(DIR, "vscode-stub.cjs");
const ENTRY = path.join(DIR, "entry.ts");
const OUTFILE = path.join(DIR, "bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    STUB,
    `
class Position { constructor(line, character){ this.line=line; this.character=character; } }
class Range { constructor(a,b){ this.start=a; this.end=b; } }
class WorkspaceEdit { replace(){} }
class EventEmitter { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
module.exports = {
  Position, Range, WorkspaceEdit, EventEmitter,
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { Class:4, Enum:9, Interface:10, Struct:22, TypeParameter:25, Function:11, Variable:12, Constant:13, Method:5 },
  window: { showWarningMessage: () => {}, showQuickPick: async () => undefined, activeTextEditor: undefined },
  commands: { registerCommand: () => ({ dispose(){} }), executeCommand: async () => undefined },
  workspace: {
    workspaceFolders: [{ uri: mkUri("/repo") }],
    applyEdit: async () => true,
    getConfiguration: () => ({ get: (k,f)=>f, has: ()=>false, inspect: ()=>undefined, update: async ()=>{} }),
  },
};
`,
  );
  const rel = (p) => JSON.stringify(path.join(__dirname, "..", p));
  fs.writeFileSync(
    ENTRY,
    `export { tightenDocComment, verbatimBreach, TIGHTEN_COMMAND_ID } from ${rel("src/vscode/tightenDocComment")};
export { availablePromptTok, estimateTextTok } from ${rel("src/core/promptBudget")};
export { foldName, matchByFold } from ${rel("src/core/spokenName")};
export { findRestatements } from ${rel("src/core/tightenFlags")};
export { parseProposerReply } from ${rel("src/core/tightenProposer")};
export { prefillStopNamesFor, stopNamesFor } from ${rel("src/core/repairTypes")};
export { PRELUDE_TYPES } from ${rel("src/core/compilerDirected")};
export { TS_STD_TYPE_NAMES } from ${rel("src/core/tsExtraction")};
export { CS_STD_TYPE_NAMES } from ${rel("src/core/csExtraction")};
export { PY_STD_TYPE_NAMES, STD_TYPE_NAMES } from ${rel("src/core/crossFileShape")};
export { GO_STD_TYPE_NAMES } from ${rel("src/core/goExtraction")};\n`,
  );
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
test.after(() => fs.rmSync(DIR, { recursive: true, force: true }));

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
    version: 1,
    isClosed: false,
    uri: { toString: () => uriStr, fsPath: uriStr, path: uriStr },
    offsetAt,
    positionAt,
    getText: (r) => (r ? text.slice(offsetAt(r.start), offsetAt(r.end)) : text),
    lineAt: (l) => ({ text: lines[l] }),
  };
}

const TS_FILE = "/repo/src/walk.ts";
const DICTATED =
  "// this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
  "export function walk() {}\n";

const LEDGER = {
  rendered: ["SegmentIndex"],
  visited: ["SegmentIndex", "SegmentRow"],
  noBlock: [],
  notLookedAt: [],
  dropped: [],
  typeCap: 4,
  admitted: 4,
  surface: "SegmentIndex\n  - id: number\n  - rows: SegmentRow[]\n",
};

const WORKSPACE = [
  { name: "ShardMemCache", kind: 4, path: "/repo/src/core/shardMemCache.ts" },
  { name: "ClientSet", kind: 10, path: "/repo/src/core/clientSet.ts" },
  { name: "ClientSetBuilder", kind: 4, path: "/repo/src/core/clientSet.ts" },
  { name: "ClientSets", kind: 13, path: "/repo/src/core/clientSets.ts" },
  { name: "client_set", kind: 11, path: "/repo/src/core/clientSet.ts" },
  { name: "SegmentIndex", kind: 4, path: "/repo/src/core/segmentIndex.ts" },
];
function fuzzy(query) {
  const key = String(query).toLowerCase().replace(/[^a-z0-9]/g, "");
  return WORKSPACE.filter((s) => s.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(key.slice(0, 6)));
}

async function run(opts = {}) {
  const text = opts.text ?? DICTATED;
  const languageId = opts.languageId ?? "typescript";
  const doc = opts.doc ?? makeDoc(text, opts.uri ?? TS_FILE, languageId);
  const logs = [];
  const warnings = [];
  const edits = [];
  const counts = { prefill: 0, queries: [], transport: 0 };
  const reply = opts.reply ?? "shard mem cache\nclient sets\n";
  let seenReview;

  const wiring = {
    presenter: { confirmDiff: async () => "accept" },
    resolveFunction: async () => (opts.noFunction === true ? undefined : { languageId, symbolName: "walk" }),
    resolvePrefill: async (_e, _d, _r, _log, o) => {
      counts.prefill++;
      if (opts.noLedger !== true) o?.onLedger?.(opts.ledger ?? LEDGER);
      return undefined;
    },
    prefillLangFor: () => ({
      localTypeDefs: () => new Map(),
      typeReference: (type) => (opts.anchors?.includes(type) ? { uri: TS_FILE, line: 0, character: 0 } : undefined),
    }),
    extractorFor: () => undefined,
    transport: () => async () => {
      counts.transport++;
      if (opts.transportThrows === true) throw new Error("server unreachable");
      return { text: reply, ttftMs: 1, totalMs: 2 };
    },
    modelTag: () => "test-model",
  };
  const FILES = { "/repo/package.json": '{"name":"repo"}' };
  const table = opts.workspace ?? WORKSPACE;
  const deps = {
    querySymbols: async (query) => {
      counts.queries.push(query);
      return (opts.symbols ?? fuzzy)(query);
    },
    fileExists: (p) => Object.prototype.hasOwnProperty.call(FILES, p) || table.some((s) => s.path === p),
    readFile: (p) => FILES[p],
    workspaceRoot: () => "/repo",
    config: () => ({
      apiBase: "http://localhost:11434",
      model: "qwen3-coder:30b",
      fallbackModel: "x",
      maxTokens: 2048,
      temperature: 0,
      numCtx: 16384,
      ...(opts.config ?? {}),
    }),
    windowed: () => opts.windowed !== false,
    review: async (review) => {
      seenReview = review;
      if (opts.review) return opts.review(review);
      return review.rows.map((r, i) => (r.checked ? i : -1)).filter((i) => i >= 0);
    },
    applyEdit: async (_d, start, end, replacement) => {
      edits.push({ start, end, replacement });
      return opts.editFails !== true;
    },
    warn: (m) => warnings.push(m),
  };
  const cursor = opts.cursor ?? { line: 0, character: 20 };
  const outcome = await B.tightenDocComment(doc, cursor, (l) => logs.push(l), wiring, deps);
  const applied = edits.length === 1 ? text.slice(0, edits[0].start) + edits[0].replacement + text.slice(edits[0].end) : text;
  return { outcome, logs, warnings, edits, counts, applied, review: seenReview, text };
}

const atest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip(`bundle failed to build: ${bundleErr.message}`);
    return fn(ctx);
  });

const widest = (buffer) => Math.max(...buffer.split("\n").map((l) => l.length));
const proseOf = (buffer) =>
  buffer.split("\n").filter((l) => l.trim().startsWith("//")).map((l) => l.trim().replace(/^\/\/+ ?/, "")).join(" ");

// ===========================================================================
// D1 BLOCKER - the re-wrap is thrown away whenever no row is accepted.
// ===========================================================================
//
// Contract p5 amendment 2: "The render is NOT conditional on a proposal
// surviving. The first cut made it so, and a dictated one-liner with no type
// name in it got 'nothing to tighten' and stayed at 200 columns, which is the
// feature's own primary input failing. The re-wrap is the baseline edit and the
// rows are the optional half."
//
// The fix moved the failure one step later. The run now reaches the review
// instead of refusing, the diff preview shows the buffer correctly wrapped, and
// then amendment 4's empty-accept guard discards it: `accepted.length === 0`
// returns `{status:"nothing"}` and writes nothing. The 121-column line stays at
// 121 columns.

atest("D1 a dictated one-liner with no type name in it is still left unwrapped", async () => {
  const long =
    "// this walker keeps every entry it can prove is stale and drops the rest of them at the end of each pass over the buffer\n" +
    "export function walk() {}\n";
  assert.ok(widest(long) > 80, "the fixture must actually need wrapping");
  const r = await run({ text: long, reply: "", symbols: () => [] });

  // The developer WAS shown the wrapped buffer at the diff gate.
  assert.ok(r.review !== undefined, "the review ran");
  assert.equal(r.review.rows.length, 0, "with no rows, exactly amendment 2's case");
  assert.ok(widest(r.review.renderWith([])) <= 80, "and the preview it showed was wrapped");

  assert.equal(
    r.edits.length,
    1,
    `amendment 2: the re-wrap is the BASELINE edit, not the optional half. ` +
      `Observed: outcome=${JSON.stringify(r.outcome)}, edits=${r.edits.length}, ` +
      `buffer still ${widest(r.text)} columns wide.`,
  );
  assert.ok(widest(r.applied) <= 80, `the buffer must end up under 80: widest=${widest(r.applied)}`);
});

atest("D1b the same hole with rows present: everything unticked leaves 110 columns", async () => {
  // The default accept set is the ticked rows. A run whose only surviving row
  // is a plural guess ships with nothing ticked, so pressing Enter writes
  // nothing at all - including the wrap.
  const ws = [{ name: "ClientSet", kind: 10, path: "/repo/src/core/clientSet.ts" }];
  const r = await run({ reply: "client sets\n", symbols: () => ws, workspace: ws });
  assert.ok(widest(r.text) > 80);
  assert.equal(r.review.rows.length, 1);
  assert.equal(r.review.rows[0].checked, false, "a plural is a guess and ships unticked");
  assert.equal(
    r.edits.length,
    1,
    `declining the guess must still buy the wrap. Observed: ${JSON.stringify(r.outcome)}, ` +
      `buffer still ${widest(r.text)} columns.`,
  );
});

// FIXED 2026-08-12, and the row now asserts the fixed behaviour. The original
// asserted `edits.length === 0` for the unreachable model, which was the D1 bug
// seen from its other side: with the render restored as the baseline edit the
// wrap DOES land, and what was missing is the sentence. Both halves are pinned
// here, so a regression in either direction fails: the developer is told the
// model could not be reached, AND the half of the gesture that needs no model
// still happens.
atest("D1c the silent half of D1: an unreachable model warns, and the wrap still lands", async () => {
  const dead = await run({ transportThrows: true });
  assert.ok(
    dead.warnings.some((w) => /model could not be reached/i.test(w)),
    `ship condition 8: the developer must be told why no names were offered. Got ${JSON.stringify(dead.warnings)}`,
  );
  assert.equal(dead.edits.length, 1, "and the re-wrap is not a model's business");
  assert.ok(widest(dead.applied) <= 80, `widest=${widest(dead.applied)}`);

  // The other silent path: nothing ticked AND nothing to re-wrap is a real
  // no-op, and it says so rather than returning in silence.
  const first = await run();
  const quiet = await run({ text: first.applied, reply: "" });
  assert.equal(quiet.edits.length, 0);
  assert.ok(quiet.warnings.length > 0, `a no-op must say why: ${JSON.stringify(quiet.warnings)}`);
});

// ===========================================================================
// D2 HIGH - a span located mid-word backticks through the middle of a word.
// ===========================================================================
//
// Standing rule 1: "No leg composes a word and no leg reorders one."
// `parseProposerReply` locates a claim with `prose.indexOf(phrase)`, which has
// no word boundary, and phase 5 auto-applies the row because the whole-prose
// fold is unchanged by inserting backticks. The verbatim guard cannot see it:
// it strips backticks before comparing, which is exactly the character that did
// the damage.

atest("D2 a phrase that sits inside a longer word is backticked through it", async () => {
  const text =
    "// the walker will reshard mem cache entries and drop everything it can prove has gone stale by now\n" +
    "export function walk() {}\n";
  const r = await run({ text, reply: "shard mem cache\n" });
  assert.equal(r.outcome.status, "applied", "it applies, with no accept: the row is ticked by default");
  assert.ok(
    !r.applied.includes("re`ShardMemCache`"),
    `the human's word "reshard" was split by a backtick: ${JSON.stringify(proseOf(r.applied))}`,
  );
});

atest("D2b the verbatim guard cannot see it, because it strips the backtick first", async () => {
  const text =
    "// the walker will reshard mem cache entries and drop everything it can prove has gone stale by now\n" +
    "export function walk() {}\n";
  const r = await run({ text, reply: "shard mem cache\n" });
  const bare = (s) => s.replace(/[ \t\r\n`]+/g, "").toLowerCase();
  assert.equal(bare(proseOf(text)), bare(proseOf(r.applied)), "ship condition 2's own comparison passes");
  // The word boundary is the property the comparison cannot express.
  const words = (s) => proseOf(s).split(/\s+/).filter((w) => w !== "");
  assert.deepEqual(
    words(r.applied).map((w) => w.replace(/`/g, "")),
    words(text),
    `every whitespace-delimited word must survive as one word. Observed the human's ` +
      `"reshard" became ${JSON.stringify(words(r.applied).find((w) => w.includes("`")))}`,
  );
});

// ===========================================================================
// D3 MEDIUM - a ticked deletion that contains a ticked backtick is silently
// dropped, and the channel reports it as applied.
// ===========================================================================

atest("D3 an accepted deletion overlapping an accepted backtick vanishes without a word", async () => {
  const a = "the walker drops every stale entry it can prove is old";
  const prose = `${a}. ${a} from the shard mem cache.`;
  const text = `// ${prose}\nexport function walk() {}\n`;
  const rep = B.findRestatements(prose);
  assert.equal(rep.pairs.length, 1, "the fixture must produce exactly one restatement pair");

  const r = await run({ text, reply: "shard mem cache\n", review: (rv) => rv.rows.map((_x, i) => i) });
  const kinds = r.review.rows.map((x) => x.kind);
  assert.deepEqual(kinds.sort(), ["delete", "respell"], "both rows are offered and both are ticked");
  const del = r.review.rows.find((x) => x.kind === "delete");
  const bt = r.review.rows.find((x) => x.kind !== "delete");
  assert.ok(bt.start >= del.start && bt.end <= del.end, "the backtick span sits inside the deletion span");

  const applied = proseOf(r.applied);
  assert.ok(
    !applied.includes(`${a} from the`),
    `the developer ticked the deletion and it did not happen: ${JSON.stringify(applied)}`,
  );
});

atest("D3b and the channel says it applied both", async () => {
  const a = "the walker drops every stale entry it can prove is old";
  const text = `// ${a}. ${a} from the shard mem cache.\nexport function walk() {}\n`;
  const r = await run({ text, reply: "shard mem cache\n", review: (rv) => rv.rows.map((_x, i) => i) });
  const line = r.logs.find((l) => l.includes("[tighten] applied"));
  assert.equal(
    line,
    "[tighten] applied 1 of 2 rows",
    `only one row reached the buffer; the channel must not claim two. Observed ${JSON.stringify(line)}`,
  );
});

// ===========================================================================
// D4 MEDIUM - a candidate the delta gate drops on the pre-fill stop set or on
// isAllCapsConstant leaves the channel saying "class=4" and then goes quiet.
// ===========================================================================
//
// Goal ship condition: "Every strip is a channel line naming the word and the
// tier that refused it." Contract p5, the channel: "a developer who wants to
// know why a name did not survive reads the channel and finds the answer."

atest("D4 a prelude-stop drop and an ALL_CAPS drop are not named on the channel", async () => {
  const ws = [
    { name: "Result", kind: 9, path: "/repo/src/core/result.rs" },
    { name: "WORKLOAD_SCHEMA", kind: 4, path: "/repo/src/core/schema.rs" },
  ];
  const r = await run({
    text: "/// the walker turns each row into a result and a workload schema before it writes\npub fn walk() {}\n",
    languageId: "rust",
    uri: "/repo/src/walk.rs",
    reply: "result\nworkload schema\n",
    symbols: () => ws,
    workspace: ws,
    review: (rv) => rv.rows.map((_x, i) => i),
  });
  assert.deepEqual((r.review?.rows ?? []).map((x) => x.label), [], "both are correctly dropped from the review");
  for (const name of ["Result", "WORKLOAD_SCHEMA"]) {
    const said = r.logs.filter((l) => l.includes(name) && (l.includes("strip") || l.includes("drop")));
    assert.ok(
      said.length > 0,
      `${name} was refused by the pre-fill's own stop set and the channel never says so. ` +
        `All it printed was: ${JSON.stringify(r.logs.filter((l) => l.includes(name)))}`,
    );
  }
});

// ===========================================================================
// D5 MEDIUM - the displaced type's token figure reads the first substring
// occurrence in the surface, which may belong to another block.
// ===========================================================================
//
// Amendment 1 exists precisely so the number in the diff line is "honest about
// which side of the swap was actually measured". `blockTokFor` then measures
// the wrong block: `surface.indexOf(type)` matches a member line or the import
// hint before it reaches the type's own block.

atest("D5 the swap line prices the wrong block when the name appears earlier in the surface", async () => {
  const block = "SegmentIndex\n  - id: number\n  - name: string\n  - rows: SegmentRow[]\n  - meta: Meta\n";
  const honestLedger = { ...LEDGER, surface: block };
  const shadowedLedger = { ...LEDGER, surface: `PageTable\n  - index: SegmentIndex\n\n${block}` };
  const detailOf = async (ledger) =>
    (await run({ ledger, reply: "shard mem cache\n" })).review.rows.find((x) => x.label === "ShardMemCache").detail;

  const honest = await detailOf(honestLedger);
  const shadowed = await detailOf(shadowedLedger);
  const tok = (d) => Number(/displaces SegmentIndex \(~(\d+) tok\)/.exec(d)?.[1]);
  assert.equal(tok(honest), B.estimateTextTok(block), "the honest surface prices the whole block");
  assert.equal(
    tok(shadowed),
    tok(honest),
    `the same SegmentIndex block must cost the same however the surface is ordered. ` +
      `Observed ~${tok(shadowed)} tok because indexOf landed on "- index: SegmentIndex" in the PageTable block, ` +
      `against ~${tok(honest)} tok for the block itself.`,
  );
});

// ===========================================================================
// D6 MEDIUM - with no pre-fill, every diff row still claims "not currently
// injected".
// ===========================================================================

atest("D6 a run with no ledger asserts a measurement it never made", async () => {
  const r = await run({ noFunction: true, review: (rv) => rv.rows.map((_x, i) => i) });
  assert.ok(r.logs.some((l) => l.includes("ledger: none")), "the channel is honest: no pre-fill ran");
  const detail = r.review.rows[0].detail;
  assert.ok(
    !/not currently injected/.test(detail),
    `no pre-fill ran, so nothing is known about the injected set, and the row states the ` +
      `opposite as fact: ${JSON.stringify(detail)}`,
  );
});

atest("D6b and the budget note reads as a measured zero", async () => {
  const r = await run({ noFunction: true });
  const note = r.review.notes[0];
  assert.ok(
    !/injected surface ~0 tok/.test(note),
    `"~0 tok" is what an empty prompt looks like, not what an unmeasured one looks like: ${JSON.stringify(note)}`,
  );
});

// ===========================================================================
// D7 MEDIUM - a strip never reaches the review, only the channel.
// ===========================================================================
//
// Contract p5, "What the developer sees, and what they have to touch":
// "A refused backtick is shown too, with the tier that refused it. Silent
// removal is the one behaviour this must not have."

atest("D7 the refused backtick is on the channel and nowhere the developer looks", async () => {
  const ws = [{ name: "ShardMemCache", kind: 4, path: "/repo/src/core/shardMemCache.ts" }];
  const r = await run({ reply: "shard mem cache\nclient sets\n", symbols: () => ws, workspace: ws });
  const strip = r.logs.find((l) => l.includes("strip:"));
  assert.ok(strip !== undefined && strip.includes("client sets"), "the channel names it");
  const surfaced = [...r.review.notes, ...r.review.rows.map((x) => `${x.label} ${x.detail}`)].join(" | ");
  assert.ok(
    /client sets/.test(surfaced),
    `the developer's review never mentions the refusal. notes+rows were: ${JSON.stringify(surfaced)}`,
  );
});

// ===========================================================================
// D8 MEDIUM - the tier-2 sweep has no per-invocation budget.
// ===========================================================================
//
// Contract p5: the command "can afford ~285ms plus a model round trip".
// Contract p3, Cost: "`refine.ts` records a ~500ms Roslyn floor per reference
// call, so six candidates is seconds on C#. Cap the candidates, batch the
// lookups". The candidates are capped at 12 and the variants at 9, and the two
// caps multiply: nothing caps the product.

atest("D8 twelve spans that miss cost 85 sequential provider round trips", async () => {
  const prose =
    "the walker keeps a shard mem cache for each of the client sets and drops every stale entry from " +
    "the segment index and the page table and the row store and the meta map and the free list and " +
    "the write ahead log and the block cache and the key range";
  const reply = [
    "shard mem cache", "client sets", "segment index", "page table", "row store", "meta map",
    "free list", "write ahead log", "block cache", "key range", "walker", "stale entry",
  ].join("\n");
  const r = await run({ text: `// ${prose}\nexport function walk() {}\n`, reply, symbols: () => [] });
  assert.ok(
    r.counts.queries.length <= 12,
    `one query per candidate is the measured recall (amendment 5: marginal recall of the sweep ` +
      `over the first query is 0 of 451). Observed ${r.counts.queries.length} round trips, which is ` +
      `${(r.counts.queries.length * 0.5).toFixed(1)}s at the contract's own ~500ms Roslyn floor, ` +
      `against a stated budget of ~285ms plus one model round.`,
  );
});

atest("D8b a chatty reply pays the sweep for words like \"the\"", async () => {
  // `parseProposerReply` keeps any line that is a substring of the prose. A CLI
  // that prefaces its answer costs a full sweep for every filler word it used.
  const reply = "Here are the type names I found:\nthe\nwalker\na\nshard mem cache\nLet me know if you want more.\n";
  const r = await run({ reply, symbols: () => [] });
  assert.ok(
    r.counts.queries.length <= 9,
    `three filler words became claimed spans and each bought a sweep: ${r.counts.queries.length} ` +
      `round trips for one real name. Queries: ${JSON.stringify(r.counts.queries)}`,
  );
});

// ===========================================================================
// D9 LOW - one unmatched backtick kills every later proposal, and the channel
// line says something false about why.
// ===========================================================================

atest("D9 a single stray backtick disables the gesture for the rest of the comment", async () => {
  const text =
    "// the walker uses a ` character and keeps a shard mem cache for each of the client sets it holds\n" +
    "export function walk() {}\n";
  const r = await run({ text, reply: "shard mem cache\n" });
  const skip = r.logs.find((l) => l.includes("already inside a backticked span"));
  assert.equal(
    skip,
    undefined,
    `"shard mem cache" is not inside a backticked span; alreadyTicked treats every unmatched ` +
      `backtick as an open one. Observed: ${JSON.stringify(skip)}`,
  );
  assert.equal(r.edits.length, 1, "and the name should still have been offered and applied");
});

// ===========================================================================
// D10 LOW - a class 2 drop reached through the surface fold names nothing.
// ===========================================================================

atest("D10 a class 2 drop found by the surface fold does not say what it collided with", async () => {
  const ledger = {
    ...LEDGER,
    rendered: ["SegmentIndex"],
    visited: ["SegmentIndex"],
    surface: "SegmentIndex\n  - cache: shard_mem_cache\n",
  };
  const r = await run({ ledger, reply: "shard mem cache\n" });
  const line = r.logs.find((l) => l.includes("candidate ShardMemCache"));
  assert.match(line, /class=2/, "the class is right");
  assert.match(
    line,
    /already in the prompt as/,
    `contract p5: "every class 1 or class 2 drop with the name it collided with". ` +
      `The collision was the surface's own \`shard_mem_cache\` spelling and the line is just ${JSON.stringify(line)}`,
  );
});

// ===========================================================================
// D11 LOW - phase 2's occurrence claiming is dead work at the command level.
// ===========================================================================

// RULED 2026-08-12, and the ruling went the other way, so the row asserts the
// ruling rather than the reviewer's reading of it. ONE BACKTICK PER IDENTIFIER
// IS CORRECT: the gesture buys a re-root and one root is one root, so phase 2's
// amendment 15 (dedupe by identifier) wins and amendment 10 (claim successive
// occurrences) is about span hygiene inside the parser, not about writing
// several backticks. What was a real defect is the COST, and that is pinned
// here too: the dedupe happens before ratification, so the second and third
// occurrence buy no queries at all.
atest("D11 a phrase said three times is backticked once, and pays for one lookup", async () => {
  const prose = "shard mem cache here and shard mem cache there and shard mem cache everywhere in the walker code";
  const text = `// ${prose}\nexport function walk() {}\n`;
  const spans = B.parseProposerReply("shard mem cache\nshard mem cache\nshard mem cache\n", prose);
  assert.equal(spans.length, 3, "p2 amendment 10: a model listing it three times claims three occurrences");

  const r = await run({ text, reply: "shard mem cache\nshard mem cache\nshard mem cache\n" });
  const hits = (r.applied.match(/`ShardMemCache`/g) ?? []).length;
  assert.equal(hits, 1, `one identifier is one root and one backtick: ${JSON.stringify(proseOf(r.applied))}`);
  assert.equal(
    r.counts.queries.length,
    1,
    `the duplicates must be dropped BEFORE the provider is asked. Queries: ${JSON.stringify(r.counts.queries)}`,
  );
  assert.ok(
    r.logs.some((l) => l.includes("already proposed once")),
    `and the channel says why the other two went nowhere: ${JSON.stringify(r.logs.filter((l) => l.includes("skip")))}`,
  );
});

// ===========================================================================
// SOUND. Each of these was attacked and came back clean.
// ===========================================================================

atest("SOUND exactly one resolvePrefill under every failure and cancellation shape", async () => {
  const shapes = {
    "zero proposals": { reply: "" },
    "many proposals": { reply: Array.from({ length: 40 }, () => "shard mem cache\nclient sets\nwalker").join("\n") },
    "cancelled QuickPick": { review: () => undefined },
    "proposer throws": { transportThrows: true },
    "symbol provider throws": { symbols: () => { throw new Error("LSP down"); } },
    "10,000 symbol hits": { symbols: () => Array.from({ length: 10000 }, (_v, i) => ({ name: `ShardMemCache${i || ""}`, kind: 4, path: `/repo/src/x${i}.ts` })) },
    "editor refuses the edit": { editFails: true },
  };
  for (const [name, opts] of Object.entries(shapes)) {
    const r = await run(opts);
    assert.equal(r.counts.prefill, 1, `${name}: ${r.counts.prefill} pre-fills`);
    assert.equal(r.counts.transport, 1, `${name}: ${r.counts.transport} model rounds`);
  }
  // A refusal before step 3 buys none, and a second invocation is independent.
  assert.equal((await run({ languageId: "ruby" })).counts.prefill, 0);
  assert.equal((await run({ text: "const t = 1;\nexport function walk() {}\n" })).counts.prefill, 0);
  assert.equal((await run()).counts.prefill, 1);
  assert.equal((await run()).counts.prefill, 1);
});

atest("SOUND autoApply is read, never re-derived, and nothing downstream reasons about `match`", async () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "tightenDocComment.ts"), "utf8");
  // Nothing in the command compares `match` against a match kind. The only
  // reads are the channel line, the sweep's own undefined check, and spreading
  // the sweep's result record.
  const reasons = src
    .split("\n")
    .filter((l) => /\bmatch\b/.test(l) && /"fold"|"plural"|"guess"/.test(l));
  assert.deepEqual(reasons, [], `something downstream reasons about the match kind: ${JSON.stringify(reasons)}`);
  // SNAPSHOT REFRESHED 2026-08-12, assertion unchanged in kind and strength.
  // The defect-8 and defect-11 fixes moved the sweep's return value and the
  // dedupe, so the three lines this used to list no longer exist; the two
  // `header.match(...)` / `surface.match(...)` entries are
  // `String.prototype.match` calls, which are a different `match` and read no
  // field. The tripwire is the same: any NEW read of the field shows up here
  // and has to be justified.
  const reads = src.split("\n").filter((l) => /\.match\b/.test(l)).map((l) => l.trim());
  assert.deepEqual(reads, [
    "candidate: { ...match, phrase, start: row.span.start, end: row.span.end },",
    "`[tighten] candidate ${f.candidate.identifier} (${JSON.stringify(f.candidate.phrase)}, match=${f.candidate.match})` +",
    "const named = header.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];",
    'for (const word of (ledger?.surface ?? "").match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {',
  ]);
  assert.ok(/checked: proposal\.autoApply/.test(src), "the row reads autoApply");
  // And a plural cannot reach the buffer on a plain confirm.
  const r = await run();
  const plural = r.review.rows.find((x) => x.label === "ClientSet");
  assert.equal(plural.checked, false);
  assert.ok(!r.applied.includes("`ClientSet`"));
  assert.ok(r.applied.includes("client sets"));
});

atest("SOUND matchByFold can never produce a `guess`, so nothing unlabelled can auto-apply", () => {
  const seen = new Set();
  for (const phrase of ["client sets", "shard mem cache", "shard memory cache", "planes", "caches", "x"]) {
    const m = B.matchByFold(phrase, ["ClientSet", "ShardMemCache", "Plan", "Plane", "Cache", "X"]);
    if (m) seen.add(m.match);
  }
  assert.ok(!seen.has("guess"), `matchByFold returned ${[...seen].join(",")}`);
});

atest("SOUND the document changing mid-review refuses and says why", async () => {
  const doc = makeDoc(DICTATED, TS_FILE, "typescript");
  const r = await run({
    doc,
    review: (rv) => {
      doc.version = 7;
      return rv.rows.map((x, i) => (x.checked ? i : -1)).filter((i) => i >= 0);
    },
  });
  assert.equal(r.outcome.status, "refused");
  assert.equal(r.edits.length, 0);
  assert.match(r.warnings.join(" "), /document changed/);
});

atest("SOUND standing rule 6: prefillStopNamesFor is byte-identical to what the five legs passed", () => {
  assert.strictEqual(B.prefillStopNamesFor("rust"), B.PRELUDE_TYPES, "rust: the same object the rust leg passed");
  assert.strictEqual(B.prefillStopNamesFor("typescript"), B.TS_STD_TYPE_NAMES);
  assert.strictEqual(B.prefillStopNamesFor("csharp"), B.CS_STD_TYPE_NAMES);
  assert.strictEqual(B.prefillStopNamesFor("python"), B.PY_STD_TYPE_NAMES);
  assert.strictEqual(B.prefillStopNamesFor("go"), B.GO_STD_TYPE_NAMES);
  for (const lang of ["typescript", "typescriptreact", "javascript", "csharp", "python", "go"]) {
    assert.strictEqual(B.prefillStopNamesFor(lang), B.stopNamesFor(lang), `${lang} must be the resolver set`);
  }
  assert.notStrictEqual(B.prefillStopNamesFor("rust"), B.stopNamesFor("rust"), "rust is the one intended difference");
});

atest("SOUND the command is registered from fnGen and reachable no other way", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const wired = JSON.stringify({ keybindings: pkg.contributes.keybindings ?? [], menus: pkg.contributes.menus ?? {} });
  assert.ok(!wired.includes("tightenDocComment"));
  const fnGen = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "fnGen.ts"), "utf8");
  assert.equal((fnGen.match(/registerTightenDocComment\(/g) ?? []).length, 1, "exactly one call site");
  assert.match(fnGen, /import \{ registerTightenDocComment \} from "\.\/tightenDocComment"/);
  assert.ok(!fnGen.includes('executeCommand("column80.tightenDocComment'));
  // The transport is read at CALL time, so a settings rebuild is followed.
  assert.match(fnGen, /transport: \(\) => service\.transport/);
});

atest("SOUND the verbatim guard refuses an out-of-range accept rather than writing a subset", async () => {
  const r = await run({ review: () => [0, 99] });
  assert.equal(r.outcome.status, "refused", JSON.stringify(r.outcome));
  assert.equal(r.edits.length, 0);
  assert.match(r.warnings.join(" "), /not word-for-word|does not exist/);
});

atest("SOUND press two is a strict no-op once the fold match has been accepted", async () => {
  const first = await run();
  assert.equal(first.outcome.status, "applied");
  // The now-backticked name is class 1 on press two, and the span is skipped
  // before the classifier even sees it.
  const second = await run({
    text: first.applied,
    reply: "ShardMemCache\nshard mem cache\nclient sets\n",
    ledger: { ...LEDGER, rendered: ["SegmentIndex", "ShardMemCache"], visited: ["SegmentIndex", "ShardMemCache"] },
  });
  assert.equal(second.edits.length, 0, "no second write");
  const third = await run({ text: first.applied, reply: "shard mem cache\n" });
  assert.equal(third.edits.length, 0);
});

atest("SOUND the CPU cost of one invocation, model round and provider trips excluded", async () => {
  await run();
  const ts = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    await run();
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  const p95 = ts[Math.floor(ts.length * 0.95)];
  console.log(`      [cost] p50=${ts[100].toFixed(3)}ms p95=${p95.toFixed(3)}ms max=${ts[199].toFixed(3)}ms (2 spans, 2 queries)`);
  assert.ok(p95 < 20, `the product's own work must be noise beside the round trips: p95=${p95.toFixed(2)}ms`);
});

// ===========================================================================
// SKIPPED LOUDLY. These need something this box is not being asked to start.
// ===========================================================================

test("SKIP live language server: real executeWorkspaceSymbolProvider latency per invocation", (ctx) =>
  ctx.skip(
    "needs a real extension host with rust-analyzer / tsserver / gopls / Roslyn / pyright up. " +
      "test-vscode/tighten.test.js row 2 times ONE query; nothing times the 85-query worst case D8 counts. " +
      "The wall-clock end-to-end number in the report is therefore CPU only.",
  ));

// CLOSED, and the review could not know: it WAS re-measured, concurrently with
// this review. The skip stays as the pointer rather than being deleted, because
// the number is the answer to the question the row asked.
test("SKIP live model: the claude-code second-turn rate, RE-MEASURED at 0.0%", (ctx) =>
  ctx.skip(
    "session-v52/census-delta.md measured 14 of 60 rows (23.3%) taking a second turn, which " +
      "claudeCodeInstruct.ts rejects outright. After the phase 2 prompt rewrite the same 60 rows were " +
      "re-run - same binary, same model, same flags, turn count read off the product's own channel - " +
      "and the rate is 0.0%. Rig: session-v52/spikes/census-b-turns.cjs. Nothing here re-spends the " +
      "60 live `claude -p` calls at roughly $0.10 each.",
  ));

test("SKIP real host: the accept path through QuickPick and ProposalPresenter.confirmDiff", (ctx) =>
  ctx.skip(
    "test-vscode/tighten.test.js states this gap itself. Every D-row above drives deps.review " +
      "instead, so nothing here proves showQuickPick returns [] rather than undefined on a zero-row " +
      "review - which is the difference between D1's silent no-op and a cancel.",
  ));
