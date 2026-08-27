// session-v60 PROBE: does the call-hierarchy walk work on its SHIPPING transport?
//
// The scout measured the walk headlessly: pyright over stdio for Python, a raw
// tsserver `provideCallHierarchyIncomingCalls` for TypeScript. Neither is what
// the product would run. In the product the walk goes through VS Code's
// `vscode.prepareCallHierarchy` / `vscode.provideIncomingCalls` commands, which
// dispatch to whatever provider the HOST has: Pylance for Python (proprietary,
// and NOT the pyright the headless leg used) and the TypeScript extension's own
// tsserver for TS. This file is the in-host half.
//
// It is a PROBE, not a contract. Nothing here asserts an answer the session does
// not already know. The only hard assertions are that the two commands do not
// throw; everything else is console.log, and the RUN OUTPUT is the measurement.
// A leg that returns nothing is a RESULT and is logged as one.
//
// Fixture: the authored shape from session-v60/harness/{pyfix,tsprobe}, copied
// INTO the label's workspace folder because every one of these servers only
// answers about files inside its project. Written in suiteSetup, removed in
// suiteTeardown, and nothing else in the repo is touched.
//
//   target  <- test_direct                 (depth 1)
//           <- wrapper   <- test_via_wrapper   (depth 2)
//           <- hub       <- test_hub_a/b/c     (depth 3)
//   unrelated <- test_unrelated             MUST NOT APPEAR
//
// Run (xvfb-run is not installed on the reference box; a display is up on :1,
// and this probe does NOT need a focused window - it never touches the widget -
// so a locked session is fine for it):
//
//   npm run build
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label python --grep V60PROBE
//   DISPLAY=:1 npx vscode-test --config test-vscode/.vscode-test.mjs --label ts     --grep V60PROBE

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { SPECS } = require('./helpers/specs');

const LANG = process.env.C80_LANG || 'ts';
const spec = SPECS[LANG];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KINDS = Object.keys(vscode.SymbolKind).filter((k) => isNaN(Number(k)));
const kindName = (k) => KINDS.find((n) => vscode.SymbolKind[n] === k) || String(k);

// How long to wait for a provider to exist at all. Pylance downloads nothing at
// this point but does index the workspace, and the fixture files are BRAND NEW
// on disk, so the watcher round trip is inside this window too.
const PREPARE_TIMEOUT_MS = 240000;

// --- the fixtures ------------------------------------------------------------

const FIXTURES = {
  python: {
    dir: 'c80_v60_probe',
    target: 'shape.py',
    needle: 'def target(',
    nameAt: 'def '.length,
    files: {
      '__init__.py': '',
      'shape.py': [
        'def target(n: int) -> int:',
        '    return n * 2',
        '',
        '',
        'def wrapper(n: int) -> int:',
        '    return target(n) + 1',
        '',
        '',
        'def hub(n: int) -> int:',
        '    return wrapper(n)',
        '',
        '',
        'def unrelated(n: int) -> int:',
        '    return n + 1',
        '',
      ].join('\n'),
      'test_shape.py': [
        'from c80_v60_probe.shape import target, wrapper, hub, unrelated',
        '',
        '',
        'def test_direct():',
        '    assert target(2) == 4',
        '',
        '',
        'def test_via_wrapper():',
        '    assert wrapper(2) == 5',
        '',
        '',
        'def test_hub_a():',
        '    assert hub(1) == 3',
        '',
        '',
        'def test_hub_b():',
        '    assert hub(2) == 5',
        '',
        '',
        'def test_hub_c():',
        '    assert hub(3) == 7',
        '',
        '',
        'def test_unrelated():',
        '    assert unrelated(1) == 2',
        '',
      ].join('\n'),
    },
    // pytest's convention is the declaration too: def test_* in a test_*.py
    isTest: (item, rel) => /(^|\/)test_[^/]*\.py$/.test(rel) && /^test_/.test(String(item.name)),
  },
  ts: {
    // playground/ carries a real tsconfig whose `include` is `src`, so the
    // fixture lands in a CONFIGURED project rather than an inferred one. An
    // inferred project only knows the files that happen to be open, which would
    // make "the walk found the callers" a fact about the editor's open tabs.
    dir: path.join('playground', 'src', 'c80-v60-probe'),
    target: 'shape.ts',
    needle: 'export function target(',
    nameAt: 'export function '.length,
    files: {
      'shape.ts': [
        'export function target(n: number): number {',
        '  return n * 2;',
        '}',
        '',
        'export function wrapper(n: number): number {',
        '  return target(n) + 1;',
        '}',
        '',
        'export function hub(n: number): number {',
        '  return wrapper(n);',
        '}',
        '',
        'export function unrelated(n: number): number {',
        '  return n + 1;',
        '}',
        '',
      ].join('\n'),
      // The callers are ARROW FUNCTIONS inside `test(...)` calls, which is the
      // whole point: that is the shape a real TS test suite has, and the
      // headless tsprobe found tsserver names the FILE rather than the test.
      'shape.test.ts': [
        "import { test } from 'node:test';",
        "import assert from 'node:assert';",
        "import { target, wrapper, hub, unrelated } from './shape';",
        '',
        "test('direct', () => {",
        '  assert.strictEqual(target(2), 4);',
        '});',
        '',
        "test('via wrapper', () => {",
        '  assert.strictEqual(wrapper(2), 5);',
        '});',
        '',
        "test('hub a', () => {",
        '  assert.strictEqual(hub(1), 3);',
        '});',
        '',
        "test('hub b', () => {",
        '  assert.strictEqual(hub(2), 5);',
        '});',
        '',
        "test('hub c', () => {",
        '  assert.strictEqual(hub(3), 7);',
        '});',
        '',
        "test('unrelated', () => {",
        '  assert.strictEqual(unrelated(1), 2);',
        '});',
        '',
      ].join('\n'),
    },
    isTest: (item, rel) => /\.test\.ts$/.test(rel),
  },
};

const FIX = FIXTURES[LANG];

function log(...lines) {
  for (const l of lines) console.log(`  [V60 ${LANG}] ${l}`);
}

// --- the walk ----------------------------------------------------------------

const prepare = (uri, pos) => vscode.commands.executeCommand('vscode.prepareCallHierarchy', uri, pos);
const incoming = (item) => vscode.commands.executeCommand('vscode.provideIncomingCalls', item);

function relOf(uri, root) {
  const p = uri && uri.fsPath ? uri.fsPath : String(uri);
  return p.startsWith(root) ? p.slice(root.length + 1) : p;
}

function describeItem(item, root) {
  const r = item.selectionRange || item.range;
  return {
    name: String(item.name),
    kind: kindName(item.kind),
    detail: item.detail === undefined || item.detail === null ? null : String(item.detail),
    rel: relOf(item.uri, root),
    line: r ? r.start.line + 1 : null,
  };
}

// BARE  = a plain identifier, no separators
// QUALIFIED = carries a container (dots, ::, parens, spaces)
// FILEPATH = the server named a file instead of a symbol
function nameShape(name, rel) {
  const n = String(name);
  if (n === path.basename(rel)) return 'FILE PATH';
  if (/[/\\]/.test(n) && /\.[a-z]+$/.test(n)) return 'FILE PATH';
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n)) return 'BARE';
  return 'QUALIFIED';
}

suite(`V60PROBE call hierarchy on the SHIPPING vscode transport [${LANG}]`, function () {
  this.timeout(600000);

  let root;
  let fixDir;
  let targetUri;
  let created = false;
  const findings = { prepared: null, items: [], byDepth: new Map(), errors: [], calls: 0 };

  suiteSetup(async function () {
    if (!FIX || !spec) {
      log(`no fixture defined for this label; the probe covers python and ts only. SKIPPED.`);
      return this.skip();
    }
    root = spec.repo;
    fixDir = path.join(root, FIX.dir);

    // What the host actually is. Pylance is proprietary and its presence is the
    // single fact that decides whether the python leg means anything.
    const thirdParty = vscode.extensions.all
      .filter((e) => !e.id.startsWith('vscode.') && !e.id.startsWith('ms-vscode.js-debug'))
      .map((e) => `${e.id}@${(e.packageJSON && e.packageJSON.version) || '?'}${e.isActive ? '' : ' (inactive)'}`);
    log('HOST EXTENSIONS: ' + (thirdParty.length ? thirdParty.join(', ') : '<none>'));
    log(`workspace folder: ${root}`);

    fs.mkdirSync(fixDir, { recursive: true });
    created = true;
    for (const [name, body] of Object.entries(FIX.files)) {
      fs.writeFileSync(path.join(fixDir, name), body, 'utf8');
    }
    log(`fixture written: ${path.join(FIX.dir, '')} (${Object.keys(FIX.files).join(', ')})`);

    // Open every fixture file. The servers index lazily and a file the editor
    // has never opened is, for some of them, a file that does not exist.
    for (const name of Object.keys(FIX.files)) {
      if (!name.endsWith('.py') && !name.endsWith('.ts')) continue;
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(fixDir, name)));
      await vscode.window.showTextDocument(doc, { preview: false });
    }
    // Give the server a beat to notice the new files before the first request.
    await sleep(5000);
  });

  suiteTeardown(async function () {
    try { await vscode.commands.executeCommand('workbench.action.closeAllEditors'); } catch {}
    if (created && fixDir) {
      try { fs.rmSync(fixDir, { recursive: true, force: true }); log('fixture removed'); } catch (e) {
        log(`fixture NOT removed: ${e && e.message}`);
      }
    }
  });

  test('1: prepareCallHierarchy answers on the target declaration', async function () {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(fixDir, FIX.target)));
    await vscode.window.showTextDocument(doc, { preview: false });
    targetUri = doc.uri;
    const text = doc.getText();
    const idx = text.indexOf(FIX.needle);
    assert.ok(idx >= 0, `needle ${JSON.stringify(FIX.needle)} not found in the fixture we just wrote`);
    const pos = doc.positionAt(idx + FIX.nameAt + 1); // one char INSIDE the name

    const started = Date.now();
    let roots = null;
    let lastErr = null;
    while (Date.now() - started < PREPARE_TIMEOUT_MS) {
      try {
        roots = await prepare(targetUri, pos);
      } catch (e) {
        lastErr = e;
        findings.errors.push(`prepareCallHierarchy threw: ${e && e.message}`);
        break;
      }
      if (Array.isArray(roots) && roots.length) break;
      await sleep(2000);
    }
    const ms = Date.now() - started;

    if (lastErr) {
      log(`prepareCallHierarchy THREW after ${ms}ms: ${lastErr && lastErr.message}`);
      assert.fail(`prepareCallHierarchy threw: ${lastErr && lastErr.message}`);
    }
    if (!Array.isArray(roots) || !roots.length) {
      findings.prepared = false;
      log(`prepareCallHierarchy returned NOTHING after ${ms}ms.`);
      log('RESULT, not a failure: this host has no call-hierarchy provider for this language,');
      log('or the provider never indexed the fixture. The walk cannot be built on this transport here.');
      return; // no throw == the only thing this probe hard-asserts
    }

    findings.prepared = true;
    findings.roots = roots.map((r) => describeItem(r, root));
    log(`prepareCallHierarchy: ${roots.length} item(s) in ${ms}ms`);
    for (const d of findings.roots) {
      log(`  root name=${JSON.stringify(d.name)} shape=${nameShape(d.name, d.rel)} kind=${d.kind} ` +
          `detail=${JSON.stringify(d.detail)} uri=${d.rel}:${d.line}`);
    }
  });

  test('2: provideIncomingCalls, breadth-first to depth 6', async function () {
    if (findings.prepared !== true) {
      log('skipped: prepareCallHierarchy returned nothing, so there is no root to walk from.');
      return this.skip();
    }
    const doc = await vscode.workspace.openTextDocument(targetUri);
    const text = doc.getText();
    const pos = doc.positionAt(text.indexOf(FIX.needle) + FIX.nameAt + 1);
    const roots = await prepare(targetUri, pos);

    const seen = new Set();
    let frontier = (roots || []).map((item) => ({ item, depth: 0 }));
    for (const n of frontier) seen.add(`${n.item.name}@${relOf(n.item.uri, root)}`);

    for (let d = 0; d < 6 && frontier.length; d++) {
      const next = [];
      for (const node of frontier) {
        let inc;
        try {
          inc = await incoming(node.item);
          findings.calls++;
        } catch (e) {
          findings.errors.push(`provideIncomingCalls threw at depth ${d}: ${e && e.message}`);
          assert.fail(`provideIncomingCalls threw: ${e && e.message}`);
        }
        for (const call of inc || []) {
          const from = call.from;
          const rel = relOf(from.uri, root);
          const key = `${from.name}@${rel}:${(from.selectionRange || from.range || { start: { line: -1 } }).start.line}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const info = describeItem(from, root);
          info.depth = node.depth + 1;
          info.fromRanges = Array.isArray(call.fromRanges) ? call.fromRanges.length : 0;
          info.isTest = !!FIX.isTest(from, rel);
          findings.items.push(info);
          if (!findings.byDepth.has(info.depth)) findings.byDepth.set(info.depth, []);
          findings.byDepth.get(info.depth).push(info);
          next.push({ item: from, depth: info.depth });
        }
      }
      frontier = next;
    }

    log(`provideIncomingCalls: ${findings.calls} request(s), ${findings.items.length} distinct caller(s)`);
    if (!findings.items.length) {
      log('RESULT, not a failure: incoming calls came back EMPTY for a target with five real callers.');
    }
    for (const [depth, list] of [...findings.byDepth.entries()].sort((a, b) => a[0] - b[0])) {
      for (const it of list) {
        log(`  depth ${depth}  name=${JSON.stringify(it.name)} shape=${nameShape(it.name, it.rel)} ` +
            `kind=${it.kind} detail=${JSON.stringify(it.detail)} uri=${it.rel}:${it.line} ` +
            `ranges=${it.fromRanges}${it.isTest ? '  <-- counts as a TEST' : ''}`);
      }
    }
  });

  test('3: the authored graph vs what the transport found', function () {
    if (findings.prepared !== true) {
      log('skipped: nothing was walked.');
      return this.skip();
    }
    const want = { test_direct: 1, test_via_wrapper: 2, test_hub_a: 3, test_hub_b: 3, test_hub_c: 3 };
    const got = new Map();
    for (const it of findings.items) {
      if (!got.has(it.name) || got.get(it.name) > it.depth) got.set(it.name, it.depth);
    }

    if (LANG === 'python') {
      log('AUTHORED shape vs the in-host walk:');
      let exact = true;
      for (const [n, d] of Object.entries(want)) {
        const g = got.get(n);
        if (g !== d) exact = false;
        log(`  ${n.padEnd(16)} authored depth ${d}   walk ${g === undefined ? 'NOT FOUND' : g}  ${g === d ? 'ok' : 'MISMATCH'}`);
      }
      const stray = got.has('test_unrelated');
      log(`  ${'test_unrelated'.padEnd(16)} must NOT appear      walk ${stray ? 'FOUND - FALSE POSITIVE' : 'absent  ok'}`);
      log(`GRANULARITY: ${findings.items.some((i) => i.isTest) ? 'TEST-LEVEL - the walk names individual test functions' : 'NOT test-level'}`);
      log(`VERDICT: ${exact && !stray ? 'matches the authored graph exactly' : 'DIVERGES from the authored graph'}`);
    } else {
      // TS: the headless tsprobe found tsserver names the FILE, because the
      // callers are anonymous arrow functions. Report what the shipping
      // transport does, without assuming it agrees.
      const shapes = new Set(findings.items.map((i) => nameShape(i.name, i.rel)));
      const testish = findings.items.filter((i) => i.isTest);
      log('what the transport named as callers:');
      for (const it of findings.items) {
        log(`  depth ${it.depth}  ${JSON.stringify(it.name)}  shape=${nameShape(it.name, it.rel)}  kind=${it.kind}  ${it.rel}:${it.line}`);
      }
      log(`name shapes seen: ${[...shapes].join(', ') || '<none>'}`);
      log(`callers landing in a *.test.ts file: ${testish.length}`);
      log(`GRANULARITY: ${
        findings.items.some((i) => /^test_|^test /.test(i.name)) ? 'TEST-LEVEL'
          : shapes.has('FILE PATH') ? 'FILE-LEVEL - the transport names the file, not the test'
          : 'see the names above'}`);
      const stray = findings.items.some((i) => /unrelated/i.test(i.name));
      log(`a caller mentioning "unrelated": ${stray ? 'PRESENT' : 'absent'} (at file granularity every test shares one node, so presence is expected)`);
    }

    if (findings.errors.length) {
      log('ERRORS RECORDED:');
      for (const e of findings.errors) log(`  ${e}`);
    }
    // The only contract this probe holds anyone to.
    assert.deepStrictEqual(findings.errors, [], 'neither call-hierarchy command may throw');
  });
});
