// session-v52 phase 5: `Column 80: Tighten Doc Comment`, the command that wires
// phases 1 through 4 into a gesture.
//
// WHAT THIS TIER CAN SEE. The whole pipeline runs headless: the module's only
// runtime dependency on `fnGen.ts` is the wiring record passed at registration,
// so a fake `resolvePrefill`, a fake transport and a fake symbol provider drive
// every ordering guarantee the contract states. The counting `resolvePrefill`
// is the one-call test; the applied BYTES are the verbatim test.
//
// WHAT IT CANNOT. Three things need a real extension host and are covered by
// `test-vscode/tighten.test.js` instead: the command appearing in the palette, a
// real `vscode.executeWorkspaceSymbolProvider`, and `workspace.applyEdit`. Row
// 16 drives the real `defaultReview` against the stub's own `showQuickPick`,
// which is what a human PRESSING ESCAPE returns, so the cancel-versus-empty-pick
// distinction is covered here rather than only in the host.
//
// ROWS
//   1  the bundle builds headless
//   2  ONE resolvePrefill per invocation, however many names need a query
//   3  the words are provably the human's: strip whitespace and backticks from
//      both sides of the buffer and compare
//   4  a fold match is ticked, a plural is not, and a plural left alone is not
//      applied
//   5  no backtick reaches the review without a tier 1 or tier 2 hit
//   6  every strip is a channel line naming the word and the tier
//   7  press twice: not the bytes, not the indentation
//   8  a refusal at every stage leaves the buffer untouched and says why
//   9  the budget line reads promptBudget.ts
//  10  class 1 and class 2 are silent to the review and loud on the channel
//  11  the swap line names what accepting displaces
//  12  the verbatim guard refuses a doctored row rather than writing it
//  13  the command is manual: no keybinding, no menu, no automatic path
//  14  five languages, Python's docstring position included
//  15  the flags reach the channel and the review, and a deletion only deletes
//  16  the real `defaultReview`: a zero-row review is not a cancel

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const esbuild = require("esbuild");

// ===========================================================================
// Harness
// ===========================================================================

const STUB = path.join(__dirname, ".impl-v52-p5-vscode-stub.cjs");
fs.writeFileSync(
  STUB,
  `
class Position {
  constructor(line, character) { this.line = line; this.character = character; }
}
class Range {
  constructor(a, b) { this.start = a; this.end = b; }
}
class WorkspaceEdit { replace() {} }
class EventEmitter { constructor(){ this.event=()=>({dispose(){}}); } fire(){} dispose(){} }
const mkUri = (s) => ({ toString: () => String(s), fsPath: String(s), path: String(s) });
module.exports = {
  Position, Range, WorkspaceEdit, EventEmitter,
  Uri: { parse: mkUri, file: mkUri },
  SymbolKind: { Class:4, Enum:9, Interface:10, Struct:22, TypeParameter:25, Function:11, Variable:12, Constant:13, Method:5 },
  window: { showWarningMessage: () => {}, showQuickPick: async () => undefined },
  commands: { registerCommand: () => ({ dispose(){} }), executeCommand: async () => undefined },
  workspace: {
    workspaceFolders: [{ uri: mkUri("/repo") }],
    applyEdit: async () => true,
    getConfiguration: () => ({ get: (k, f) => f, has: () => false, inspect: () => undefined, update: async () => {} }),
  },
};
`,
);

const ENTRY = path.join(__dirname, ".impl-v52-p5.entry.ts");
const OUTFILE = path.join(__dirname, ".impl-v52-p5.bundle.cjs");
let B = {};
let bundleErr;
try {
  fs.writeFileSync(
    ENTRY,
    `export { tightenDocComment, verbatimBreach, TIGHTEN_COMMAND_ID } from "../src/vscode/tightenDocComment";
export { availablePromptTok, estimateTextTok } from "../src/core/promptBudget";
export { foldName } from "../src/core/spokenName";
export { resolveTightenRegion } from "../src/core/tightenRender";\n`,
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
test.after(() => [STUB, ENTRY, OUTFILE].forEach((f) => fs.rmSync(f, { force: true })));

test("row 1: the command bundles headless against a vscode stub", () => {
  if (bundleErr) assert.fail(`bundle failed to build: ${bundleErr.message}`);
  for (const n of ["tightenDocComment", "verbatimBreach", "TIGHTEN_COMMAND_ID"]) {
    assert.ok(B[n] !== undefined, `${n} must be exported`);
  }
});
const btest = (name, fn) =>
  test(name, (ctx) => {
    if (bundleErr) return ctx.skip("bundle failed to build; see row 1");
    return fn(ctx);
  });

// --- a document the command can drive ------------------------------------

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

// The ledger the single pre-fill hands over. `SegmentIndex` rendered and the
// cap is full, so any surviving proposal displaces it.
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

// A fuzzy provider, exactly as the contract describes one: a query for
// `ClientSet` also answers `ClientSetBuilder`, a constant named `ClientSets`
// and a function named `client_set`, and the fold plus the kind filter is what
// clears them. `client_set` earns its place twice over: it folds to the SAME
// key as `ClientSet`, so a candidate search that does not filter by kind first
// reaches two spellings and refuses a type that plainly resolves.
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

/** One invocation, with every seam recorded. */
async function run(opts = {}) {
  const text = opts.text ?? DICTATED;
  const languageId = opts.languageId ?? "typescript";
  const doc = makeDoc(text, TS_FILE, languageId);
  const logs = [];
  const warnings = [];
  const edits = [];
  const counts = { prefill: 0, queries: [], transport: 0 };
  const reply = opts.reply ?? "shard mem cache\nclient sets\n";
  let seenReview;

  const wiring = {
    presenter: { confirmDiff: async () => "accept" },
    resolveFunction: async () => (opts.noFunction === true ? undefined : { languageId, symbolName: "walk" }),
    resolvePrefill: async (_extractor, _document, _resolved, _log, o) => {
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

  // A fake filesystem with ONE package.json, so the TypeScript import row
  // derives a relative specifier instead of a cross-package one. A
  // `fileExists: () => true` finds a package.json in every ancestor directory
  // and refuses every import, which is a fixture defect that reads exactly like
  // a product refusal.
  const FILES = { "/repo/package.json": '{"name":"repo"}' };
  const deps = {
    querySymbols: async (query) => {
      counts.queries.push(query);
      return (opts.symbols ?? fuzzy)(query);
    },
    fileExists: (p) => Object.prototype.hasOwnProperty.call(FILES, p) || WORKSPACE.some((s) => s.path === p),
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
    ...(opts.useDefaultReview === true ? {} : { review: async (review) => {
      seenReview = review;
      if (opts.review) return opts.review(review);
      // The developer presses Enter without touching a row: exactly the ticked
      // set is accepted, which is the default this command must be safe under.
      return review.rows.map((r, i) => (r.checked ? i : -1)).filter((i) => i >= 0);
    } }),
    applyEdit: async (_document, start, end, replacement) => {
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

/** Ship condition 2's comparison, run on the buffer rather than on a helper:
 *  whitespace and backticks off, and NOTHING else. `\s` is wrong here - a
 *  non-breaking space is a character the human said. */
const bare = (s) => s.replace(/[ \t\r\n`]+/g, "");
/** The comment's own words, markers off. */
const proseOf = (buffer) =>
  buffer
    .split("\n")
    .filter((l) => l.trim().startsWith("//"))
    .map((l) => l.trim().replace(/^\/\/+ ?/, ""))
    .join(" ");

// ===========================================================================
// Rows
// ===========================================================================

btest("row 2: exactly ONE resolvePrefill per invocation, whatever the names cost", async () => {
  const r = await run();
  assert.equal(
    r.counts.prefill,
    1,
    "the pre-fill is a ~285ms pre-fill-class resolve and BOTH the delta gate and the diff's " +
      "consequence lines read the same ledger; a second call is the defect this row exists for",
  );
  assert.ok(r.counts.queries.length > 0, "the fixture must actually reach tier 2, or the count proves nothing");
  assert.equal(r.counts.transport, 1, "one proposer round, not one per span");
});

btest("row 2b: one pre-fill even when nothing survives and when no function resolves", async () => {
  assert.equal((await run({ reply: "nothing the model saw\n" })).counts.prefill, 1);
  // No function under the comment: no pre-fill at all, and the channel says the
  // degrade out loud rather than letting an empty ledger read as an empty prompt.
  const none = await run({ noFunction: true });
  assert.equal(none.counts.prefill, 0);
  assert.ok(
    none.logs.some((l) => l.includes("no pre-fill") || l.includes("class 4")),
    `the no-function degrade must be on the channel: ${none.logs.join("\n")}`,
  );
});

btest("row 3: the words are provably the human's", async () => {
  const r = await run();
  assert.equal(r.outcome.status, "applied", `expected an edit: ${JSON.stringify(r.outcome)}`);

  const before = proseOf(r.text);
  const after = proseOf(r.applied);
  assert.notEqual(before, after, "the fixture must actually change, or this row proves nothing");

  // Every difference is a respelling whose folded spoken span equals the folded
  // identifier. The accepted set here is the DEFAULT set (fold matches only), so
  // the two sides must be equal under the fold, character for character.
  assert.equal(
    B.foldName(before),
    B.foldName(after),
    `ship condition 2: strip whitespace and backticks and the two must be equal.\n  BEFORE ${JSON.stringify(before)}\n  AFTER  ${JSON.stringify(after)}`,
  );
  // And the code beneath the comment is untouched, byte for byte.
  assert.ok(r.applied.includes("export function walk() {}"), "the command may not touch code");
});

btest("row 3b: a backticked span is the only new punctuation", async () => {
  const r = await run();
  const after = proseOf(r.applied);
  assert.match(after, /`ShardMemCache`/, "the fold match is applied as a backticked identifier");
  // Nothing but whitespace and backticks may differ, which is exactly what
  // `bare` erases. A word invented anywhere would survive it.
  const dropped = bare(proseOf(r.text)).toLowerCase();
  const kept = bare(after).toLowerCase();
  assert.equal(kept, dropped, `no character outside whitespace and backticks may move:\n  ${dropped}\n  ${kept}`);
});

btest("row 4: only a fold match is ticked, and a plural left alone is not applied", async () => {
  const r = await run();
  const rows = r.review.rows;
  const shard = rows.find((row) => row.label === "ShardMemCache");
  const client = rows.find((row) => row.label === "ClientSet");
  assert.ok(shard !== undefined, `the fold match must reach the review: ${JSON.stringify(rows)}`);
  assert.ok(client !== undefined, `the plural match must reach the review, labelled: ${JSON.stringify(rows)}`);
  assert.equal(shard.checked, true, "a fold match is the one thing the product may respell without asking");
  assert.equal(
    client.checked,
    false,
    "`client sets` folds to clientsets and `ClientSet` folds to clientset: a plural strip is a guess about " +
      "English, and a repo holding both Plan and Plane would have planes silently respelled",
  );
  // The developer pressed Enter without touching a row, so the plural stayed prose.
  assert.ok(!r.applied.includes("`ClientSet`"), "an unticked row must not be written");
  assert.ok(r.applied.includes("client sets"), "the words the developer said survive as prose");
});

btest("row 4b: a plural the developer ticks by hand IS applied", async () => {
  const r = await run({ review: (review) => review.rows.map((_row, i) => i) });
  assert.ok(r.applied.includes("`ClientSet`"), "an explicit accept is the other half of the rule");
  // And the guarantee still holds under a hand accept: the ONLY difference is
  // the substitution the developer accepted.
  const after = proseOf(r.applied);
  assert.ok(after.includes("`ClientSet`") && !after.includes("client sets"));
});

btest("row 5: no backtick reaches the review without a tier 1 or tier 2 hit", async () => {
  // Nothing in the workspace answers, and the model names two spans anyway.
  //
  // AMENDED 2026-08-12 (phase 5 adversarial, defect 1): this row used to assert
  // `status === "nothing"` and no edit, which asserted the bug as correct. The
  // fixture is 110 columns wide, so the RE-WRAP is owed whatever happens to the
  // names; what this row is about is that no BACKTICK survives.
  const r = await run({ symbols: () => [] });
  assert.deepEqual(r.review.rows, [], "no name may be offered when nothing ratified");
  assert.ok(!r.applied.includes("`"), `and none may be written: ${JSON.stringify(proseOf(r.applied))}`);
  assert.equal(r.edits.length, 1, "the wrap is the baseline edit and does not depend on a name");
  assert.ok(Math.max(...r.applied.split("\n").map((l) => l.length)) <= 80);
});

btest("row 5b: the fuzzy provider is fully filtered", async () => {
  // The provider answers ClientSetBuilder, ClientSets and a function named
  // client_set beside ClientSet; exactly one of them may be ratified.
  const r = await run({ review: (review) => review.rows.map((_row, i) => i) });
  const labels = r.review.rows.map((row) => row.label);
  assert.ok(labels.includes("ClientSet"), `ClientSet must survive: ${labels.join(", ")}`);
  for (const wrong of ["ClientSetBuilder", "ClientSets", "client_set"]) {
    assert.ok(!labels.includes(wrong), `${wrong} must not: ${labels.join(", ")}`);
  }
});

btest("row 6: every strip is a channel line naming the word and the tier", async () => {
  const r = await run({ symbols: () => [], reply: "shard mem cache\n" });
  const strips = r.logs.filter((l) => l.includes("strip:"));
  assert.equal(strips.length >= 1, true, `a refused name must be named on the channel: ${r.logs.join("\n")}`);
  assert.match(strips[0], /shard mem cache/, "the strip line names the WORD");
  assert.match(strips[0], /tier 2/, "and the TIER that refused it");
});

btest("row 6b: an ambiguous workspace hit refuses, names both places, and never picks", async () => {
  const twice = [
    { name: "ShardMemCache", kind: 4, path: "/repo/src/a/shardMemCache.ts" },
    { name: "ShardMemCache", kind: 4, path: "/repo/src/b/shardMemCache.ts" },
  ];
  const r = await run({ symbols: () => twice, reply: "shard mem cache\n" });
  assert.ok(!r.applied.includes("`ShardMemCache`"), "an ambiguous name must not be written");
  assert.deepEqual(r.review.rows, [], "and must not be offered either");
  const strips = r.logs.filter((l) => l.includes("strip:"));
  assert.ok(
    strips.some((l) => l.includes("ambiguous") && l.includes("ShardMemCache")),
    `the refusal must reach the channel: ${r.logs.join("\n")}`,
  );
});

btest("row 7: running the command twice changes nothing, bytes or indentation", async () => {
  const first = await run();
  assert.equal(first.outcome.status, "applied");
  // The model is not deterministic about what it names, so press two is driven
  // with a reply that names the SAME words again - including the one that is
  // now inside backticks. A press that re-ticked it would render ``Name``.
  const second = await run({
    text: first.applied,
    reply: "ShardMemCache\nshard mem cache\nclient sets\n",
    review: (review) => review.rows.map((_row, i) => (review.rows[i].checked ? i : -1)).filter((i) => i >= 0),
  });
  const settled = second.edits.length === 0 ? first.applied : second.applied;
  assert.equal(settled, first.applied, "press two must be a no-op, byte for byte");
  const indents = (buffer) => buffer.split("\n").map((l) => l.length - l.trimStart().length);
  assert.deepEqual(indents(settled), indents(first.applied), "and the block must not walk right");
});

btest("row 7b: press twice on an INDENTED comment keeps its column", async () => {
  const indented =
    "class Walker {\n" +
    "    // this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale\n" +
    "    walk() {}\n" +
    "}\n";
  const first = await run({ text: indented, reply: "shard mem cache\n" });
  assert.equal(first.outcome.status, "applied", JSON.stringify(first.outcome));
  const commentLines = first.applied.split("\n").filter((l) => l.trim().startsWith("//"));
  assert.ok(commentLines.length > 0);
  for (const line of commentLines) {
    assert.equal(line.slice(0, 4), "    ", `the comment keeps the region's own indent: ${JSON.stringify(line)}`);
    assert.equal(line[4], "/", `and gains none: ${JSON.stringify(line)}`);
  }
  const second = await run({ text: first.applied, reply: "ShardMemCache\nshard mem cache\n" });
  assert.equal(second.edits.length === 0 ? first.applied : second.applied, first.applied);
});

btest("row 8: a refusal at every stage leaves the buffer untouched and says why", async () => {
  // An unserved language.
  const lang = await run({ languageId: "ruby" });
  assert.equal(lang.outcome.status, "refused");
  assert.equal(lang.edits.length, 0);
  assert.match(lang.warnings.join(" "), /ruby/);

  // A cursor on a line of code: phase 1's naked-prose gate is deliberately mean.
  const code = await run({ text: "const total = shard + cache;\nexport function walk() {}\n" });
  assert.equal(code.outcome.status, "refused", JSON.stringify(code.outcome));
  assert.equal(code.edits.length, 0);
  assert.ok(code.warnings[0].length > 10, "a refusal is a sentence, not a code");

  // The model is unreachable. AMENDED 2026-08-12 (defect 1): the render still
  // stands, so the wrap DOES land - it needs no model - and what the developer
  // must not get is silence about the half that did not happen.
  const dead = await run({ transportThrows: true });
  assert.equal(dead.edits.length, 1, "the wrap needs no model");
  assert.ok(dead.logs.some((l) => l.includes("proposer round failed")), dead.logs.join("\n"));
  assert.ok(
    dead.warnings.some((w) => /model could not be reached/i.test(w)),
    `ship condition 8: say why. Got ${JSON.stringify(dead.warnings)}`,
  );

  // The developer cancels the review.
  const cancelled = await run({ review: () => undefined });
  assert.equal(cancelled.outcome.status, "cancelled");
  assert.equal(cancelled.edits.length, 0);

  // The editor refuses the edit.
  const refusedEdit = await run({ editFails: true });
  assert.equal(refusedEdit.outcome.status, "refused");
  assert.match(refusedEdit.warnings.join(" "), /nothing was written/);
});

btest("row 9: the budget line reads promptBudget.ts and quotes its numbers", async () => {
  const r = await run();
  const line = r.logs.find((l) => l.startsWith("[tighten] budget:"));
  assert.ok(line !== undefined, `there must be a budget line: ${r.logs.join("\n")}`);
  const available = B.availablePromptTok(16384, 2048);
  const surface = B.estimateTextTok(LEDGER.surface);
  assert.ok(line.includes(`~${available} tok available`), `the window comes from availablePromptTok: ${line}`);
  assert.ok(line.includes(`~${surface} tok`), `and the surface from estimateTextTok: ${line}`);

  // A backend with no local window is EXEMPT, exactly as the arbitration reads
  // an absent num_ctx, and the line says so instead of quoting a window that
  // does not exist.
  const cloud = await run({ windowed: false });
  const cloudLine = cloud.logs.find((l) => l.startsWith("[tighten] budget:"));
  assert.match(cloudLine, /no local window/);
});

btest("row 10: class 1 and class 2 are silent to the review and loud on the channel", async () => {
  // `SegmentIndex` rendered already: backticking it would spend a capped slot
  // and evict a real type, so it must never reach the developer.
  const ledger = { ...LEDGER, rendered: ["ShardMemCache"], visited: ["ShardMemCache"] };
  const r = await run({ ledger, reply: "shard mem cache\n" });
  assert.deepEqual(r.review.rows, [], "a class 1 name must not reach the developer's review");
  assert.ok(!r.applied.includes("`ShardMemCache`"), "and must not be written");
  const line = r.logs.find((l) => l.includes("ShardMemCache") && l.includes("class="));
  assert.ok(line !== undefined, `the class must be on the channel: ${r.logs.join("\n")}`);
  assert.match(line, /class=1/);
  assert.match(line, /already in the prompt as ShardMemCache/, "and the name it collided with");
  assert.equal(r.counts.queries.length, 0, "a name already in the surface must not cost a round trip");
});

btest("row 11: the swap line names what accepting displaces", async () => {
  const r = await run();
  const shard = r.review.rows.find((row) => row.label === "ShardMemCache");
  assert.match(shard.detail, /not currently injected/, `class 4 says so: ${shard.detail}`);
  assert.match(shard.detail, /displaces SegmentIndex/, `and the full cap says what it costs: ${shard.detail}`);
  assert.match(shard.detail, /~\d+ tok/, `with the displaced block priced off the SAME ledger: ${shard.detail}`);
  assert.match(shard.detail, /import \{ ShardMemCache \} from "\.\/core\/shardMemCache"/, shard.detail);

  // A cap with a free slot is a pure addition and says nothing about a swap.
  const roomy = await run({ ledger: { ...LEDGER, admitted: 1 } });
  const row = roomy.review.rows.find((x) => x.label === "ShardMemCache");
  assert.ok(!row.detail.includes("displaces"), row.detail);
});

btest("row 12: the verbatim guard refuses a doctored row rather than writing it", async () => {
  const prose = "this walker keeps a shard mem cache for each client set";
  const region = {
    kind: "line-comment",
    start: 0,
    end: prose.length,
    indent: "",
    prefix: "// ",
    prose,
  };
  const at = prose.indexOf("shard mem cache");
  const honest = [
    { kind: "respell", label: "ShardMemCache", detail: "", checked: true, start: at, end: at + "shard mem cache".length, replacement: "`ShardMemCache`" },
  ];
  const rendered = (rows, accepted) => {
    const row = rows[accepted[0]];
    const edited = prose.slice(0, row.start) + row.replacement + prose.slice(row.end);
    return `// ${edited}\n`;
  };
  assert.equal(
    B.verbatimBreach(prose, region, rendered(honest, [0]), "typescript", 4, honest, [0]),
    undefined,
    "an honest respelling passes",
  );
  // A row that writes a word nobody said. This is the mutation the guard exists
  // for: everything upstream can be correct and this still has to catch it.
  const invented = [{ ...honest[0], replacement: "`ShardMemCache` (a cache of shards)" }];
  assert.notEqual(
    B.verbatimBreach(prose, region, rendered(invented, [0]), "typescript", 4, invented, [0]),
    undefined,
    "a row that invents prose must be refused",
  );
});

btest("row 14: five languages, Python's docstring position included", async () => {
  const sentence =
    "this walker keeps a shard mem cache for each of the client sets and drops every entry it can prove is stale";
  const cases = [
    { languageId: "rust", text: `/// ${sentence}\npub fn walk() {}\n`, marker: "///" },
    { languageId: "csharp", text: `    /// ${sentence}\n    void Walk() {}\n`, marker: "///" },
    { languageId: "go", text: `// ${sentence}\nfunc walk() {}\n`, marker: "//" },
    { languageId: "typescript", text: `// ${sentence}\nexport function walk() {}\n`, marker: "//" },
    { languageId: "python", text: `def walk():\n    """${sentence}"""\n`, marker: '"""' },
  ];
  for (const c of cases) {
    // Tier 1 answers, so the row is about the render and the write rather than
    // about five import derivations phase 3 already has rows for.
    const cursor = c.text.indexOf("shard mem cache") + 4;
    const doc = makeDoc(c.text, c.languageId === "python" ? "/repo/src/walk.py" : TS_FILE, c.languageId);
    const r = await run({
      text: c.text,
      languageId: c.languageId,
      reply: "shard mem cache\n",
      anchors: ["ShardMemCache"],
      cursor: doc.positionAt(cursor),
    });
    assert.equal(r.outcome.status, "applied", `${c.languageId}: ${JSON.stringify(r.outcome)}`);
    assert.ok(r.applied.includes("`ShardMemCache`"), `${c.languageId} must respell under the fold`);
    // The words, still the human's, in every language.
    const wordsOf = (buffer) => buffer.replace(/[ \t\r\n`]+/g, "").replace(/\/+|"""/g, "");
    assert.equal(
      wordsOf(r.applied).toLowerCase().replace(/shardmemcache/g, "shardmemcache"),
      wordsOf(c.text).toLowerCase().replace(/shardmemcache/g, "shardmemcache"),
      `${c.languageId}: nothing outside whitespace and backticks may move`,
    );
    for (const line of r.applied.split("\n")) {
      assert.ok(line.length <= 80 || line.split(/\s+/).filter((t) => t !== "").length <= 1, `${c.languageId}: ${line}`);
    }
    // Press two.
    const again = await run({
      text: r.applied,
      languageId: c.languageId,
      reply: "ShardMemCache\nshard mem cache\n",
      anchors: ["ShardMemCache"],
      cursor: doc.positionAt(cursor),
    });
    assert.equal(again.edits.length, 0, `${c.languageId}: press two must write nothing`);
  }
});

btest("row 15: the flags reach the channel and the review, and a deletion only deletes", async () => {
  const twice =
    "// the walker drops every stale entry from the shard cache. the walker drops every stale entry from the shard cache.\n" +
    "export function walk() {}\n";
  const r = await run({ text: twice, reply: "", review: (review) => review.rows.map((_row, i) => i) });
  const del = r.review.rows.find((row) => row.kind === "delete");
  assert.ok(del !== undefined, `a restatement must be offered as a deletion: ${JSON.stringify(r.review.rows)}`);
  assert.equal(del.checked, false, "a deletion is never automatic");
  assert.equal(del.replacement, "", "a deletion may only remove: that is why it cannot introduce a claim");
  assert.ok(
    r.logs.some((l) => l.includes("flag restatement")),
    `the flag must be on the channel: ${r.logs.join("\n")}`,
  );
  // Applied by hand, it removes words and adds none.
  assert.equal(r.outcome.status, "applied");
  const after = proseOf(r.applied);
  assert.ok(after.length < proseOf(twice).length, "the deletion shortened the comment");
  for (const word of after.split(/\s+/).filter((w) => w !== "")) {
    assert.ok(proseOf(twice).includes(word), `${word} was not in what the developer said`);
  }
});

btest("row 16: the real review path - a zero-row review must not read as a cancel", async () => {
  // THE HOST HALF OF DEFECT 1, and no injected `review` can see it: the default
  // review opens a multi-select QuickPick, and `showQuickPick([])` resolves
  // `undefined` the moment it is shown - which is this command's CANCEL. A
  // comment that only needs re-wrapping would have been cancelled by its own
  // empty menu. The stub's showQuickPick returns undefined exactly as an empty
  // pick does, so this row drives the real `defaultReview`.
  const long =
    "// this walker keeps every entry it can prove is stale and drops the rest of them at the end of each pass over the buffer\n" +
    "export function walk() {}\n";
  const zeroRows = await run({ text: long, reply: "", symbols: () => [], useDefaultReview: true });
  assert.equal(zeroRows.edits.length, 1, `the wrap must survive an empty menu: ${JSON.stringify(zeroRows.outcome)}`);
  assert.ok(Math.max(...zeroRows.applied.split("\n").map((l) => l.length)) <= 80);

  // And with rows, the pick is still the gate: the stub declines it, which is a
  // cancel, and a cancel writes nothing.
  const withRows = await run({ useDefaultReview: true });
  assert.equal(withRows.outcome.status, "cancelled");
  assert.equal(withRows.edits.length, 0);
});

btest("row 13: the command is manual - declared, and in no automatic path", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const declared = pkg.contributes.commands.find((c) => c.command === "column80.tightenDocComment");
  assert.ok(declared !== undefined, "package.json must carry the command");
  assert.equal(declared.title, "Tighten Doc Comment");
  assert.equal(declared.category, "Column 80");
  assert.equal(B.TIGHTEN_COMMAND_ID, "column80.tightenDocComment");

  const wired = JSON.stringify({ keybindings: pkg.contributes.keybindings ?? [], menus: pkg.contributes.menus ?? {} });
  assert.ok(
    !wired.includes("tightenDocComment"),
    "no keybinding and no menu: one pre-fill-class resolve, one model round and up to nine symbol " +
      "queries is fine for a gesture a developer asks for and indefensible anywhere near a keystroke",
  );

  // And nothing in the product calls it: the only registration is the palette one.
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "vscode", "fnGen.ts"), "utf8");
  assert.ok(!src.includes('executeCommand("column80.tightenDocComment'), "nothing may invoke it automatically");
});
