// BLIND ORACLE - session-v21 phase 3a item 3: "No block" must say why, in every
// language [session-v21/surface-p3a.md §3]. Written from that document ALONE,
// before the implementation exists. This file never reads
// src/vscode/completionProvider.ts, src/core/fimInject.ts,
// src/core/extraction.ts or any extractor - the esbuild bundle resolves them at
// bundle time only, and the only thing this file reads back is the OUTPUT
// CHANNEL, which is the channel the contract is written about.
//
// The contract, restated: at a member site that injects nothing, the channel
// carries WHY, in every supported language, once per distinct site rather than
// once per keystroke. Four reasons must be distinguishable from each other:
//
//   R1 the receiver resolved to nothing   - the server answered with zero members
//   R2 nothing semantic came back         - items came back, every one is VS Code's
//                                           word-based fallback (kind Text). This is
//                                           the "your file does not parse" case and
//                                           it is the one that cost a user an
//                                           afternoon; it must NOT read as R1
//   R3 members came back, none signed     - nothing to render
//   R4 the deadline was hit               - before the resolver answered
//
// HOW A REASON LINE IS IDENTIFIED WITHOUT INVENTING ITS WORDING. The surface
// pins that the channel says why and that the four reasons are distinguishable;
// it does not pin any spelling. So this file never matches a literal. It drives
// the SAME site under all five member-surface shapes - one healthy control and
// the four dark ones - and reads two things off each dark run:
//
//   extra     - lines the healthy run does not write. A line the product already
//               writes at EVERY degraded site clears this bar while saying
//               nothing, which is the defect verbatim: "logs memberSite=true
//               injected=false and nothing else".
//   distinct  - lines neither the healthy run NOR any of the other three dark
//               runs write. Only this can be the reason.
//
// Digits are normalised away first, so a millisecond figure is not mistaken for
// new content. The four dark shapes carry the SAME member names as the healthy
// control wherever they have names at all, so the output gate behaves the same
// in each and the only thing that varies is the property the reason is about.
//
// WHAT THE STUB EXTRACTOR SENDS FOR R2, and the one assumption in this file.
// The surface says the product "correctly maps [the word-based fallback] to zero
// members", which is precisely why R2 is indistinguishable from R1 today: by the
// time the provider sees the result, the Text items are gone. Telling them apart
// needs the Text-ness to survive to whoever writes the line. This harness models
// that the honest way it can from outside: the stub extractor hands back members
// carrying `kind: "text"`. If the implementation instead keeps the evidence on a
// different channel (a raw item count, an evidence field), this harness cannot
// see it and the R2 rows here must be re-pointed - report that as a finding
// rather than editing the assertion.
//
// Expected RED on the contract. A BUILD failure or a harness throw is a bug in
// this file. The python R1 row is the harness's own control: python already
// carries a dark-site evidence line today, so a red THERE means this harness is
// not reaching the code path at all.
//
// Run: SKIP_LIVE=1 node --test test/blind-v21-p3a-darkreason.test.cjs
// (Hermetic: a vscode stub, a stubbed extractor registry, a stubbed generate.
// No model, no network, no real VS Code, no language server.)

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

// ===========================================================================
// Harness. The idiom of test/blind-v19-empty-partial.test.cjs: alias `vscode`
// to a hand-built stub, redirect the extractor registry through an esbuild
// plugin (async API, hence the child process), require the bundle.
// ===========================================================================

const TAG = ".blind-v21-p3a-dark";
const STUB = path.join(__dirname, `${TAG}-vscode-stub.cjs`);
const REGISTRY_STUB = path.join(__dirname, `${TAG}-registry.ts`);
const entry = path.join(__dirname, `${TAG}.entry.ts`);
const outfile = path.join(__dirname, `${TAG}.bundle.cjs`);
const buildScript = path.join(__dirname, `${TAG}.build.cjs`);

fs.writeFileSync(
  STUB,
  `class Position { constructor(line, character) { this.line = line; this.character = character; }
  translate(l, c) { return new Position(this.line + (l || 0), this.character + (c || 0)); } }
class Range { constructor(a, b, c, d) {
  if (typeof a === "number") { this.start = new Position(a, b); this.end = new Position(c, d); }
  else { this.start = a; this.end = b; } } }
module.exports = {
  Position, Range,
  Uri: { parse: (s) => ({ toString: () => s }) },
  languages: {}, window: {}, commands: {},
  workspace: {
    getConfiguration: () => ({ get: (k, d) => {
      const over = (globalThis.__v21Config || {});
      if (Object.prototype.hasOwnProperty.call(over, k)) { return over[k]; }
      if (k === "fimAlternatives") { return 1; }
      if (k === "fimMemberGate") { return true; }
      if (k === "debounceMs") { return 0; }
      return d;
    } }),
    textDocuments: [],
    openTextDocument: async () => { throw new Error("no such file"); },
  },
  InlineCompletionItem: class { constructor(text, range) { this.insertText = text; this.range = range; } },
  InlineCompletionTriggerKind: { Invoke: 0, Automatic: 1 },
  ThemeColor: class {}, MarkdownString: class {}, EventEmitter: class {},
};\n`
);

fs.writeFileSync(
  REGISTRY_STUB,
  `export function extractorFor(_languageId: string): any {
  return (globalThis as any).__v21Extractor;
}\n`
);

fs.writeFileSync(
  entry,
  `export { FimCompletionProvider } from "../src/vscode/completionProvider";
export * from "../src/core/completionService";
export { DEFAULT_FIM_CONFIG } from "../src/core/config";\n`
);

fs.writeFileSync(
  buildScript,
  `require("esbuild").build({
  entryPoints: [${JSON.stringify(entry)}],
  bundle: true, outfile: ${JSON.stringify(outfile)}, format: "cjs", platform: "node",
  alias: { vscode: ${JSON.stringify(STUB)} },
  plugins: [{ name: "registry", setup(b) {
    b.onResolve({ filter: /(^|\\/)extractors$/ }, () => ({ path: ${JSON.stringify(REGISTRY_STUB)} }));
  } }],
}).catch((e) => { console.error(e); process.exit(1); });\n`
);

let buildError;
let mod = {};
try {
  execFileSync(process.execPath, [buildScript], { stdio: "pipe" });
  mod = require(outfile);
} catch (e) {
  buildError = e;
}

test.after(() => {
  [STUB, REGISTRY_STUB, entry, outfile, buildScript].forEach((f) => fs.rmSync(f, { force: true }));
});

const need = () => {
  if (buildError) {
    assert.fail(`the bundle does not build: ${String(buildError.stderr || buildError.message).slice(0, 2000)}`);
  }
  return mod;
};

test("harness: the provider, the service and the config all bundle [harness guard - red here is a build problem, not a contract failure]", () => {
  need();
  assert.strictEqual(typeof mod.FimCompletionProvider, "function", "no FimCompletionProvider export");
  assert.strictEqual(typeof mod.CompletionService, "function", "no CompletionService export");
});

const deadline = () => {
  need();
  const d = mod.INJECTION_DEADLINE_MS;
  return typeof d === "number" && d > 0 ? d : 50;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===========================================================================
// The document. Two DISTINCT member sites in one file, so "once per distinct
// site" can be told from "once per document" and from "once per keystroke".
// ===========================================================================

// Line 0 carries the two member names as ordinary words. That is what makes the
// R2 fixture faithful AND controlled: VS Code's word-based fallback offers words
// scraped from the buffer, so a Text-kind `enrollTile` is exactly what that
// fallback serves - and because R1, R2, R3 and the healthy control then all
// carry the SAME names, the output gate behaves identically across them and the
// only thing that varies is the property each reason is about.
const SOURCE = ["let enrollTile = mk(); let tileTally = mk();", "s.", "let t = mk();", "t."].join("\n");
const SITE_A = { line: 1, character: 2, receiver: "s" };
const SITE_B = { line: 3, character: 2, receiver: "t" };

// Every supported language. The reason line is language-AGNOSTIC: python is the
// only one that reports today, and that is the defect.
const LANGS = ["rust", "typescript", "csharp", "python"];

function makePos(line, character) {
  return {
    line,
    character,
    translate(l, c) {
      return makePos(this.line + (l || 0), this.character + (c || 0));
    },
  };
}

function makeDoc(text, languageId) {
  const ext = { rust: "rs", typescript: "ts", csharp: "cs", python: "py" }[languageId] || "txt";
  return {
    languageId,
    version: 1,
    _text: text,
    get lineCount() {
      return this._text.split("\n").length;
    },
    uri: { toString: () => `file:///dark.${ext}` },
    _offset(p) {
      const ls = this._text.split("\n");
      const line = Math.max(0, Math.min(p.line, ls.length - 1));
      let n = 0;
      for (let i = 0; i < line; i += 1) n += ls[i].length + 1;
      return n + Math.max(0, Math.min(p.character, ls[line].length));
    },
    getText(range) {
      if (range == null) return this._text;
      return this._text.slice(this._offset(range.start), this._offset(range.end));
    },
    lineAt(n) {
      const ls = this._text.split("\n");
      const len = (ls[n] ?? "").length;
      return {
        text: ls[n] ?? "",
        range: { start: { line: n, character: 0 }, end: { line: n, character: len } },
      };
    },
    offsetAt(p) {
      return this._offset(p);
    },
    positionAt(o) {
      const ls = this._text.split("\n");
      let rem = o;
      for (let i = 0; i < ls.length; i += 1) {
        if (rem <= ls[i].length) return makePos(i, rem);
        rem -= ls[i].length + 1;
      }
      return makePos(ls.length - 1, (ls[ls.length - 1] ?? "").length);
    },
  };
}

// ---------------------------------------------------------------------------
// The five member-surface scenarios. `healthy` is the control: a receiver that
// injects, so its channel lines are the baseline every dark run is diffed
// against.
// ---------------------------------------------------------------------------

const SIGNED = [
  { name: "enrollTile", signature: "enrollTile(Tile) : bool", kind: "method" },
  { name: "tileTally", signature: "tileTally : int", kind: "field" },
];

const SCENARIOS = {
  healthy: { members: async () => SIGNED },
  // R1: the server answered with zero members.
  empty: { members: async () => [] },
  // R2: items came back and every one is VS Code's word-based fallback. In the
  // capture the file does not compile, Roslyn binds no receiver, and the only
  // completions served are buffer words at kind Text (`foo:Text`,
  // `namespace:Text`). Here they are the buffer words on line 0.
  textOnly: {
    members: async () => [
      { name: "enrollTile", kind: "text" },
      { name: "tileTally", kind: "text" },
      { name: "mk", kind: "text" },
    ],
  },
  // R3: real semantic members came back, none of them carries a signature, so
  // there is nothing to render.
  unsigned: {
    members: async () => [
      { name: "enrollTile", kind: "method" },
      { name: "tileTally", kind: "field" },
    ],
  },
  // R4: the deadline was hit before the resolver answered.
  slow: {
    members: async () => {
      await sleep(deadline() + 120);
      return SIGNED;
    },
  },
};

// One provider, one service, one or more requests. Returns the channel lines.
async function run(languageId, scenario, sites = [SITE_A]) {
  const { FimCompletionProvider, CompletionService, DEFAULT_FIM_CONFIG } = need();
  const spec = SCENARIOS[scenario];
  globalThis.__v21Config = {};
  globalThis.__v21Extractor = {
    completeMembers: spec.members,
    async membersOfType() {
      return [];
    },
    async definition() {
      return undefined;
    },
  };

  const channel = [];
  const service = new CompletionService(
    { ...DEFAULT_FIM_CONFIG, debounceMs: 0, cacheCapacity: 100 },
    async () => ({ text: "enrollTile(tile);", ttftMs: 1, totalMs: 2 }),
    (l) => channel.push(String(l))
  );
  const provider = new FimCompletionProvider(() => service, { appendLine: (l) => channel.push(String(l)) });
  const doc = makeDoc(SOURCE, languageId);

  for (const site of sites) {
    await provider.provideInlineCompletionItems(
      doc,
      makePos(site.line, site.character),
      { triggerKind: 0, selectedCompletionInfo: undefined },
      { onCancellationRequested: () => {}, isCancellationRequested: false }
    );
  }

  service.dispose();
  globalThis.__v21Extractor = undefined;
  return channel;
}

// Millisecond figures, counts and positions vary run to run; the WORDING is the
// reason. Normalising digits keeps a timing number from reading as new content.
// `gateWait=Nms` is dropped, not normalised to N. The product emits that segment
// only when the gate actually had to wait (`gateWait > 0 ? ... : ""`), so the SAME
// event yields two different lines depending on how loaded the box is. This file
// compares line sets across separate runs - profile() caches one healthy run and
// row D takes another - so a load-dependent segment makes a healthy line from one
// run look like a dark line from another. It did, on CI. Every reason this file
// reads is in the words, never in the timings.
const norm = (l) =>
  String(l)
    .replace(/\sgateWait=\d+ms/g, "")
    .replace(/\d+/g, "N")
    .trim();

// Two readings of one dark run, and the difference between them is the whole
// point of this file:
//
//   `extra`    - what the dark run says that a HEALTHY run does not. A line the
//                product already emits at every degraded site satisfies this
//                without saying anything, which is exactly the defect: "the
//                product logs memberSite=true injected=false and nothing else".
//   `distinct` - what the dark run says that neither a healthy run NOR any OTHER
//                dark run says. This is the reason. Nothing else can be.
const profiles = new Map();
async function profile(languageId) {
  if (profiles.has(languageId)) return profiles.get(languageId);
  const healthy = new Set((await run(languageId, "healthy")).map(norm));
  const extra = {};
  for (const d of DARK) {
    const dark = await run(languageId, d.key);
    extra[d.key] = dark.map(norm).filter((l) => l.length > 0 && !healthy.has(l));
  }
  const distinct = {};
  for (const d of DARK) {
    const others = new Set(DARK.filter((o) => o.key !== d.key).flatMap((o) => extra[o.key]));
    distinct[d.key] = extra[d.key].filter((l) => !others.has(l));
  }
  const p = { healthy, extra, distinct };
  profiles.set(languageId, p);
  return p;
}

const table = async (rows, body) => {
  const bad = [];
  for (const row of rows) {
    try {
      await body(row);
    } catch (e) {
      bad.push(`${row.name}: ${e.message}`);
    }
  }
  if (bad.length) assert.fail(`${bad.length}/${rows.length} cases failed:\n  - ${bad.join("\n  - ")}`);
};

const DARK = [
  { key: "empty", why: "R1 the receiver resolved to nothing (zero members)" },
  { key: "textOnly", why: "R2 nothing semantic came back (every item is kind Text)" },
  { key: "unsigned", why: "R3 members came back but none carried a signature" },
  { key: "slow", why: "R4 the deadline was hit before the resolver answered" },
];

// ===========================================================================
// H. HARNESS CONTROL. Python already logs a dark-site evidence line once per
// distinct site whose receiver resolved zero members. If THIS is red, the
// harness is not reaching the member-site path and nothing below means anything.
// ===========================================================================

test("H. control: python already says why at a zero-member receiver, so this harness does reach the member-site path [today's Python-only honest-dark line]", async () => {
  const p = await profile("python");
  assert.ok(
    p.distinct.empty.length > 0,
    `python's existing dark-site evidence line did not appear; the harness is not driving a member site, so every assertion below would be vacuous. Lines seen: ${JSON.stringify(p.extra.empty)}`
  );
});

// ===========================================================================
// A. THE CHANNEL SAYS WHY, IN EVERY LANGUAGE [surface §3 'The reason line is
// language-agnostic ... in every supported language']. Today the honest-dark
// log is python-only: the one language whose member surface is already correct
// is the only one that reports when it is dark.
// ===========================================================================

test("A. at a member site that injects nothing the channel carries a reason THIS site's darkness alone accounts for, in every supported language - a line the product writes at every degraded site says nothing, and `memberSite=true injected=false` and nothing else IS the defect [surface §3 'the channel carries WHY, in every supported language']", async () => {
  await table(
    LANGS.flatMap((lang) => DARK.map((d) => ({ name: `${lang} / ${d.why}`, lang, scenario: d.key }))),
    async (row) => {
      const p = await profile(row.lang);
      assert.ok(
        p.distinct[row.scenario].length > 0,
        `no line here is particular to this reason. Lines a healthy site does not write: ${JSON.stringify(
          p.extra[row.scenario]
        )} - every one of them is also written for a DIFFERENT dark reason, so the channel reports darkness without reporting why`
      );
    }
  );
});

// ===========================================================================
// B. THE FOUR REASONS ARE DISTINGUISHABLE [surface §3 'The reasons that must be
// distinguishable']. A line that cannot tell "your file does not parse" from
// "the resolver was slow" from "the receiver is untyped" is the line the
// product already has.
// ===========================================================================

test("B. the four reasons are pairwise DIFFERENT at the same site in the same language - one line that covers all four is the line the product already has [surface §3 'The reasons that must be distinguishable']", async () => {
  await table(
    LANGS.map((lang) => ({ name: lang, lang })),
    async ({ lang }) => {
      const p = await profile(lang);
      const got = {};
      for (const d of DARK) got[d.key] = p.extra[d.key].join(" | ");
      const clashes = [];
      for (let i = 0; i < DARK.length; i += 1) {
        for (let j = i + 1; j < DARK.length; j += 1) {
          const a = DARK[i];
          const b = DARK[j];
          if (got[a.key] === got[b.key]) {
            clashes.push(`${a.why} and ${b.why} both read ${JSON.stringify(got[a.key])}`);
          }
        }
      }
      assert.deepStrictEqual(clashes, [], `reasons that cannot be told apart:\n    ${clashes.join("\n    ")}`);
    }
  );
});

test("B2. THE CASE THAT COST AN AFTERNOON: a receiver whose only completions are VS Code's word-based fallback reads as `nothing semantic`, NOT as `the receiver resolved to nothing` - a non-zero item count is not proof a language server is running [surface §3 'This is the your file does not parse case and it is the one that cost the afternoon']", async () => {
  await table(
    LANGS.map((lang) => ({ name: lang, lang })),
    async ({ lang }) => {
      const p = await profile(lang);
      const zero = p.extra.empty.join(" | ");
      const textish = p.extra.textOnly.join(" | ");
      assert.ok(textish.length > 0, "a site whose every item is VS Code's word-based fallback (kind Text) said nothing at all");
      assert.notStrictEqual(
        textish,
        zero,
        `the fallback-only site reads exactly like a genuinely empty one (${JSON.stringify(zero)}); the file does not compile and the product never says so`
      );
    }
  );
});

test("B3. a slow resolver and an empty one do not share a reason: lateness is not emptiness [surface §3 'The deadline was hit before the resolver answered' vs 'The server answered with zero members']", async () => {
  await table(
    LANGS.map((lang) => ({ name: lang, lang })),
    async ({ lang }) => {
      const p = await profile(lang);
      const zero = p.extra.empty.join(" | ");
      const late = p.extra.slow.join(" | ");
      assert.ok(late.length > 0, "a resolver that missed the deadline said nothing at all");
      assert.notStrictEqual(late, zero, "a deadline miss must not be reported as an unresolved receiver");
    }
  );
});

// ===========================================================================
// C. ONCE PER DISTINCT SITE [surface §3 'once per distinct site rather than
// once per keystroke ... A reason line per keystroke drowns the channel, which
// is the failure the logging discipline exists to prevent'].
// ===========================================================================

test("C1. three keystrokes at the SAME dark site produce ONE reason line, not three - a reason per keystroke drowns the channel [surface §3 'once per distinct site rather than once per keystroke']", async () => {
  await table(
    LANGS.flatMap((lang) => DARK.map((d) => ({ name: `${lang} / ${d.why}`, lang, scenario: d.key }))),
    async (row) => {
      const p = await profile(row.lang);
      const reason = p.distinct[row.scenario];
      assert.ok(reason.length > 0, "no reason line particular to this darkness, so there is nothing to count (see section A)");
      const repeated = (await run(row.lang, row.scenario, [SITE_A, SITE_A, SITE_A])).map(norm);
      // At least one line that identifies this darkness must be written ONCE for
      // the three keystrokes. Lines the product already repeats per request are
      // not disturbed by this: the contract is that the REASON is per site.
      const counts = reason.map((r) => [r, repeated.filter((l) => l === r).length]);
      assert.ok(
        counts.some(([, n]) => n === 1),
        `three keystrokes at ONE site repeated every line that identifies this darkness: ${JSON.stringify(counts)}`
      );
    }
  );
});

// Two requests either way, so anything the product writes ONCE PER REQUEST
// contributes equally to both runs and cancels. The only thing that can make
// the second run longer is the second SITE reporting its own darkness.
test("C2. a SECOND distinct dark site reports its own darkness, while the same site twice does not report twice - the dedup is per site, never per document [surface §3 'Once per distinct site, keyed as it is now']", async () => {
  await table(
    LANGS.flatMap((lang) => DARK.map((d) => ({ name: `${lang} / ${d.why}`, lang, scenario: d.key }))),
    async (row) => {
      const p = await profile(row.lang);
      assert.ok(p.distinct[row.scenario].length > 0, "no reason line particular to this darkness (see section A)");
      const sameTwice = await run(row.lang, row.scenario, [SITE_A, SITE_A]);
      const twoSites = await run(row.lang, row.scenario, [SITE_A, SITE_B]);
      const off = (ls) => ls.map(norm).filter((l) => l.length > 0 && !p.healthy.has(l)).length;
      assert.ok(
        off(twoSites) > off(sameTwice),
        `two DISTINCT dark sites must report more than the same site twice, and both runs cost two requests so per-keystroke noise cancels; got ${off(
          twoSites
        )} against ${off(sameTwice)}`
      );
    }
  );
});

// ===========================================================================
// D. WHAT MUST NOT CHANGE [surface §3 'the existing Python evidence semantics'
// + 'any claim the product makes about what an empty set PROVES stays as narrow
// as it is today']. A healthy receiver is not reported as dark, in any
// language. (regression net)
// ===========================================================================

test("D. a receiver that DOES inject is never given a dark reason: the four reasons are for sites that injected nothing [surface §3 'At a member site that injects nothing'] (regression net)", async () => {
  await table(
    LANGS.map((lang) => ({ name: lang, lang })),
    async ({ lang }) => {
      const p = await profile(lang);
      const healthy = await run(lang, "healthy");
      const darkLines = new Set(DARK.flatMap((d) => p.distinct[d.key]));
      const leaked = healthy.map(norm).filter((l) => darkLines.has(l));
      assert.deepStrictEqual(
        leaked,
        [],
        `a healthy member site wrote a line this file identified as a dark reason: ${JSON.stringify(leaked)}`
      );
    }
  );
});
