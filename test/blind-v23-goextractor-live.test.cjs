// BLIND ORACLE (LIVE) — v23 Go HEADLESS transport GoLspExtractor
// (src/core/goLspExtractor.ts) against REAL gopls over stdio. This is the
// falsifiable core the pure suite cannot reach: the two-rule filter's
// completeness on real completion lists, the receiver-sibling join on real
// documentSymbols, the drift canary, the bare-dot-vs-prefix arming evidence,
// and the out-of-span Add-import edit.
//
// TWO RUNGS (the pyextractor-live pattern):
//   1. GROUND-TRUTH (independent of GoLspExtractor): an in-test LSP-over-stdio
//      driver spawns real gopls and asserts the raw shapes the blind contract
//      rests on (six members with `detail` riding the item, isIncomplete=true
//      always, the slice site's all-snippet list, `(*Stripe).Enroll` symbol
//      names). PASSES whether or not GoLspExtractor exists — it proves the
//      fixtures and the scouted taxonomy are REAL on this gopls.
//   2. GoLspExtractor-driven: RED until src/core/goLspExtractor.ts lands.
//
// Fixtures: a mkdtemp COPY of session-v23/harness/spike-mod's go.mod/go.sum/
// atlas (uuid v1.6.0 is warmed in the shared module cache, so no network),
// with per-case single-package dirs whose on-disk file is ONLY a `package x`
// clause — every real body arrives as an OPEN OVERLAY buffer (openDocument
// text never on disk), so a completion served from disk instead of the
// overlay answers nothing. A second mkdtemp stdlib-only module carries the
// drift-canary struct and the io.Reader interface site.
//
// gopls: /home/utilitydelta/go/bin/gopls (skip with message when absent).
// go toolchain: /home/utilitydelta/.local/go/bin prepended to PATH.
// Never read src/**. Skip with SKIP_LIVE=1. Finishes well under 3 minutes.
//
// Run: node --test test/blind-v23-goextractor-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const { pathToFileURL } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

// The go toolchain the scratchpad rung runs against: prepend so every spawned
// gopls (extractor-owned or ground-truth) finds `go` without user config.
const GO_BIN_DIR = "/home/utilitydelta/.local/go/bin";
process.env.PATH = `${GO_BIN_DIR}:${process.env.PATH || ""}`;

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 90_000;
const GOPLS = "/home/utilitydelta/go/bin/gopls";
const goplsMissing = !fs.existsSync(GOPLS) ? `gopls not found at ${GOPLS}` : undefined;
const SPIKE = path.join(__dirname, "..", "session-v23", "harness", "spike-mod");

// The canary's evidence lines must NAME the gopls version and the transport,
// because the taxonomy was proven on v0.23.0 and rides user-visible settings.
let goplsVer;
const goplsVersion = () => {
  if (goplsVer === undefined) {
    try {
      goplsVer = execFileSync(GOPLS, ["version"], { encoding: "utf8", env: process.env }).split("\n")[0].trim();
    } catch (e) {
      goplsVer = `unknown (${String(e.message).slice(0, 60)})`;
    }
  }
  return goplsVer;
};

// --- bundle the headless transport (RED until it lands) --------------------
let mod = {};
let cleanupBundle = () => {};
let bundleError;
try {
  ({ mod, cleanup: cleanupBundle } = bundleCore(
    "blind-v23-golsp",
    `export { GoLspExtractor } from "../src/core/goLspExtractor";\n`,
  ));
} catch (e) {
  bundleError = e;
  cleanupBundle = () => {
    fs.rmSync(path.join(__dirname, ".blind-v23-golsp.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v23-golsp.bundle.cjs"), { force: true });
  };
}
if (!bundleError && typeof mod.GoLspExtractor !== "function") {
  bundleError = new Error("the bundle built but exports no GoLspExtractor class");
}
const { GoLspExtractor } = mod;

// ---------------------------------------------------------------------------
// Overlay texts (tab-indented, gofmt's). Each lives in its own single-file
// package so one broken buffer can never contaminate another case.
// ---------------------------------------------------------------------------

const M_OVERLAY = `package m

import "example.com/atlasspike/atlas"

func Fanout() uint32 {
\ts := atlas.NewStripe()
\treturn s.
}
`;

const SL_OVERLAY = `package sl

import "example.com/atlasspike/atlas"

func Drop(xs []atlas.Tile) int {
\txs.
\treturn len(xs)
}
`;

const EM_OVERLAY = `package em

import "example.com/atlasspike/atlas"

type Fabric struct {
\tatlas.Stripe
\tTag string
}

func Weave(f *Fabric) uint32 {
\tf.
\treturn 0
}
`;

const TP_OVERLAY = `package tp

import "github.com/google/uuid"

func Mint() string {
\tid := uuid.New()
\tid.
\treturn ""
}
`;

const PX_OVERLAY = `package px

import "example.com/atlasspike/atlas"

func Narrow() {
\ts := atlas.NewStripe()
\ts.En
}
`;

// Parse-CLEAN buffer using an unimported-but-known package identifier.
const QF_OVERLAY = `package qf

func Fresh() string {
\treturn uuid.NewString()
}
`;

// Parse-clean buffer whose identifier resolves to NOTHING anywhere.
const UR_OVERLAY = `package ur

func Lost() int {
\treturn zorblatt.Frombulate()
}
`;

const AE_OVERLAY_TILE = `package ae

import "example.com/atlasspike/atlas"

func Flip() uint32 {
\tt := atlas.TileFromMorton(9, 3)
\treturn t.
}
`;

const AE_OVERLAY_STRIPE = `package ae

import "example.com/atlasspike/atlas"

func Flip() uint32 {
\ts := atlas.NewStripe()
\treturn s.
}
`;

// The drift-canary fixture: a locally-defined NON-embedding struct, ON DISK.
// Pinned to this fixture deliberately — embedded promotion and third-party
// receivers false-red a broader canary by construction.
const GAUGE_GO = `// Package gauge is the v23 drift-canary fixture.
package gauge

type Gauge struct {
\tWindow int
\tticks  []int
}

func NewGauge(window int) *Gauge {
\treturn &Gauge{Window: window}
}

func (g *Gauge) Observe(v int) {
\tg.ticks = append(g.ticks, v)
}

func (g *Gauge) Drain() []int {
\tout := g.ticks
\tg.ticks = nil
\treturn out
}

func (g Gauge) Len() int {
\treturn len(g.ticks)
}
`;

// Same-package use site (unsaved): unexported members must appear here.
const USE_OVERLAY = `package gauge

func Probe(g *Gauge) int {
\tg.
\treturn 0
}
`;

const RD_OVERLAY = `package rd

import "io"

func Pump(r io.Reader) int {
\tr.
\treturn 0
}
`;

// ---------------------------------------------------------------------------
// Fixture workspaces (mkdtemp; the repo fixture is read-only source material).
// ---------------------------------------------------------------------------

let ws; // copy of spike-mod (go.mod/go.sum/atlas) + per-case package stubs
let canaryWs; // stdlib-only module: gauge (canary) + rd (interface)
let atlasText;
const WS_PKGS = ["m", "sl", "em", "tp", "px", "qf", "ur", "ae"];

const buildFixtures = () => {
  if (ws) return;
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v23-golive-ws-"));
  fs.copyFileSync(path.join(SPIKE, "go.mod"), path.join(ws, "go.mod"));
  fs.copyFileSync(path.join(SPIKE, "go.sum"), path.join(ws, "go.sum"));
  fs.mkdirSync(path.join(ws, "atlas"));
  fs.copyFileSync(path.join(SPIKE, "atlas", "atlas.go"), path.join(ws, "atlas", "atlas.go"));
  atlasText = fs.readFileSync(path.join(ws, "atlas", "atlas.go"), "utf8");
  // On disk each case package is ONLY its package clause; the bodies above
  // exist solely as overlays, so overlay service is load-bearing.
  for (const p of WS_PKGS) {
    fs.mkdirSync(path.join(ws, p));
    fs.writeFileSync(path.join(ws, p, `${p}.go`), `package ${p}\n`);
  }
  canaryWs = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v23-golive-canary-"));
  fs.writeFileSync(path.join(canaryWs, "go.mod"), "module example.com/canaryfix\n\ngo 1.26\n");
  fs.mkdirSync(path.join(canaryWs, "gauge"));
  fs.writeFileSync(path.join(canaryWs, "gauge", "gauge.go"), GAUGE_GO);
  fs.writeFileSync(path.join(canaryWs, "gauge", "use.go"), "package gauge\n");
  fs.mkdirSync(path.join(canaryWs, "rd"));
  fs.writeFileSync(path.join(canaryWs, "rd", "rd.go"), "package rd\n");
};

const wsUri = (...seg) => pathToFileURL(path.join(ws, ...seg)).href;
const canUri = (...seg) => pathToFileURL(path.join(canaryWs, ...seg)).href;

// Cursor helpers over overlay text (0-based line, UTF-16 column).
const lineColOf = (text, needle) => {
  const idx = text.indexOf(needle);
  assert.ok(idx >= 0, `fixture needle not found: ${JSON.stringify(needle)}`);
  const before = text.slice(0, idx);
  const line = (before.match(/\n/g) || []).length;
  const col = idx - (before.lastIndexOf("\n") + 1);
  return { line, col };
};
// Position right AFTER the needle (a dot site: needle ends with ".").
const posAfter = (text, needle) => {
  const { line, col } = lineColOf(text, needle);
  return { line, character: col + needle.length };
};
// Position INSIDE the token the needle starts with.
const posIn = (text, needle, offset = 2) => {
  const { line, col } = lineColOf(text, needle);
  return { line, character: col + offset };
};
const lineOf = (text, needle) => lineColOf(text, needle).line;

// ---------------------------------------------------------------------------
// GROUND-TRUTH rung: a minimal LSP-over-stdio driver for real gopls (a TEST
// driver, not the code under test — it proves the fixtures + taxonomy REAL).
// ---------------------------------------------------------------------------

function makeSession(rootDir) {
  const proc = spawn(GOPLS, ["serve"], { stdio: ["pipe", "pipe", "pipe"], env: process.env });
  let buf = Buffer.alloc(0);
  const pending = new Map();
  let nextId = 1;
  const diagsFor = {};
  const send = (m) => {
    const s = JSON.stringify(m);
    proc.stdin.write(`Content-Length: ${Buffer.byteLength(s, "utf8")}\r\n\r\n${s}`);
  };
  const request = (method, params) => {
    const id = nextId++;
    send({ jsonrpc: "2.0", id, method, params });
    return new Promise((res) => pending.set(id, res));
  };
  const notify = (method, params) => send({ jsonrpc: "2.0", method, params });
  proc.stdout.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const he = buf.indexOf("\r\n\r\n");
      if (he < 0) return;
      const m = /Content-Length: (\d+)/i.exec(buf.slice(0, he).toString("utf8"));
      if (!m) return;
      const len = parseInt(m[1], 10);
      const start = he + 4;
      if (buf.length < start + len) return;
      const msg = JSON.parse(buf.slice(start, start + len).toString("utf8"));
      buf = buf.slice(start + len);
      if (msg.id !== undefined && pending.has(msg.id)) {
        pending.get(msg.id)(msg.result);
        pending.delete(msg.id);
      } else if (msg.method === "workspace/configuration") {
        send({ jsonrpc: "2.0", id: msg.id, result: msg.params.items.map(() => ({})) });
      } else if (msg.method === "textDocument/publishDiagnostics") {
        diagsFor[msg.params.uri] = msg.params.diagnostics;
      } else if (msg.id !== undefined) {
        send({ jsonrpc: "2.0", id: msg.id, result: null }); // registerCapability, workDoneProgress/create, ...
      }
    }
  });
  proc.stderr.on("data", () => {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    async init() {
      await request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(rootDir).href,
        workspaceFolders: [{ uri: pathToFileURL(rootDir).href, name: "ws" }],
        initializationOptions: {},
        capabilities: {
          textDocument: {
            completion: {
              completionItem: { snippetSupport: true, documentationFormat: ["markdown", "plaintext"] },
              contextSupport: true,
            },
            hover: { contentFormat: ["markdown", "plaintext"] },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            definition: { linkSupport: true },
            publishDiagnostics: {},
          },
          workspace: { configuration: true, workspaceFolders: true },
        },
      });
      notify("initialized", {});
    },
    open(uri, text) {
      notify("textDocument/didOpen", { textDocument: { uri, languageId: "go", version: 1, text } });
    },
    async waitReady(uri) {
      for (let i = 0; i < 60; i++) {
        await sleep(150);
        if (diagsFor[uri]) break;
      }
      await sleep(300);
    },
    async completion(uri, line, character) {
      let c = await request("textDocument/completion", {
        textDocument: { uri }, position: { line, character }, context: { triggerKind: 1 },
      });
      for (let i = 0; i < 8 && !(c && (c.items || c).length); i++) {
        await sleep(300);
        c = await request("textDocument/completion", {
          textDocument: { uri }, position: { line, character }, context: { triggerKind: 1 },
        });
      }
      return c || { items: [] };
    },
    documentSymbol(uri) {
      return request("textDocument/documentSymbol", { textDocument: { uri } });
    },
    dispose() { try { proc.kill(); } catch {} },
  };
}

// Lazy ground-truth session over the ws module.
let gtP;
const gtSession = () =>
  (gtP ||= (async () => {
    buildFixtures();
    const s = makeSession(ws);
    await s.init();
    s.open(wsUri("m", "m.go"), M_OVERLAY);
    s.open(wsUri("sl", "sl.go"), SL_OVERLAY);
    s.open(wsUri("atlas", "atlas.go"), atlasText);
    await s.waitReady(wsUri("m", "m.go"));
    return s;
  })());

// ---------------------------------------------------------------------------
// Extractor rung plumbing: one GoLspExtractor per module, lazily started;
// each overlay opened at most once.
// ---------------------------------------------------------------------------

let exWsP;
const wsExtractor = () =>
  (exWsP ||= (async () => {
    buildFixtures();
    const ex = await GoLspExtractor.start({ projectRoot: ws, goplsPath: GOPLS });
    await ex.whenReady(30_000);
    return ex;
  })());

let exCanP;
const canExtractor = () =>
  (exCanP ||= (async () => {
    buildFixtures();
    const ex = await GoLspExtractor.start({ projectRoot: canaryWs, goplsPath: GOPLS });
    await ex.whenReady(30_000);
    return ex;
  })());

const openedDocs = new Set();
const openOnce = async (ex, uri, text) => {
  if (!openedDocs.has(uri)) {
    await ex.openDocument(uri, text);
    openedDocs.add(uri);
  }
};

const byName = (ms, n) => ms.find((m) => m.name === n);
const namesOf = (ms) => ms.map((m) => m.name);
const PLAIN_IDENT = /^[\p{L}_][\p{L}\p{Nd}_]*$/u;
// The blanket post-filter invariant: no snippet, no dotted/called label, ever.
const assertAllPlain = (members, where) => {
  for (const m of members) {
    assert.ok(PLAIN_IDENT.test(m.name), `${where}: ${JSON.stringify(m.name)} is not a plain Go identifier — the two-rule filter leaked`);
    assert.notStrictEqual(m.kind, "text", `${where}: 'text' must never come out of the gopls path`);
  }
};

const STRIPE_SIX = ["AggregateFanout", "Enroll", "EnrollBatch", "EnrollTile", "PartitionByLod", "RehomeByLod"];

// Memoized bare-dot member set on the *atlas.Stripe receiver (the m overlay).
let bareP;
const bareStripeMembers = async () => {
  const ex = await wsExtractor();
  await openOnce(ex, wsUri("m", "m.go"), M_OVERLAY);
  const c = posAfter(M_OVERLAY, "return s.");
  return (bareP ||= ex.completeMembers({ uri: wsUri("m", "m.go"), line: c.line, character: c.character }));
};

test.after(async () => {
  try { if (gtP) (await gtP).dispose(); } catch {}
  try { if (exWsP) await (await exWsP).dispose(); } catch {}
  try { if (exCanP) await (await exCanP).dispose(); } catch {}
  if (ws) fs.rmSync(ws, { recursive: true, force: true });
  if (canaryWs) fs.rmSync(canaryWs, { recursive: true, force: true });
  cleanupBundle();
});

const ltest = (name, fn) =>
  test(name, { skip: SKIP, timeout: LIVE_TIMEOUT }, async (ctx) => {
    if (goplsMissing) return ctx.skip(goplsMissing);
    return fn(ctx);
  });
const rtest = (name, fn) =>
  ltest(name, async (ctx) => {
    if (bundleError) assert.fail(`the Go headless transport is not implemented yet: ${bundleError.message}`);
    return fn(ctx);
  });

// ===========================================================================
// RUNG 1 — GROUND TRUTH (real gopls; proves fixtures + the scouted taxonomy).
// ===========================================================================

ltest("GT: gopls serves a broken OVERLAY buffer (text never on disk): the bare-dot *Stripe list carries all six methods WITH detail riding the item, and isIncomplete=true always [surface: scout 'signatures on the item, no resolve round-trip' + the isIncomplete caveat]", async () => {
  const s = await gtSession();
  console.log(`[gt] ${goplsVersion()} transport=headless`);
  const c = posAfter(M_OVERLAY, "return s.");
  const list = await s.completion(wsUri("m", "m.go"), c.line, c.character);
  const items = list.items || list;
  const labels = items.map((it) => it.label);
  for (const n of STRIPE_SIX) {
    assert.ok(labels.includes(n), `raw list carries ${n}, got ${JSON.stringify(labels.slice(0, 25))}`);
    const it = items.find((x) => x.label === n);
    assert.ok(typeof it.detail === "string" && it.detail.length > 0, `${n} carries a non-empty detail ON THE ITEM (no resolve round trip needed)`);
  }
  const rehome = items.find((x) => x.label === "RehomeByLod");
  assert.ok(rehome.detail.includes("(uint32, error)"), `the multi-value return renders in detail, got ${JSON.stringify(rehome.detail)}`);
  assert.strictEqual(list.isIncomplete, true, "GROUND TRUTH: gopls sets isIncomplete=true on every list — the gate must never read it as emptiness, and must arm off the bare-dot query only");
});

ltest("GT: a slice-typed receiver's raw list is postfix snippets (kind=15, `!` labels) and holds ZERO plain-identifier members [surface: scout 'a slice receiver gets 12 of these and zero fake members']", async () => {
  const s = await gtSession();
  const c = posAfter(SL_OVERLAY, "\txs.");
  const list = await s.completion(wsUri("sl", "sl.go"), c.line, c.character);
  const items = list.items || list;
  assert.ok(items.length > 0, `the slice site answers a non-empty raw list, got ${items.length}`);
  assert.ok(items.some((it) => it.kind === 15), "at least one kind=15 (Snippet) postfix item is present");
  const fakeMembers = items.filter((it) => it.kind !== 15 && /^[A-Za-z_]\w*$/.test(it.label));
  assert.deepStrictEqual(fakeMembers.map((it) => it.label), [], "no non-snippet plain-identifier item exists at the slice site — the filtered set is EMPTY by construction");
});

ltest("GT: documentSymbol names methods top-level as `(*Stripe).Enroll` / `(Tile).SubtendedChildren` with the signature in detail; struct fields are children [surface: scout 'receiver-sibling shape confirmed']", async () => {
  const s = await gtSession();
  const syms = await s.documentSymbol(wsUri("atlas", "atlas.go"));
  assert.ok(Array.isArray(syms) && syms.length > 0, "documentSymbol answers");
  const names = syms.map((x) => x.name);
  assert.ok(names.includes("(*Stripe).Enroll"), `pointer-receiver method is top-level as (*Stripe).Enroll, got ${JSON.stringify(names)}`);
  assert.ok(names.includes("(Tile).SubtendedChildren"), "value-receiver method is top-level as (Tile).SubtendedChildren");
  const rehome = syms.find((x) => x.name === "(*Stripe).RehomeByLod");
  assert.ok(rehome && typeof rehome.detail === "string" && rehome.detail.includes("(uint32, error)"), `the method symbol's detail carries the full signature, got ${JSON.stringify(rehome && rehome.detail)}`);
  const stripe = syms.find((x) => x.name === "Stripe");
  assert.ok(stripe, "the struct is its own top-level symbol");
  const kids = (stripe.children || []).map((c) => c.name);
  assert.ok(kids.includes("tiles") && kids.includes("band"), `struct fields are children of the struct symbol, got ${JSON.stringify(kids)}`);
});

// ===========================================================================
// RUNG 2 — GoLspExtractor end to end. RED until src/core/goLspExtractor.ts.
// ===========================================================================

rtest("live start: GoLspExtractor.start({projectRoot, goplsPath}) spawns gopls and carries the six primitives + openDocument/applyEdit/whenReady/dispose [surface: pinned GoLspStartOptions + lifecycle]", async () => {
  const ex = await wsExtractor();
  for (const m of ["completeMembers", "hoverSurface", "definition", "example", "qualifyImport", "membersOfType", "openDocument", "applyEdit", "whenReady", "dispose"]) {
    assert.strictEqual(typeof ex[m], "function", `carries ${m}`);
  }
});

rtest("live two-rule filter completeness: bare `s.` on *atlas.Stripe in a BROKEN unsaved buffer -> ALL six real methods with signatures riding the items, and nothing non-identifier, ever [surface: goal 'what remains is the complete member set' on a broken unsaved buffer]", async () => {
  const members = await bareStripeMembers();
  assert.ok(Array.isArray(members) && members.length > 0, `a real member set, got ${JSON.stringify(members)}`);
  for (const n of STRIPE_SIX) {
    assert.ok(byName(members, n), `${n} survives the filter, got ${JSON.stringify(namesOf(members))}`);
  }
  assertAllPlain(members, "bare-dot Stripe site");
  assert.ok(!members.some((m) => m.name.endsWith("!")), "no postfix snippet leaked");
  const rehome = byName(members, "RehomeByLod");
  assert.ok(typeof rehome.signature === "string" && rehome.signature.includes("uint32") && rehome.signature.includes("error"), `the signature rode the item (no resolve round trip), got ${JSON.stringify(rehome.signature)}`);
  assert.ok(rehome.kind === "method", `a receiver method maps to kind 'method', got ${rehome.kind}`);
});

rtest("live two-rule filter on a slice receiver: `xs.` on []atlas.Tile (only postfix snippets in the raw list) filters to EMPTY, not to snippets [surface: goal member-gate — EMPTY is the honest answer]", async () => {
  const ex = await wsExtractor();
  await openOnce(ex, wsUri("sl", "sl.go"), SL_OVERLAY);
  const c = posAfter(SL_OVERLAY, "\txs.");
  const members = await ex.completeMembers({ uri: wsUri("sl", "sl.go"), line: c.line, character: c.character });
  assert.deepStrictEqual(members, [], `the slice site filters to EMPTY, got ${JSON.stringify(namesOf(members || []))}`);
});

rtest("live embedded promotion: `f.` on a struct embedding atlas.Stripe lists the promoted methods as plain items, plus its own field and the embedded field — all survive the filter [surface: scout 'completeness holds through embedded-struct promotion']", async () => {
  const ex = await wsExtractor();
  await openOnce(ex, wsUri("em", "em.go"), EM_OVERLAY);
  const c = posAfter(EM_OVERLAY, "\tf.");
  const members = await ex.completeMembers({ uri: wsUri("em", "em.go"), line: c.line, character: c.character });
  for (const n of ["Enroll", "AggregateFanout", "RehomeByLod"]) {
    assert.ok(byName(members, n), `promoted ${n} survives, got ${JSON.stringify(namesOf(members))}`);
  }
  assert.ok(byName(members, "Tag"), "the struct's own field Tag is a member");
  assert.ok(byName(members, "Stripe"), "the embedded field itself is a member");
  assertAllPlain(members, "embedding site");
});

rtest("live interface receiver: `r.` on io.Reader lists Read, and the type-assertion continuation `x.(T)` never yields a member (no name starts with '(') [surface: scout 'interface receivers' + goal pin 'x.(T) passes ungated']", async () => {
  const ex = await canExtractor();
  await openOnce(ex, canUri("rd", "rd.go"), RD_OVERLAY);
  const c = posAfter(RD_OVERLAY, "\tr.");
  const members = await ex.completeMembers({ uri: canUri("rd", "rd.go"), line: c.line, character: c.character });
  assert.ok(byName(members, "Read"), `io.Reader serves Read, got ${JSON.stringify(namesOf(members))}`);
  assert.ok(!members.some((m) => m.name.startsWith("(")), "a type assertion is legal syntax at the dot but NEVER a member");
  assertAllPlain(members, "interface site");
});

rtest("live same-package site: `g.` inside package gauge serves the unexported field `ticks` beside the exported surface [surface: scout 'same-package sites (unexported tiles, band appear)']", async () => {
  const ex = await canExtractor();
  await openOnce(ex, canUri("gauge", "use.go"), USE_OVERLAY);
  const c = posAfter(USE_OVERLAY, "\tg.");
  const members = await ex.completeMembers({ uri: canUri("gauge", "use.go"), line: c.line, character: c.character });
  assert.ok(byName(members, "ticks"), `the unexported field appears at its own package's site, got ${JSON.stringify(namesOf(members))}`);
  assert.ok(byName(members, "Observe") && byName(members, "Window"), "exported method + field appear beside it");
  assertAllPlain(members, "same-package site");
});

rtest("live third-party receiver: `id.` on a uuid.UUID value serves Version/String from the warmed module cache [surface: scout 'third-party (uuid, 19 items)']", async () => {
  const ex = await wsExtractor();
  await openOnce(ex, wsUri("tp", "tp.go"), TP_OVERLAY);
  const c = posAfter(TP_OVERLAY, "\tid.");
  const members = await ex.completeMembers({ uri: wsUri("tp", "tp.go"), line: c.line, character: c.character });
  assert.ok(byName(members, "Version"), `uuid.UUID serves Version, got ${JSON.stringify(namesOf(members))}`);
  assert.ok(byName(members, "String"), "uuid.UUID serves String");
  assertAllPlain(members, "third-party site");
});

rtest("live membersOfType receiver-join: at the Gauge DEFINITION -> exactly its methods (parsed from (*Gauge)/(Gauge) symbol names) plus its fields, with signatures; the free function NewGauge is NOT a member [surface: goal 'membersOfType does the receiver-sibling join']", async () => {
  const ex = await canExtractor();
  await openOnce(ex, canUri("gauge", "gauge.go"), GAUGE_GO);
  const d = posIn(GAUGE_GO, "type Gauge struct", "type ".length + 2);
  const members = await ex.membersOfType({ uri: canUri("gauge", "gauge.go"), line: d.line, character: d.character });
  assert.deepStrictEqual(
    namesOf(members).sort(),
    ["Drain", "Len", "Observe", "Window", "ticks"],
    "EXACTLY the type's own surface: pointer + value receiver methods joined by receiver name, plus the struct's field children — and never the free constructor NewGauge",
  );
  const observe = byName(members, "Observe");
  assert.strictEqual(observe.kind, "method", "a joined method carries kind 'method'");
  assert.ok(typeof observe.signature === "string" && observe.signature.includes("int"), `the method's documentSymbol detail rides its signature, got ${JSON.stringify(observe.signature)}`);
  assert.strictEqual(byName(members, "Window").kind, "field", "a struct field child carries kind 'field'");
});

rtest("live DRIFT CANARY (pinned to the local non-embedding gauge.Gauge fixture ONLY): every two-rule filter survivor at the bare-dot site appears in that fixture's membersOfType receiver-join set [surface: goal pin 3 — if this reds, the gate disarms to honest-dark until the taxonomy is re-proven]", async () => {
  const ver = goplsVersion();
  const ex = await canExtractor();
  await openOnce(ex, canUri("gauge", "use.go"), USE_OVERLAY);
  await openOnce(ex, canUri("gauge", "gauge.go"), GAUGE_GO);
  const c = posAfter(USE_OVERLAY, "\tg.");
  const survivors = await ex.completeMembers({ uri: canUri("gauge", "use.go"), line: c.line, character: c.character });
  assert.ok(survivors.length > 0, `the canary needs a non-empty survivor set (gopls ${ver}, transport=headless), got 0`);
  const d = posIn(GAUGE_GO, "type Gauge struct", "type ".length + 2);
  const join = await ex.membersOfType({ uri: canUri("gauge", "gauge.go"), line: d.line, character: d.character });
  const joinNames = new Set(namesOf(join));
  const missing = namesOf(survivors).filter((n) => !joinNames.has(n));
  assert.deepStrictEqual(
    missing,
    [],
    `DRIFT CANARY RED (gopls ${ver}, transport=headless, fixture gauge.Gauge): filter survivors not in the receiver-join set: ${JSON.stringify(missing)} — the two-rule taxonomy no longer holds on this gopls; the member gate must disarm to honest-dark for Go until re-proven`,
  );
  console.log(`[canary] GREEN gopls=${JSON.stringify(ver)} transport=headless fixture=gauge.Gauge survivors=${namesOf(survivors).sort().join(",")} — all present in the receiver-join set`);
});

rtest("live arming evidence: the PREFIX-filtered list at `s.En` is a strict SUBSET of the bare-dot set, missing real members the bare-dot set has — arming the gate off a prefixed query would blind it [surface: goal pin 1 'the gate arms off the bare-dot query only']", async () => {
  const ex = await wsExtractor();
  const bare = await bareStripeMembers();
  await openOnce(ex, wsUri("px", "px.go"), PX_OVERLAY);
  const c = posAfter(PX_OVERLAY, "\ts.En");
  const prefixed = await ex.completeMembers({ uri: wsUri("px", "px.go"), line: c.line, character: c.character });
  const bareNames = new Set(namesOf(bare));
  const prefixNames = namesOf(prefixed);
  assert.ok(prefixNames.includes("Enroll"), `the prefix keeps the matching members, got ${JSON.stringify(prefixNames)}`);
  for (const n of prefixNames) {
    assert.ok(bareNames.has(n), `prefixed member ${n} is in the bare-dot set (subset direction)`);
  }
  for (const gone of ["PartitionByLod", "RehomeByLod"]) {
    assert.ok(!prefixNames.includes(gone), `${gone} is filtered away by the prefix — a real member a prefix-armed gate would falsely suppress`);
  }
  assert.ok(prefixNames.length < bare.length, `the prefixed list (${prefixNames.length}) is strictly smaller than the bare-dot list (${bare.length})`);
});

rtest("live applyEdit: replacing an open overlay's text re-serves the NEW receiver's members (Tile surface before, Stripe surface after) [surface: pinned lifecycle — the overlay, not the disk, is what gopls answers about]", async () => {
  const ex = await wsExtractor();
  const uri = wsUri("ae", "ae.go");
  await openOnce(ex, uri, AE_OVERLAY_TILE);
  const c1 = posAfter(AE_OVERLAY_TILE, "return t.");
  const before = await ex.completeMembers({ uri, line: c1.line, character: c1.character });
  assert.ok(byName(before, "SubtendedChildren") && byName(before, "Encloses"), `the Tile surface first, got ${JSON.stringify(namesOf(before))}`);
  assert.ok(!byName(before, "Enroll"), "no Stripe member on a Tile receiver");
  await ex.applyEdit(uri, AE_OVERLAY_STRIPE);
  const c2 = posAfter(AE_OVERLAY_STRIPE, "return s.");
  const after = await ex.completeMembers({ uri, line: c2.line, character: c2.character });
  assert.ok(byName(after, "Enroll") && byName(after, "AggregateFanout"), `the Stripe surface after the edit, got ${JSON.stringify(namesOf(after))}`);
  assert.ok(!byName(after, "SubtendedChildren"), "the old receiver's members are gone");
});

rtest("live hoverSurface: hover on NewStripe -> signature + doc prose via the parseGoHover shape, and the pkg.go.dev link section never reads as doc [surface: pinned hoverSurface]", async () => {
  const ex = await wsExtractor();
  await openOnce(ex, wsUri("m", "m.go"), M_OVERLAY);
  const c = posIn(M_OVERLAY, "NewStripe()", 2);
  const h = await ex.hoverSurface({ uri: wsUri("m", "m.go"), line: c.line, character: c.character });
  assert.ok(h, "hover answers a surface");
  assert.ok(typeof h.signature === "string" && h.signature.includes("NewStripe"), `the signature names the symbol, got ${JSON.stringify(h.signature)}`);
  assert.ok(!h.signature.includes("```"), "no fence marker leaks into the signature");
  assert.ok(typeof h.doc === "string" && h.doc.includes("empty stripe"), `the doc comment prose rides doc, got ${JSON.stringify(h.doc)}`);
  assert.ok(!h.doc.includes("pkg.go.dev"), "the link section is NOT doc prose");
});

rtest("live definition: cursor on a cross-file use of the atlas API resolves to the atlas/atlas.go location inside the module [surface: pinned definition — cross-file within the module]", async () => {
  const ex = await wsExtractor();
  await openOnce(ex, wsUri("m", "m.go"), M_OVERLAY);
  const c = posIn(M_OVERLAY, "NewStripe()", 2);
  const def = await ex.definition({ uri: wsUri("m", "m.go"), line: c.line, character: c.character });
  assert.ok(def, "NewStripe resolves to a location");
  assert.ok(def.uri.endsWith("/atlas/atlas.go"), `the definition lands in atlas/atlas.go, got ${JSON.stringify(def.uri)}`);
  assert.strictEqual(def.range.startLine, lineOf(atlasText, "func NewStripe()"), "the range lands on the declaration's line (the name token, not the whole body)");
});

rtest("live example: ALWAYS undefined — dark by decision, the locked C#/TS resolution [surface: goal 'example() is dark']", async () => {
  const ex = await wsExtractor();
  await openOnce(ex, wsUri("m", "m.go"), M_OVERLAY);
  const c = posIn(M_OVERLAY, "NewStripe()", 2);
  assert.strictEqual(await ex.example({ uri: wsUri("m", "m.go"), line: c.line, character: c.character }), undefined, "example at a documented constructor is still undefined");
  const dot = posAfter(M_OVERLAY, "return s.");
  assert.strictEqual(await ex.example({ uri: wsUri("m", "m.go"), line: dot.line, character: dot.character }, "Enroll"), undefined, "a prefer hint changes nothing — dark is dark");
});

rtest("live qualifyImport: a parse-CLEAN buffer using unimported `uuid` -> a single Add-import QualifyEdit landing in the IMPORTS REGION (startLine strictly above the function), newText carrying the import path [surface: goal 'Go joins the existing out-of-span family']", async () => {
  const ex = await wsExtractor();
  await openOnce(ex, wsUri("qf", "qf.go"), QF_OVERLAY);
  const c = posIn(QF_OVERLAY, "uuid.NewString", 2);
  const edit = await ex.qualifyImport({ uri: wsUri("qf", "qf.go"), line: c.line, character: c.character });
  assert.ok(edit, "the single-candidate Add-import quickfix is accepted");
  assert.ok(edit.newText.includes("github.com/google/uuid"), `the import path rides newText, got ${JSON.stringify(edit.newText)}`);
  const funcLine = lineOf(QF_OVERLAY, "func Fresh()");
  assert.ok(edit.range.startLine < funcLine, `the edit lands in the imports region — out-of-span, above the function (startLine ${edit.range.startLine} < func line ${funcLine}), routing through offerOutOfSpanImport, never the in-span splice`);
});

rtest("live qualifyImport: a genuinely-unresolvable identifier -> undefined (honest-dark, a real hallucination is not an import) [surface: pinned 'ONLY when a single unambiguous candidate exists']", async () => {
  const ex = await wsExtractor();
  await openOnce(ex, wsUri("ur", "ur.go"), UR_OVERLAY);
  const c = posIn(UR_OVERLAY, "zorblatt.Frombulate", 2);
  assert.strictEqual(await ex.qualifyImport({ uri: wsUri("ur", "ur.go"), line: c.line, character: c.character }), undefined, "no package anywhere provides `zorblatt` -> undefined, never a guessed edit");
});

rtest("live latency evidence: warm completeMembers at the member site answers inside a generous ceiling, ms logged [surface: scout 'warm completion latency 0-1ms' — evidence line, not a tight assert]", async () => {
  const ex = await wsExtractor();
  await openOnce(ex, wsUri("m", "m.go"), M_OVERLAY);
  const c = posAfter(M_OVERLAY, "return s.");
  const cur = { uri: wsUri("m", "m.go"), line: c.line, character: c.character };
  await ex.completeMembers(cur); // warm
  const t0 = Date.now();
  const members = await ex.completeMembers(cur);
  const ms = Date.now() - t0;
  console.log(`[latency] warm completeMembers ${ms}ms, ${members.length} members (gopls=${JSON.stringify(goplsVersion())} transport=headless)`);
  assert.ok(members.length >= STRIPE_SIX.length, "the warm answer is the real set");
  assert.ok(ms < 2000, `warm member completion answered in ${ms}ms (>2000ms means the surface cannot ride a keystroke)`);
});
