// session-v64 PHASE 5 SPIKE: does the OUTGOING call hierarchy answer, and do the
// callees carry doc comments?
//
// `callWalk.ts` walks CALLERS, upward, and that leg is proven. Arm E of this
// session wants the other direction: the function's DOWNSTREAM CALLEES and the
// doc comment sitting on each one, handed to the model as context. Nothing in
// the product walks that way today, so this file measures whether it could.
//
// It is a PROBE, not a contract. The ONLY hard assertions are that
// `vscode.prepareCallHierarchy`, `vscode.provideOutgoingCalls` and
// `vscode.provideIncomingCalls` do not throw. Everything else is logged, and the
// RUN OUTPUT plus session-v64/spike-out/<lang>.json is the measurement.
//
// `vscode.provideIncomingCalls` runs on the SAME root in the same run as a
// POSITIVE CONTROL. If outgoing is empty AND incoming is empty, the rig did not
// fire and the zero is a fact about the rig, not about the language. That
// distinction is the whole reason this file exists.
//
// Every root is a REAL function already checked into that language's dogfood
// workspace, chosen because its body actually calls other named functions. A
// function with no callees measures nothing.
//
// Run (a display is up on :1; this probe never touches the completion widget,
// so a locked session is fine for it - same as the v60 probe):
//
//   npm run build
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label rust   --grep V64PROBE
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label ts     --grep V64PROBE
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label csharp --grep V64PROBE
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label python --grep V64PROBE
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label go     --grep V64PROBE

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { SPECS } = require('./helpers/specs');

const LANG = process.env.C80_LANG || 'ts';
const spec = SPECS[LANG];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OUT_DIR = '/home/utilitydelta/work/utilitydelta/column-80/session-v64/spike-out';

// How long to wait for a call-hierarchy provider to exist at all. rust-analyzer
// loads the cargo workspace and Pylance indexes before either answers anything.
const PREPARE_TIMEOUT_MS = 300000;

const KINDS = Object.keys(vscode.SymbolKind).filter((k) => isNaN(Number(k)));
const kindName = (k) => KINDS.find((n) => vscode.SymbolKind[n] === k) || String(k);

// --- the roots: real functions with real callees --------------------------

const ROOTS = {
  rust: [
    { id: 'cohort_seven_count', file: 'crates/playground/src/fns.rs',
      needle: 'fn cohort_seven_count() -> usize {', nameAt: 'fn '.length,
      note: 'same-file callees: CohortRegister::new / induct / tally_cohort' },
    { id: 'stripe_from_orders', file: 'crates/playground/src/autocontext.rs',
      needle: 'pub fn stripe_from_orders(', nameAt: 'pub fn '.length,
      note: 'cross-crate callees into the atlas crate' },
  ],
  ts: [
    { id: 'touchSites', file: 'playground/src/fns.ts',
      needle: 'export function touchSites(): void {', nameAt: 'export function '.length,
      note: 'same-file fns + a class ctor + a cross-package import' },
    { id: 'hallucinatedMember', file: 'playground/src/repair.ts',
      needle: 'export function hallucinatedMember(): number {', nameAt: 'export function '.length,
      note: 'cross-package callees into @scratch/atlas-ts' },
  ],
  csharp: [
    { id: 'HallucinatedMember', file: 'src/Playground/Repair.cs',
      needle: 'public static int HallucinatedMember()', nameAt: 'public static int '.length,
      note: 'cross-project callees into the Atlas assembly' },
    { id: 'TileSite', file: 'src/Playground/Fim.cs',
      needle: 'public static int TileSite()', nameAt: 'public static int '.length,
      note: 'a static helper plus an instance method' },
  ],
  python: [
    { id: '_touch_atlas', file: 'playground/fns.py',
      needle: 'def _touch_atlas() -> int:', nameAt: 'def '.length,
      note: 'cross-package callees into atlas_py' },
    { id: 'hallucinated_member', file: 'playground/repair.py',
      needle: 'def hallucinated_member() -> int:', nameAt: 'def '.length,
      note: 'cross-package callees into atlas_py' },
  ],
  go: [
    { id: 'touchAtlas', file: 'playground/fns.go',
      needle: 'func touchAtlas() uint32 {', nameAt: 'func '.length,
      note: 'cross-package callees into the atlas package' },
    { id: 'hallucinatedMember', file: 'playground/repair.go',
      needle: 'func hallucinatedMember() uint32 {', nameAt: 'func '.length,
      note: 'cross-package callees into the atlas package' },
  ],
};

// A REAL-REPOSITORY override. The dogfood workspaces were authored as FIM
// fixtures and are documented far above the rate real code is, so the callee
// doc-comment number they produce flatters the feature. `C80_V64_WS` points the
// same probe at a production repository and `C80_V64_ROOTS` carries its roots as
// JSON, so no shared config file has to be edited to run it.
const WS_OVERRIDE = process.env.C80_V64_WS || null;
const ACTIVE_ROOTS = process.env.C80_V64_ROOTS
  ? JSON.parse(process.env.C80_V64_ROOTS)
  : (ROOTS[LANG] || []);

// --- doc-comment detection -------------------------------------------------
//
// HOW EACH LANGUAGE IS COUNTED, stated so the number can be argued with:
//
//   rust    `///` (or `//!`) lines immediately above the declaration, stepping
//           over `#[...]` attribute lines. A `/** */` block also counts.
//   ts      a `/** ... */` JSDoc block closing on the line above. A plain `//`
//           run is recorded SEPARATELY as `line-comment`, not as a doc comment.
//   csharp  `///` lines above, stepping over `[Attribute]` lines.
//   go      a run of `//` lines immediately above `func`, no blank line between
//           (that is exactly what godoc counts).
//   python  a docstring INSIDE the body: the first non-blank line after the
//           declaration's terminating `:`, opening with `"""` / `'''`.
//
// Blank lines break every one of these except the python case, which is what
// the language tools themselves do.

const fileCache = new Map();
function linesOf(fsPath) {
  if (fileCache.has(fsPath)) return fileCache.get(fsPath);
  let lines = null;
  try { lines = fs.readFileSync(fsPath, 'utf8').split('\n'); } catch { lines = null; }
  fileCache.set(fsPath, lines);
  return lines;
}

function docAbove(fsPath, declLine, lang) {
  const lines = linesOf(fsPath);
  if (!lines) return { has: false, kind: 'unreadable', text: null };

  if (lang === 'python') {
    // Walk forward to the line that ends the declaration header (`:`), then the
    // first non-blank line after it.
    let i = declLine;
    let guard = 0;
    while (i < lines.length && guard++ < 40 && !/:\s*(#.*)?$/.test(lines[i])) i++;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const t = j < lines.length ? lines[j].trim() : '';
    if (/^(r|b|u|f)?("""|''')/i.test(t)) {
      const out = [];
      for (let k = j; k < lines.length && k < j + 12; k++) {
        out.push(lines[k].trim());
        if (k > j && /("""|''')\s*$/.test(lines[k])) break;
        if (k === j && /^(r|b|u|f)?("""|''').*("""|''')\s*$/i.test(t)) break;
      }
      return { has: true, kind: 'docstring', text: out.join(' ').slice(0, 200) };
    }
    return { has: false, kind: 'none', text: null };
  }

  let i = declLine - 1;
  const skip = lang === 'rust' ? /^\s*#\[/ : lang === 'csharp' ? /^\s*\[/ : null;
  while (i >= 0 && ((skip && skip.test(lines[i])) || (lang !== 'go' && lines[i].trim() === '' && false))) i--;
  if (i < 0) return { has: false, kind: 'none', text: null };
  const above = lines[i];

  if (lang === 'rust' || lang === 'csharp') {
    const marker = /^\s*\/\/\//;
    if (marker.test(above)) {
      const out = [];
      let k = i;
      while (k >= 0 && marker.test(lines[k])) { out.unshift(lines[k].trim()); k--; }
      return { has: true, kind: lang === 'rust' ? 'rustdoc ///' : 'xmldoc ///', text: out.join(' ').slice(0, 200) };
    }
    if (lang === 'rust' && /^\s*\/\/!/.test(above)) {
      return { has: true, kind: 'rustdoc //!', text: above.trim().slice(0, 200) };
    }
  }

  if (lang === 'go') {
    if (/^\s*\/\//.test(above)) {
      const out = [];
      let k = i;
      while (k >= 0 && /^\s*\/\//.test(lines[k])) { out.unshift(lines[k].trim()); k--; }
      return { has: true, kind: 'godoc //', text: out.join(' ').slice(0, 200) };
    }
  }

  if (lang === 'ts') {
    if (/\*\/\s*$/.test(above)) {
      const out = [];
      let k = i;
      while (k >= 0) { out.unshift(lines[k].trim()); if (/\/\*\*/.test(lines[k])) break; if (/\/\*/.test(lines[k])) break; k--; }
      const joined = out.join(' ');
      if (/^\/\*\*/.test(joined)) return { has: true, kind: 'jsdoc /** */', text: joined.slice(0, 200) };
      return { has: false, kind: 'block-comment (not jsdoc)', text: joined.slice(0, 200) };
    }
    if (/^\s*\/\//.test(above)) {
      return { has: false, kind: 'line-comment', text: above.trim().slice(0, 200) };
    }
  }

  return { has: false, kind: 'none', text: null };
}

// --- plumbing --------------------------------------------------------------

const prepare = (uri, pos) => vscode.commands.executeCommand('vscode.prepareCallHierarchy', uri, pos);
const outgoing = (item) => vscode.commands.executeCommand('vscode.provideOutgoingCalls', item);
const incoming = (item) => vscode.commands.executeCommand('vscode.provideIncomingCalls', item);

function relOf(uri, root) {
  const p = uri && uri.fsPath ? uri.fsPath : String(uri);
  return p.startsWith(root) ? p.slice(root.length + 1) : p;
}

function log(...ls) { for (const l of ls) console.log(`  [V64 ${LANG}] ${l}`); }

const REPORT = { lang: LANG, workspace: null, host: null, roots: [], errors: [] };

suite(`V64PROBE outgoing call hierarchy + callee doc comments [${LANG}]`, function () {
  this.timeout(900000);

  const list = ACTIVE_ROOTS;
  let wsRoot;

  suiteSetup(async function () {
    if (!spec || !list.length) {
      log('no roots defined for this label. SKIPPED.');
      return this.skip();
    }
    wsRoot = WS_OVERRIDE || spec.repo;
    REPORT.workspace = wsRoot;
    const thirdParty = vscode.extensions.all
      .filter((e) => !e.id.startsWith('vscode.') && !e.id.startsWith('ms-vscode.js-debug'))
      .map((e) => `${e.id}@${(e.packageJSON && e.packageJSON.version) || '?'}${e.isActive ? '' : ' (inactive)'}`);
    REPORT.host = thirdParty;
    log('HOST EXTENSIONS: ' + (thirdParty.length ? thirdParty.join(', ') : '<none>'));
    log(`workspace folder: ${wsRoot}`);
  });

  suiteTeardown(async function () {
    try { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); } catch {}
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      const tag = process.env.C80_V64_TAG || LANG;
      fs.writeFileSync(path.join(OUT_DIR, `${tag}.json`), JSON.stringify(REPORT, null, 2), 'utf8');
      log(`report written: ${path.join(OUT_DIR, `${tag}.json`)}`);
    } catch (e) {
      log(`report NOT written: ${e && e.message}`);
    }
  });

  for (const rootSpec of ACTIVE_ROOTS) {
    test(`root ${rootSpec.id}: outgoing calls, doc comments, and the incoming control`, async function () {
      const rec = {
        id: rootSpec.id, file: rootSpec.file, note: rootSpec.note,
        prepared: false, prepareMs: null,
        outgoingAnswered: null, outgoingMs: null, outgoingWarmMs: null, callees: [],
        incomingAnswered: null, incomingMs: null, incomingCount: 0, incoming: [],
      };
      REPORT.roots.push(rec);

      const abs = path.join(wsRoot, rootSpec.file);
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
      await vscode.window.showTextDocument(doc, { preview: false });
      const text = doc.getText();
      const idx = text.indexOf(rootSpec.needle);
      assert.ok(idx >= 0, `needle ${JSON.stringify(rootSpec.needle)} not found in ${rootSpec.file}`);
      const pos = doc.positionAt(idx + rootSpec.nameAt + 1); // one char INSIDE the name

      // 1. prepare, with a retry window: a cold server answers nothing at first.
      const t0 = Date.now();
      let items = null;
      while (Date.now() - t0 < PREPARE_TIMEOUT_MS) {
        try {
          items = await prepare(doc.uri, pos);
        } catch (e) {
          REPORT.errors.push(`[${rootSpec.id}] prepareCallHierarchy threw: ${e && e.message}`);
          assert.fail(`prepareCallHierarchy threw: ${e && e.message}`);
        }
        if (Array.isArray(items) && items.length) break;
        await sleep(2000);
      }
      rec.prepareMs = Date.now() - t0;

      if (!Array.isArray(items) || !items.length) {
        log(`${rootSpec.id}: prepareCallHierarchy returned NOTHING after ${rec.prepareMs}ms.`);
        log('RESULT, not a failure: no call-hierarchy provider answered here, so BOTH directions');
        log('are unmeasurable for this root and the zeros below are about the rig.');
        return;
      }
      rec.prepared = true;
      const item = items[0];
      rec.rootItem = { name: String(item.name), kind: kindName(item.kind), rel: relOf(item.uri, wsRoot) };
      log(`${rootSpec.id}: prepared in ${rec.prepareMs}ms -> ${items.length} item(s), first = ` +
          `${JSON.stringify(item.name)} kind=${kindName(item.kind)} ${rec.rootItem.rel}`);

      // 2. OUTGOING, cold then warm.
      let out = null;
      const t1 = Date.now();
      try {
        out = await outgoing(item);
      } catch (e) {
        REPORT.errors.push(`[${rootSpec.id}] provideOutgoingCalls threw: ${e && e.message}`);
        rec.outgoingAnswered = 'THREW';
        assert.fail(`provideOutgoingCalls threw: ${e && e.message}`);
      }
      rec.outgoingMs = Date.now() - t1;
      rec.outgoingAnswered = Array.isArray(out) ? (out.length ? 'yes' : 'empty array') : String(out);

      const t2 = Date.now();
      try { await outgoing(item); } catch { /* recorded on the cold call */ }
      rec.outgoingWarmMs = Date.now() - t2;

      for (const call of out || []) {
        const to = call.to;
        const uri = to.uri;
        const fsPath = uri && uri.fsPath ? uri.fsPath : String(uri);
        const sel = to.selectionRange || to.range;
        const declLine = sel ? sel.start.line : 0;
        const d = docAbove(fsPath, declLine, LANG);
        const c = {
          name: String(to.name),
          kind: kindName(to.kind),
          detail: to.detail === undefined || to.detail === null ? null : String(to.detail),
          rel: relOf(uri, wsRoot),
          inWorkspace: fsPath.startsWith(wsRoot),
          line: declLine + 1,
          sites: Array.isArray(call.fromRanges) ? call.fromRanges.length : 0,
          doc: d.has,
          docKind: d.kind,
          docText: d.text,
        };
        rec.callees.push(c);
      }

      const withDoc = rec.callees.filter((c) => c.doc).length;
      log(`${rootSpec.id}: OUTGOING ${rec.outgoingAnswered} in ${rec.outgoingMs}ms cold / ${rec.outgoingWarmMs}ms warm; ` +
          `${rec.callees.length} callee(s), ${withDoc} with a doc comment`);
      for (const c of rec.callees) {
        log(`    callee ${JSON.stringify(c.name).padEnd(24)} kind=${c.kind} sites=${c.sites} ` +
            `${c.inWorkspace ? 'in-workspace' : 'EXTERNAL'} ${c.rel}:${c.line} ` +
            `doc=${c.doc ? 'YES' : 'no'} (${c.docKind})`);
        if (c.doc) log(`        ${JSON.stringify(String(c.docText).slice(0, 120))}`);
      }
      if (!rec.callees.length) {
        log(`${rootSpec.id}: RESULT, not a failure: outgoing calls came back EMPTY for a body that calls real functions.`);
      }

      // 3. INCOMING on the SAME root: the positive control.
      let inc = null;
      const t3 = Date.now();
      try {
        inc = await incoming(item);
      } catch (e) {
        REPORT.errors.push(`[${rootSpec.id}] provideIncomingCalls threw: ${e && e.message}`);
        rec.incomingAnswered = 'THREW';
        assert.fail(`provideIncomingCalls threw: ${e && e.message}`);
      }
      rec.incomingMs = Date.now() - t3;
      rec.incomingAnswered = Array.isArray(inc) ? (inc.length ? 'yes' : 'empty array') : String(inc);
      rec.incomingCount = (inc || []).length;
      rec.incoming = (inc || []).map((call) => ({
        name: String(call.from.name), rel: relOf(call.from.uri, wsRoot),
      }));
      log(`${rootSpec.id}: INCOMING (positive control) ${rec.incomingAnswered} in ${rec.incomingMs}ms; ` +
          `${rec.incomingCount} caller(s): ${rec.incoming.map((i) => i.name).join(', ') || '<none>'}`);

      if (!rec.callees.length && !rec.incomingCount) {
        log(`${rootSpec.id}: BOTH DIRECTIONS EMPTY. The rig did not fire on this root; do not read this as a language result.`);
      }
    });
  }

  test('zzz: neither call-hierarchy command threw', function () {
    if (REPORT.errors.length) { log('ERRORS RECORDED:'); for (const e of REPORT.errors) log(`  ${e}`); }
    assert.deepStrictEqual(REPORT.errors, [], 'no call-hierarchy command may throw');
  });
});
