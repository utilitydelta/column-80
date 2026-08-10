// BLIND ORACLE (LIVE) — v11 Python HEADLESS transport PyLspExtractor
// (src/core/pyLspExtractor.ts) against REAL `pyright-langserver --stdio`, spawned
// from the npm dep (node_modules/.bin/pyright-langserver). This is the
// falsifiable core the fake-runner unit suite cannot reach: real member sets on a
// broken buffer, real completionItem/resolve signatures, the real Any-receiver
// darkness, the real doctest example, the real documentSymbol hierarchy.
//
// TWO RUNGS (the pyoracle-live pattern):
//   1. GROUND-TRUTH (independent of PyLspExtractor): an in-test LSP-over-stdio
//      driver spawns real pyright-langserver and asserts the member/hover/symbol
//      shapes the blind contract rests on. This PASSES whether or not
//      PyLspExtractor exists — it proves the fixtures + captured shapes are REAL
//      and pins OQ-6 (the signature field: DOCUMENTATION, not detail).
//   2. PyLspExtractor-driven: drive the class end to end. RED until
//      src/core/pyLspExtractor.ts lands.
//
// The deterministic fixture needs NO venv and NO network: a local
// source-followable `widgetlib` (doctest -> example LIT), stdlib `pathlib.Path`
// (typeshed -> example DARK), and an `Any` receiver from `json.loads` (-> EMPTY).
// A pydantic ground-truth test is OPPORTUNISTIC: it builds a venv+pydantic best
// effort and SKIPS cleanly when offline.
//
// Never read src/**. Requires node_modules/.bin/pyright-langserver. Skip with
// SKIP_LIVE=1. Nothing in the repo is touched.
//
// Run: node --test --test-concurrency=1 test/blind-v11-pyextractor-live.test.cjs

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const { pathToFileURL } = require("node:url");
const { bundleCore } = require("./.blind-util.cjs");

const SKIP = process.env.SKIP_LIVE === "1" ? "SKIP_LIVE=1" : false;
const LIVE_TIMEOUT = 90_000;
const SERVER = path.join(__dirname, "..", "node_modules", ".bin", "pyright-langserver");
const serverMissing = !fs.existsSync(SERVER) ? `pyright-langserver not found at ${SERVER}` : undefined;

// --- bundle the headless transport (RED until it lands) --------------------
let mod = {};
let cleanupBundle = () => {};
let bundleError;
try {
  ({ mod, cleanup: cleanupBundle } = bundleCore(
    "blind-v11-pylsp",
    `export { PyLspExtractor } from "../src/core/pyLspExtractor";\n`,
  ));
} catch (e) {
  bundleError = e;
  cleanupBundle = () => {
    fs.rmSync(path.join(__dirname, ".blind-v11-pylsp.entry.ts"), { force: true });
    fs.rmSync(path.join(__dirname, ".blind-v11-pylsp.bundle.cjs"), { force: true });
  };
}
if (!bundleError && typeof mod.PyLspExtractor !== "function") {
  bundleError = new Error("the bundle built but exports no PyLspExtractor class");
}
const { PyLspExtractor } = mod;

// ---------------------------------------------------------------------------
// A minimal LSP-over-stdio driver for the GROUND-TRUTH rung (this is a TEST
// driver, not the code under test — it proves the fixtures are real).
// ---------------------------------------------------------------------------

function makeSession(wsDir, pythonPath) {
  const proc = spawn(SERVER, ["--stdio"], { stdio: ["pipe", "pipe", "pipe"] });
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
        const items = msg.params.items.map((it) => {
          if (it.section === "python.analysis") return { autoImportCompletions: true, diagnosticMode: "openFilesOnly", useLibraryCodeForTypes: true };
          if (it.section === "python") return pythonPath ? { pythonPath, analysis: { useLibraryCodeForTypes: true } } : { analysis: { useLibraryCodeForTypes: true } };
          return {};
        });
        send({ jsonrpc: "2.0", id: msg.id, result: items });
      } else if (msg.method === "textDocument/publishDiagnostics") {
        diagsFor[msg.params.uri] = msg.params.diagnostics;
      } else if (msg.id !== undefined) {
        send({ jsonrpc: "2.0", id: msg.id, result: null });
      }
    }
  });
  proc.stderr.on("data", () => {});
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  return {
    async init() {
      await request("initialize", {
        processId: process.pid,
        rootUri: pathToFileURL(wsDir).href,
        workspaceFolders: [{ uri: pathToFileURL(wsDir).href, name: "ws" }],
        capabilities: {
          textDocument: {
            completion: { completionItem: { snippetSupport: true, resolveSupport: { properties: ["documentation", "detail"] }, documentationFormat: ["markdown", "plaintext"] } },
            hover: { contentFormat: ["markdown", "plaintext"] },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
            definition: { linkSupport: true },
          },
          workspace: { configuration: true, workspaceFolders: true },
        },
      });
      notify("initialized", {});
      notify("workspace/didChangeConfiguration", { settings: { python: { analysis: { useLibraryCodeForTypes: true } } } });
    },
    open(uri, text) { notify("textDocument/didOpen", { textDocument: { uri, languageId: "python", version: 1, text } }); },
    async waitReady(uri) { for (let i = 0; i < 50; i++) { await sleep(150); if (diagsFor[uri]) break; } await sleep(400); },
    async completion(uri, line, character) {
      let c = await request("textDocument/completion", { textDocument: { uri }, position: { line, character }, context: { triggerKind: 1 } });
      for (let i = 0; i < 6 && !(c && (c.items || c).length); i++) { await sleep(250); c = await request("textDocument/completion", { textDocument: { uri }, position: { line, character }, context: { triggerKind: 1 } }); }
      return c ? (c.items || c) : [];
    },
    resolve(item) { return request("completionItem/resolve", item); },
    hover(uri, line, character) { return request("textDocument/hover", { textDocument: { uri }, position: { line, character } }); },
    documentSymbol(uri) { return request("textDocument/documentSymbol", { textDocument: { uri } }); },
    definition(uri, line, character) { return request("textDocument/definition", { textDocument: { uri }, position: { line, character } }); },
    dispose() { try { proc.kill(); } catch {} },
  };
}

// ---------------------------------------------------------------------------
// The deterministic fixture (no venv, no network).
// ---------------------------------------------------------------------------

const WIDGETLIB = `class Widget:
    """A widget."""
    def __init__(self, name: str) -> None:
        self.name = name

    def resize(self, n: int) -> str:
        """Resize the widget label.

        >>> Widget("a").resize(3)
        'aaa'
        """
        return self.name * n

    def render(self) -> str: ...
    def clone(self) -> "Widget": ...
    def area(self) -> int: ...
    def width(self) -> int: ...
    def height(self) -> int: ...
    def move(self, dx: int, dy: int) -> None: ...
    def rotate(self, deg: float) -> None: ...
    def scale(self, f: float) -> None: ...
    def hide(self) -> None: ...
    def show(self) -> None: ...
    def label(self) -> str: ...
    def reset(self) -> None: ...
    def _internal(self) -> None: ...
`;

const SRC = `from widgetlib import Widget
from pathlib import Path
import json


class Repo:
    name: str

    def fetch(self, url: str) -> str:
        cached = url
        return cached


w = Widget("a")
w.resize(3)
w.
p = Path("x")
p.
blob = json.loads("{}")
blob.
`;
const LINES = SRC.split("\n");
const lineEq = (content) => {
  const i = LINES.indexOf(content);
  assert.ok(i >= 0, `fixture line not found: ${JSON.stringify(content)}`);
  return i;
};
const endOf = (content) => { const l = lineEq(content); return { line: l, character: LINES[l].length }; };
const colOf = (content, sub) => { const l = lineEq(content); const c = LINES[l].indexOf(sub); assert.ok(c >= 0); return { line: l, character: c }; };

let detWs;
let detUri;
const buildDetFixture = () => {
  if (detWs) return detWs;
  detWs = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v11-pylive-"));
  fs.writeFileSync(path.join(detWs, "widgetlib.py"), WIDGETLIB);
  fs.writeFileSync(path.join(detWs, "gen.py"), SRC);
  detUri = pathToFileURL(path.join(detWs, "gen.py")).href;
  return detWs;
};

// Lazy ground-truth session over the deterministic fixture.
let gtP;
const gtSession = () =>
  (gtP ||= (async () => {
    buildDetFixture();
    const s = makeSession(detWs, undefined);
    await s.init();
    s.open(detUri, SRC);
    await s.waitReady(detUri);
    return s;
  })());

// Lazy PyLspExtractor over the deterministic fixture (RED until it lands).
let exP;
const extractor = () =>
  (exP ||= (async () => {
    buildDetFixture();
    const ex = await PyLspExtractor.start({ projectRoot: detWs, serverPath: SERVER, server: SERVER });
    await ex.whenReady();
    return ex;
  })());

// Opportunistic pydantic fixture (venv + pip). Best effort; skips on failure.
let pyd; // { ws, uri, python } | { err }
const buildPydantic = () => {
  if (pyd) return pyd;
  try {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "blind-v11-pyd-"));
    execFileSync("python3", ["-m", "venv", ".venv"], { cwd: ws, timeout: 60_000, stdio: "ignore" });
    const py = path.join(ws, ".venv", "bin", "python");
    execFileSync(py, ["-m", "pip", "install", "--quiet", "--disable-pip-version-check", "pydantic"], { cwd: ws, timeout: 180_000, stdio: "ignore" });
    const src = `from pydantic import BaseModel


class User(BaseModel):
    name: str
    age: int


u = User(name="a", age=1)
u.
`;
    fs.writeFileSync(path.join(ws, "gen.py"), src);
    pyd = { ws, uri: pathToFileURL(path.join(ws, "gen.py")).href, python: py, src };
  } catch (e) {
    pyd = { err: e };
  }
  return pyd;
};

const scratch = [];
test.after(async () => {
  try { if (gtP) (await gtP).dispose(); } catch {}
  try { if (exP) (await exP).dispose(); } catch {}
  if (detWs) fs.rmSync(detWs, { recursive: true, force: true });
  if (pyd && pyd.ws) fs.rmSync(pyd.ws, { recursive: true, force: true });
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
  cleanupBundle();
});

const byName = (ms, n) => ms.find((m) => m.name === n);
const namesOf = (ms) => ms.map((m) => m.name);
const mdValue = (doc) => (doc && typeof doc === "object" ? doc.value : doc);

// A test gated on the live environment (server present, not SKIP_LIVE).
const ltest = (name, fn) =>
  test(name, { skip: SKIP, timeout: LIVE_TIMEOUT }, async (ctx) => {
    if (serverMissing) return ctx.skip(serverMissing);
    return fn(ctx);
  });
// A test that additionally needs PyLspExtractor to be built.
const rtest = (name, fn) =>
  ltest(name, async (ctx) => {
    if (bundleError) assert.fail(`the Python headless transport is not implemented yet: ${bundleError.message}`);
    return fn(ctx);
  });

// ===========================================================================
// RUNG 1 — GROUND TRUTH (real pyright-langserver; proves fixtures + pins OQ-6).
// ===========================================================================

ltest("GT: pyright-langserver spawns + initializes; a `.` site on a source class returns MANY real members incl a doctest method + single-underscore, and the RAW set carries dunders (what the extractor's by-name filter removes) [surface: brief-1 member surface]", async () => {
  const s = await gtSession();
  const c = endOf("w.");
  const items = await s.completion(detUri, c.line, c.character);
  const labels = items.map((it) => it.label);
  assert.ok(items.length > 12, `a wide real member set, got ${items.length}`);
  assert.ok(labels.includes("resize") && labels.includes("render") && labels.includes("clone"), `real Widget methods present, got ${JSON.stringify(labels.slice(0, 20))}`);
  assert.ok(labels.includes("_internal"), "single-underscore `_internal` is in the RAW set (the extractor KEEPS it)");
  assert.ok(labels.filter((n) => /^__.+__$/.test(n)).length > 0, "the RAW set carries dunders (the extractor filters these by name)");
});

ltest("GT (OQ-6): the resolved signature rides `documentation` (markdown ```python fence), NOT `detail` (detail is undefined) [surface: OQ-6 — pin the field explicitly]", async () => {
  const s = await gtSession();
  const c = endOf("w.");
  const items = await s.completion(detUri, c.line, c.character);
  const resize = items.find((it) => it.label === "resize");
  assert.ok(resize, "resize completes");
  const r = await s.resolve(resize);
  assert.strictEqual(r.detail, undefined, "GROUND TRUTH: pyright leaves completion `detail` UNDEFINED");
  const val = mdValue(r.documentation);
  assert.ok(typeof val === "string" && val.includes("```python"), "GROUND TRUTH: the signature rides documentation as a python fence, got " + JSON.stringify(val).slice(0, 160));
  assert.ok(/def\s+resize\s*\(/.test(val), "the fence body is the real def signature");
});

ltest("GT: a site-packages/source doctest lights (a `>>>` block rides the resolved documentation) — example() LIT direction [surface: Fork 4 LIT]", async () => {
  const s = await gtSession();
  const c = endOf("w.");
  const items = await s.completion(detUri, c.line, c.character);
  const r = await s.resolve(items.find((it) => it.label === "resize"));
  const val = mdValue(r.documentation);
  assert.ok(val.includes(">>>") && val.includes('Widget("a").resize(3)'), `GROUND TRUTH: the doctest `>>>` is present in the payload, got ${JSON.stringify(val).slice(0, 220)}`);
});

ltest("GT: a stdlib receiver returns real methods but NO doctest (typeshed) — example() DARK direction [surface: Fork 4 DARK]", async () => {
  const s = await gtSession();
  const c = endOf("p.");
  const items = await s.completion(detUri, c.line, c.character);
  const labels = items.map((it) => it.label);
  assert.ok(labels.includes("cwd") && labels.includes("stat"), `real Path methods, got ${JSON.stringify(labels.slice(0, 15))}`);
  const r = await s.resolve(items.find((it) => it.label === "cwd"));
  const val = mdValue(r.documentation) || "";
  assert.ok(!val.includes(">>>"), "GROUND TRUTH: the stdlib symbol carries no `>>>` doctest -> example is DARK");
});

ltest("GT: an Any/Unknown receiver (`json.loads(...)`) completes to ZERO members (honest-dark) [surface: brief-1 EMPTY set]", async () => {
  const s = await gtSession();
  const c = endOf("blob.");
  const items = await s.completion(detUri, c.line, c.character);
  assert.strictEqual(items.length, 0, "GROUND TRUTH: an Any receiver has zero completable members (the empty that must never be faked)");
});

ltest("GT: documentSymbol is hierarchical — a class's method is a child, and the method's body LOCAL is a child of the METHOD (never of the class) [surface: '6. documentSymbol' + the locals filter]", async () => {
  const s = await gtSession();
  const syms = await s.documentSymbol(detUri);
  const repo = (syms || []).find((x) => x.name === "Repo");
  assert.ok(repo, `Repo class is a top-level symbol, got ${JSON.stringify((syms || []).map((x) => x.name))}`);
  const fetch = (repo.children || []).find((c) => c.name === "fetch");
  assert.ok(fetch, "fetch is a child of Repo");
  const repoChildNames = (repo.children || []).map((c) => c.name);
  assert.ok(!repoChildNames.includes("cached"), "GROUND TRUTH: the body local `cached` is NOT a direct child of Repo");
  assert.ok((fetch.children || []).some((c) => c.name === "cached"), "GROUND TRUTH: `cached` is a child of the fetch METHOD symbol (structurally excluded from Repo's members)");
});

ltest("GT: hover on a typed variable is a ```python fence [surface: '2. hoverSurface' fence-is-signature]", async () => {
  const s = await gtSession();
  const c = colOf("w = Widget(\"a\")", "w");
  const h = await s.hover(detUri, c.line, c.character);
  const val = mdValue(h && h.contents);
  assert.ok(typeof val === "string" && val.includes("```python") && /Widget/.test(val), "hover carries a python fence naming the type, got " + JSON.stringify(val).slice(0, 120));
});

ltest("GT (opportunistic): a real pydantic BaseModel receiver -> many members incl `model_dump`, the fields `name`/`age`, single-underscore kept [surface: brief-1 pydantic receiver]", async (ctx) => {
  const p = buildPydantic();
  if (p.err) return ctx.skip(`pydantic venv unavailable (offline?): ${String(p.err.message || p.err).slice(0, 120)}`);
  const s = makeSession(p.ws, p.python);
  scratch.push(p.ws);
  await s.init();
  s.open(p.uri, p.src);
  await s.waitReady(p.uri);
  const lines = p.src.split("\n");
  const uLine = lines.indexOf("u.");
  const items = await s.completion(p.uri, uLine, 2);
  const labels = items.map((it) => it.label);
  s.dispose();
  assert.ok(items.length > 40, `a wide pydantic member set, got ${items.length}`);
  assert.ok(labels.includes("model_dump"), `model_dump present, got ${JSON.stringify(labels.filter((n) => n.startsWith("model_")).slice(0, 10))}`);
  assert.ok(labels.includes("name") && labels.includes("age"), "the declared fields name/age are members");
  assert.ok(labels.some((n) => /^_[^_]/.test(n)), "at least one single-underscore private member is present (kept)");
});

// ===========================================================================
// RUNG 2 — PyLspExtractor end to end. RED until src/core/pyLspExtractor.ts lands.
// ===========================================================================

rtest("live start: resolves pyright-langserver and carries the six primitives + lifecycle [surface: 'SurfaceExtractor' + pyLspExtractor]", async () => {
  const ex = await extractor();
  for (const m of ["completeMembers", "hoverSurface", "definition", "example", "qualifyImport", "membersOfType"]) {
    assert.strictEqual(typeof ex[m], "function", `primitive ${m}`);
  }
  assert.strictEqual(typeof ex.dispose, "function", "dispose");
});

rtest("live completeMembers: a source-class `.` site -> the real member set with resolved signatures; dunders filtered by name, single-underscore kept [surface: brief-1 + Fork 7]", async () => {
  const ex = await extractor();
  const c = endOf("w.");
  const members = await ex.completeMembers({ uri: detUri, line: c.line, character: c.character });
  assert.ok(Array.isArray(members) && members.length > 0, `a real member set, got ${members.length}`);
  const resize = byName(members, "resize");
  assert.ok(resize, `resize is in the set, got ${JSON.stringify(namesOf(members).slice(0, 20))}`);
  assert.ok(resize.kind === "method" || resize.kind === "function", "resize is callable");
  assert.ok(typeof resize.signature === "string" && /resize\(/.test(resize.signature) && !resize.signature.includes("```"), `the resolved signature is fence-stripped, got ${JSON.stringify(resize.signature)}`);
  assert.strictEqual(members.filter((m) => /^__.+__$/.test(m.name)).length, 0, "the dunder filter removed every /^__.+__$/ member");
  assert.ok(byName(members, "_internal"), "single-underscore `_internal` is KEPT");
});

rtest("live completeMembers: an Any receiver returns [] (honest-dark, load-bearing) [surface: brief-1 EMPTY]", async () => {
  const ex = await extractor();
  const c = endOf("blob.");
  const members = await ex.completeMembers({ uri: detUri, line: c.line, character: c.character });
  assert.deepStrictEqual(members, [], "an Any receiver -> [] (never a faked non-empty, never a false-empty from a dead server)");
});

rtest("live completeMembers: a non-member site returns [] (the member-site gate) [surface: brief-1 member-site gate]", async () => {
  const ex = await extractor();
  // Column 0 of the `from ...` import line — not after `identifier.`.
  const members = await ex.completeMembers({ uri: detUri, line: 0, character: 0 });
  assert.deepStrictEqual(members, [], "not a member site -> no members");
});

rtest("live hoverSurface: a doctest method yields signature + example; a stdlib method has signature but NO example [surface: '2. hoverSurface' + docstring split]", async () => {
  const ex = await extractor();
  const rz = colOf("w.resize(3)", "resize");
  const h = await ex.hoverSurface({ uri: detUri, line: rz.line, character: rz.character });
  assert.ok(h && typeof h.signature === "string" && /resize/.test(h.signature), `signature names resize, got ${JSON.stringify(h && h.signature)}`);
  assert.ok(typeof h.example === "string" && h.example.includes('Widget("a").resize(3)'), `the doctest surfaces as example, got ${JSON.stringify(h && h.example)}`);
});

rtest("live example: a site-packages/source doctest LIGHTS, a stdlib symbol stays DARK (the first conditional example()) [surface: '4. example' both directions]", async () => {
  const ex = await extractor();
  const rz = colOf("w.resize(3)", "resize");
  const lit = await ex.example({ uri: detUri, line: rz.line, character: rz.character });
  assert.ok(typeof lit === "string" && lit.includes('Widget("a").resize(3)') && !/^>>>/m.test(lit), `LIT: the doctest snippet, markers stripped, got ${JSON.stringify(lit)}`);
  const pc = endOf("p.");
  const dark = await ex.example({ uri: detUri, line: pc.line, character: pc.character });
  assert.strictEqual(dark, undefined, "DARK: a stdlib receiver has no doctest -> example undefined");
});

rtest("live definition: a stdlib symbol resolves into a file:// location (typeshed stub) [surface: '3. definition']", async () => {
  const ex = await extractor();
  const pc = colOf("p = Path(\"x\")", "Path");
  const def = await ex.definition({ uri: detUri, line: pc.line, character: pc.character });
  assert.ok(def, "Path resolves to a location");
  assert.ok(typeof def.uri === "string" && def.uri.startsWith("file://"), `a file:// uri, got ${JSON.stringify(def.uri)}`);
  for (const k of ["startLine", "startCharacter", "endLine", "endCharacter"]) assert.strictEqual(typeof def.range[k], "number", `range.${k} is a number`);
});

rtest("live membersOfType: documentSymbol descent of the local class -> its declared attributes + methods, NOT a method's body local [surface: '6. membersOfType' + locals filter]", async () => {
  const ex = await extractor();
  const rc = colOf("class Repo:", "Repo");
  const members = await ex.membersOfType({ uri: detUri, line: rc.line, character: rc.character });
  const got = namesOf(members);
  assert.ok(byName(members, "fetch") && byName(members, "fetch").kind === "method", `the declared method, got ${JSON.stringify(got)}`);
  assert.ok(byName(members, "name"), "the declared class attribute `name` is a member");
  assert.strictEqual(byName(members, "cached"), undefined, "the method's body local `cached` is NOT a member of the class (locals filter)");
});
