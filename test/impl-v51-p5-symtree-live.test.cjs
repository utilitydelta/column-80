// LIVE - session-v51 phase 5. `documentSymbolsForTest` on the Python and Go
// transports, and the one translation that stands between a real tree and a
// leg that is dark while looking like it ran.
//
// WHY THIS ROW EXISTS. The pre-fill's RECEIVER leg - at a method target, the
// enclosing type, the one type the body is certain to touch - reads its tree out
// of `ResolvedFunction.symbols`. In the editor the product resolved the span OUT
// of that tree, so the field is already populated. A headless caller builds its
// records from a manifest, has no tree, and the field's contract is that absent
// means "no tree" and every reader degrades SILENTLY. Session-v51's first Python
// arm read 39 of 40 rows as a zero-byte injected surface for exactly that reason
// while 71 of its 80 rows sit inside a class, and the number was quoted as a
// fact about Python.
//
// THE TRAP IS THE KIND NUMBERING, and it is why this is not a one-line
// smoke test. LSP and vscode number `SymbolKind` differently BY EXACTLY ONE, and
// `fnGen`'s container test is written against the VSCODE numbering. A raw LSP
// tree therefore reads Class(5) as Method(5): every node type-checks, the array
// is non-empty, `resolvePrefill` runs to completion, and the receiver resolves to
// nothing. The failure looks identical to a language that has no enclosing type.
// So the assertion is DIFFERENTIAL: the same live tree, the same live row,
// through the product's own `resolvePrefill`, once raw and once translated. Raw
// must find no receiver; translated must name the real class. A test that only
// asserted the translated side would pass against a mapping that shifted the
// wrong way, and a re-derived mapping has already inverted one arm result in
// this project (session-v29).
//
// Skips (never fails) when SKIP_LIVE is set, when the rig is absent, or when the
// corpus is not on this box - the same discipline as
// test/impl-v51-p1-pyrig-live.test.cjs.
//
// Run: node --test test/impl-v51-p5-symtree-live.test.cjs

const { RIG_PRESENT, SKIP_REASON } = require("./.rig-present.cjs");
if (!RIG_PRESENT) {
  require("node:test")("rig-dependent rows", { skip: SKIP_REASON }, () => {});
  return;
}

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const MANIFEST = path.join(__dirname, "..", "session-v51", "manifest-py-src40.json");
const PY_ROOT = process.env.STUDY_ROOT_PY ?? path.join(os.homedir(), "sandbox", "v51-corpus-py");

const manifestPresent = fs.existsSync(MANIFEST);
const pyCorpusPresent = fs.existsSync(path.join(PY_ROOT, "mcp-graph-engine")) && fs.existsSync(path.join(PY_ROOT, "debate-event-store"));

const SKIP =
  process.env.SKIP_LIVE ? "SKIP_LIVE set"
  : !manifestPresent ? "no session-v51/manifest-py-src40.json"
  : !pyCorpusPresent ? `no Python corpus at ${PY_ROOT}`
  : false;

if (SKIP) {
  test(`documentSymbolsForTest live exit gate (SKIPPED: ${SKIP})`, () => {});
} else {
  process.env.STUDY_ROOT_PY = PY_ROOT;
  const { loadCore, loadPrefill, makeDoc, STUB } = require("../session-complxity-research/spikes/lib-core.cjs");
  const { mod: core } = loadCore();
  const { mod: prefill } = loadPrefill();
  const stub = require(STUB);
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  // LSP SymbolKind numbering, which is what every transport's accessor answers
  // in. Spelled as literals rather than derived, because the whole row is about
  // two numberings being one apart and a derivation would derive the bug.
  const LSP_CLASS = 5;
  const LSP_STRUCT = 23;
  const VSCODE_CLASS = 4;

  /** The rig's translation, the same three lines `run-row-py.cjs` carries. */
  function toVscodeSymbols(node) {
    if (!Array.isArray(node)) return undefined;
    return node.map((sym) => ({
      name: typeof sym?.name === "string" ? sym.name : "",
      detail: typeof sym?.detail === "string" ? sym.detail : "",
      kind: typeof sym?.kind === "number" ? sym.kind - 1 : -1,
      range: sym?.range
        ? new stub.Range(sym.range.start.line, sym.range.start.character, sym.range.end.line, sym.range.end.character)
        : undefined,
      selectionRange: sym?.selectionRange
        ? new stub.Range(sym.selectionRange.start.line, sym.selectionRange.start.character, sym.selectionRange.end.line, sym.selectionRange.end.character)
        : undefined,
      children: toVscodeSymbols(sym?.children) ?? [],
    }));
  }

  // The subject: a real corpus row that SITS INSIDE A CLASS and takes `self`.
  // Chosen off the manifest rather than named, so a corpus rebuild moves the row
  // instead of breaking the test - but asserted to exist, because a filter that
  // silently matches nothing is the false green this file is guarding against.
  const row = manifest.rows.find((r) => r.enclosing && /\(\s*self\b/.test(r.signature) && r.crate === "debate-event-store");
  const prepared = (r) => {
    const full = fs.readFileSync(path.join(PY_ROOT, r.file), "utf8");
    return full.slice(0, r.docEnd) + full.slice(r.bodyClose + 1);
  };

  test("py transport: documentSymbolsForTest answers a real LSP tree, and the kind translation is what lights the receiver leg", { timeout: 600_000 }, async () => {
    assert.ok(row, "the manifest must carry a method row with a `self` receiver, or this row tests nothing");
    const projectRoot = path.join(PY_ROOT, row.project);
    const ext = await core.PyLspExtractor.start({
      projectRoot,
      pythonPath: path.join(projectRoot, ".venv", "bin", "python"),
    });
    try {
      await ext.whenReady(240_000);
      const absPath = path.join(PY_ROOT, row.file);
      const uri = pathToFileURL(absPath).href;
      const text = prepared(row);
      ext.openDocument(uri, text);

      // ---- 1. the transport answers, and it answers a TREE ----
      const raw = await ext.documentSymbolsForTest(uri);
      assert.ok(Array.isArray(raw) && raw.length > 0, "the Python transport must answer a non-empty document-symbol tree");
      const cls = raw.find((s) => s.name === row.enclosing);
      assert.ok(cls, `the tree must carry the row's enclosing class \`${row.enclosing}\`, got: ${raw.map((s) => s.name).join(",")}`);
      assert.equal(cls.kind, LSP_CLASS, "the accessor answers in the LSP numbering, where Class is 5");
      assert.ok(Array.isArray(cls.children) && cls.children.length > 0, "a class node must carry its members as children");
      assert.ok(cls.range && cls.selectionRange, "a node without ranges cannot anchor a receiver");
      // The row really is inside it. If it were not, the differential below
      // would pass for the wrong reason.
      const head = makeDoc(stub, absPath, text, "python").positionAt(row.docEnd);
      assert.ok(
        cls.range.start.line <= head.line && head.line <= cls.range.end.line,
        `the row's span head (line ${head.line}) must sit inside \`${row.enclosing}\` (${cls.range.start.line}-${cls.range.end.line})`,
      );

      // ---- 2. the translation, and the exact off-by-one it corrects ----
      const translated = toVscodeSymbols(raw);
      const tcls = translated.find((s) => s.name === row.enclosing);
      assert.equal(tcls.kind, VSCODE_CLASS, "translated, the class must read as vscode's Class(4)");
      assert.equal(cls.kind - 1, tcls.kind, "the two numberings differ by exactly one, in this direction");
      // The stated trap, named: UNTRANSLATED, a Python class carries the number
      // vscode uses for Method, so the container test sees a method.
      assert.equal(cls.kind, stub.SymbolKind.Method, "untranslated, LSP Class(5) IS vscode's Method - this is the whole defect");
      assert.equal(tcls.kind, stub.SymbolKind.Class);

      // ---- 3. the differential, through the PRODUCT'S OWN resolvePrefill ----
      // Not through a re-implemented container test. The leg that was dark is
      // the one inside `resolvePrefill`, and only the facade can say whether it
      // is lit (`bind-the-oracle-to-the-facade`).
      const doc = makeDoc(stub, absPath, text, "python");
      const base = {
        span: { start: row.docEnd, end: row.docEnd },
        signature: row.signature,
        docComment: core.stripPyDocstring(row.docComment),
        symbolName: row.name,
        languageId: "python",
        kind: "function",
        bodyOnly: true,
        headerIndent: row.indent,
        bodyIndent: row.bodyIndent,
      };
      const run = async (symbols) => {
        const logs = [];
        const surface = await prefill.resolvePrefill(ext, doc, { ...base, symbols }, (l) => logs.push(String(l)));
        return { surface, logs };
      };

      const dark = await run(raw);
      assert.ok(
        !dark.logs.some((l) => l.includes("pre-fill receiver")),
        `an UNTRANSLATED tree must leave the receiver leg dark, got: ${dark.logs.filter((l) => l.includes("receiver")).join(" | ")}`,
      );

      const lit = await run(translated);
      assert.ok(
        lit.logs.some((l) => l.includes(`pre-fill receiver \`${row.enclosing}\``)),
        `the translated tree must resolve the enclosing class as the receiver, got: ${lit.logs.join(" | ")}`,
      );
      // And it must reach the PROMPT, not just the channel. Detection is not
      // injection, and the channel line says so itself.
      assert.ok(typeof lit.surface === "string" && lit.surface.length > 0, "the lit leg must produce a non-empty injected surface");
      assert.ok(lit.surface.includes(row.enclosing), `the surface must name \`${row.enclosing}\``);
      assert.ok(
        (dark.surface ?? "").length < lit.surface.length,
        `the dark leg must produce less than the lit one, got dark=${(dark.surface ?? "").length}B lit=${lit.surface.length}B`,
      );
      // The product's own stop line, on both sides: a run that produced no
      // channel at all is an instrument result, not a product one.
      for (const [tag, r] of [["dark", dark], ["lit", lit]]) {
        assert.ok(r.logs.some((l) => l.includes("injected context: stop=")), `${tag}: no product channel line`);
      }
    } finally {
      try {
        ext.dispose?.();
      } catch {}
    }
  });

  // ---------------------------------------------------------------------------
  // Go. The accessor was added to `GoLspExtractor` in the same change, so it
  // gets the same transport row: does gopls answer a tree, and does it answer in
  // the LSP numbering the one translation assumes?
  //
  // IT IS A TRANSPORT ROW AND NOTHING MORE, said plainly. Go's rig
  // (`run-row-go.cjs`) has no live-test harness of its own and no `enclosing`
  // column in its population - its rows are the v42 authored-candidate shape, not
  // a manifest of class members - so there is no Go row here to run the
  // receiver differential against, and none is invented. Go also resolves its
  // receiver from the SIGNATURE (`rules.receiverType`, fnGen.ts), so the tree is
  // not on its receiver path at all. Whether the accessor moves a Go arm is
  // unmeasured.
  // ---------------------------------------------------------------------------

  // The Go corpus the session's own `run-row-go.cjs` pins (`--corpus v42-corpus
  // --crate pgx`), so this row and that rig look at the same world. The binary
  // and PATH are the ones the other Go live rows pin, so the version behind an
  // evidence line is never in doubt.
  //
  // READ-ONLY: this opens documents and asks for documentSymbol. Nothing
  // splices, nothing runs `go build`, so it is safe beside another process on
  // the same checkout - unlike the Go rig rows that splice.
  const GOPLS = "/home/utilitydelta/go/bin/gopls";
  const GO_BIN_DIR = "/home/utilitydelta/.local/go/bin";
  process.env.PATH = `${GO_BIN_DIR}:${process.env.PATH || ""}`;
  const GO_ROOT = process.env.STUDY_ROOT_GO ?? path.join(os.homedir(), "sandbox", "v42-corpus", "pgx");
  const goFile = (() => {
    if (!fs.existsSync(GOPLS) || !fs.existsSync(path.join(GO_BIN_DIR, "go")) || !fs.existsSync(GO_ROOT)) return undefined;
    const stack = [GO_ROOT];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== ".git" && e.name !== "testdata" && e.name !== "vendor") stack.push(p);
        } else if (e.name.endsWith(".go") && !e.name.endsWith("_test.go")) {
          // A file that declares a struct, which is the node the numbering
          // question is about.
          if (/\ntype\s+\w+\s+struct\s*\{/.test(fs.readFileSync(p, "utf8"))) return p;
        }
      }
    }
    return undefined;
  })();

  if (!goFile) {
    test(`go transport: documentSymbolsForTest (SKIPPED: no gopls at ${GOPLS}, no go toolchain, or no struct-declaring file under ${GO_ROOT})`, () => {});
  } else {
    test("go transport: documentSymbolsForTest answers a tree in the LSP numbering", { timeout: 600_000 }, async () => {
      const modDir = (() => {
        let d = path.dirname(goFile);
        while (d.startsWith(GO_ROOT) && !fs.existsSync(path.join(d, "go.mod"))) d = path.dirname(d);
        return fs.existsSync(path.join(d, "go.mod")) ? d : GO_ROOT;
      })();
      const ext = await core.GoLspExtractor.start({ projectRoot: modDir, goplsPath: GOPLS });
      try {
        await ext.whenReady(240_000);
        const uri = pathToFileURL(goFile).href;
        ext.openDocument(uri, fs.readFileSync(goFile, "utf8"));
        const raw = await ext.documentSymbolsForTest(uri);
        assert.ok(Array.isArray(raw) && raw.length > 0, `gopls must answer a non-empty tree for ${goFile}`);
        const struct = raw.find((s) => s.kind === LSP_STRUCT);
        assert.ok(struct, `the tree must carry a Struct(${LSP_STRUCT}) node in the LSP numbering, got kinds: ${[...new Set(raw.map((s) => s.kind))].join(",")}`);
        assert.ok(struct.range && struct.selectionRange, "a node without ranges cannot anchor anything");
        // Translated, a Go struct lands on vscode's Struct - the same one
        // subtraction, checked on the other transport so the mapping is not a
        // Python coincidence.
        assert.equal(toVscodeSymbols(raw).find((s) => s.name === struct.name).kind, stub.SymbolKind.Struct);
      } finally {
        try {
          ext.dispose?.();
        } catch {}
      }
    });
  }
}
